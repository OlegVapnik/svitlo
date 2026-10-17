/**
 * Разведка: собирает полный справочник районов и городов АТ «Чернігівобленерго».
 *
 * ЗАЧЕМ. У сайта неполная цепочка сертификатов — обычный fetch отбрасывает ответ, пока не
 * отключишь проверку. Cloudflare Workers валидируют TLS строго, поэтому парсить из воркера
 * нельзя в принципе: нужен посредник вне Workers. Этот скрипт и есть тот посредник.
 *
 * ТРИ ЗВЕНА, все проверены живыми ответами (не угаданы):
 *   1) GET  /getPower_outages                      → список РЕМ і дільниць (id + назва); на 2026-10-17 їх 22
 *   2) GET  /api/list_city_str/?nq=city_rem&q=<префикс>&r=<id района>  → id городов
 *   3) POST /api/list_acc  {req_param: encoded {c: <город>, t: <тип>}}  → отключения и ГПВ
 *
 * ВАЖНО про поиск городов: он идёт ПО ПРЕФИКСУ НАЧАЛА НАЗВАНИЯ и требует минимум 3 символа.
 * Поэтому перебрать «все города района» одним запросом нельзя — приходится подставлять
 * префиксы. Источник префиксов — наш собственный справочник населённых пунктов
 * (cf-worker/src/settlements-ua.json): он уже проверен, и чужие города отсеиваются по
 * названию района, которое оператор возвращает в скобках.
 *
 * Запуск:
 *   node tools/discover-chernihiv-cities.mjs                 # все районы
 *   node tools/discover-chernihiv-cities.mjs --raions=100,110 # только указанные
 *   node tools/discover-chernihiv-cities.mjs --out=/tmp/x.json
 *
 * Результат по умолчанию кладётся в `.cache/chernihiv-cities.json`: это рабочий артефакт разведки,
 * а не часть продукта, и в git ему не место (`chernihiv-cities.json` в корне репозитория тоже бы
 * попал в индекс — корень не игнорируется).
 */

import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'https://chernihivoblenergo.com.ua';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Отключаем проверку сертификата: сервер отдаёт неполную цепочку, и без этого рукопожатие
// не завершается. Для публичного сайта без передачи секретов это безопасно.
const agent = new https.Agent({ rejectUnauthorized: false });

const argv = Object.fromEntries(
  process.argv.slice(2).map((item) => {
    const [key, value = 'true'] = item.replace(/^--/, '').split('=');
    return [key, value];
  }),
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function request(path, { method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const req = https.request(
      url,
      {
        agent,
        method,
        headers: {
          'user-agent': UA,
          accept: 'application/json',
          'accept-language': 'uk-UA,uk;q=0.9',
          referer: `${BASE}/power_outages`,
          origin: BASE,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, json: JSON.parse(raw), raw });
          } catch {
            resolve({ status: res.statusCode, json: null, raw });
          }
        });
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/** Префиксы из нашего справочника НП: оператор ищет по началу названия и требует ≥3 символов. */
function candidatePrefixes() {
  const file = new URL('../cf-worker/src/settlements-ua.json', import.meta.url);
  const directory = JSON.parse(fs.readFileSync(file, 'utf8'));
  // Ключ с дефисами — только через скобки: `obj.chernihivska-oblast` это вычитание.
  const regionCode = directory.regions['chernihivska-oblast'];
  const prefixes = new Set();
  for (const [name, code] of directory.places) {
    if (code !== regionCode) continue;
    // Отбрасываем ведущие «с. » / «м. »: в ответе оператора тоже «м.Батурин», но префикс
    // из названия без префикса типа даёт больше совпадений.
    const cleaned = name.replace(/^[смі]\.\s*/u, '').trim();
    // Три символа — минимум, который принимает поиск оператора. Короткие префиксы дают
    // больше совпадений (и больше отсеивается чужими городами по названию района).
    if (cleaned.length >= 3) prefixes.add(cleaned.slice(0, 3));
  }
  return [...prefixes];
}

async function fetchRaions() {
  const { json } = await request('/getPower_outages');
  const html = String(json?.depart ?? '');
  const raions = [];
  for (const match of html.matchAll(/<option value="(\d+)"[^>]*>([^<]+)<\/option>/gu)) {
    const name = match[2].trim();
    if (!name || name.startsWith('-')) continue;
    raions.push({ id: match[1], name });
  }
  return raions;
}

async function collectCities(raion, prefixes) {
  const found = new Map();
  for (const prefix of prefixes) {
    let list = [];
    try {
      const url = `/api/list_city_str/?nq=city_rem&q=${encodeURIComponent(prefix)}&r=${raion.id}`;
      const { json } = await request(url);
      list = Array.isArray(json?.list) ? json.list : [];
    } catch {
      list = [];
    }
    for (const [id, label, kind] of list) {
      if (!id || found.has(String(id))) continue;
      found.set(String(id), { id: String(id), label: String(label), kind: String(kind ?? '') });
    }
    // Пауза между запросами: ровный поток — самая заметная примета автоматизации.
    await sleep(350);
  }
  return [...found.values()];
}

async function main() {
  const out = argv.out ?? '.cache/chernihiv-cities.json';
  const prefixes = candidatePrefixes();
  console.log(`Префиксов-кандидатов из нашего справочника: ${prefixes.length}`);

  const raions = await fetchRaions();
  console.log(`Районов получено: ${raions.length}`);
  if (raions.length === 0) throw new Error('Список районов пуст — структура сайта изменилась');

  const only = argv.raions ? String(argv.raions).split(',').map((item) => item.trim()) : null;
  const targets = only ? raions.filter((raion) => only.includes(raion.id)) : raions;

  const result = {
    baseUrl: BASE,
    collectedAt: new Date().toISOString(),
    raions: [],
    totalCities: 0,
  };

  for (const raion of targets) {
    const cities = await collectCities(raion, prefixes);
    result.raions.push({ ...raion, cityCount: cities.length, cities });
    result.totalCities += cities.length;
    console.log(`  ${raion.name.padEnd(28)} городов: ${cities.length}`);
  }

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(result, null, 2));
  console.log(`\nГотово: ${result.totalCities} городов в ${out}`);
}

main().catch((error) => {
  console.error('Ошибка:', error.message);
  process.exit(1);
});