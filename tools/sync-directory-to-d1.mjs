#!/usr/bin/env node
/**
 * sync-directory-to-d1.mjs — переносит справочник адресов в продовую базу Cloudflare D1.
 *
 * Зачем. `deploy-cf.sh` раскатывал схему и воркер, но не данные справочника. На облачном пути
 * (PWA и Android-сборка ходят именно в Worker) это выглядело так: поиск населённого пункта в
 * мастере адреса находил одно село из 1311, потому что `directory_settlements` в D1 была почти
 * пуста, а реестр КОАТУУ лежал только рядом с Node-бэкендом. Здесь этот разрыв закрыт одной
 * идемпотентной командой.
 *
 * Источники — все настоящие, ничего не выдумано:
 *   1. `apps/api/src/providers/data/settlement-directory.json` — реестр КОАТУУ Чернігівщини
 *      (тот же файл, что читает Node-бэкенд: 1509 записей → 1310 уникальных нормализованных имён).
 *   2. `cf-worker/src/settlements-ua.json` — дамп GeoNames: города и центры громад остальных
 *      областей (воркер ищет по нему в памяти, а в D1 его не было вовсе).
 *   3. Локальная PostgreSQL, если поднята: `address_queues` (привязки «адрес → черга») и
 *      `settlements` (названия населённых пунктов). `settlement_queues` в привязки не переносим:
 *      это перечень групп населённого пункта, а не «вся улица относится к одной группе». Без работающей
 *      базы скрипт не падает: справочник НП переносится из файлов репозитория, а о пропущенной
 *      части он честно сообщает.
 *
 * Ключи `normalized` считает `normalizeAddress` из `cf-worker/src/address.ts` — тот же код, что
 * потом ищет по этим ключам в облаке. Если посчитать их иначе (например, SQL-функцией
 * `energy_normalize_address`), в базе лежали бы одни строки, а воркер искал бы другие, и поиск
 * молча не находил бы ничего.
 *
 * Идемпотентность: `directory_*` — `INSERT OR IGNORE`; `address_queues` — upsert с условием
 * `source <> 'community'`. Повторный запуск ничего не портит и НЕ перетирает привязки, которые
 * люди или парсер воркера уже положили в D1.
 *
 * Использование:
 *   node tools/sync-directory-to-d1.mjs                   # собрать SQL-батчи, ничего не заливая
 *   node tools/sync-directory-to-d1.mjs --apply           # залить в продовую D1
 *   node tools/sync-directory-to-d1.mjs --apply --verify  # залить и проверить D1 и живой /sync
 *   node tools/sync-directory-to-d1.mjs --apply --local   # залить в локальную D1 (wrangler dev)
 *   node tools/sync-directory-to-d1.mjs --only settlements
 *
 * Переменные окружения: SVITLO_WRANGLER, SVITLO_D1_NAME, SVITLO_D1_DIR (куда писать SQL),
 * SVITLO_DB_USER / SVITLO_DB_NAME (локальная PostgreSQL), SVITLO_WORKER_BASE и
 * SVITLO_VERIFY_REGION (для --verify).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(import.meta.dirname, '..');
const KATOTTG_FILE = path.join(REPO, 'apps/api/src/providers/data/settlement-directory.json');
const GEOJSON_FILE = path.join(REPO, 'cf-worker/src/settlements-ua.json');
const WRANGLER = process.env.SVITLO_WRANGLER ?? path.join(REPO, 'cf-worker/node_modules/.bin/wrangler');
const WRANGLER_CONFIG = path.join(REPO, 'cf-worker/wrangler.toml');
const D1_NAME = process.env.SVITLO_D1_NAME ?? 'svitlo';
const OUT_DIR = process.env.SVITLO_D1_DIR ?? path.join(REPO, '.cache/d1-directory');
const WORKER_BASE = process.env.SVITLO_WORKER_BASE ?? 'https://svitlo-api.olegvapnik45.workers.dev';
const VERIFY_REGION = process.env.SVITLO_VERIFY_REGION ?? 'chernihivska-oblast';
const DB_USER = process.env.SVITLO_DB_USER ?? 'svitlo';
const DB_NAME = process.env.SVITLO_DB_NAME ?? 'svitlo';

// Лимиты D1/SQLite: 999 связанных параметров на запрос и ~1 МБ на пакет. Мы пишем значения
// прямо в текст оператора (экранирование ниже), поэтому ограничение только по размеру строки:
// 100 строк на оператор и 2 МБ на файл — заведомо внутри того, что принимает wrangler.
const ROWS_PER_STATEMENT = 100;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

function log(message) {
  process.stdout.write(`${message}\n`);
}

function fatal(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

/** Разбор аргументов: только то, что реально нужно, без внешних зависимостей. */
function parseArgs(argv) {
  const options = { apply: false, local: false, verify: false, only: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--local') options.local = true;
    else if (arg === '--verify') options.verify = true;
    else if (arg === '--only') {
      const values = (argv[index + 1] ?? '').split(',').map((item) => item.trim()).filter(Boolean);
      options.only = new Set(values);
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      log('См. комментарий в начале tools/sync-directory-to-d1.mjs: там все режимы и переменные окружения.');
      process.exit(0);
    } else {
      fatal(`неизвестный аргумент: ${arg} (--help покажет подсказку)`);
    }
  }
  return options;
}

// ── Нормализация ключей ──────────────────────────────────────────────────────
// Статический import .ts из .mjs работает не на всяком Node: type-stripping включён по умолчанию
// с 22.18. Проверяем версию заранее, иначе человек увидел бы невнятную синтаксическую ошибку
// вместо внятного «обновите Node».
function requireTypeStrippingNode() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 18)) {
    fatal(`нужен Node 22.18+ (сейчас ${process.versions.node}): скрипт читает normalizeAddress из cf-worker/src/address.ts`);
  }
}

async function loadNormalizer() {
  requireTypeStrippingNode();
  const address = await import(path.join(REPO, 'cf-worker/src/address.ts'));
  const directory = await import(path.join(REPO, 'apps/api/src/providers/settlement-directory.ts'));
  const guard = await import(path.join(REPO, 'apps/api/src/services/directory-guard.ts'));
  return {
    normalizeAddress: address.normalizeAddress,
    REGION_KATOTTG: directory.REGION_KATOTTG,
    assertDirectoryNamesClean: guard.assertDirectoryNamesClean,
  };
}

/** Значение как SQL-литерал: кавычки удваиваются, управляющие символы вырезаются. */
function sqlLiteral(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  const text = String(value)
    // eslint-disable-next-line no-control-regex — управляющие символы в SQLite не нужны
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/gu, '')
    .replace(/'/gu, "''");
  return `'${text}'`;
}

/** Режем строки на операторы по 100 значений: файл остаётся читаемым, а оператор — коротким. */
function* chunks(rows, size) {
  for (let index = 0; index < rows.length; index += size) {
    yield rows.slice(index, index + size);
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    fatal(`не читается ${path.relative(REPO, file)}: ${error.message}`);
    return null;
  }
}

function relative(file) {
  return path.relative(REPO, file);
}

// ── Локальная PostgreSQL (необязательный источник) ───────────────────────────
// Два пути к базе: `psql` в PATH (быстро) и `docker compose exec db psql` (штатный способ этого
// репозитория). Если не сработал ни один — это не ошибка: справочник НП всё равно поедет из
// файлов репозитория, а про привязки скрипт честно скажет, что их взять негде.
let dbStrategy = null; // null — ещё не проверяли, false — недоступна, иначе имя сработавшей команды

function parseJsonLines(stdout) {
  const rows = [];
  let broken = 0;
  for (const line of String(stdout ?? '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed));
    } catch {
      broken += 1;
    }
  }
  return { rows, broken };
}

/** Выполняет SQL и возвращает строки как объекты (PostgreSQL сам сериализует их в JSON). */
function queryJson(sql) {
  const command = `SELECT row_to_json(t) FROM (${sql}) t`;
  const psqlArgs = ['-U', DB_USER, '-d', DB_NAME, '-At', '-v', 'ON_ERROR_STOP=1', '-c', command];
  const attempts = dbStrategy === 'docker'
    ? [['docker', ['compose', 'exec', '-T', 'db', 'psql', ...psqlArgs]]]
    : dbStrategy === 'psql'
      ? [['psql', psqlArgs]]
      : [['psql', psqlArgs], ['docker', ['compose', 'exec', '-T', 'db', 'psql', ...psqlArgs]]];

  let reason = 'ни psql, ни docker compose не отвечают';
  for (const [command_, args] of attempts) {
    const result = spawnSync(command_, args, { encoding: 'utf8', cwd: REPO, maxBuffer: 128 * 1024 * 1024 });
    // Команды нет в системе — это не ошибка запуска, просто пробуем следующий способ.
    if (result.error?.code === 'ENOENT') continue;
    if (result.status !== 0) {
      reason = (result.stderr ?? '').trim().split('\n').find((line) => line.trim()) ?? `код ${result.status}`;
      continue;
    }
    dbStrategy = command_;
    return { ok: true, ...parseJsonLines(result.stdout) };
  }
  dbStrategy = false;
  return { ok: false, reason };
}

const DB_QUERIES = {
  regionNames: `SELECT cpu, name_ua FROM regions WHERE name_ua IS NOT NULL`,
  settlements: `SELECT region, name FROM settlements WHERE name <> ''`,
  addressQueues: `SELECT region, settlement_name, street_name, house_pattern, queue, source, updated_at
                  FROM address_queues WHERE settlement_name <> ''`,
  settlementQueues: `SELECT s.region, s.name AS settlement_name, sq.queue, sq.source, sq.last_seen_at
                     FROM settlement_queues sq JOIN settlements s ON s.id = sq.settlement_id
                     ORDER BY s.region, s.name, sq.queue`,
  streetQueueCount: `SELECT count(*)::int AS total FROM street_queues`,
};

/**
 * Читает локальные привязки адресов. Возвращает `{ available, addressQueues, settlementQueues,
 * regionNames, streetQueues, reason }`.
 */
function loadLocalDatabase() {
  const empty = {
    available: false,
    addressQueues: [],
    settlementQueues: [],
    localSettlements: [],
    regionNames: new Set(),
    streetQueues: 0,
    reason: '',
  };
  const probe = queryJson('SELECT 1 AS ok');
  if (!probe.ok) return { ...empty, reason: probe.reason };

  const addressQueues = queryJson(DB_QUERIES.addressQueues);
  const settlementQueues = queryJson(DB_QUERIES.settlementQueues);
  const settlements = queryJson(DB_QUERIES.settlements);
  const regionNames = queryJson(DB_QUERIES.regionNames);
  const streetQueues = queryJson(DB_QUERIES.streetQueueCount);

  if (!addressQueues.ok || !settlementQueues.ok) {
    // Частично прочитанная база опаснее непрочитанной: перенесли бы половину привязок и решили,
    // что это все. Поэтому при любой ошибке считаем источник недоступным целиком.
    return {
      ...empty,
      reason: `запрос отвалился (${addressQueues.ok ? settlementQueues.reason : addressQueues.reason})`,
    };
  }

  return {
    available: true,
    addressQueues: addressQueues.rows,
    settlementQueues: settlementQueues.rows,
    // Реальные НП из базы провайдеров: подсказки по областям, для которых реестра КОАТУУ ещё нет.
    localSettlements: settlements.ok ? settlements.rows : [],
    regionNames: new Set(
      regionNames.ok
        ? regionNames.rows.flatMap((row) => {
            const name = String(row.name_ua ?? '').trim().toLocaleLowerCase('uk-UA');
            if (!name) return [];
            // Помимо самого названия области держим его «прилагательную» форму: зеркало называет
            // агрегаты по-разному («Чернігівська область», «Полтавська»), и без второго варианта
            // «Полтавська» уехала бы в D1 населённым пунктом.
            return [name.replace(/\s*область$/u, '')];
          })
        : [],
    ),
    streetQueues: streetQueues.ok ? Number(streetQueues.rows[0]?.total ?? 0) : 0,
    reason: '',
  };
}

/** Время для D1 (TEXT): ISO-строка; нераспознанное значение заменяем моментом синхронизации. */
function isoTime(value) {
  if (!value) return new Date().toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

/**
 * Собирает строки для D1 и пересчитывает ключи `normalized` через normalizeAddress.
 *
 * Пересчёт обязателен и для строк из PostgreSQL: там ключи считает SQL-функция
 * `energy_normalize_address`, а воркер в облаке сравнивает адрес со своим JS-результатом.
 *
 * Названия областей из локальной базы (`Чернігівська область`) не переносим: таблица
 * `settlements` зеркала кладёт туда агрегат целой области, а справочник НП — это места, куда
 * человек вводит адрес. Иначе в подсказках появилось бы «Черкаська область» как населённый пункт.
 */
function buildRows(sources, normalizeAddress) {
  const settlements = new Map();
  const bindings = new Map();
  const streets = new Map();

  const isRegionLike = (name) => {
    const normalized = normalizeAddress(name);
    if (!normalized) return true;
    if (sources.regionNames.has(normalized)) return true;
    return /(^|\s)(область|обл)$/u.test(normalized);
  };

  // Строки из локальной базы фильтруем ДО сборки: агрегат области (`Чернігівська область`) —
  // это не населённый пункт, и в подсказках адреса ему не место. Файловые справочники (реестр
  // КОАТУУ и GeoNames) фильтру не подлежат: там заведомо только НП.
  // `duplicates` — не ошибка, а следствие ключа D1: он допускает одну чергу на адрес, поэтому у
  // НП с несколькими чергами остаётся первая (запросы к базе отсортированы по коду черги).
  const skipped = { regionLike: 0, examples: [], duplicates: 0 };
  const dropRegionLike = (rows, pick) => rows.filter((row) => {
    const name = String(pick(row) ?? '').trim();
    if (name && !isRegionLike(name)) return true;
    if (name) {
      skipped.regionLike += 1;
      if (skipped.examples.length < 3) skipped.examples.push(`${row.region}: ${name}`);
    }
    return false;
  });
  const localSettlements = dropRegionLike(sources.localSettlements, (row) => row.name);
  const localQueues = dropRegionLike(sources.settlementQueues, (row) => row.settlement_name);
  const localAddresses = dropRegionLike(sources.addressQueues, (row) => row.settlement_name);

  const addSettlement = (region, name, source) => {
    const normalized = normalizeAddress(name);
    if (!region || !normalized) return;
    const key = `${region}\u0000${normalized}`;
    if (!settlements.has(key)) {
      settlements.set(key, { region, name: String(name).trim(), normalized, source });
    }
  };

  const addBinding = (row) => {
    const region = String(row.region ?? '').trim();
    const name = String(row.settlement_name ?? '').trim();
    if (!region || !name) return;
    const settlementNormalized = normalizeAddress(name);
    if (!settlementNormalized) return;
    const queue = String(row.queue ?? '').trim();
    if (!queue) return;
    const streetName = String(row.street_name ?? '').trim();
    const streetNormalized = streetName ? normalizeAddress(streetName) : '';
    const housePattern = String(row.house_pattern ?? '*').trim() || '*';
    const key = `${region}\u0000${settlementNormalized}\u0000${streetNormalized}\u0000${housePattern}`;
    if (bindings.has(key)) {
      skipped.duplicates += 1;
      return;
    }
    bindings.set(key, {
      region,
      settlement_name: name,
      settlement_normalized: settlementNormalized,
      street_name: streetName,
      street_normalized: streetNormalized,
      house_pattern: housePattern,
      queue,
      source: String(row.source ?? 'manual').trim() || 'manual',
      updated_at: isoTime(row.updated_at ?? row.last_seen_at),
    });
    // Улица из привязки — реальный факт: она уже проверена и лежит в address_queues.
    // Раньше directory_streets оставался пустым, и подсказки улиц не работали даже там,
    // где очередь была известна.
    if (streetNormalized) {
      const streetKey = `${region}\u0000${settlementNormalized}\u0000${streetNormalized}`;
      if (!streets.has(streetKey)) {
        streets.set(streetKey, {
          region,
          settlement_normalized: settlementNormalized,
          name: streetName,
          normalized: streetNormalized,
          source: 'address_queues',
        });
      }
    }
  };

  for (const row of sources.katottg) addSettlement(row.region, row.name, row.source);
  for (const row of sources.geonames) addSettlement(row.region, row.name, row.source);
  // Реальные НП, которые нашли провайдеры: без них справочник состоял бы только из реестров, а
  // населённые пункты из выгрузок оператора выпадали бы из подсказок.
  for (const row of localSettlements) addSettlement(row.region, row.name, 'local-db');
  for (const row of localQueues) addSettlement(row.region, row.settlement_name, 'local-db');

  // Привязки адресов идут первыми: они точнее, чем «черга на весь НП», и при совпадении ключа
  // (тот же НП, та же пустая улица) должны победить.
  for (const row of localAddresses) addBinding(row);
  // `settlementQueues` — это список групп населённого пункта из графика, а НЕ привязка адреса.
  // Превращать его в «вся улица/село → первая группа» нельзя: в НП с несколькими группами это
  // показывало бы человеку чужое отключение. Такие НП остаются в подсказках как названия, а
  // очередь подтверждается только реальными `address_queues` (community/operator/curated).

  return {
    settlements: [...settlements.values()],
    bindings: [...bindings.values()],
    streets: [...streets.values()],
    skipped,
  };
}

// ── Файловые источники справочника ───────────────────────────────────────────

/** Реестр КОАТУУ: НП Чернігівщини с типом (місто/селище/село). */
function loadKatottg(REGION_KATOTTG) {
  const file = readJson(KATOTTG_FILE);
  const regions = file.regions ?? {};
  const rows = [];
  const unmapped = [];
  for (const [cpu, katottg] of Object.entries(REGION_KATOTTG)) {
    const region = regions[katottg];
    if (!region) {
      unmapped.push(cpu);
      continue;
    }
    for (const settlement of region.settlements ?? []) {
      const name = String(settlement.name ?? '').trim();
      if (name) rows.push({ region: cpu, name, source: 'katottg' });
    }
  }
  return { rows, unmapped };
}

/**
 * Дамп GeoNames: города и центры громад областей, которых нет в реестре КОАТУУ.
 *
 * Код области GeoNames не различает Дніпро (ДнЕМ/ЦЕК) и Київ (місто/область) — в справочнике
 * воркера одному коду соответствуют два cpu. Кладём такой НП в обе области: это не угадывание,
 * а факт (Дніпро действительно входит в обе энергосистемы), и в подсказках лучше два совпадения,
 * чем ни одного.
 */
function loadGeoNames() {
  const file = readJson(GEOJSON_FILE);
  const cpusByCode = new Map();
  for (const [cpu, code] of Object.entries(file.regions ?? {})) {
    const key = String(code);
    cpusByCode.set(key, [...(cpusByCode.get(key) ?? []), cpu]);
  }
  const rows = [];
  let ambiguous = 0;
  let skipped = 0;
  for (const place of file.places ?? []) {
    const name = String(place?.[0] ?? '').trim();
    const cpus = cpusByCode.get(String(place?.[1] ?? '')) ?? [];
    if (!name || cpus.length === 0) {
      skipped += 1;
      continue;
    }
    if (cpus.length > 1) ambiguous += 1;
    for (const cpu of cpus) rows.push({ region: cpu, name, source: 'geonames' });
  }
  return { rows, ambiguous, skipped };
}

// ── Генерация SQL ────────────────────────────────────────────────────────────
// Значения пишем литералами, а не связанными параметрами: `wrangler d1 execute --file`
// параметров не принимает, а лимит SQLite «999 переменных на оператор» иначе обошёл бы любой
// засев длиннее двух сотен строк.

function statementsForDirectory(rows) {
  const statements = [];
  for (const batch of chunks(rows, ROWS_PER_STATEMENT)) {
    const values = batch.map(
      (row) => `  (${[row.region, row.name, row.normalized, row.source].map(sqlLiteral).join(', ')})`,
    );
    statements.push(
      `INSERT OR IGNORE INTO directory_settlements (region, name, normalized, source) VALUES\n${values.join(',\n')};`,
    );
  }
  return statements;
}

/**
 * `address_queues` — upsert с условием `source <> 'community'`: повторный прогон обновляет наши
 * привязки, но НИКОГДА не перетирает то, что люди или парсер воркера уже положили в облако.
 */
function statementsForBindings(rows) {
  const statements = [];
  const columns = '(region, settlement_name, settlement_normalized, street_name, street_normalized, house_pattern, queue, source, updated_at)';
  for (const batch of chunks(rows, ROWS_PER_STATEMENT)) {
    const values = batch.map((row) => {
      const cells = [
        row.region, row.settlement_name, row.settlement_normalized, row.street_name,
        row.street_normalized, row.house_pattern, row.queue, row.source, row.updated_at,
      ];
      return `  (${cells.map(sqlLiteral).join(', ')})`;
    });
    statements.push(
      `INSERT INTO address_queues ${columns} VALUES\n${values.join(',\n')}\n` +
        'ON CONFLICT(region, settlement_normalized, street_normalized, house_pattern) DO UPDATE SET\n' +
        '  settlement_name = excluded.settlement_name,\n' +
        '  street_name = excluded.street_name,\n' +
        '  queue = excluded.queue,\n' +
        '  source = excluded.source,\n' +
        '  updated_at = excluded.updated_at\n' +
        "WHERE address_queues.source <> 'community';",
    );
  }
  return statements;
}

function statementsForStreets(rows) {
  const statements = [];
  for (const batch of chunks(rows, ROWS_PER_STATEMENT)) {
    const values = batch.map(
      (row) => `  (${[row.region, row.settlement_normalized, row.name, row.normalized, row.source].map(sqlLiteral).join(', ')})`,
    );
    statements.push(
      `INSERT OR IGNORE INTO directory_streets (region, settlement_normalized, name, normalized, source) VALUES\n${values.join(',\n')};`,
    );
  }
  return statements;
}

let fileIndex = 0;
const writtenFiles = [];

/** Раскладывает операторы по файлам: 2 МБ на файл, чтобы wrangler не давился гигантским пакетом. */
function writeSqlFiles(name, statements, header) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  let current = [];
  let bytes = 0;
  const flush = () => {
    if (current.length === 0) return;
    fileIndex += 1;
    const file = path.join(OUT_DIR, `${String(fileIndex).padStart(4, '0')}-${name}.sql`);
    const body = `${header}\n\n${current.join('\n\n')}\n`;
    fs.writeFileSync(file, body);
    writtenFiles.push({ file, statements: current.length, bytes: Buffer.byteLength(body) });
    current = [];
    bytes = 0;
  };
  for (const statement of statements) {
    const size = Buffer.byteLength(statement) + 2;
    if (current.length > 0 && bytes + size > MAX_FILE_BYTES) flush();
    current.push(statement);
    bytes += size;
  }
  flush();
}

// ── Применение и проверка ────────────────────────────────────────────────────

/** Заливает один SQL-файл. Вывод wrangler обрезаем: он печатает таблицу на каждый оператор. */
function applyFile(file, useLocal) {
  const args = [
    'd1', 'execute', D1_NAME, useLocal ? '--local' : '--remote',
    '--config', WRANGLER_CONFIG, `--file=${file}`, '--yes',
  ];
  const result = spawnSync(WRANGLER, args, { encoding: 'utf8', cwd: REPO, maxBuffer: 64 * 1024 * 1024 });
  if (result.error?.code === 'ENOENT') {
    fatal(`не найден wrangler: ${relative(WRANGLER)} (выполните npm install в cf-worker)`);
  }
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  if (result.status !== 0) {
    log(output);
    fatal(`wrangler не принял ${relative(file)}`);
  }
  log(`    ${summarizeD1Report(result.stdout ?? '')}`);
}

/**
 * Сводка из JSON-отчёта wrangler: он печатает отчёт на каждый оператор, и последняя строка
 * этого вывода — просто `]`. В логе деплоя полезнее «операторов 23, строк записано 2284».
 */
function summarizeD1Report(text) {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end <= start) return 'выполнено';
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    const items = Array.isArray(parsed) ? parsed : [parsed];
    const failed = items.filter((item) => item?.success === false).length;
    const changes = items.reduce((sum, item) => sum + Number(item?.meta?.changes ?? 0), 0);
    return `операторов ${items.length - failed}${failed > 0 ? `, ошибок ${failed}` : ''}, строк записано ${changes}`;
  } catch {
    return 'выполнено';
  }
}

/** Счётчики прямо из D1 — доказательство, что засев дошёл до облака, а не остался в логах. */
function d1Counts(useLocal) {
  const sql = 'SELECT (SELECT count(*) FROM directory_settlements) AS settlements, ' +
    '(SELECT count(*) FROM directory_streets) AS streets, (SELECT count(*) FROM address_queues) AS bindings';
  const args = [
    'd1', 'execute', D1_NAME, useLocal ? '--local' : '--remote',
    '--config', WRANGLER_CONFIG, '--json', `--command=${sql}`,
  ];
  const result = spawnSync(WRANGLER, args, { encoding: 'utf8', cwd: REPO, maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) return null;
  try {
    return JSON.parse(result.stdout)?.[0]?.results?.[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Живой `/sync`. Смотрим `settlementsTotal`, а не длину массива: именно «сколько НП знает
 * справочник области» показывает, подействовал ли засев.
 */
async function verifyLive() {
  const url = `${WORKER_BASE.replace(/\/+$/u, '')}/api/v1/sync?region=${encodeURIComponent(VERIFY_REGION)}`;
  try {
    const response = await fetch(url, { headers: { 'user-agent': 'SvitloUA/sync-directory' } });
    if (!response.ok) return { error: `http=${response.status}` };
    const payload = await response.json();
    const data = payload?.data ?? payload;
    return {
      total: data?.settlementsTotal ?? null,
      items: Array.isArray(data?.settlements) ? data.settlements.length : null,
      regions: Array.isArray(data?.regions) ? data.regions.length : null,
    };
  } catch (error) {
    return { error: error.message };
  }
}

function formatList(values, limit = 3) {
  if (values.length <= limit) return values.join(', ');
  return `${values.slice(0, limit).join(', ')} и ещё ${values.length - limit}`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const wantSettlements = !options.only || options.only.has('settlements');
  const wantAddresses = !options.only || options.only.has('addresses');

  log('Справочник адресов → Cloudflare D1');
  const { normalizeAddress, REGION_KATOTTG, assertDirectoryNamesClean } = await loadNormalizer();

  const katottg = loadKatottg(REGION_KATOTTG);
  const geonames = loadGeoNames();
  const db = loadLocalDatabase();

  const rows = buildRows({
    katottg: katottg.rows,
    geonames: geonames.rows,
    localSettlements: db.localSettlements,
    settlementQueues: db.settlementQueues,
    addressQueues: db.addressQueues,
    regionNames: db.regionNames,
  }, normalizeAddress);

  // Стоп-кран до записи в D1: тестовая строка в справочнике выглядит как настоящий адрес,
  // поэтому не «предупреждаем и едем дальше», а падаем с понятной причиной.
  assertDirectoryNamesClean(
    [...katottg.rows, ...geonames.rows, ...db.localSettlements, ...db.addressQueues],
    'источники справочника',
  );
  assertDirectoryNamesClean(rows.settlements, 'directory_settlements');
  assertDirectoryNamesClean(rows.streets, 'directory_streets');
  assertDirectoryNamesClean(rows.bindings, 'address_queues');

  log('');
  log(`Реестр КОАТУУ: ${katottg.rows.length} записей (${Object.keys(REGION_KATOTTG).join(', ')})`);
  if (katottg.unmapped.length > 0) log(`  ! в реестре нет областей: ${katottg.unmapped.join(', ')}`);
  log(`GeoNames: ${geonames.rows.length} записей, из них в двух энергосистемах сразу: ${geonames.ambiguous}; без области в справочнике воркера: ${geonames.skipped}`);
  log(db.available
    ? `Локальная база: привязок ${db.addressQueues.length}, НП с чергами ${db.settlementQueues.length}, НП ${db.localSettlements.length}, улиц без НП ${db.streetQueues}`
    : `Локальная база недоступна (${db.reason}) — переношу только справочник из файлов репозитория`);

  log('');
  log('В D1 уедет:');
  log(`  directory_settlements — ${rows.settlements.length} строк`);
  log(`  directory_streets     — ${rows.streets.length} улиц из привязок`);
  log(`  address_queues        — ${rows.bindings.length} привязок`);
  if (rows.skipped.regionLike > 0) {
    log(`  пропущено ${rows.skipped.regionLike}: «${formatList(rows.skipped.examples)}» — это агрегаты областей, а не населённые пункты`);
  }
  if (rows.skipped.duplicates > 0) {
    log(`  у ${rows.skipped.duplicates} привязок была не одна черга: ключ D1 — один адрес → одна черга, осталась первая`);
  }
  if (rows.streets.length === 0) {
    log('  directory_streets — пусто: в подтверждённых привязках нет названий улиц');
  }

  // Файлы пишем всегда: их можно посмотреть глазами и применить руками, без этого скрипта.
  // Каталог чистим от прошлого прогона: иначе остался бы лишний файл, который потом применился бы.
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  if (wantSettlements) {
    writeSqlFiles(
      'directory_settlements',
      statementsForDirectory(rows.settlements),
      '-- Справочник НП для офлайн-поиска адреса. Источник: tools/sync-directory-to-d1.mjs',
    );
  }
  if (wantAddresses) {
    writeSqlFiles(
      'directory_streets',
      statementsForStreets(rows.streets),
      '-- Улицы из подтверждённых привязок «адрес → черга». Источник: tools/sync-directory-to-d1.mjs',
    );
    writeSqlFiles(
      'address_queues',
      statementsForBindings(rows.bindings),
      '-- Привязки «адрес → черга». Community-записи в D1 не перетираются. Источник: tools/sync-directory-to-d1.mjs',
    );
  }

  if (writtenFiles.length > 0) {
    const totalBytes = writtenFiles.reduce((sum, item) => sum + item.bytes, 0);
    log('');
    log(`SQL: ${writtenFiles.length} файл(ов), ${(totalBytes / 1024).toFixed(0)} КБ в ${relative(OUT_DIR)}`);
    for (const item of writtenFiles) log(`  ${path.basename(item.file)} — операторов ${item.statements}`);
  }

  if (!options.apply) {
    log('');
    log('Сухой прогон: ничего не залито. Применить: node tools/sync-directory-to-d1.mjs --apply');
    return 0;
  }
  if (writtenFiles.length === 0) {
    log('');
    log('Заливать нечего: операторов нет.');
    return 0;
  }

  log('');
  log(`Заливаю в ${options.local ? 'локальную' : 'продовую'} D1 «${D1_NAME}»…`);
  for (const item of writtenFiles) {
    log(`  ${path.basename(item.file)} (${item.statements} операторов)`);
    applyFile(item.file, options.local);
  }

  if (options.verify) {
    log('');
    log('Проверка D1:');
    const counts = d1Counts(options.local);
    log(counts
      ? `  directory_settlements=${counts.settlements} address_queues=${counts.bindings} directory_streets=${counts.streets}`
      : '  ! счётчики не прочитались: wrangler --json вернул неожиданный вывод');
    log(`Проверка живого /sync (${VERIFY_REGION}):`);
    const live = await verifyLive();
    log(live.error
      ? `  ! воркер не ответил: ${live.error}`
      : `  settlementsTotal=${live.total}, в пакете=${live.items}, регионов=${live.regions}`);
  }

  return 0;
}

main().catch((error) => {
  fatal(error instanceof Error ? error.message : String(error));
});





