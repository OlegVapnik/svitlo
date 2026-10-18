#!/usr/bin/env node
/**
 * import-osm-streets.mjs — наполняет D1 реальными названиями улиц из OpenStreetMap.
 *
 * Зачем отдельный импорт. В `address_queues` лежит привязка «дом → очередь», но её нельзя
 * выдумать: если оператор не опубликовал соответствие улицы группе, честного ответа нет. Зато
 * сами улицы — публичные данные OSM. Они позволяют человеку найти свою улицу в подсказках, а
 * очередь он может привязать сам через мастер адреса (source='community').
 *
 * Что пишем:
 *   - directory_settlements — города из списка ниже (source='osm');
 *   - directory_streets — реальные названия улиц, без очередей и без выдуманных диапазонов домов.
 *
 * Никаких `address_queues` этот скрипт не создаёт: очередь нельзя вывести из OSM, а подставить
 * «похожую» группу значило бы показать человеку чужое отключение.
 *
 * Использование:
 *   node tools/import-osm-streets.mjs                    # собрать SQL, ничего не заливая
 *   node tools/import-osm-streets.mjs --apply            # залить в продовую D1
 *   node tools/import-osm-streets.mjs --apply --local    # залить в локальную D1
 *   node tools/import-osm-streets.mjs --limit 200        # не больше 200 улиц на город
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(import.meta.dirname, '..');
const WRANGLER = process.env.SVITLO_WRANGLER ?? path.join(REPO, 'cf-worker/node_modules/.bin/wrangler');
const WRANGLER_CONFIG = path.join(REPO, 'cf-worker/wrangler.toml');
const D1_NAME = process.env.SVITLO_D1_NAME ?? 'svitlo';
const OUT_DIR = process.env.SVITLO_OSM_DIR ?? path.join(REPO, '.cache/osm-streets');
const USER_AGENT = 'SvitloUA/2.15 (+https://svitlo-ua-4ze.pages.dev; directory import)';
const OVERPASS_ENDPOINTS = [
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

/**
 * Города и их bbox из OSM (Nominatim, 2026-10-18). Границы зафиксированы, чтобы импорт был
 * воспроизводимым и не зависел от лимитов публичного Nominatim.
 */
const CITIES = [
  { name: 'Чернігів', region: 'chernihivska-oblast', bbox: [51.4367, 31.2071, 51.5494, 31.3824] },
  { name: 'Ніжин', region: 'chernihivska-oblast', bbox: [50.9869, 31.8028, 51.0963, 31.9443] },
  { name: 'Прилуки', region: 'chernihivska-oblast', bbox: [50.5506, 32.2940, 50.6262, 32.4435] },
  { name: 'Бахмач', region: 'chernihivska-oblast', bbox: [51.1456, 32.7785, 51.1986, 32.8756] },
  { name: 'Київ', region: 'kyiv-city', bbox: [50.2132, 30.2361, 50.5908, 30.8264] },
  { name: 'Біла Церква', region: 'kyivska-oblast', bbox: [49.7569, 30.0209, 49.8543, 30.2225] },
  { name: 'Бровари', region: 'kyivska-oblast', bbox: [50.4823, 30.7376, 50.5371, 30.8641] },
  { name: 'Ірпінь', region: 'kyivska-oblast', bbox: [50.4728, 30.1891, 50.5518, 30.2927] },
  {
    name: 'Дніпро',
    region: 'dnipropetrovska-oblast',
    // ЦЕК і ДнЕМ — окремі мережі в каталозі областей; улицы города одинаковые, поэтому дублируем
    // справочник под всеми тремя ключами, иначе подсказки пропадали бы при выборе сети.
    extraRegions: ['dnipro-cek', 'dnipro-dnem'],
    bbox: [48.3559, 34.7489, 48.5764, 35.2422],
  },
  { name: 'Львів', region: 'lvivska-oblast', bbox: [49.7682, 23.8981, 49.9037, 24.1334] },
  { name: 'Полтава', region: 'poltavska-oblast', bbox: [49.5477, 34.4468, 49.6579, 34.6603] },
  { name: 'Черкаси', region: 'cherkaska-oblast', bbox: [49.3650, 31.9589, 49.4976, 32.1250] },
  { name: 'Харків', region: 'kharkivska-oblast', bbox: [49.8785, 36.1056, 50.1048, 36.4555] },
  { name: 'Житомир', region: 'zhytomyrska-oblast', bbox: [50.2234, 28.5911, 50.3085, 28.7560] },
];

const HIGHWAY_PRIORITY = {
  primary: 0,
  secondary: 1,
  tertiary: 2,
  residential: 3,
  unclassified: 4,
  living_street: 5,
};

function parseArgs(args) {
  const options = { apply: false, local: false, limit: 220, only: null };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--local') options.local = true;
    else if (arg === '--limit') options.limit = Math.max(1, Number(args[++index]) || options.limit);
    else if (arg === '--city') options.only = args[++index] ?? null;
  }
  return options;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJson(url, init = {}, attempts = 3) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(120_000),
        headers: { 'user-agent': USER_AGENT, accept: 'application/json', ...(init.headers ?? {}) },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      await sleep(1200 * (attempt + 1));
    }
  }
  throw lastError ?? new Error('request failed');
}

/** Копия normalizeAddress из cf-worker/src/address.ts: ключи должны совпадать с поиском. */
function normalizeAddress(raw) {
  const map = { 'ы': 'и', 'э': 'е', 'ё': 'е', 'ї': 'і', 'и': 'і' };
  let value = String(raw ?? '')
    .toLowerCase()
    .replace(/[ыэёїи]/gu, (char) => map[char] ?? char);
  value = value.replace(/[[\]{}()<>,.;:"'`«»/\\|!?*_+%$#@~^&=—–-]/gu, ' ');
  value = value.replace(/\s+/gu, ' ').trim();
  value = value.replace(/^(вулиця|вул|улица|ул|проспект|просп|провулок|пров|переулок|пер|село|с\.?)\s+/u, '');
  return value.trim();
}

/** Границы города уже зафиксированы в CITIES — сеть нужна только для Overpass. */
function findCityArea(city) {
  if (!city.bbox) throw new Error(`Для «${city.name}» не задан bbox OSM`);
  return { bbox: city.bbox, displayName: city.name };
}

/** Запрашивает улицы внутри bbox города. Сначала магистрали, потом жилые. */
async function fetchStreets(area, limit) {
  const [south, west, north, east] = area.bbox;
  // 20 000 — с запасом: в Киеве больше трёх тысяч именованных участков, и при меньшем лимите
  // Overpass отдавал случайное подмножество, из-за чего центр города (например, Хрещатик)
  // мог не попасть в справочник вовсе.
  const query = `[out:json][timeout:90];way(${south},${west},${north},${east})["highway"~"^(primary|secondary|tertiary|residential|unclassified|living_street)$"]["name"];out tags 20000;`;
  let lastError = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const payload = await fetchJson(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: new URLSearchParams({ data: query }).toString(),
      });
      const unique = new Map();
      for (const element of payload.elements ?? []) {
        const name = String(element.tags?.name ?? '').trim();
        const highway = String(element.tags?.highway ?? '');
        const normalized = normalizeAddress(name);
        if (!name || !normalized || normalized.length < 2) continue;
        const priority = HIGHWAY_PRIORITY[highway] ?? 9;
        const previous = unique.get(normalized);
        if (!previous || priority < previous.priority) unique.set(normalized, { name, normalized, priority });
      }
      return [...unique.values()]
        .sort((left, right) => left.priority - right.priority || left.name.localeCompare(right.name, 'uk'))
        .slice(0, limit);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error('Overpass недоступен');
}

function sqlLiteral(value) {
  return `'${String(value).replace(/'/gu, "''")}'`;
}

function writeCitySql(city, streets) {
  if (streets.length === 0) throw new Error(`OSM не вернул улиц для «${city.name}»`);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const settlement = normalizeAddress(city.name);
  const file = path.join(OUT_DIR, `${city.region}__${settlement}.sql`);
  const values = streets
    .map((street) => `  (${sqlLiteral(city.region)}, ${sqlLiteral(settlement)}, ${sqlLiteral(street.name)}, ${sqlLiteral(street.normalized)}, 'osm')`)
    .join(',\n');
  const body = [
    `-- Реальные улицы OSM для ${city.name}. Очереди здесь НЕТ: её нельзя вывести из OSM.`,
    `INSERT OR IGNORE INTO directory_settlements (region, name, normalized, source)`,
    `VALUES (${sqlLiteral(city.region)}, ${sqlLiteral(city.name)}, ${sqlLiteral(settlement)}, 'osm');`,
    '',
    `INSERT OR IGNORE INTO directory_streets (region, settlement_normalized, name, normalized, source)`,
    `VALUES`,
    `${values};`,
    '',
  ].join('\n');
  fs.writeFileSync(file, body, 'utf8');
  return { file, bytes: Buffer.byteLength(body) };
}


function applyFile(file, useLocal) {
  const args = ['d1', 'execute', D1_NAME, useLocal ? '--local' : '--remote', '--config', WRANGLER_CONFIG, `--file=${file}`, '--yes'];
  const result = spawnSync(WRANGLER, args, { encoding: 'utf8', cwd: REPO, maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`${result.stdout ?? ''}${result.stderr ?? ''}`.trim() || 'wrangler завершился с ошибкой');
  }
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const start = output.indexOf('[');
  const end = output.lastIndexOf(']');
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(output.slice(start, end + 1));
      return (Array.isArray(parsed) ? parsed : [parsed]).reduce((sum, item) => sum + Number(item?.meta?.changes ?? 0), 0);
    } catch {
      return null;
    }
  }
  return null;
}

function d1Counts(useLocal) {
  const sql = 'SELECT (SELECT count(*) FROM directory_settlements) AS settlements, ' +
    '(SELECT count(*) FROM directory_streets) AS streets, (SELECT count(*) FROM address_queues) AS bindings';
  const args = ['d1', 'execute', D1_NAME, useLocal ? '--local' : '--remote', '--config', WRANGLER_CONFIG, '--json', `--command=${sql}`];
  const result = spawnSync(WRANGLER, args, { encoding: 'utf8', cwd: REPO, maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) return null;
  try {
    return JSON.parse(result.stdout)?.[0]?.results?.[0] ?? null;
  } catch {
    return null;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const cities = options.only ? CITIES.filter((city) => city.name === options.only) : CITIES;
  if (cities.length === 0) throw new Error(`Город «${options.only}» не найден в списке`);

  console.log(`OSM → D1: ${cities.length} городов, до ${options.limit} улиц на город`);
  const files = [];
  for (const city of cities) {
    try {
      const area = findCityArea(city);
      const streets = await fetchStreets(area, options.limit);
      const regions = [city.region, ...(city.extraRegions ?? [])];
      let bytes = 0;
      for (const region of regions) {
        const written = writeCitySql({ ...city, region }, streets);
        files.push({ city, region, ...written, count: streets.length });
        bytes += written.bytes;
      }
      console.log(`  ${city.name} [${regions.join(', ')}] — ${streets.length} улиц, ${(bytes / 1024).toFixed(0)} КБ`);
    } catch (error) {
      console.log(`  ! ${city.name}: ${error.message}`);
    }
    await sleep(1800);
  }

  console.log('');
  console.log(`SQL: ${files.length} файлов в ${path.relative(REPO, OUT_DIR)}`);
  if (!options.apply) {
    console.log('Сухой прогон: ничего не залито. Применить: node tools/import-osm-streets.mjs --apply');
    return;
  }

  let changes = 0;
  for (const item of files) {
    try {
      const applied = applyFile(item.file, options.local);
      changes += applied ?? 0;
      console.log(`  залито ${item.city.name} [${item.region ?? item.city.region}]: ${applied ?? '?'} строк`);
    } catch (error) {
      console.log(`  ! ${item.city.name}: ${error.message.split('\n')[0]}`);
    }
  }

  const counts = d1Counts(options.local);
  console.log('');
  console.log(`Готово, изменений ${changes}.`);
  console.log(counts
    ? `D1: directory_settlements=${counts.settlements}, directory_streets=${counts.streets}, address_queues=${counts.bindings}`
    : 'D1: счётчики не прочитались');
}

await main();

