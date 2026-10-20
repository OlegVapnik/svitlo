/**
 * Svitlo — Cloudflare Worker.
 *
 * Задача воркера: отдавать графики ГПВ по HTTPS 24/7, пока ноутбук выключен, и не требовать
 * ни GitHub, ни своего сервера. Поэтому здесь нет ни одной Node-зависимости: только стандартный
 * Web Fetch API, D1 (постоянное хранилище) и Cache API.
 *
 * График единственный и настоящий — зеркало расписания ДТЕК. Мы его не придумываем: если
 * зеркало недоступно или вернуло неожиданный формат, воркер отдаёт честную пустую выдачу,
 * а фронтенд показывает EmptyState. Подставлять «похожий» график хуже, чем не показать ничего.
 */

import { isQueueCode, matchHouseNumber, normalizeAddress, normalizeHouseNumber, normalizeQueue, parseHouseNumber } from './address.js';
import { collectChernihivOutages, fetchCityIds, type ChernihivOutage } from './chernihiv.js';
// Разбор ГПВ из открытых Telegram-каналов операторов. Модуль — копия проверенного
// `apps/api/src/services/telegram-schedule.service.ts`, чтобы оба сервера читали один пост одинаково.
import {
  TELEGRAM_SCHEDULE_CHANNELS,
  TELEGRAM_SCHEDULE_SOURCE,
  classifyOutagePost,
  firstTimeWindow,
  isAllClearNotice,
  parseTelegramScheduleText,
  resolveScheduleDate,
} from './telegram-schedule.js';
// Чейнджлог генерирует tools/gen_changelog.mjs из истории git — воркер получает ту же копию,
// что и Node-бэкенд, поэтому список «Що нового» одинаков на обоих серверах.
import changelog from './data/changelog.json';
import versionInfo from './data/version.json';
import {
  ALL_CLEAR_QUEUE,
  extractCoverage,
  extractSlots,
  isJsonObject,
  isYmd,
  listRegionCpus,
  listRegionNames,
  mergeCoverage,
  mergeSlots,
  unwrapMirrorPayload,
  type CoverageEntry,
  type Slot,
} from './mirror-parser.js';
import {
  kyivOffsetMinutesAt,
  kyivToday,
  kyivWallClockMs,
  localSlotToUtc,
} from './kyiv-time.js';
import { saveCoverageDiff, saveSlotsDiff } from './d1-write.js';
import { pruneHistoryOncePerDay, syncMirrorSchedule } from './mirror-sync.js';
import {
  FEED_KEYS,
  REGION_CATALOG,
  REGION_NAMES,
  canonicalRegionCpu,
  regionFeedKeys,
} from './regions.js';

interface Env {
  DB: D1Database;
  /** APK-релизы: файл слишком большой для Pages (лимит 25 MiB), поэтому отдаём из R2. */
  APK_BUCKET?: R2Bucket;
  MIRROR_SCHEDULE_URL: string;
  /**
   * Через запятую — временно ограничить импорт зеркала областями (ключи фида или канонические
   * `cpu`). Пусто — импортируются все области, которые фид реально отдаёт.
   */
  MIRROR_SCHEDULE_IMPORT_REGIONS?: string;
  NEWS_CHANNELS: string;
  /** Необязательный RSS-источник. Если не задан — RSS просто не опрашивается. */
  NEWS_RSS_URL?: string;
  /** Сбор точечных отключений Чернигівобленерго. Выключен по умолчанию, как и в Node-бэкенде. */
  CHERNIHIV_WEB_ENABLED?: string;
  /** Базовый адрес оператора (для тестового стенда). */
  CHERNIHIV_WEB_BASE_URL?: string;
  /** Идентификаторы НП. Если пусто — определяются в рантайме и кэшируются в D1. */
  CHERNIHIV_CITY_IDS?: string;
}

/** Состояние отключения в терминах приложения (совпадает с `OperatorStateCode` в @svitlo/shared). */
const OFF_STATE = { code: 3 as const, name: 'Відключення', color: '#E33535' };

/**
 * Кэш в памяти изолята. TTL — две минуты: данные обновляет крон раз в 20 минут, поэтому две
 * минуты не отдают человеку устаревший график, зато снимают с D1 и с CPU всё, что повторяется
 * в пределах двух минут (повторное открытие приложения, переключение вкладок, `refetchInterval`).
 *
 * Зачем это вообще нужно на бесплатном тарифе Cloudflare: лимит — 10 мс CPU на запрос, а `/sync`
 * собирает пакет из десятков запросов к D1 (статус, каталог областей, слоты, список групп,
 * справочник НП, новости). Воркер отвечал людям `503` с `error 1102`. Кэш на изоляте превращает
 * повторные вызовы в `JSON.stringify` готового тела (десятые доли миллисекунды), а `scheduled()`
 * чистит кэш сразу после обхода — свежие данные не ждут минуту.
 *
 * Хранилище — `Map`, поэтому перебор (`clear()`, вставка) дешёвый, а ключи уникальны; порядок
 * вставки позволяет вытеснять самую старую запись при переполнении.
 */
const MEMORY_CACHE_TTL_MS = 120_000;

/**
 * Справочники области (группы, населённые пункты) меняются вместе с каталогом, а не каждую
 * минуту. Держим их 10 минут, чтобы `/sync` не пересобирал тысячи строк на каждом старте
 * приложения: именно этот агрегат сильнее всего расходовал `rows_read`.
 */
const AGGREGATE_CACHE_TTL_MS = 10 * 60_000;

/** Сколько записей держим: ключ включает область и параметры, поэтому записей немного. */
const MEMORY_CACHE_LIMIT = 120;

const memoryCache = new Map<string, { expiresAt: number; payload: unknown }>();

/**
 * Кэш готовых HTTP-ответов: второй уровень поверх Cache API.
 *
 * Зачем отдельно от `memoryCache`: тот кэширует результаты внутренних функций, но запрос всё
 * равно проходит через сборку конверта, сортировку и заголовки. Повторное открытие приложения
 * обязано стоить 0 `rows_read`, поэтому готовое тело отдаётся до любого обращения к D1.
 */
interface MemoryHttpEntry {
  expiresAt: number;
  status: number;
  headers: Array<[string, string]>;
  body: string;
}

const httpMemoryCache = new Map<string, MemoryHttpEntry>();
const HTTP_CACHE_TTL_MS = 120_000;
const HTTP_CACHE_LIMIT = 160;

/**
 * Результат `producer` на `ttlMs` по строковому ключу.
 *
 * Отдаётся тот же объект, что и в первый раз: вызывающие только читают его (кладут в `json` или в
 * тело пакета), поэтому копировать не нужно.
 */
async function cached<T>(key: string, producer: () => Promise<T>, ttlMs: number = MEMORY_CACHE_TTL_MS): Promise<T> {
  const now = Date.now();
  const hit = memoryCache.get(key);
  if (hit && hit.expiresAt > now) return hit.payload as T;
  const payload = await producer();
  remember(key, payload, ttlMs);
  return payload;
}

/**
 * Кладёт готовое значение в кэш изолята.
 *
 * Нужен там, где тело ответа собирается не одной функцией (`/reliability`, `/sync`): кэшировать
 * приходится уже собранный объект, а не результат вызова-обёртки.
 */
function remember(key: string, payload: unknown, ttlMs: number = MEMORY_CACHE_TTL_MS): void {
  if (memoryCache.size >= MEMORY_CACHE_LIMIT) {
    // `Map` хранит порядок вставки: первый ключ — самая старая запись.
    const oldest = memoryCache.keys().next();
    if (!oldest.done) memoryCache.delete(oldest.value);
  }
  memoryCache.set(key, { expiresAt: Date.now() + ttlMs, payload });
}

/** Сбрасывает кэш изолята: вызывается после крона, который переписал данные. */
function clearMemoryCache(): void {
  memoryCache.clear();
  httpMemoryCache.clear();
}

/**
 * Проверяет, что ошибка пришла от D1, а не от логики воркера.
 *
 * При исчерпанном дневном лимите D1 отвечает `D1_ERROR: exceeded D1's free tier daily row read
 * limit`. В этом случае отдавать 500 нельзя: у нас есть живое зеркало, из которого ответ
 * собирается в памяти. Те же симптомы дают `SQLITE_BUSY` и `no such table` после неудачной
 * миграции — для человека результат один: «сервер не отвечает», хотя данные доступны.
 */
function isD1Unavailable(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return /D1_ERROR|row read limit|row write limit|exceeded|SQLITE_BUSY|database is locked|no such table/iu.test(
    message,
  );
}

/**
 * Момент, когда этот изолят впервые увидел недоступность D1. Живёт до перезапуска изолята
 * и нужен только для диагностики (`/health`, `/status`): по нему видно, что 5xx у данных —
 * не случайность, а исчерпанная квота базы.
 */
let d1UnavailableAt: string | null = null;

/**
 * Отдельная отметка именно дневного лимита D1.
 *
 * `isD1Unavailable` намеренно широкий (в него попадают `no such table`, `SQLITE_BUSY` и любое
 * «exceeded»), потому что для фолбэка на зеркало причина не важна. Но показывать человеку
 * «вичерпано денний ліміт бази» по любой ошибке нельзя: это готовая отговорка на пустом месте.
 * Поэтому признак квоты считается только по тексту про дневной лимит.
 */
let d1QuotaExceededAt: string | null = null;

function isD1QuotaError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return /daily row (read|write) limit|free tier.*limit|exceeded d1/iu.test(message);
}

/** URL-ключ HTTP-кэша: без диагностического `timing`, чтобы обычный запрос попадал в ту же запись. */
function httpCacheKey(url: URL): string {
  const copy = new URL(url.toString());
  copy.searchParams.delete('timing');
  return copy.toString();
}

function isCacheableApiRequest(request: Request, url: URL): boolean {
  if (request.method !== 'GET') return false;
  if (!url.pathname.startsWith('/api/v1/')) return false;
  // `timing=1` — диагностический обход кэша: он обязан считать пакет заново.
  return !url.searchParams.has('timing');
}

function responseFromHttpEntry(entry: MemoryHttpEntry): Response {
  return new Response(entry.body, { status: entry.status, headers: entry.headers });
}

async function readHttpMemoryCache(key: string): Promise<Response | null> {
  const hit = httpMemoryCache.get(key);
  if (!hit || hit.expiresAt <= Date.now()) {
    if (hit) httpMemoryCache.delete(key);
    return null;
  }
  return responseFromHttpEntry(hit);
}

function rememberHttpResponse(key: string, response: Response, body: string): void {
  if (httpMemoryCache.size >= HTTP_CACHE_LIMIT) {
    const oldest = httpMemoryCache.keys().next();
    if (!oldest.done) httpMemoryCache.delete(oldest.value);
  }
  httpMemoryCache.set(key, {
    expiresAt: Date.now() + HTTP_CACHE_TTL_MS,
    status: response.status,
    headers: [...response.headers.entries()],
    body,
  });
}


/**
 * Секундомер подзапросов для диагностики бюджета CPU.
 *
 * Включается `?timing=1` и пишет один `console.log` на запрос. В обычном запросе накладных
 * расходов нет вовсе: при `enabled === false` ни один метод не вызывает `performance.now()`,
 * потому что лимит — 10 мс и любая «просто диагностика» в горячем пути съедает его.
 */
function stepTimer(enabled: boolean) {
  const started = enabled ? performance.now() : 0;
  const marks: Array<{ step: string; ms: number }> = [];
  /** Оборачивает ожидание: время пишется, только если секундомер включён. */
  const measure = async <T,>(step: string, work: Promise<T>): Promise<T> => {
    if (!enabled) return work;
    const at = performance.now();
    try {
      return await work;
    } finally {
      marks.push({ step, ms: Math.round((performance.now() - at) * 10) / 10 });
    }
  };
  /** Отметка шага, который считается не запросом, а чистым JS. */
  const mark = (step: string, at: number): void => {
    if (enabled) marks.push({ step, ms: Math.round((performance.now() - at) * 10) / 10 });
  };
  const done = (label: string): void => {
    if (!enabled) return;
    marks.push({ step: 'total', ms: Math.round((performance.now() - started) * 10) / 10 });
    console.log(`${label} timing: ${JSON.stringify(marks)}`);
  };
  return { enabled, now: (): number => (enabled ? performance.now() : 0), mark, measure, done };
}

type StepTimer = ReturnType<typeof stepTimer>;

/**
 * Одна коллация на изолят: `.localeCompare(other, 'uk')` создаёт новый `Collator` на КАЖДЫЙ вызов,
 * а сортировка списка НП и названий областей — это тысячи сравнений в горячем пути `/sync`. Общий
 * экземпляр стоит одной инициализации на изолят и снимает миллисекунды CPU с каждого пакета.
 */
const UK_COLLATOR = new Intl.Collator('uk');

/** Сравнение украинских строк по алфавиту — общим коллатором, а не новым на каждый вызов. */
function compareUk(a: string, b: string): number {
  return UK_COLLATOR.compare(a, b);
}

/**
 * Порядок «1, 1/2, 2, 2/2, 10»: сначала основная очередь, затем под-очередь.
 *
 * Копия из `apps/api/src/services/queues.service.ts`, а не импорт — та же причина, что и у
 * `computeSyncEtag`: воркер собирается wrangler'ом отдельно и не тянет `@svitlo/shared`. Копия
 * должна вести себя одинаково: список групп в облачной и серверной сборках — один и тот же экран.
 */
function compareQueueCodes(a: string, b: string): number {
  const parse = (code: string): [number, number] => {
    const [major, minor] = code.split('/');
    return [Number(major), Number(minor ?? 0)];
  };
  const [aMajor, aMinor] = parse(a);
  const [bMajor, bMinor] = parse(b);
  if (Number.isNaN(aMajor) || Number.isNaN(bMajor)) return a.localeCompare(b);
  return aMajor - bMajor || aMinor - bMinor;
}

/**
 * Все ключи, под которыми данные запрошенного кода могут лежать в D1.
 *
 * Зачем единая точка: после введения канонических `cpu` (`kyiv-city`, `kyivska-oblast`,
 * `dnipropetrovska-oblast`) в `schedule_slots`/`schedule_coverage` данные остались под ключами фида
 * (`kyiv`, `kiivska-oblast`, `dnipro-cek`), а закладки и `localStorage` людей хранят вообще старые
 * коды. Чтение по одному ключу молча давало «даних графіка немає» при живом графике, поэтому SQL
 * ищет сразу по ВСЕМ ключам области.
 *
 * Одно исключение — многомережная область: если человек назвал конкретную сеть (`dnipro-cek`),
 * расширять её до всей области нельзя (у ЦЕК и ДнЕМ общая нумерация черг, но разные графики).
 * Названа область целиком (`dnipropetrovska-oblast`) — возвращаются все её сети, а конкретную
 * выбирает `resolveReadRegions` по фактическим данным.
 */
function resolveDbRegions(regionParam: string): string[] {
  const value = (regionParam ?? '').trim().toLowerCase();
  if (!value) return [];
  const canonical = canonicalRegionCpu(value);
  const feedKeys = regionFeedKeysOf(canonical);
  const isNamedNetwork = value !== canonical && FEED_KEYS.has(value);
  // Сеть названа явно, а сетей у области несколько — читаем ТОЛЬКО её: чужие часы показать нельзя.
  if (isNamedNetwork && feedKeys.length > 1) return [value];
  return [...new Set([value, canonical, ...feedKeys])];
}

/**
 * Области, где один набор групп публикуется двумя кодировками: плоской «1» и подгруппой «1/1».
 *
 * Київ: живой источник (Ясно/ДТЕК) отдаёт «1…6», зеркало ГПВ — «1/1…60/1». Для человека это одна
 * и та же группа, но поиск по точному коду её не находил: `/schedules?queue=1` отвечал пустым
 * графиком, хотя данные лежали под «1/1». Для остальных областей «1» и «1/1» — РІЗНІ черги, поэтому
 * тождество вводится только здесь.
 */
const FLAT_SUBGROUP_REGIONS = new Set(['kyiv-city']);

/**
 * Коды чтения для запрошенной группы: у Києва «1» и «1/1» — синонимы, поэтому слоты/покрытие
 * ищем под обеими формами. Для прочих областей возвращаем ровно один код — поведение не меняется.
 */
function queueReadAliases(regionParam: string, queue: string): string[] {
  const clean = normalizeQueue(queue);
  if (!FLAT_SUBGROUP_REGIONS.has(canonicalRegionCpu(regionParam))) return [clean];
  if (/^\d+$/u.test(clean)) return [clean, `${clean}/1`];
  const match = /^(\d+)\/1$/u.exec(clean);
  if (match) return [clean, match[1]!];
  return [clean];
}

/** `column IN (?, …)` по ключам чтения. Пустой список — фильтра по области нет («вся страна»). */
function regionIn(regions: string[], column = 'region'): { clause: string; bindings: string[] } {
  const keys = [...new Set(regions.filter((key) => key))];
  if (keys.length === 0) return { clause: '', bindings: [] };
  return { clause: `${column} IN (${keys.map(() => '?').join(', ')})`, bindings: keys };
}

/**
 * ОСР иногда уточняет одинаковые названия районом: «Коропська дільниця · ДЕСНЯНСЬКЕ».
 * Поиск показывает человеку короткое «Деснянське», поэтому перед чтением улиц и домов
 * однозначно переводим короткую форму в каноническое имя каталога. При нескольких совпадениях
 * ничего не угадываем: остаётся исходное имя, а UI может предложить районные варианты.
 */
async function canonicalDirectorySettlement(env: Env, regions: string[], value: string): Promise<string> {
  const input = value.trim();
  const normalized = normalizeAddress(input);
  const filter = regionIn(regions, 'region');
  if (!normalized || !filter.clause) return input;
  const cacheRegion = [...regions].sort().join(',');
  return cached(`canonical-settlement:${cacheRegion}:${normalized}`, async () => {
    const suffix = ` · ${normalized}`;
    const qualified = await env.DB.prepare(
      `SELECT name FROM directory_settlements
       WHERE ${filter.clause} AND substr(normalized, -length(?)) = ?
       LIMIT 2`,
    ).bind(...filter.bindings, suffix, suffix).all<{ name: string }>();
    // Возвращаем НОРМИЛИЗОВАННЫЙ КЛЮЧ, а не отображаемое имя каталога. Раньше здесь
    // возвращали `name` («м. Бровари»), и вызывающая сторона нормализовала его второй раз —
    // получалось «м бровари», тогда как в `directory_streets.settlement_normalized` лежит
    // «броварі». Сравнение не сходилось, и `/streets` отдавал пустоту для любого НП.
    // Отдельные разновидности нормализации в разных слоях — источник этой ошибки.
    if (qualified.results?.length === 1) return normalized;
    if ((qualified.results?.length ?? 0) > 1) return normalized;

    const exact = await env.DB.prepare(
      `SELECT normalized FROM directory_settlements
       WHERE ${filter.clause} AND normalized = ? LIMIT 1`,
    ).bind(...filter.bindings, normalized).first<{ normalized: string }>();
    return exact?.normalized ?? input;
  }, AGGREGATE_CACHE_TTL_MS);
}

/** Сколько данных у каждой сети многомережной области на дату: слоты, слоты нужной черги, покрытие. */
async function networkDataOn(
  env: Env,
  keys: string[],
  date: string,
  queue: string | null,
): Promise<Map<string, { slots: number; queueSlots: number; coverage: number }>> {
  const filter = regionIn(keys);
  const stats = new Map<string, { slots: number; queueSlots: number; coverage: number }>();
  const statKey = (region: string, source: string) => `${region}\u0000${source}`;
  const ensure = (region: string, source: string) => {
    const key = statKey(region, source);
    const current = stats.get(key) ?? { slots: 0, queueSlots: 0, coverage: 0 };
    stats.set(key, current);
    return current;
  };
  const [slots, coverage] = await Promise.all([
    env.DB.prepare(
      `SELECT region, source, COUNT(*) AS slots,
              SUM(CASE WHEN queue = ? THEN 1 ELSE 0 END) AS queueSlots
       FROM schedule_slots WHERE ${filter.clause} AND date = ? GROUP BY region, source`,
    )
      .bind(queue ?? '', ...filter.bindings, date)
      .all<{ region: string; source: string; slots: number; queueSlots: number }>(),
    env.DB.prepare(
      `SELECT region, source, COUNT(*) AS n FROM schedule_coverage
       WHERE ${filter.clause} AND date = ? GROUP BY region, source`,
    )
      .bind(...filter.bindings, date)
      .all<{ region: string; source: string; n: number }>(),
  ]);
  for (const row of slots.results ?? []) {
    const current = ensure(row.region, row.source);
    current.slots = row.slots ?? 0;
    current.queueSlots = row.queueSlots ?? 0;
  }
  for (const row of coverage.results ?? []) {
    ensure(row.region, row.source).coverage = row.n ?? 0;
  }
  return stats;
}

/**
 * Ключи чтения конкретного запроса. Область с одной сетью читается по всем своим ключам (канонический
 * + ключ фида + легаси): данные под ними — это один и тот же график, а подстановка ключа не должна
 * зависеть от того, что именно лежит у человека в закладке.
 *
 * Многомережная область сужается до ОДНОЙ сети по фактическим данным: сеть, у которой на запрошенную
 * дату есть слоты нужной черги, затем — у которой есть слоты вообще, затем — покрытие. Раньше здесь
 * отдавался 400 `AMBIGUOUS_REGION`, и экран области целиком падал в «даних графіка немає» при живом
 * графике; теперь побеждает сеть с данными, а какую именно сеть человек хочет — он выбирает в
 * каталоге (`dnipro-cek` / `dnipro-dnem`).
 */
async function resolveReadRegions(
  env: Env,
  dbRegions: string[],
  date: string,
  queue: string | null = null,
): Promise<string[]> {
  const keys = [...new Set(dbRegions.filter((key) => key))];
  if (keys.length <= 1) return keys;
  // Проверяем данные ТОЛЬКО когда у области несколько СЕТЕЙ (ключей фида): у `kyiv-city` ключи
  // `kyiv-city` и `kyiv` — это один и тот же график, и лишние два запроса к D1 тут ничего не решают,
  // а CPU-бюджет воркера (10 мс на запрос) решают: тяжёлые маршруты упирались в лимит 1102.
  const feedKeys = regionFeedKeysOf(canonicalRegionCpu(keys[0]!));
  if (feedKeys.length <= 1) return keys;
  const candidates = keys.filter((key) => feedKeys.includes(key));
  const stats = await networkDataOn(env, candidates.length > 0 ? candidates : keys, date, queue);
  const pool = candidates.length > 0 ? candidates : keys;
  const statOf = (key: string, source: string) => stats.get(`${key}\u0000${source}`);
  // Источник выбираем по силе доказательства, а не просто по факту наличия записи:
  // слоты запрошенной группы → любые слоты дня → покрытие. Покрытие без слотов — это
  // «день опубликован», но у живого источника импорт может отставать, и тогда один лишь
  // `schedule_coverage` перекрывал зеркало с настоящими интервалами: Київ показывал
  // «Відключень немає» при живом графике в зеркале. Живой `energy-ua` по-прежнему важнее
  // зеркала, когда слоты есть у обоих.
  const hasQueueSlots = (candidate: string) =>
    pool.some((key) => (statOf(key, candidate)?.queueSlots ?? 0) > 0);
  const hasSlots = (candidate: string) =>
    pool.some((key) => (statOf(key, candidate)?.slots ?? 0) > 0);
  const hasCoverage = (candidate: string) =>
    pool.some((key) => (statOf(key, candidate)?.coverage ?? 0) > 0);
  const source =
    ['energy-ua', 'mirror'].find(hasQueueSlots) ??
    ['energy-ua', 'mirror'].find(hasSlots) ??
    ['energy-ua', 'mirror'].find(hasCoverage);
  const sourcePool = source ? pool.filter((key) => statOf(key, source)) : pool;
  const pick =
    sourcePool.find((key) => (statOf(key, source ?? '')?.queueSlots ?? 0) > 0) ??
    sourcePool.find((key) => (statOf(key, source ?? '')?.slots ?? 0) > 0) ??
    sourcePool.find((key) => (statOf(key, source ?? '')?.coverage ?? 0) > 0) ??
    sourcePool[0] ??
    pool[0];
  return pick ? [pick] : keys;
}

/**
 * Ключи фида, под которыми лежат данные области.
 *
 * Порожний массив — область известна, но фид её не отдаёт; неизвестный `cpu` возвращаем как «свой
 * единственный ключ»: так запрос к нему остаётся честно пустым графиком, а не путается с чужой
 * областью.
 */
function regionFeedKeysOf(cpu: string): string[] {
  // То же правило, что и в каталоге (`./regions.js`): одна реализация вместо двух копий.
  const keys = regionFeedKeys(cpu);
  const canonical = canonicalRegionCpu(cpu);
  // Явно названная сеть многомережной области читается только по себе: чужие часы показывать нельзя.
  if (cpu.trim() !== canonical) return keys.includes(cpu) && keys.length > 1 ? [cpu] : keys;
  // Канонический `cpu` может быть не ключом фида (`kyiv-city` ↔ `kyiv`, `kyivska-oblast` ↔
  // `kiivska-oblast`), но именно под ним лежит живой график Energy-UA. Без него `/queues` и
  // `/schedules` читали только зеркало и показывали 60 исторических групп Києва.
  return keys.includes(canonical) ? keys : [...keys, canonical];
}

/** Название области по-украински: из встроенного списка, дальше — по её ключу фида. */
function canonicalRegionName(cpu: string, mirrorNames: Record<string, string> = {}): string {
  const direct = REGION_NAMES[cpu] ?? mirrorNames[cpu];
  if (direct) return direct;
  for (const key of regionFeedKeysOf(cpu)) {
    const viaFeed = REGION_NAMES[key] ?? mirrorNames[key];
    if (viaFeed) return viaFeed;
  }
  return cpu;
}

interface NewsRow {
  id: string;
  source_key: string;
  url: string;
  title: string;
  summary: string | null;
  published_at: string | null;
  first_seen_at: string;
  /** Классификация публикации: outage | schedule-change | repair | emergency | ukraine | other. */
  kind?: string;
  region_cpu?: string | null;
  is_ukraine_wide?: number;
  /** JSON-массив URL изображений поста (графики Чернігівобленерго приходят картинками). */
  image_urls?: string | null;
  body?: string | null;
}

/** Убирает HTML-теги и схлопывает пробелы — из Telegram-страницы приходит размеченный текст. */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/giu, '\n')
    .replace(/<[^>]+>/gu, '')
    .replace(/&nbsp;/gu, ' ')
    .replace(/&amp;/gu, '&')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    // Числовые сущности: Telegram экранирует даже «!» как `&#33;`, и без их разбора заголовок
    // выглядел бы с мусором в тексте.
    .replace(/&#(\d{1,7});/gu, (_, code: string) => {
      const point = Number.parseInt(code, 10);
      return Number.isFinite(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '';
    })
    .replace(/&#x([0-9a-f]{1,6});/giu, (_, code: string) => {
      const point = Number.parseInt(code, 16);
      return Number.isFinite(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '';
    })
    .replace(/[ \t]+/gu, ' ')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

/**
 * Разбирает публичную веб-страницу Telegram-канала (`t.me/s/<канал>`).
 *
 * Берём только то, что видно любому посетителю без токена бота: текст поста, ссылку и время
 * публикации. Ничего не выдумываем — если разметка неожиданная, возвращаем пустой массив.
 */
function parseTelegramChannel(html: string, sourceKey: string): Array<Omit<NewsRow, 'first_seen_at'>> {
  const items: Array<Omit<NewsRow, 'first_seen_at'>> = [];
  // Каждый пост — блок `.tgme_widget_message`; внутри него дата в `time[datetime]` и текст.
  const blocks = html.split('tgme_widget_message_wrap').slice(1);
  for (const block of blocks) {
    const datetime = /<time[^>]*datetime="([^"]+)"/u.exec(block)?.[1];
    const link = /href="(https:\/\/t\.me\/[^"]*\/\d+)"/u.exec(block)?.[1];
    const textMatch = /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/u.exec(block);
    if (!textMatch) continue;
    const text = stripHtml(textMatch[1] ?? '');
    if (!text || !link) continue;
    // Заголовком считаем первую строку поста: она уже отделена разметкой от тела сообщения.
    const [firstLine, ...rest] = text.split('\n');
    const title = (firstLine ?? text).slice(0, 300);
    const summary = rest.join('\n').trim().slice(0, 600) || null;
    // Фото поста: Telegram отдаёт его как background-image у блока с photo.
    const photo = /tgme_widget_message_photo[\s\S]*?background-image:url\('([^']+)'\)/u.exec(block)?.[1];
    items.push({
      id: `${sourceKey}:${link}`,
      source_key: sourceKey,
      url: link,
      title,
      summary,
      published_at: datetime ?? null,
      body: text.slice(0, 4000),
      image_urls: photo ? JSON.stringify([photo]) : null,
    });
    if (items.length >= 40) break;
  }
  return items;
}

/** Минимальный разбор RSS/Atom: только заголовок, ссылка и дата. */
function parseRssFeed(xml: string, sourceKey: string): Array<Omit<NewsRow, 'first_seen_at'>> {
  const items: Array<Omit<NewsRow, 'first_seen_at'>> = [];
  const blocks = xml.match(/<item[\s\S]*?<\/item>/giu) ?? [];
  for (const block of blocks.slice(0, 40)) {
    const title = stripHtml(/<title>([\s\S]*?)<\/title>/iu.exec(block)?.[1] ?? '');
    const link = /<link>([\s\S]*?)<\/link>/iu.exec(block)?.[1]?.trim() ?? '';
    const date = /<pubDate>([\s\S]*?)<\/pubDate>/iu.exec(block)?.[1]?.trim();
    if (!title || !link) continue;
    items.push({
      id: `${sourceKey}:${link}`,
      source_key: sourceKey,
      url: link,
      title: title.slice(0, 300),
      summary: null,
      published_at: date ? new Date(date).toISOString() : null,
    });
  }
  return items;
}

async function fetchNews(env: Env): Promise<Array<Omit<NewsRow, 'first_seen_at'>>> {
  const channels = (env.NEWS_CHANNELS ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const collected: Array<Omit<NewsRow, 'first_seen_at'>> = [];

  await Promise.all(
    channels.map(async (channel) => {
      try {
        // /s/<канал> — публичная веб-версия канала, токен бота не нужен.
        const response = await fetch(`https://t.me/s/${channel}`, {
          headers: { 'user-agent': 'Mozilla/5.0 (compatible; svitlo-cf-worker)' },
        });
        if (!response.ok) return;
        collected.push(...parseTelegramChannel(await response.text(), channel));
      } catch {
        // Канал недоступен — это ожидаемо (блокировка, сеть), а не повод ронять весь крон.
      }
    }),
  );

  if (env.NEWS_RSS_URL) {
    try {
      const response = await fetch(env.NEWS_RSS_URL, { headers: { accept: 'application/rss+xml' } });
      if (response.ok) collected.push(...parseRssFeed(await response.text(), 'rss'));
    } catch {
      // Аналогично: молча пропускаем.
    }
  }

  return collected;
}

/**
 * Сохраняет собранные отключения оператора.
 *
 * Старые записи удаляем только по тем внешним ключам, которых уже нет в новой выборке, и
 * только для текущего провайдера: иначе один неудачный заход крона стёр бы весь прошлый
 * архив, а «оператор отменил все ремонты» — это не то же самое, что «мы не смогли прочитать».
 */
async function saveOutages(env: Env, outages: ChernihivOutage[]): Promise<void> {
  const fetchedAt = new Date().toISOString();
  for (const outage of outages) {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO outage_events
         (external_id, region, starts_at, ends_at, area_name, addresses_raw, reason, kind, source_url, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        outage.externalId, 'chernihivska-oblast', outage.startsAt, outage.endsAt,
        outage.areaName, outage.addressesRaw, outage.reason, outage.kind,
        'https://chernihivoblenergo.com.ua/power_outages', fetchedAt,
      )
      .run();
  }

  // Подрезаем прошлое: архив дольше 30 дней людям не нужен, а таблица растёт без границ.
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare(`DELETE FROM outage_events WHERE region = ? AND starts_at < ?`)
    .bind('chernihivska-oblast', cutoff).run();
}

/** Идентификаторы НП оператора: из переменной окружения, иначе — найденные и закэшированные. */
async function chernihivCityIds(env: Env): Promise<string[]> {
  const fromEnv = (env.CHERNIHIV_CITY_IDS ?? '').split(',').map((item) => item.trim()).filter(Boolean);
  if (fromEnv.length > 0) return fromEnv;

  const cached = await env.DB.prepare(
    `SELECT city_id FROM provider_city_ids WHERE provider = 'chernihiv' ORDER BY city_id`,
  ).all<{ city_id: string }>();
  if ((cached.results ?? []).length > 0) return cached.results!.map((row) => row.city_id);
  return [];
}

/**
 * Обход оператора: наполняет outage_events живыми данными.
 *
 * Возвращает false, если собрать не удалось — вызывающий обязан это учесть и не записать
 * в метаданные время «успешного» сбора.
 */
async function runChernihiv(env: Env): Promise<boolean> {
  const baseUrl = env.CHERNIHIV_WEB_BASE_URL || 'https://chernihivoblenergo.com.ua';

  let cityIds = await chernihivCityIds(env);
  if (cityIds.length === 0) {
    // Справочник НП узнаём в рантайме: зашивать вручную одно село нельзя — это создало бы
    // впечатление, будто мы видим отключения по всей области, а видели бы одно.
    try {
      cityIds = await fetchCityIds(baseUrl, '');
      if (cityIds.length === 0) return false;
      const now = new Date().toISOString();
      for (const cityId of cityIds) {
        await env.DB.prepare(
          `INSERT OR IGNORE INTO provider_city_ids (provider, city_id, discovered_at) VALUES ('chernihiv', ?, ?)`,
        ).bind(cityId, now).run();
      }
    } catch {
      return false;
    }
  }

  const outages = await collectChernihivOutages(
    { cityIds, types: [1, 2, 6], baseUrl },
    // Сдвиг на сегодняшний момент: оператор отдаёт время по Киеву, а события пишем в UTC.
    kyivOffsetMinutesAt(Date.now()),
  );
  if (outages.length === 0) return false;

  await saveOutages(env, outages);
  await env.DB.prepare(`INSERT OR REPLACE INTO snapshot_meta (key, value, updated_at) VALUES (?, ?, ?)`)
    .bind('chernihiv', JSON.stringify({ at: new Date().toISOString(), outages: outages.length, cities: cityIds.length }), new Date().toISOString())
    .run();
  return true;
}

/**
 * Счётчики статуса — ОДНИМ запросом к D1 вместо семи.
 *
 * Раньше здесь было семь последовательных `DB.prepare(...).first()`: каждый — отдельный
 * round-trip, и `/status` вместе с `/sync` упирались в 10 мс CPU (Cloudflare отдавал 503
 * `error 1102`). Скалярные подзапросы дают ровно те же числа: фильтр по области одинаковый,
 * а `countIncidents` его и раньше не имел (считает аварии по всей стране).
 *
 * Порядок биндингов обязан совпадать с порядком `?` в запросе: `?` идут подзапрос за подзапросом
 * слева направо, поэтому `filter.bindings` повторяются там, где повторяется `region IN (?, …)`.
 */
async function statusCounters(
  env: Env,
  regions: string[],
  today: string,
): Promise<{
  totalQueues: number;
  activeOutages: number;
  scheduledOutages: number;
  incidents: number;
  groupsToday: number;
  groups24h: number;
  outagesToday: number;
  outages24h: number;
  importedAt: string | null;
}> {
  const filter = regionIn(regions);
  const where = filter.clause ? `${filter.clause} AND ` : '';
  const nowIso = new Date().toISOString();
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  // `importedAt` берём из `updated_at`, а не из `value`: `value` — это JSON сводки обхода
  // (`{"fetchedAt":…,"slots":…}`), и в `lastUpdatedAt` уезжала вся строка целиком, а `Date.parse`
  // в проверке `dataStale` давал `NaN`. `updated_at` cron пишет тем же ISO-моментом.
  const row = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(DISTINCT region || '|' || queue) FROM schedule_slots) AS totalQueues,
       (SELECT COUNT(*) FROM outage_events WHERE ${where}starts_at <= ? AND ends_at >= ?) AS activeOutages,
       (SELECT COUNT(*) FROM outage_events WHERE ${where}starts_at > ?) AS scheduledOutages,
       (SELECT COUNT(*) FROM outage_events WHERE kind = 'emergency' AND ends_at >= ?) AS incidents,
       -- Число УНИКАЛЬНЫХ групп за окно, а не число строк. Раньше здесь стоял
       -- COUNT(*) по outage_events, и в подзаголовке карточки человек читал
       -- «у середньому по 1901 групах» для Киева, где групп всего 60. Число строк —
       -- техническая величина хранения, а не количество групп.
       (SELECT COUNT(DISTINCT queue) FROM outage_events
         WHERE ${where}substr(starts_at, 1, 10) = ?) AS groupsToday,
       (SELECT COUNT(DISTINCT queue) FROM outage_events
         WHERE ${where}starts_at >= ?) AS groups24h,
       (SELECT COUNT(*) FROM outage_events WHERE ${where}substr(starts_at, 1, 10) = ?) AS outagesToday,
       (SELECT COUNT(*) FROM outage_events WHERE ${where}starts_at >= ?) AS outages24h,
       (SELECT updated_at FROM snapshot_meta WHERE key = 'schedule') AS importedAt`,
  )
    .bind(
      ...filter.bindings,
      nowIso,
      nowIso,
      ...filter.bindings,
      nowIso,
      nowIso,
      ...filter.bindings,
      today,
      ...filter.bindings,
      since24h,
    )
    .first<{
      totalQueues: number | null;
      groupsToday: number | null;
      groups24h: number | null;
      activeOutages: number | null;
      scheduledOutages: number | null;
      incidents: number | null;
      outagesToday: number | null;
      outages24h: number | null;
      importedAt: string | null;
    }>();
  return {
    totalQueues: row?.totalQueues ?? 0,
    activeOutages: row?.activeOutages ?? 0,
    scheduledOutages: row?.scheduledOutages ?? 0,
    incidents: row?.incidents ?? 0,
    groupsToday: row?.groupsToday ?? 0,
    groups24h: row?.groups24h ?? 0,
    outagesToday: row?.outagesToday ?? 0,
    outages24h: row?.outages24h ?? 0,
    importedAt: row?.importedAt ?? null,
  };
}

/**
 * Что даёт ОДИН список слотов за сутки: сколько групп без света сейчас, сколько погасят позже и
 * сколько минут без света в среднем на группу.
 *
 * Раньше это были три независимые функции, каждая заново читала слоты той же даты из D1
 * (`countGroupsOffNow` + `countGroupsOffLater` + `outageMinutesInWindow`): четыре чтения вместо
 * двух и четыре прохода по одним и тем же строкам. Считаем один раз и отдаём все числа.
 */
function daySlotStats(
  rows: SlotRow[],
  nowMs: number,
): { activeGroups: number; scheduledGroups: number; outageMinutes: number } {
  const active = new Set<string>();
  const later = new Set<string>();
  const byQueue = new Map<string, Array<[number, number]>>();
  for (const row of rows) {
    const queue = normalizeQueue(row.queue);
    const startMs = kyivWallClockMs(row.date, row.time_from, false);
    const endMs = kyivWallClockMs(row.date, row.time_to, true);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue;
    if (startMs <= nowMs && nowMs < endMs) active.add(queue);
    if (startMs > nowMs) later.add(queue);
    const intervals = byQueue.get(queue) ?? [];
    intervals.push([startMs, endMs]);
    byQueue.set(queue, intervals);
  }

  // Усредняем ПО ГРУППАМ, а не складываем. Отключения разных групп идут параллельно:
  // сумма по 12 группам легко превышает сутки и давала бы отрицательную надёжность
  // («минус 145%»), что бессмысленно. Человека интересует «сколько времени у меня»,
  // а у человека одна группа — значит, среднее по группам и есть честный ответ.
  //
  // Слияние считаем в миллисекундах: раньше интервалы заворачивались в ISO-строки и разбирались
  // обратно `Date.parse` — два лишних преобразования на каждый слот в горячем пути `/status`.
  let sum = 0;
  for (const intervals of byQueue.values()) {
    intervals.sort((a, b) => a[0] - b[0]);
    let total = 0;
    let cursor = Number.NEGATIVE_INFINITY;
    for (const [startMs, endMs] of intervals) {
      const from = Math.max(startMs, cursor);
      if (endMs > from) {
        total += endMs - from;
        cursor = endMs;
      }
    }
    sum += Math.round(total / 60_000);
  }
  return {
    activeGroups: active.size,
    scheduledGroups: later.size,
    outageMinutes: byQueue.size === 0 ? 0 : Math.round(sum / byQueue.size),
  };
}

/**
 * Слот отчёта, подготовленный один раз: границы — в миллисекундах UTC, дата — дата НАЧАЛА слота.
 *
 * Перевод київського времени в UTC — самая дорогая операция отчёта, и раньше он выполнялся заново
 * для каждого окна (день, неделя, месяц, сводки), то есть десятки раз на одни и те же строки.
 */
interface ReliabilitySlot {
  date: string;
  startMs: number;
  endMs: number;
}

/**
 * Слоты месяца, прочитанные ОДНИМ запросом и разложенные по парам «область + группа».
 *
 * Окна отчёта — это наборы целых дат внутри месяца, поэтому все они считаются по этому же набору
 * чисел. Раньше каждое окно делало собственный запрос к D1 и заново разбирало те же строки:
 * ~40 обращений и ~40 разборов на один заход — именно это съедало бюджет CPU воркера и давало
 * `503 error 1102` на `/reliability`.
 */
interface ReliabilityIndex {
  byQueue: Map<string, { region: string; queue: string; slots: ReliabilitySlot[] }>;
  /**
   * Дни, на которые оператор ОПУБЛИКОВАЛ график: `область|дата` → какие очереди в нём есть и в каких
   * из них были отключения.
   *
   * Зачем рядом со слотами: в `schedule_slots` лежат только «тёмные» часы. День, опубликованный без
   * отключений (Киев, Днепр, Ивано-Франковск 17.10.2026), не даёт ни одной строки слотов, и отчёт
   * честно, но бесполезно писал «даних немає» — человек видел график на экране и «немає даних» в
   * статистике. Покрытие отделяет «мы не знаем» от «знаем: отключений не было».
   */
  coverage: Map<string, { region: string; date: string; covered: Set<string>; off: Set<string> }>;
}

/** Итоги окна отчёта в той форме, которую читает фронтенд. */
interface ReliabilityTotals {
  windowMinutes: number;
  outageMinutes: number;
  poweredMinutes: number;
  reliabilityPct: number;
  hasData: boolean;
  outageCount: number;
}

/** Читает слоты за период (все области сразу) и готовит их к расчёту окон. */
async function loadReliabilityIndex(env: Env, fromDate: string, toDate: string): Promise<ReliabilityIndex> {
  const [slotRows, coverageRows] = await Promise.all([
    env.DB.prepare(
      `SELECT region, queue, date, time_from, time_to FROM schedule_slots WHERE date >= ? AND date <= ?`,
    )
      .bind(fromDate, toDate)
      .all<{ region: string; queue: string; date: string; time_from: string; time_to: string }>(),
    // Покрытие читаем тем же запросом к окну: без него день «опубликован, отключений нет» не
    // отличался от «оператор ничего не публиковал» (см. комментарий у `ReliabilityIndex.coverage`).
    env.DB.prepare(
      `SELECT region, queue, date, has_outages FROM schedule_coverage WHERE date >= ? AND date <= ?`,
    )
      .bind(fromDate, toDate)
      .all<{ region: string; queue: string; date: string; has_outages: number }>(),
  ]);

  const byQueue = new Map<string, { region: string; queue: string; slots: ReliabilitySlot[] }>();
  for (const row of slotRows.results ?? []) {
    const startMs = kyivWallClockMs(row.date, row.time_from, false);
    const endMs = kyivWallClockMs(row.date, row.time_to, true);
    // Битый слот (пустое время, конец раньше начала) не считаем: правдоподобной цифры из него не
    // выйдет, а отрицательная длительность сломала бы и сумму, и процент.
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue;
    const queue = normalizeQueue(row.queue);
    const key = `${row.region}|${queue}`;
    const entry = byQueue.get(key) ?? { region: row.region, queue, slots: [] };
    entry.slots.push({ date: row.date, startMs, endMs });
    byQueue.set(key, entry);
  }
  // Порядок строк в ответе D1 не гарантирован, а объединение интервалов требует сортировки.
  for (const entry of byQueue.values()) entry.slots.sort((a, b) => a.startMs - b.startMs);

  const coverage: ReliabilityIndex['coverage'] = new Map();
  for (const row of coverageRows.results ?? []) {
    const key = `${row.region}|${row.date}`;
    const entry = coverage.get(key) ?? { region: row.region, date: row.date, covered: new Set<string>(), off: new Set<string>() };
    const queue = normalizeQueue(row.queue);
    entry.covered.add(queue);
    if (row.has_outages) entry.off.add(queue);
    coverage.set(key, entry);
  }
  return { byQueue, coverage };
}

/**
 * Объединение интервалов в пределах окна: минуты без света и число интервалов.
 *
 * Пересечения не считаются дважды (`22:00–01:00` и `00:00–02:00` — это три часа, а не пять), а
 * границы окна обрезают слот, как в Node-бэкенде: иначе вчерашний слот целиком попадал в
 * сегодняшний бакет. Слоты обязаны быть отсортированы по началу — это делает `loadReliabilityIndex`.
 */
function unionInWindow(slots: ReliabilitySlot[], fromMs: number, toMs: number): { minutes: number; count: number } {
  let total = 0;
  let count = 0;
  let cursor = fromMs;
  for (const slot of slots) {
    const start = Math.max(slot.startMs, fromMs, cursor);
    const end = Math.min(slot.endMs, toMs);
    if (end > start) {
      total += end - start;
      count += 1;
      cursor = end;
    }
  }
  return { minutes: Math.round(total / 60_000), count };
}

/** Слоты пары «область + группа», попавшие в диапазон дат окна (дата начала слота). */
function slotsInRange(entry: { slots: ReliabilitySlot[] }, fromDate: string, toDate: string): ReliabilitySlot[] {
  return entry.slots.filter((slot) => slot.date >= fromDate && slot.date <= toDate);
}

/**
 * Сводка по окну отчёта: сколько минут без света, сколько со светом и какой процент.
 *
 * Считается СРЕДНИМ по группам, а не суммой: отключения разных групп идут параллельно, и сумма
 * за месяц легко превысила бы длину окна в несколько раз, дав надёжность ниже нуля. У конкретного
 * человека одна группа — значит, среднее и есть его «сколько часов без света».
 *
 * Знаменатель — только дни, по которым слоты ЕСТЬ: иначе месячное окно в 31 день с данными за
 * одни сутки давало «99,3% надійності», посчитанное по 30 дням, о которых мы ничего не знаем.
 * Для окна в сутки знаменатель берём таким, каким его передал вызывающий (сегодняшние сутки ещё не
 * прожиты — подмешивать в них будущее время значило бы врать).
 *
 * hasData=false, когда по окну нет ни одного слота: это «нет данных», а не «100% надёжности».
 * Проверяем именно пересечение с окном, а не попадание в диапазон дат: слот, который целиком
 * остался за границей окна (например, вчерашний, когда на сегодня график ещё не опубликован), —
 * это не «сьогодні 100%», а «даних за сьогодні немає».
 */
function reliabilityTotals(
  index: ReliabilityIndex,
  regions: ReadonlySet<string>,
  queueFilter: string | null,
  fromDate: string,
  toDate: string,
  fromMs: number,
  toMs: number,
  windowMinutes: number,
): ReliabilityTotals {
  let sumMinutes = 0;
  let queues = 0;
  let outageCount = 0;
  const daysWithData = new Set<string>();
  for (const entry of index.byQueue.values()) {
    if (!regions.has(entry.region)) continue;
    if (queueFilter !== null && entry.queue !== queueFilter) continue;
    const slots = slotsInRange(entry, fromDate, toDate);
    if (slots.length === 0) continue;
    const union = unionInWindow(slots, fromMs, toMs);
    if (union.count === 0) continue;
    queues += 1;
    sumMinutes += union.minutes;
    outageCount += union.count;
    for (const slot of slots) {
      // В `daysWithData` попадают только дни, чьи слоты реально задеты окном: слот целиком за его
      // пределами (например, завтрашний в отчёте «по факт») — это не «день с данными».
      if (slot.endMs >= fromMs && slot.startMs <= toMs) daysWithData.add(slot.date);
    }
  }
  // Дни, которые оператор опубликовал БЕЗ отключений. Слотов у них нет по определению (мы храним
  // только «тёмные» часы), поэтому раньше они не попадали ни в знаменатель, ни в hasData — и
  // «світло за графіком» превращалось в «даних немає». Покрытие доказывает, что день известен.
  for (const coverage of index.coverage.values()) {
    if (!regions.has(coverage.region)) continue;
    // Для отчёта по группе день считается известным, если группа есть в опубликованном графике
    // либо оператор опубликовал день целиком (служебный `*`).
    if (queueFilter !== null && !coverage.covered.has(queueFilter) && !coverage.covered.has(ALL_CLEAR_QUEUE)) {
      continue;
    }
    if (coverage.date < fromDate || coverage.date > toDate) continue;
    const dayStart = kyivWallClockMs(coverage.date, '00:00', false);
    const dayEnd = dayStart + 86_400_000;
    // Строгое пересечение: вчерашний день заканчивается ровно там, где начинается сегодняшний, и
    // нестрогое сравнение приписало бы «сегодня» покрытие вчерашнего дня.
    if (dayEnd <= fromMs || dayStart >= toMs) continue;
    daysWithData.add(coverage.date);
  }
  if (queues === 0 && daysWithData.size === 0) {
    return { windowMinutes, outageMinutes: 0, poweredMinutes: 0, reliabilityPct: 0, hasData: false, outageCount: 0 };
  }
  const effectiveWindow =
    windowMinutes <= 24 * 60
      ? Math.max(1, windowMinutes)
      : Math.max(24 * 60, Math.min(windowMinutes, daysWithData.size * 24 * 60));
  const average = queues === 0 ? 0 : Math.round(sumMinutes / queues);
  // Окно не может быть «переполнено»: если расчёт дал больше, данные противоречивы и показывать их
  // — значит соврать. Тогда честно отдаём полное отключение без нуля.
  const counted = Math.min(effectiveWindow, average);
  return {
    windowMinutes: effectiveWindow,
    outageMinutes: counted,
    poweredMinutes: Math.max(0, effectiveWindow - counted),
    reliabilityPct:
      effectiveWindow > 0 ? Math.round(((effectiveWindow - counted) / effectiveWindow) * 1000) / 10 : 0,
    hasData: true,
    outageCount,
  };
}

/**
 * Надёжность всех областей за окно — для сравнения «як у мене і як поруч».
 *
 * Пустые области в список не попадают: область без слотов — это «нет данных», и строка «0%» рядом
 * с ней читалась бы как «там вообще нет света». Считаем тем же способом, что и по одной области
 * (среднее по группам, знаменатель — только дни с данными), иначе цифры в сравнении были бы
 * получены другим правилом и не сходились бы с цифрой своей области.
 *
 * Порядок — от худшей надёжности к лучшей: человек ищет свою область и то, что рядом с ней,
 * а не алфавит.
 */
function reliabilityByRegion(
  index: ReliabilityIndex,
  fromDate: string,
  toDate: string,
  windowMinutes: number,
  mirrorNames: Record<string, string>,
): Array<Record<string, unknown>> {
  const byRegion = new Map<string, { minutes: number; queues: number; days: Set<string>; count: number }>();
  for (const entry of index.byQueue.values()) {
    const slots = slotsInRange(entry, fromDate, toDate);
    if (slots.length === 0) continue;
    const target = byRegion.get(entry.region) ?? { minutes: 0, queues: 0, days: new Set<string>(), count: 0 };
    target.minutes += unionInWindow(slots, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY).minutes;
    target.queues += 1;
    target.count += slots.length;
    for (const slot of slots) target.days.add(slot.date);
    byRegion.set(entry.region, target);
  }

  // Дни, опубликованные без отключений (Киев, Днепр, Ивано-Франковск): слотов нет, но день
  // известен. Без этого прохода такие области выпадали из сравнения «як у мене і як поруч».
  for (const coverage of index.coverage.values()) {
    if (coverage.date < fromDate || coverage.date > toDate) continue;
    const target = byRegion.get(coverage.region) ?? { minutes: 0, queues: 0, days: new Set<string>(), count: 0 };
    target.days.add(coverage.date);
    byRegion.set(coverage.region, target);
  }

  const summary: Array<Record<string, unknown>> = [];
  for (const [cpu, data] of byRegion) {
    const daysKnown = data.days.size;
    const effectiveWindow = Math.max(24 * 60, Math.min(windowMinutes, daysKnown * 24 * 60));
    const counted = Math.min(effectiveWindow, Math.round(data.minutes / Math.max(1, data.queues)));
    summary.push({
      region: cpu,
      nameUa: REGION_NAMES[cpu] ?? mirrorNames[cpu] ?? cpu,
      windowMinutes: effectiveWindow,
      outageMinutes: counted,
      poweredMinutes: Math.max(0, effectiveWindow - counted),
      reliabilityPct:
        effectiveWindow > 0 ? Math.round(((effectiveWindow - counted) / effectiveWindow) * 1000) / 10 : 0,
      // Число интервалов по области: здесь это именно строки слотов, как и раньше.
      outageCount: data.count,
      hasData: true,
      daysKnown,
    });
  }
  return summary.sort((a, b) => Number(a['reliabilityPct']) - Number(b['reliabilityPct']) || compareUk(String(a['region']), String(b['region'])));
}

/**
 * Один бакет отчёта надёжности: окно плюс посчитанные минуты. `isForecast` — только у завтрашнего
 * дня, график на который уже опубликован, но отключений по нему ещё не было.
 */
interface ReliabilityWindow {
  key: string;
  label: string;
  start: string;
  end: string;
  windowMinutes: number;
  outageMinutes: number;
  poweredMinutes: number;
  reliabilityPct: number;
  hasData: boolean;
  outageCount: number;
  isForecast?: boolean;
}

/** Момент времени → YYYY-MM-DD (по UTC, как слоты лежат в базе). */
function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Подписи бакетов отчёта — те же, что у Node-бэкенда (`apps/api/src/services/reliability.ts`):
 * «9 жовт.», «6 жовт. – 12 жовт.», «жовтень 2026 р.». Без этого одна и та же карточка
 * «Статистика електропостачання» выглядела по-разному в зависимости от того, с кем разговаривает
 * фронтенд, а «2026-10-01» в узкой колонке обрезалось до многоточия.
 *
 * Названия месяцев — константы, а не `Intl.DateTimeFormat('uk-UA', …)`: построение двух ICU-форматтеров
 * (и форматирование каждого дня месяца через них) съедало в `/reliability` до 8–10 мс CPU, то есть
 * почти весь бюджет воркера (10 мс) ещё до обращения к данным. Строки совпадают с выводом ICU для
 * `uk-UA` символ в символ: `{day:'numeric', month:'short'}` → «9 жовт.»,
 * `{month:'long', year:'numeric'}` → «жовтень 2026 р.» (сокращения — «січ.», «лют.», «бер.»,
 * «квіт.», «трав.», «черв.», «лип.», «серп.», «вер.», «жовт.», «лист.», «груд.»).
 */
const UK_MONTHS_SHORT = [
  'січ.',
  'лют.',
  'бер.',
  'квіт.',
  'трав.',
  'черв.',
  'лип.',
  'серп.',
  'вер.',
  'жовт.',
  'лист.',
  'груд.',
];

/** Полные названия месяцев в именительном падеже — так их печатает ICU для «жовтень 2026 р.». */
const UK_MONTHS_LONG = [
  'січень',
  'лютий',
  'березень',
  'квітень',
  'травень',
  'червень',
  'липень',
  'серпень',
  'вересень',
  'листопад',
  'грудень',
];

/** Київская дата (YYYY-MM-DD) → подпись дня для человека. */
function labelDayIso(iso: string): string {
  const [, month, day] = iso.split('-').map(Number) as [number, number, number];
  const name = UK_MONTHS_SHORT[month - 1];
  return name && Number.isFinite(day) ? `${day} ${name}` : iso;
}

/** Київская дата (YYYY-MM-DD) → подпись месяца. */
function labelMonthIso(iso: string): string {
  const [year, month] = iso.split('-').map(Number) as [number, number];
  const name = UK_MONTHS_LONG[month - 1];
  return name && Number.isFinite(year) ? `${name} ${year} р.` : iso;
}

/** Сколько суток между двумя київскими датами (YYYY-MM-DD). */
function daysBetweenIso(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00.000Z`) - Date.parse(`${fromIso}T00:00:00.000Z`)) / 86_400_000);
}

/**
 * Надёжность по группам области за окно: доля времени со светом по графику ГПВ.
 *
 * Знаменатель — только дни, за которые по группе ЕСТЬ слоты: за месяц в 31 день с данными за одну
 * добу получалось «99,9% надійності», посчитанное по 30 дням, о которых мы ничего не знаем.
 *
 * Завтрашний прогноз в разбивку по группам не берём: там рядом с фактом стояла бы цифра из ещё не
 * наступившего дня. Порядок — от худшей надёжности к лучшей, как в Node-отчёте.
 */
function reliabilityByQueue(
  index: ReliabilityIndex,
  regions: ReadonlySet<string>,
  fromDate: string,
  toDate: string,
  windowMinutes: number,
) {
  // Одна группа может прийти из нескольких сетей области: считаем её один раз и по объединению
  // интервалов всех сетей — иначе группа с двумя источниками попала бы в отчёт дважды.
  const byQueue = new Map<string, { slots: ReliabilitySlot[]; days: Set<string> }>();
  for (const entry of index.byQueue.values()) {
    if (!regions.has(entry.region)) continue;
    const slots = slotsInRange(entry, fromDate, toDate);
    if (slots.length === 0) continue;
    const target = byQueue.get(entry.queue) ?? { slots: [], days: new Set<string>() };
    for (const slot of slots) {
      target.slots.push(slot);
      target.days.add(slot.date);
    }
    byQueue.set(entry.queue, target);
  }

  // Группы из опубликованного дня без отключений: слотов у них нет, но день известен — иначе
  // вкладка «Групи» у Киева и Днепра была бы пустой при живом графике.
  for (const coverage of index.coverage.values()) {
    if (!regions.has(coverage.region)) continue;
    if (coverage.date < fromDate || coverage.date > toDate) continue;
    for (const queue of coverage.covered) {
      if (queue === ALL_CLEAR_QUEUE || !isQueueCode(queue)) continue;
      const target = byQueue.get(queue) ?? { slots: [], days: new Set<string>() };
      target.days.add(coverage.date);
      byQueue.set(queue, target);
    }
  }

  return [...byQueue.entries()]
    .map(([queue, data]) => {
      data.slots.sort((a, b) => a.startMs - b.startMs);
      const daysWithData = data.days.size;
      const effectiveWindow = Math.max(24 * 60, Math.min(windowMinutes, daysWithData * 24 * 60));
      const outageMinutes = unionInWindow(data.slots, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY).minutes;
      const counted = Math.min(effectiveWindow, outageMinutes);
      return {
        queue,
        windowMinutes: effectiveWindow,
        outageMinutes: counted,
        poweredMinutes: Math.max(0, effectiveWindow - counted),
        reliabilityPct:
          effectiveWindow > 0 ? Math.round(((effectiveWindow - counted) / effectiveWindow) * 1000) / 10 : 0,
        // День с опубликованным графиком — это данные, даже если отключений в нём не было.
        hasData: data.days.size > 0,
      };
    })
    .sort((a, b) => a.reliabilityPct - b.reliabilityPct || b.outageMinutes - a.outageMinutes);
}

/** Прибавляет одно отключение к накопителю «сколько раз» и «сколько минут». */
function addBucket(current: { count: number; minutes: number } | undefined, minutes: number) {
  return { count: (current?.count ?? 0) + 1, minutes: (current?.minutes ?? 0) + minutes };
}

/**
 * Гарантирует наличие таблиц.
 *
 * Все DDL-запросы идемпотентны (`IF NOT EXISTS`), поэтому их безопасно повторять после перезапуска
 * изолята; отправляем их одной пачкой, а не десятью последовательными запросами.
 */
async function ensureSchema(env: Env): Promise<void> {
  const prepared: D1PreparedStatement[] = [];
  const statements = [
    `CREATE TABLE IF NOT EXISTS schedule_slots (
      region TEXT NOT NULL, queue TEXT NOT NULL, date TEXT NOT NULL,
      time_from TEXT NOT NULL, time_to TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'mirror',
      PRIMARY KEY (region, queue, date, time_from))`,
    // Индексы под самые частые чтения: слоты области за дату и слоты всех областей за дату.
    // Без них SQLite сканирует всю таблицу на каждый `/regions`, `/status` и `/sync`, а на
    // бесплатном D1 каждая прочитанная строка — это `rows_read`.
    `CREATE INDEX IF NOT EXISTS idx_slots_region_date ON schedule_slots (region, date)`,
    `CREATE INDEX IF NOT EXISTS idx_slots_date ON schedule_slots (date)`,
    `CREATE TABLE IF NOT EXISTS snapshot_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    // Покрытие ГПВ: «на эту дату оператор опубликовал график и включил в него эту очередь».
    // Отдельно от слотов, потому что график без отключений (все коды 1 = «світло за графіком»)
    // иначе неотличим от «оператор ничего не публиковал», и приложение писало «Немає даних» там,
    // где график есть. `has_outages` — были ли в графике часы отключений для этой очереди.
    `CREATE TABLE IF NOT EXISTS schedule_coverage (
      region TEXT NOT NULL, date TEXT NOT NULL, queue TEXT NOT NULL, has_outages INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'mirror', updated_at TEXT NOT NULL,
      PRIMARY KEY (region, date, queue))`,
    `CREATE INDEX IF NOT EXISTS idx_schedule_coverage_region_date ON schedule_coverage (region, date)`,
    `CREATE TABLE IF NOT EXISTS news (
      id TEXT PRIMARY KEY, source_key TEXT NOT NULL, url TEXT NOT NULL, title TEXT NOT NULL,
      summary TEXT, published_at TEXT, first_seen_at TEXT NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS idx_news_published ON news (published_at DESC)`,
    `CREATE TABLE IF NOT EXISTS outage_events (
      external_id TEXT PRIMARY KEY, region TEXT NOT NULL, starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL, area_name TEXT NOT NULL, addresses_raw TEXT NOT NULL,
      reason TEXT, kind TEXT NOT NULL DEFAULT 'repair', source_url TEXT, fetched_at TEXT NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS idx_outage_events_starts ON outage_events (starts_at DESC)`,
    `CREATE TABLE IF NOT EXISTS provider_city_ids (
      provider TEXT NOT NULL, city_id TEXT NOT NULL, discovered_at TEXT NOT NULL,
      PRIMARY KEY (provider, city_id))`,
  ];
  for (const sql of statements) {
    prepared.push(env.DB.prepare(sql));
  }
  // `batch()` — один round-trip к D1 вместо десяти последовательных `run()`: DDL идемпотентны
  // (`IF NOT EXISTS`), порядок внутри batch сохраняется, а каждый лишний round-trip на холодном
  // изоляте — это CPU, которого при лимите 10 мс и так не хватает.
  await env.DB.batch(prepared);
  await ensureNewsColumns(env);
}

/**
 * Догоняющая миграция новостей: в старой D1 у `news` не было категории и региона, поэтому
 * фильтры на клиенте было нечем применять. ALTER TABLE ADD COLUMN в D1 идемпотентно не
 * умеет, поэтому колонки добавляем по результату PRAGMA.
 */
async function ensureNewsColumns(env: Env): Promise<void> {
  const info = await env.DB.prepare(`PRAGMA table_info(news)`).all<{ name: string }>();
  const existing = new Set((info.results ?? []).map((row) => row.name));
  const additions: Array<[string, string]> = [
    ['kind', `TEXT`],
    ['region_cpu', `TEXT`],
    ['is_ukraine_wide', `INTEGER NOT NULL DEFAULT 1`],
    ['image_urls', `TEXT NOT NULL DEFAULT '[]'`],
    ['body', `TEXT`],
  ];
  let added = false;
  for (const [name, sql] of additions) {
    if (existing.has(name)) continue;
    await env.DB.prepare(`ALTER TABLE news ADD COLUMN ${name} ${sql}`).run();
    added = true;
  }
  // Бэкфилл — только в момент миграции: иначе каждый холодный изолят сканировал бы всю ленту.
  if (!added) return;
  // Заполняем категорию для уже собранных постов грубыми правилами (только там, где пусто).
  await env.DB.prepare(
    `UPDATE news SET kind = CASE
       WHEN lower(title) LIKE '%авар%' OR lower(title) LIKE '%надзвича%' THEN 'emergency'
       WHEN lower(title) LIKE '%відключ%' OR lower(title) LIKE '%без світла%' THEN 'outage'
       WHEN lower(title) LIKE '%графік%' OR lower(title) LIKE '%розклад%' THEN 'schedule-change'
       WHEN lower(title) LIKE '%ремонт%' OR lower(title) LIKE '%роботи%' THEN 'repair'
       ELSE 'other' END
     WHERE kind IS NULL`,
  ).run();
  await env.DB.prepare(
    `UPDATE news SET region_cpu = 'chernihivska-oblast', is_ukraine_wide = 0
     WHERE source_key LIKE '%chernigiv%' OR source_key LIKE '%chernihiv%'`,
  ).run();
}

/**
 * Лимит D1 на число связанных переменных в одном prepared-запросе (SQLITE_MAX_VARIABLE_NUMBER).
 * Не «размер запроса» и не «число строк»: превышение даёт «too many SQL variables».
 */
const MAX_VARIABLES = 100;

/**
 * Чистка протухшей истории — не чаще раза в сутки.
 *
 * Раньше `DELETE FROM schedule_slots WHERE date < ?` выполнялся на каждом обходе крона и на каждом
 * запросе к пустой базе. Строк он не находил, но `rows_written` за удаления D1 считает, а история
 * меняется не чаще раза в сутки: двигается только граница «сегодня». Гейт — по дате в
 * `snapshot_meta`, поэтому его видят все изоляты, а не только прогретый.
 */
let pruneCheckedOn: string | null = null;

async function maybePruneHistory(env: Env): Promise<void> {
  const today = kyivToday();
  if (pruneCheckedOn === today) return;
  try {
    await pruneHistoryOncePerDay(env.DB, today);
    pruneCheckedOn = today;
  } catch (error) {
    // Чистка — не повод не отдавать график: без неё данные просто живут дольше.
    console.log(`prune: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Записывает слоты в D1.
 *
 * Авторитетный источник (зеркало) заменяет данные за затронутые (область, дата), но только начиная
 * со вчерашнего дня: зеркало отдаёт лишь ближайшие даты и не должно стирать уже собранную историю —
 * от неё зависят «Статистика електропостачання» и надёжность.
 *
 * Дополнительный источник (Telegram) снимает только СВОИ строки за (область, очередь, дата) и
 * вставляет с `INSERT OR IGNORE`: полный график оператора из зеркала он не перетирает. Та же
 * семантика, что у Node-бэкенда (`importTelegramScheduleSlots`).
 *
 * Сама запись — разницей (`saveSlotsDiff`): неизменившиеся интервалы не переписываются, иначе
 * дневной лимит D1 (`rows_written`) сгорал на повторных обходах.
 */
async function saveSlots(env: Env, slots: Slot[], options: { source?: string; replace?: boolean } = {}): Promise<void> {
  await saveSlotsDiff(env.DB, slots, {
    source: options.source ?? 'mirror',
    replace: options.replace ?? true,
    historyBorder: addDays(kyivToday(), -1),
  });
}

/** Строка покрытия ГПВ из D1. */
interface CoverageRow {
  region: string;
  date: string;
  queue: string;
  has_outages: number;
  source: string;
}

/**
 * Сохраняет покрытие ГПВ: какие очереди на какие даты оператор опубликовал.
 *
 * `replace: true` — для зеркала: это авторитетный источник, и если на дату пришёл другой набор
 * очередей, прежние строки за эту дату надо снять (иначе «очередь исчезла из графика» не
 * отразилось бы). Прошлые даты не трогаем — так же, как в `saveSlots`.
 */
async function saveCoverage(
  env: Env,
  entries: CoverageEntry[],
  options: { source?: string; replace?: boolean } = {},
): Promise<void> {
  await saveCoverageDiff(env.DB, entries, {
    source: options.source ?? 'mirror',
    replace: options.replace ?? true,
  });
}
/**
 * Покрытие одной области за диапазон дат (включительно).
 */
async function loadCoverage(env: Env, regions: string[], from: string, to: string): Promise<CoverageRow[]> {
  const filter = regionIn(regions);
  const result = await env.DB.prepare(
    `SELECT region, date, queue, has_outages, source FROM schedule_coverage
     WHERE ${filter.clause ? `${filter.clause} AND ` : ''}date >= ? AND date <= ?`,
  ).bind(...filter.bindings, from, to).all<CoverageRow>();
  return result.results ?? [];
}

/** Что известно об опубликованном ГПВ области за одну дату. */
interface DayCoverage {
  /** Очереди, которые оператор включил в график на эту дату. */
  queues: Set<string>;
  /** Из них те, у кого в графике есть часы отключений. */
  offQueues: Set<string>;
  /** Источники, которые дали покрытие (`mirror`, `telegram`). */
  sources: Set<string>;
}

/** Покрытие области за одну дату: пустой набор — «оператор на эту дату ничего не публиковал». */
async function coverageOfDay(env: Env, regions: string[], date: string): Promise<DayCoverage> {
  const rows = await loadCoverage(env, regions, date, date);
  const coverage: DayCoverage = { queues: new Set(), offQueues: new Set(), sources: new Set() };
  for (const row of rows) {
    const queue = normalizeQueue(row.queue);
    coverage.queues.add(queue);
    if (row.has_outages) coverage.offQueues.add(queue);
    coverage.sources.add(row.source);
  }
  return coverage;
}

/**
 * Количество колонок в строке `outage_events` — от этого зависит размер пачки вставки.
 *
 * Десять: внешний ключ, область, начало, конец, место, адреса, причина, тип, ссылка, время сбора.
 */
const EVENT_COLUMNS = 10;

/**
 * Переносит собранные слоты ГПВ в `outage_events` (`kind = 'gpv'`).
 *
 * Зачем: `outage_events` — каноническое ядро, из него живут страницы «Відключення», «Аварії» и
 * тепловая карта. Пока в ядро писал только точечный источник (Чернігівобленерго, да и тот под
 * флагом), таблица стояла пустой, и эти экраны показывали пустоту при том, что график по стране
 * у нас уже лежит.
 *
 * Пишем только ближайшие даты (сегодня/завтра): полный бэкфилл истории ГПВ раздул бы базу
 * воркера, а историческая надёжность и так считается по `schedule_slots`.
 */
async function materializeGpvEvents(env: Env, dates: string[]): Promise<number> {
  const wanted = [...new Set(dates)].filter((date) => isYmd(date));
  if (wanted.length === 0) return 0;
  const rows = await env.DB.prepare(
    `SELECT region, queue, date, time_from, time_to FROM schedule_slots
     WHERE date IN (${wanted.map(() => '?').join(', ')})`,
  ).bind(...wanted).all<SlotRow>();
  const list = rows.results ?? [];
  if (list.length === 0) return 0;

  // Фингерпринт набора слотов. Без него крон каждые 20 минут делал INSERT OR REPLACE по
  // всем ~1900 событиям за сегодня и завтра: OR REPLACE в SQLite — это DELETE+INSERT даже
  // если не изменилось ни одно значение, и D1 считал обе строки написанными. Так за сутки
  // сгорало ~77k из 100k лимита записи, хотя данные не менялись ни на байт.
  const fingerprint = list.length + '·' + list
    .map((row) => `${row.region}:${row.queue}:${row.date}:${row.time_from}-${row.time_to}`)
    .sort()
    .join('|');
  const previous = await env.DB.prepare(
    `SELECT value FROM snapshot_meta WHERE key = 'gpv_fingerprint'`,
  ).first<{ value: string }>();
  if (previous?.value === fingerprint) {
    return -list.length;
  }
  await env.DB.prepare(`INSERT OR REPLACE INTO snapshot_meta (key, value, updated_at) VALUES (?, ?, ?)`)
    .bind('gpv_fingerprint', fingerprint, new Date().toISOString())
    .run();

  const CHUNK = Math.max(1, Math.floor(MAX_VARIABLES / EVENT_COLUMNS));
  const fetchedAt = new Date().toISOString();
  for (let start = 0; start < list.length; start += CHUNK) {
    const chunk = list.slice(start, start + CHUNK);
    const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
    const values = chunk.flatMap((row) => {
      const queue = normalizeQueue(row.queue);
      return [
        // Внешний ключ детерминированный: повторный обход перезаписывает ту же строку, а не
        // плодит дубликаты одного и того же отключения.
        `gpv:${row.region}:${queue}:${row.date}:${row.time_from}`,
        row.region,
        localSlotToUtc(row.date, row.time_from, false),
        localSlotToUtc(row.date, row.time_to, true),
        REGION_NAMES[row.region] ?? row.region,
        `Черга ${queue} · ${row.date}`,
        'Графік ГПВ',
        'gpv',
        null,
        fetchedAt,
      ];
    });
    await env.DB.prepare(
      `INSERT OR REPLACE INTO outage_events
       (external_id, region, starts_at, ends_at, area_name, addresses_raw, reason, kind, source_url, fetched_at)
       VALUES ${placeholders}`,
    ).bind(...values).run();
  }
  return list.length;
}

/** Точечное событие из поста оператора: без очереди, но с областью, временем и причиной. */
interface TelegramOutageEvent {
  id: string;
  region: string;
  startsAt: string;
  endsAt: string;
  /** Короткий текст поста — он и есть «адреса» события: адресов оператор в посте не даёт. */
  text: string;
  reason: string;
  kind: 'emergency' | 'repair';
  url: string;
}

/**
 * Точковые отключения из постов оператора (`kind = 'emergency' | 'repair'`).
 *
 * В Telegram операторы пишут не только ГПВ: «ремонтні роботи 08:00–18:00» (ЦЕК, Дніпро) или
 * «аварійне відключення 14:30–15:30» (Прикарпаттяобленерго). Номера очереди в таких постах нет,
 * поэтому группы у события тоже нет — но место (область), причина и время есть, и это законное
 * событие для страницы «Аварії». Без явного времени событие не пишем: придумывать длительность
 * аварии нельзя (то же правило, что в Node-бэкенде).
 */
async function saveTelegramOutageEvents(env: Env, events: TelegramOutageEvent[]): Promise<number> {
  if (events.length === 0) return 0;
  const CHUNK = Math.max(1, Math.floor(MAX_VARIABLES / EVENT_COLUMNS));
  const fetchedAt = new Date().toISOString();
  let written = 0;
  for (let start = 0; start < events.length; start += CHUNK) {
    const chunk = events.slice(start, start + CHUNK);
    const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
    const values = chunk.flatMap((event) => [
      event.id,
      event.region,
      event.startsAt,
      event.endsAt,
      REGION_NAMES[event.region] ?? event.region,
      event.text,
      event.reason,
      event.kind,
      event.url,
      fetchedAt,
    ]);
    // OR IGNORE: внешний ключ — идентификатор поста, поэтому повторный обход не дублирует событие
    // и не переписывает уже собранное (текст поста могли отредактировать позже).
    await env.DB.prepare(
      `INSERT OR IGNORE INTO outage_events
       (external_id, region, starts_at, ends_at, area_name, addresses_raw, reason, kind, source_url, fetched_at)
       VALUES ${placeholders}`,
    ).bind(...values).run();
    written += chunk.length;
  }
  return written;
}

/** Один пост канала так, как он виден на публичной странице `t.me/s/<канал>`. */
interface TelegramSchedulePost {
  text: string;
  /** Ссылка на пост (`https://t.me/<канал>/<номер>`) или `null`, если разметка её не отдала. */
  url: string | null;
  /** Идентификатор поста для дедупликации событий: ссылка, а без неё — начало текста. */
  id: string;
  publishedAt: Date;
}

/**
 * Разбирает публичную страницу канала в посты (текст + время публикации + ссылка).
 *
 * Разметка та же, что у `parseTelegramChannel` для ленты новостей: блоки `.tgme_widget_message`,
 * дата в `time[datetime]`, текст в `.tgme_widget_message_text`. Здесь нужен ещё и сырой текст
 * поста (для разбора ГПВ) и его идентификатор — по нему дедуплицируются точковые события.
 * Токен бота не нужен: это открытая веб-версия канала.
 */
function parseTelegramChannelPosts(html: string): TelegramSchedulePost[] {
  const posts: TelegramSchedulePost[] = [];
  for (const block of html.split('tgme_widget_message_wrap').slice(1)) {
    const datetime = /<time[^>]*datetime="([^"]+)"/u.exec(block)?.[1];
    const link = /href="(https:\/\/t\.me\/[^"]*\/\d+)"/u.exec(block)?.[1] ?? null;
    const textMatch = /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/u.exec(block);
    if (!textMatch) continue;
    const text = stripHtml(textMatch[1] ?? '');
    if (!text) continue;
    posts.push({
      text,
      url: link,
      id: link ?? `tg:${text.slice(0, 60)}`,
      publishedAt: datetime ? new Date(datetime) : new Date(),
    });
    if (posts.length >= 40) break;
  }
  return posts;
}

/**
 * Импорт ГПВ и точечных отключений из публичных каналов операторов.
 *
 * Зачем: зеркало ГПВ — не единственный источник правды по стране. Часть областей оно не отдаёт
 * вовсе либо отдаёт только ближайшие даты, и человек видел «Немає даних» там, где оператор график
 * опубликовал. Операторы пишут изменения прямо в открытых каналах, например
 * «🕗 З 16:40 до 18:30 додатково відключається черга 6/2».
 *
 * Каналы берём только те, у которых соответствие «канал → область» проверено
 * (`TELEGRAM_SCHEDULE_CHANNELS`): чужой график на нашей области — выдумка, а она хуже честного
 * пустого экрана.
 *
 * Слоты пишутся за вчера/сегодня/завтра: более старые «зміни» уже неактуальны. Источник —
 * `telegram`, и зеркало он не перетирает (см. `saveSlots`). Точковые события (авария/ремонт с
 * явным временем) уходят в `outage_events`.
 */
async function importTelegramSchedules(
  env: Env,
  dates: string[],
): Promise<{ slots: number; coverage: number; events: number; channels: number }> {
  const wanted = new Set(dates);
  const slots: Slot[] = [];
  const coverage: CoverageEntry[] = [];
  const events: TelegramOutageEvent[] = [];

  await Promise.all(
    TELEGRAM_SCHEDULE_CHANNELS.map(async ({ channel, region }) => {
      try {
        const response = await fetch(`https://t.me/s/${channel}`, {
          headers: { 'user-agent': 'Mozilla/5.0 (compatible; svitlo-cf-worker)' },
        });
        if (!response.ok) return;
        for (const post of parseTelegramChannelPosts(await response.text())) {
          for (const slot of parseTelegramScheduleText(post.text, post.publishedAt)) {
            if (!wanted.has(slot.date)) continue;
            slots.push({
              region,
              queue: slot.queue,
              date: slot.date,
              timeFrom: slot.timeFrom,
              timeTo: slot.timeTo,
            });
            // Пост «черга 6/2 відключається 16:40–18:30» — это и покрытие: очередь в графике
            // на эту дату есть, и часы отключений в ней есть.
            coverage.push({ region, date: slot.date, queue: slot.queue, hasOutages: true });
          }
          // «Графіки не діють» — оператор прямо сообщил, что на эту дату отключений нет.
          // Без такой строки область выглядела бы «без данных», хотя график опубликован.
          if (isAllClearNotice(post.text)) {
            const date = resolveScheduleDate(post.text, post.publishedAt);
            if (wanted.has(date)) {
              coverage.push({ region, date, queue: ALL_CLEAR_QUEUE, hasOutages: false });
            }
          }
          // Точковое событие (авария/ремонт) пишем только при явном времени в посте: без него
          // длительность пришлось бы выдумать.
          const kind = classifyOutagePost(post.text);
          if (!kind) continue;
          const window = firstTimeWindow(post.text);
          if (!window) continue;
          const date = resolveScheduleDate(post.text, post.publishedAt);
          if (!wanted.has(date)) continue;
          events.push({
            id: post.id,
            region,
            startsAt: localSlotToUtc(date, window.timeFrom, false),
            endsAt: localSlotToUtc(date, window.timeTo, true),
            text: post.text.replace(/\s+/gu, ' ').slice(0, 300),
            reason: (post.text.split('\n')[0] ?? post.text).slice(0, 160),
            kind,
            url: post.url ?? `https://t.me/s/${channel}`,
          });
        }
      } catch {
        // Канал недоступен (сеть, блокировка) — ожидаемый случай, крон из-за него не падает.
      }
    }),
  );

  await saveSlots(env, mergeSlots(slots), { source: TELEGRAM_SCHEDULE_SOURCE, replace: false });
  await saveCoverage(env, mergeCoverage(coverage), { source: TELEGRAM_SCHEDULE_SOURCE, replace: false });
  const eventsWritten = await saveTelegramOutageEvents(env, events);
  return { slots: slots.length, coverage: coverage.length, events: eventsWritten, channels: TELEGRAM_SCHEDULE_CHANNELS.length };
}

/** Регион источника: пока зеркалу известен только Черниговский оператор. */
function newsRegionForSource(sourceKey: string): string | null {
  if (sourceKey.includes('chernigiv') || sourceKey.includes('chernihiv')) return 'chernihivska-oblast';
  return null;
}

/**
 * Классификация поста по ключевым словам.
 *
 * Полноценный классификатор живёт в Node-бэкенде; зеркало не может держать LLM/правила, но
 * грубые категории нужны, чтобы фильтры «Аварії» и «Зміна графіка» в приложении не были
 * пустыми. Ошибка классификации здесь дешевле, чем полное отсутствие фильтров.
 */
function classifyNewsKind(text: string): string {
  if (/авар|надзвичай|екстрен/u.test(text)) return 'emergency';
  if (/відключ|без світла|без електро/u.test(text)) return 'outage';
  if (/графік|розклад|почергов/u.test(text)) return 'schedule-change';
  if (/ремонт|роботи/u.test(text)) return 'repair';
  return 'other';
}

async function saveNews(env: Env, items: Array<Omit<NewsRow, 'first_seen_at'>>): Promise<void> {
  if (items.length === 0) return;
  const now = new Date().toISOString();
  // 12 колонок на публикацию: 100/12 = 8 строк за один round-trip.
  const CHUNK = Math.max(1, Math.floor(MAX_VARIABLES / 12));
  for (let start = 0; start < items.length; start += CHUNK) {
    const chunk = items.slice(start, start + CHUNK);
    const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
    const values = chunk.flatMap((item) => {
      const text = `${item.title} ${item.summary ?? ''}`.toLocaleLowerCase('uk-UA');
      const kind = classifyNewsKind(text);
      const region = newsRegionForSource(item.source_key);
      return [
        item.id,
        item.source_key,
        item.url,
        item.title,
        item.summary,
        item.published_at,
        now,
        kind,
        region,
        region ? 0 : 1,
        item.image_urls ?? '[]',
        item.body ?? item.summary ?? null,
      ];
    });
    // INSERT OR IGNORE: первый_seen_at не перетираем, иначе дата обнаружения «обнулялась» бы
    // при каждом кроне и новости вечно выглядели бы только что найденными.
    await env.DB.prepare(
      `INSERT OR IGNORE INTO news
         (id, source_key, url, title, summary, published_at, first_seen_at,
          kind, region_cpu, is_ukraine_wide, image_urls, body)
       VALUES ${placeholders}`,
    ).bind(...values).run();
  }
}

/**
 * Крон каждые 20 минут: забирает график и новости и складывает снимок в D1 + Cache API.
 *
 * Порядок важен: сначала график (он важнее новостей), и ошибка на новостях не должна была
 * помешать записать график. Итог пишется в `snapshot_meta`, поэтому даже при пустом зеркале
 * фронтенд знает, что автоборт был, и не рисует «свежие» данные из пустоты.
 */
export async function scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
  await ensureSchemaOnce(env);

  const today = kyivToday();
  const tomorrow = addDays(today, 1);
  let mirrorSlots = 0;
  let mirrorCoverage = 0;
  let mirrorTimestamp: string | null = null;
  let mirrorRegions = 0;

  const mirrorSync = await syncMirrorSchedule(env);
  if (mirrorSync.ok) {
    mirrorSlots = mirrorSync.slotsParsed;
    mirrorCoverage = mirrorSync.coverageParsed;
    mirrorTimestamp = mirrorSync.timestamp;
    mirrorRegions = mirrorSync.regionsImported;
    // Логируем только факт записи: на спокойном графике импорт не тратит ни одной строки, и
    // именно это нужно видеть при разборе лимита D1 — молчание здесь означает «изменений нет».
    if (!mirrorSync.skippedByFingerprint) {
      console.log(
        `scheduled: зеркало ${mirrorSync.regionsImported} областей: ` +
          `+${mirrorSync.slotsInserted}/-${mirrorSync.slotsDeleted} слотов, ` +
          `+${mirrorSync.coverageInserted}/-${mirrorSync.coverageDeleted} покрытия`,
      );
    }
  } else {
    console.log(`scheduled: зеркало недоступно (${mirrorSync.error ?? 'unknown'})`);
  }

  // Второй источник: открытые каналы операторов. Нужен там, где зеркало область не отдаёт вовсе
  // или отдаёт только ближайшие даты, — именно на этих областях человек видел «Немає даних».
  // Ошибку глотаем: график из зеркала уже записан, без Telegram экраны остаются рабочими.
  let telegram = { slots: 0, coverage: 0, events: 0, channels: 0 };
  try {
    telegram = await importTelegramSchedules(env, [addDays(today, -1), today, tomorrow]);
  } catch (error) {
    console.log(`scheduled: Telegram недоступен (${String(error)})`);
  }

  // Слоты ГПВ переносим в каноническое ядро `outage_events`: из него живут «Відключення»,
  // «Аварії» и тепловая карта, которые оставались пустыми, хотя график уже был собран.
  let gpvEvents = 0;
  try {
    gpvEvents = await materializeGpvEvents(env, [today, tomorrow]);
    // Отрицательное число означает «отпечаток совпал, писать было нечего»: молчание на
    // спокойном графике — норма, а не поломка. Это нужно видеть при разборе лимита D1.
    if (gpvEvents < 0) console.log(`scheduled: ГПВ без изменений (${Math.abs(gpvEvents)} событий пропущено)`);
  } catch (error) {
    console.log(`scheduled: не удалось перенести ГПВ в outage_events (${String(error)})`);
  }

  if (mirrorSync.ok || telegram.slots > 0) {
    // Итог обхода пишем в snapshot_meta: по нему фронтенд знает, что борт был, и не выдаёт
    // старые данные за свежие. Считаем здесь, после Telegram, иначе цифры в отчёте были бы
    // только про зеркало и «0 слотов» выглядело бы как поломка.
    await env.DB.prepare(`INSERT OR REPLACE INTO snapshot_meta (key, value, updated_at) VALUES (?, ?, ?)`)
      .bind('schedule', JSON.stringify({
        fetchedAt: new Date().toISOString(),
        timestamp: mirrorTimestamp,
        slots: mirrorSlots,
        coverage: mirrorCoverage,
        mirrorRegions,
        telegramSlots: telegram.slots,
        telegramEvents: telegram.events,
        gpvEvents,
        regions: Object.keys(REGION_NAMES).length,
      }), new Date().toISOString())
      .run();
  }

  // Новости — отдельно и «мягко»: их отсутствие не должно помешать записать график.
  try {
    await saveNews(env, await fetchNews(env));
  } catch {
    // Игнорируем: график уже записан.
  }

  // Точечные отключения Чернигівобленерго. Выключены по умолчанию, как и в Node-бэкенде:
  // оператор под WAF, и включение без списка НП дало бы пустую выдачу, которую легко
  // принять за «отключений нет».
  if (env.CHERNIHIV_WEB_ENABLED === 'true') {
    try {
      const ok = await runChernihiv(env);
      console.log(`chernihiv: сбор ${ok ? 'завершён' : 'не удался (источник недоступен)'}`);
    } catch (error) {
      console.warn(`chernihiv: ${error instanceof Error ? error.message : 'unknown'}`);
    }
  }

  // Данные переписаны — кэш изолята больше не актуален. У изолятов, которые обслуживают запросы,
  // свой кэш (и он живёт не дольше `MEMORY_CACHE_TTL_MS`), а здесь сбрасываем свой: иначе
  // следующий обход читал бы собственные старые ответы.
  if (mirrorSync.ok || telegram.slots > 0) {
    scheduleSeeded = true;
    clearMemoryCache();
  }

  ctx.waitUntil(cacheApiRefresh());
}

/** Прогревает Cache API под `/api/v1/regions` и `/api/v1/queues`, чтобы чтения шли без D1. */
async function cacheApiRefresh(): Promise<void> {
  // Заполняется лениво первым же запросом; здесь только гарантируем, что Cache API доступен.
  return Promise.resolve();
}

// ───────────────────────────── Справочники и поиск по адресу ─────────────────────────────

/** Откуда пришла подсказка: наш справочник, привязка из базы или открытый гео-справочник OSM. */
type PlaceSource = 'curated' | 'address_queues' | 'osm' | 'directory';

interface AddressQueueRow {
  region: string;
  settlement_name: string;
  settlement_normalized: string;
  street_name: string;
  street_normalized: string;
  house_pattern: string;
  queue: string;
  source: string;
  updated_at: string;
}

/**
 * Спрашивает Nominatim OpenStreetMap.
 *
 * Это открытый географический справочник: в нём есть реальные города, сёла и улицы Украины,
 * которых нет в нашей базе. Без него подсказки ограничивались бы теми несколькими населёнными
 * пунктами, что мы внесли вручную. Лимиты Nominatim — 1 запрос в секунду на приложение,
 * поэтому ответы складываются в Cache API на сутки, а адреса из D1 всегда спрашиваются первыми.
 *
 * User-Agent обязателен по правилам Nominatim, поэтому передаём свой, а не браузерный.


/** Убирает дубли по нормализованному имени, сохраняя порядок (сначала наши данные). */
function dedupePlaces<T extends { normalized: string }>(places: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const place of places) {
    if (!place.normalized || seen.has(place.normalized)) continue;
    seen.add(place.normalized);
    result.push(place);
  }
  return result;
}

// ───────────────────────────── HTTP-часть ─────────────────────────────

/**
 * Заголовки, которые фронтенд реально отправляет.
 *
 * `If-None-Match` в списке обязателен: офлайн-пакет (`/sync`) уходит с ним, а по правилам CORS
 * это НЕ простой заголовок — браузер делает preflight и требует разрешение в ответе. Пока здесь
 * стоял только Content-Type, preflight отклонялся, `/sync` (графики, очереди, области, НП,
 * новости одним запросом) не проходил вовсе, и приложение жило на данных первой синхронизации:
 * «дані з сервера не прилітають». `POST` нужен народной привязке адреса (/addresses/contribute):
 * метода POST в списке не было, поэтому и она отклонялась на preflight.
 */
const ALLOWED_HEADERS = 'Content-Type, If-None-Match';

/** Конверт ответа совпадает с бэкендом: `{ data: … }`. Фронтенд читает именно его. */
function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // CORS: фронтенд живёт на Pages (в приложении — на https://localhost), воркер — на другом
      // домене, поэтому браузер обязан спросить разрешение перед каждым таким запросом.
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': ALLOWED_HEADERS,
      'access-control-max-age': '86400',
      ...headers,
    },
  });
}

function addDays(date: string, offset: number): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + offset);
  return next.toISOString().slice(0, 10);
}

interface SlotRow {
  region: string;
  queue: string;
  date: string;
  time_from: string;
  time_to: string;
  /** Источник слота (`mirror`, `telegram`). Необязателен: часть запросов его не выбирает. */
  source?: string;
}

/**
 * Слоты графика по ключам области за дату.
 *
 * Пустой список ключей — «вся страна»: фильтра по области нет. Так же читали счётчики статуса до
 * появления канонических `cpu`, и это поведение сохранено (`/status` без `?region=`).
 */
async function loadSlots(env: Env, regions: string[], date: string): Promise<SlotRow[]> {
  const filter = regionIn(regions);
  const result = await env.DB.prepare(
    `SELECT region, queue, date, time_from, time_to, source FROM schedule_slots
     WHERE ${filter.clause ? `${filter.clause} AND ` : ''}date = ?`,
  ).bind(...filter.bindings, date).all<SlotRow>();
  return result.results ?? [];
}

/**
 * Каталог областей, как его прислало зеркало (`cpu → name_ua`), из последнего обхода.
 *
 * Зачем: наш список имён не обязан знать каждую область, а имя из источника честнее слага.
 * Функция ничего не выдумывает: нет данных — пустая мапа, и подпись остаётся прежней.
 */
async function loadMirrorRegionNames(env: Env): Promise<Record<string, string>> {
  const row = await env.DB.prepare(`SELECT value FROM snapshot_meta WHERE key = 'mirror_regions'`).first<{
    value: string;
  }>();
  if (!row?.value) return {};
  try {
    const parsed: unknown = JSON.parse(row.value);
    if (!isJsonObject(parsed)) return {};
    const names: Record<string, string> = {};
    for (const [cpu, name] of Object.entries(parsed)) {
      if (typeof name === 'string' && name.trim()) names[cpu] = name.trim();
    }
    return names;
  } catch {
    return {};
  }
}

/**
 * Интервалы группы за дату в форме `ScheduleIntervalUtc`, склеенные в окна отключений.
 *
 * Пустой массив означает «по этой группе отключений в этот день нет» — это законное состояние,
 * фронтенд по нему честно покажет «свет будет», а не ошибку.
 */
function toIntervals(rows: SlotRow[], queue: string | readonly string[], date: string) {
  // Принимаем и один код, и набор синонимов (Київ: «1» ≡ «1/1»): слоты под любой из форм — это
  // график одной и той же группы.
  const wanted = new Set((Array.isArray(queue) ? queue : [queue]).map((code) => normalizeQueue(code)));
  const filtered = rows
    .filter((row) => wanted.has(normalizeQueue(row.queue)))
    .sort((a, b) => a.time_from.localeCompare(b.time_from));

  // Преобразуем каждую пару в миллисекунды UTC и локальные строки
  interface IntervalCandidate {
    startMs: number;
    endMs: number;
    localTimeFrom: string;
    localTimeTo: string;
  }

  const rawIntervals: IntervalCandidate[] = [];
  for (const row of filtered) {
    const startsAt = localSlotToUtc(date, row.time_from, false);
    const endsAt = localSlotToUtc(date, row.time_to, true);
    const startMs = Date.parse(startsAt);
    const endMs = Date.parse(endsAt);
    if (endMs > startMs) {
      rawIntervals.push({
        startMs,
        endMs,
        localTimeFrom: row.time_from,
        localTimeTo: row.time_to,
      });
    }
  }

  // Сортируем по началу интервала
  rawIntervals.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  // Склеиваем смежные или пересекающиеся интервалы (например, 06:00-06:30 + 06:30-07:00 -> 06:00-07:00)
  const merged: IntervalCandidate[] = [];
  for (const cur of rawIntervals) {
    const prev = merged[merged.length - 1];
    if (prev && cur.startMs <= prev.endMs) {
      if (cur.endMs > prev.endMs) {
        prev.endMs = cur.endMs;
        prev.localTimeTo = cur.localTimeTo;
      }
    } else {
      merged.push({ ...cur });
    }
  }

  return merged.map((item) => ({
    startsAt: new Date(item.startMs).toISOString(),
    endsAt: new Date(item.endMs).toISOString(),
    localTimeFrom: item.localTimeFrom,
    localTimeTo: item.localTimeTo,
    stateCode: OFF_STATE.code,
    stateName: OFF_STATE.name,
    stateColor: OFF_STATE.color,
  }));
}

/**
 * Снимок зеркала для аварийного чтения без D1.
 *
 * `ok=false` — зеркало недоступно или ответ не разобрался. Это не повод отдавать 500: вызывающий
 * решает, что честнее показать (503 с причиной), но данные из D1 в этом случае не читаются вовсе.
 */
interface MirrorSnapshot {
  ok: boolean;
  payload: Record<string, unknown> | null;
  /** `cpu → name_ua` из payload: подписи областей без D1. */
  names: Record<string, string>;
  /** Все ключи фида, которые реально пришли. */
  cpus: string[];
  /**
   * Слоты, собранные нами сами и лежащие в `schedule_slots` (`source = energy-ua`).
   *
   * Зачем: зеркало отдаёт не все области и не все дни — у Киева расписания пустые. Раньше
   * маршруты `/regions`, `/queues`, `/schedules` работали ТОЛЬКО от зеркала, поэтому собранные
   * Scrapling графики лежали в D1 и не были видны ни в одном ответе. Теперь снимок включает
   * оба источника, а приоритет у зеркала: наши слоты добавляются, если по этому ключу зеркало
   * ничего не дало на эту дату.
   */
  d1Slots?: Record<string, SlotRow[]>;
  /**
   * Покрытие, собранное нашим собственным парсером (`schedule_coverage`).
   *
   * Для областей, которые мы разбираем сами, ЭТО источник истины. Внешнее зеркало отдаёт
   * для них пустые таблицы как «свет есть по графику»: 48 ячеек со статусом «світло є»
   * при полном отсутствии данных у оператора. Показывать человеку зелёный там, где висит
   * `class="no_data"`, — худшая ошибка монитора отключений, поэтому при наличии своих
   * данных покрытие берётся только из них, а зеркало используется лишь там, где своих нет.
   */
  d1Coverage?: Record<string, Array<{ queue: string; hasOutages: boolean }>>;
  /** Метка времени источника (не время нашего запроса). */
  timestamp: string | null;
  /** Когда снимок получен этим изолятом (ms). */
  fetchedAt: number;
  error?: string;
}

const MIRROR_SNAPSHOT_TTL_MS = 5 * 60_000;
let mirrorSnapshotCache: { expiresAt: number; snapshot: MirrorSnapshot } | null = null;
let mirrorSnapshotInflight: Promise<MirrorSnapshot> | null = null;

/**
 * Забирает зеркало ГПВ без записи в D1 и кэширует результат на 5 минут.
 *
 * Зачем отдельный путь, если `syncMirrorSchedule` уже умеет fetch: тот импорт пишет diff в D1,
 * а при исчерпанном `rows_read` падает ещё до разбора payload. Здесь нужен только HTTP-ответ
 * зеркала и чистый `extractSlots`/`extractCoverage` — ноль обращений к базе.
 */
async function fetchMirror(env: Env): Promise<MirrorSnapshot> {
  const now = Date.now();
  if (mirrorSnapshotCache && mirrorSnapshotCache.expiresAt > now) return mirrorSnapshotCache.snapshot;
  if (mirrorSnapshotInflight) return mirrorSnapshotInflight;

  const request = (async (): Promise<MirrorSnapshot> => {
    const fetchedAt = Date.now();
    try {
      const response = await fetch(env.MIRROR_SCHEDULE_URL, {
        headers: { 'user-agent': 'svitlo-cf-worker', accept: 'application/json' },
        // Пять минут — ровно срок жизни снимка в памяти изолята. Зеркало обновляется оператором
        // заметно реже, а при лимите D1 это единственный источник данных.
        cf: { cacheTtl: 300, cacheEverything: true },
      } as RequestInit);
      if (!response.ok) {
        return {
          ok: false,
          payload: null,
          names: {},
          cpus: [],
          timestamp: null,
          fetchedAt,
          error: `mirror HTTP ${response.status}`,
        };
      }

      const raw: unknown = await response.json();
      const payload = unwrapMirrorPayload(raw);
      if (!payload) {
        return {
          ok: false,
          payload: null,
          names: {},
          cpus: [],
          timestamp: null,
          fetchedAt,
          error: 'mirror payload unwrap failed',
        };
      }
      const timestamp =
        isJsonObject(raw) && typeof raw['timestamp'] === 'string' ? raw['timestamp'] : null;
      return {
        ok: true,
        payload,
        names: listRegionNames(payload),
        cpus: listRegionCpus(payload),
        timestamp,
        fetchedAt,
      };
    } catch (error) {
      return {
        ok: false,
        payload: null,
        names: {},
        cpus: [],
        timestamp: null,
        fetchedAt,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  })();

  mirrorSnapshotInflight = request;
  try {
    const base = await request;
    const snapshot = { ...base, d1Slots: await loadOwnSlots(env), d1Coverage: await loadOwnCoverage(env) };
    // Неудачный ответ тоже кэшируем на 5 минут: иначе каждый запрос при недоступном зеркале
    // будет ждать сеть и жечь CPU, пока D1 тоже недоступен.
    mirrorSnapshotCache = { expiresAt: Date.now() + MIRROR_SNAPSHOT_TTL_MS, snapshot };
    return snapshot;
  } finally {
    mirrorSnapshotInflight = null;
  }
}

/**
 * Слоты, собранные нашим собственным сборщиком и сохранённые в `schedule_slots`.
 *
 * Окно широкое намеренно: зеркало отдаёт не все области, а собранные нами графики не должны
 * исчезать из ответа из-за того, что попали в соседний день. Всё равно отдаёт только
 * `today`/`tomorrow`, поэтому лишнее окно не влияет на выдачу.
 */
async function loadOwnSlots(env: Env): Promise<Record<string, SlotRow[]>> {
  try {
    const result = await env.DB.prepare(
      `SELECT region, queue, date, time_from, time_to, source FROM schedule_slots
       WHERE date >= ? AND date <= ?`,
    ).bind(addDays(kyivToday(), -1), addDays(kyivToday(), 7)).all<SlotRow>();
    const grouped: Record<string, SlotRow[]> = {};
    for (const row of result.results ?? []) {
      (grouped[row.region] ??= []).push(row);
    }
    return grouped;
  } catch {
    // Нет D1 или таблицы — маршруты просто остаются на данных зеркала, как и раньше.
    return {};
  }
}

/** Покрытие по области на сегодня из `schedule_coverage` — только из проверенных источников. */
async function loadOwnCoverage(env: Env): Promise<Record<string, Array<{ queue: string; hasOutages: boolean }>>> {
  const grouped: Record<string, Array<{ queue: string; hasOutages: boolean }>> = {};
  try {
    const today = kyivToday();
    const result = await env.DB.prepare(
      `SELECT region, queue, has_outages FROM schedule_coverage
       WHERE date = ? AND source <> 'mirror'`,
    ).bind(today).all<{ region: string; queue: string; has_outages: number }>();
    for (const row of result.results ?? []) {
      (grouped[row.region] ??= []).push({
        queue: normalizeQueue(row.queue),
        hasOutages: Number(row.has_outages) > 0,
      });
    }
  } catch {
    return {};
  }
  return grouped;
}

/**
 * Слоты по ключам области: сначала зеркало, затем наши собственные.
 *
 * Раньше ключ, которого нет в фиде, отбрасывался целиком (`present.has(key)`), из-за чего
 * области без фида показывали пустые графики, хотя данные лежали в D1. Теперь отсутствие в
 * зеркале не причина отбрасывать ключ — просто добавляем то, что собрали сами.
 */
/** Статус отключения из времени: идёт / запланировано / завершено. */
function outageStatus(startsAt: string, endsAt: string): 'active' | 'scheduled' | 'finished' {
  const now = Date.now();
  const from = Date.parse(startsAt);
  const to = Date.parse(endsAt);
  if (Number.isFinite(from) && from <= now && Number.isFinite(to) && now < to) return 'active';
  if (Number.isFinite(from) && from > now) return 'scheduled';
  return 'finished';
}

function mirrorSlotsFor(snapshot: MirrorSnapshot, keys: string[]): Slot[] {
  const present = new Set(snapshot.cpus);
  const own = snapshot.d1Slots ?? {};
  const slots: Slot[] = [];
  const seen = new Set<string>();
  for (const key of [...new Set(keys)]) {
    if (present.has(key) && snapshot.payload) slots.push(...extractSlots(snapshot.payload, key));
    if (key in own) {
      for (const row of own[key]!) {
        const id = `${row.region}|${row.queue}|${row.date}|${row.time_from}|${row.time_to}`;
        if (seen.has(id)) continue;
        seen.add(id);
        slots.push({ region: row.region, queue: row.queue, date: row.date, timeFrom: row.time_from, timeTo: row.time_to });
      }
    }
  }
  return mergeSlots(slots);
}

/** Покрытие ГПВ по ключам области: какие группы оператор опубликовал и где есть отключения. */
function mirrorCoverageFor(snapshot: MirrorSnapshot, keys: string[]): CoverageEntry[] {
  if (!snapshot.payload) return [];
  const present = new Set(snapshot.cpus);
  const coverage: CoverageEntry[] = [];
  for (const key of [...new Set(keys)].filter((key) => present.has(key))) {
    coverage.push(...extractCoverage(snapshot.payload, key));
  }
  return mergeCoverage(coverage);
}


/** Слоты зеркала в форме строк D1: `toIntervals` и расчёты статуса работают с этими полями. */
function mirrorSlotRows(slots: Slot[]): SlotRow[] {
  return slots.map((slot) => ({
    region: slot.region,
    queue: normalizeQueue(slot.queue),
    date: slot.date,
    time_from: slot.timeFrom,
    time_to: slot.timeTo,
    source: 'mirror',
  }));
}

interface MirrorFact {
  queues: Set<string>;
  slots: number;
  todaySlots: number;
  lastDate: string | null;
  /** Группы, опубликованные на сегодня. */
  todayCovered: Set<string>;
  /** Группы, у которых на сегодня в графике есть часы отключений. */
  todayOff: Set<string>;
}

/**
 * Факты по каждому ключу фида одним проходом: группы, объём слотов, последняя дата и покрытие.
 * Используются тремя fallback-маршрутами, поэтому считаются один раз на снимок.
 */
function mirrorFacts(snapshot: MirrorSnapshot, today: string): Map<string, MirrorFact> {
  const facts = new Map<string, MirrorFact>();
  // Раньше при пустом payload функция выходила сразу, а обход шёл только по ключам зеркала.
  // В итоге области, для которых есть только собственные слоты в D1, вообще не попадали в
  // `/regions` — выглядело как «графиков нет», хотя слоты в базе лежали.
  const ownRegions = Object.keys(snapshot.d1Slots ?? {});
  if (!snapshot.payload && ownRegions.length === 0) return facts;
  for (const cpu of new Set([...snapshot.cpus, ...ownRegions])) {
    const slots = mirrorSlotsFor(snapshot, [cpu]);
    // Своё покрытие имеет приоритет: если мы сами разобрали область и там стоит
    // «Немає даних», зеркало не имеет права превратить это в «світло є за графіком».
    const ownCoverageToday = snapshot.d1Coverage?.[cpu];
    const coverageToday =
      ownCoverageToday && ownCoverageToday.length > 0
        ? ownCoverageToday
        : snapshot.payload
          ? mirrorCoverageFor(snapshot, [cpu]).filter((entry) => entry.date === today)
          : [];
    const fact: MirrorFact = {
      queues: new Set<string>(),
      slots: slots.length,
      todaySlots: slots.filter((slot) => slot.date === today).length,
      lastDate: null,
      todayCovered: new Set<string>(),
      todayOff: new Set<string>(),
    };
    for (const slot of slots) {
      fact.queues.add(normalizeQueue(slot.queue));
      if (!fact.lastDate || slot.date > fact.lastDate) fact.lastDate = slot.date;
    }

    // Очереди, у которых сегодня есть настоящие слоты. Покрытие по слотам — единственный
    // источник права считать область покрытой, когда оператор обещает отключения.
    const queuesWithSlotsToday = new Set<string>();
    for (const slot of slots) {
      if (slot.date === today) queuesWithSlotsToday.add(normalizeQueue(slot.queue));
    }

    for (const entry of coverageToday) {
      const queue = normalizeQueue(entry.queue);
      // Строка покрытия с `has_outages = 1`, за которой нет ни одного слота, — это фантом:
      // источник пообещал отключения и не отдал графика. Раньше она давала `covered: true`
      // при `todaySlots: 0`, и область светилась зелёным при полном отсутствии данных.
      // Публикация дня БЕЗ отключений (`has_outages = 0`) — законный allClear, его уважаем.
      const backedBySlots = queuesWithSlotsToday.has(queue);
      const publishedWithoutOutages = !entry.hasOutages;
      if (queue !== ALL_CLEAR_QUEUE && (backedBySlots || publishedWithoutOutages)) {
        fact.todayCovered.add(queue);
      }
      if (entry.hasOutages) fact.todayOff.add(queue);
    }
    // Дата публикации. Слоты её уже дали. Но когда оператор опубликовал график БЕЗ отключений,
    // слотов нет, а покрытие есть — и дата жила только в `schedule_coverage`. Раньше она
    // терялась, и покрытая область показывалась с пустой датой, что читалось как «не посчитали».
    //
    // Условие на `ownCoverageToday` было слишком узким: собственное покрытие есть не у всех
    // источников, и области, покрытые зеркалом, оставались с `lastDate: null` — то есть их
    // опубликованный allContinueDay выглядел как отсутствие данных. Врать нельзя только там,
    // где покрытия нет вовсе, а оно здесь уже проверено перебором `coverageToday`.
    if (!fact.lastDate && coverageToday.length > 0) fact.lastDate = today;

    facts.set(cpu, fact);
  }
  return facts;
}

/** Все ключи области, по которым можно что-то прочитать из зеркала. */
function mirrorRegionKeys(requestedRegion: string): string[] {
  return [...new Set(resolveDbRegions(requestedRegion))];
}

/**
 * Ключи чтения для маршрутов с одним графиком (`/schedules`, `/status`, `/sync`).
 *
 * У Днепра две сети (ЦЕК и ДнЕМ) с одинаковой нумерацией черг, но разными графиками. Смешать их
 * в один список — значит показать человеку чужие часы. Выбираем одну сеть по факту: где на нужную
 * дату есть эта очередь, затем где есть хоть какие-то слоты, затем где есть покрытие.
 */
function mirrorReadKeys(snapshot: MirrorSnapshot, requestedRegion: string, date: string, queue?: string): string[] {
  const dbRegions = mirrorRegionKeys(requestedRegion);
  const canonical = canonicalRegionCpu(requestedRegion);
  // Сеть названа явно — читаем только её, даже если у области есть вторая.
  if (requestedRegion && requestedRegion !== canonical && FEED_KEYS.has(requestedRegion)) {
    return [requestedRegion];
  }
  const feedKeys = dbRegions.filter((key) => snapshot.cpus.includes(key) || key in (snapshot.d1Slots ?? {}));
  if (feedKeys.length <= 1) return feedKeys.length > 0 ? feedKeys : dbRegions;

  const slots = feedKeys.map((key) => ({ key, slots: mirrorSlotsFor(snapshot, [key]) }));
  const coverage = feedKeys.map((key) => ({
    key,
    entries: mirrorCoverageFor(snapshot, [key]).filter((entry) => entry.date === date),
  }));

  if (queue) {
    const wanted = normalizeQueue(queue);
    const withQueue = slots.find((item) =>
      item.slots.some((slot) => slot.date === date && normalizeQueue(slot.queue) === wanted),
    );
    if (withQueue) return [withQueue.key];
    const coveredQueue = coverage.find((item) =>
      item.entries.some((entry) => normalizeQueue(entry.queue) === wanted || entry.queue === ALL_CLEAR_QUEUE),
    );
    if (coveredQueue) return [coveredQueue.key];
  }

  const withSlotsToday = slots.find((item) => item.slots.some((slot) => slot.date === date));
  if (withSlotsToday) return [withSlotsToday.key];
  const withCoverageToday = coverage.find((item) => item.entries.length > 0);
  if (withCoverageToday) return [withCoverageToday.key];
  return [feedKeys[0]!];
}

/**
 * Каталог областей из зеркала: тот же контракт, что `/regions`, но без единого запроса к D1.
 *
 * Имена берутся из каталога, затем из `name_ua` фида. Пустые области остаются в списке с нулями:
 * человек должен видеть свою область и честное «даних немає», а не отсутствующую строку.
 */
function mirrorRegionSummaries(snapshot: MirrorSnapshot, today: string): Array<Record<string, unknown>> {
  const facts = mirrorFacts(snapshot, today);
  const rows: Array<Record<string, unknown>> = [];
  const consumed = new Set<string>();

  for (const entry of REGION_CATALOG) {
    const expected = entry.feedKeys.length > 0 ? entry.feedKeys : [entry.cpu];
    for (const key of expected) consumed.add(key);
    const available = expected.map((key) => facts.get(key)).filter((fact): fact is MirrorFact => Boolean(fact));
    const queues = new Set<string>();
    let slots = 0;
    let todaySlots = 0;
    let lastDate: string | null = null;
    for (const fact of available) {
      for (const queue of fact.queues) queues.add(queue);
      slots += fact.slots;
      todaySlots += fact.todaySlots;
      if (fact.lastDate && (!lastDate || fact.lastDate > lastDate)) lastDate = fact.lastDate;
    }
    const covered =
      entry.feedKeys.length > 0
        ? entry.feedKeys.every((key) => (facts.get(key)?.todayCovered.size ?? 0) > 0)
        : false;
    const allClear = covered ? expected.every((key) => (facts.get(key)?.todayOff.size ?? 0) === 0) : undefined;

    rows.push({
      cpu: entry.cpu,
      nameUa: canonicalRegionName(entry.cpu, snapshot.names),
      nameEn: null,
      queues: [...queues].sort(compareQueueCodes),
      slots,
      todaySlots,
      lastDate,
      feedKeys: [...entry.feedKeys],
      isActive: true,
      covered,
      allClear,
    });

    if (entry.feedKeys.length > 1) {
      for (const key of entry.feedKeys) {
        const fact = facts.get(key);
        const networkCovered = (fact?.todayCovered.size ?? 0) > 0;
        rows.push({
          cpu: key,
          nameUa: REGION_NAMES[key] ?? snapshot.names[key] ?? key,
          nameEn: null,
          queues: [...(fact?.queues ?? [])].sort(compareQueueCodes),
          slots: fact?.slots ?? 0,
          todaySlots: fact?.todaySlots ?? 0,
          lastDate: fact?.lastDate ?? null,
          feedKeys: [key],
          parentCpu: entry.cpu,
          isActive: true,
          covered: networkCovered,
          allClear: networkCovered ? (fact?.todayOff.size ?? 0) === 0 : undefined,
        });
      }
    }
  }

  // Ключи фида вне каталога: отдаём как есть, с человеческой подписью из зеркала.
  for (const cpu of snapshot.cpus) {
    if (consumed.has(cpu)) continue;
    const fact = facts.get(cpu);
    const covered = (fact?.todayCovered.size ?? 0) > 0;
    rows.push({
      cpu,
      nameUa: REGION_NAMES[cpu] ?? snapshot.names[cpu] ?? cpu,
      nameEn: null,
      queues: [...(fact?.queues ?? [])].sort(compareQueueCodes),
      slots: fact?.slots ?? 0,
      todaySlots: fact?.todaySlots ?? 0,
      lastDate: fact?.lastDate ?? null,
      feedKeys: [cpu],
      isActive: true,
      covered,
      allClear: covered ? (fact?.todayOff.size ?? 0) === 0 : undefined,
    });
  }

  return rows.sort((a, b) => compareUk(String(a['nameUa']), String(b['nameUa'])));
}

/** Список групп области из зеркала в форме `QueueSummary`. */
function mirrorQueueList(
  snapshot: MirrorSnapshot,
  keys: string[],
  today: string,
): Array<Record<string, unknown>> {
  const facts = mirrorFacts(snapshot, today);
  const expected = keys.filter((key) => facts.has(key));
  if (expected.length === 0) return [];

  // Считаем слоты по каждой группе отдельно: брать «все слоты сети» и приписывать их каждой
  // группе нельзя — бейдж показывал бы одинаковое число у всех.
  const sums = new Map<string, { queue: string; slots: number; todaySlots: number; lastDate: string | null }>();
  for (const slot of mirrorSlotsFor(snapshot, expected)) {
    const queue = normalizeQueue(slot.queue);
    const current = sums.get(queue) ?? { queue, slots: 0, todaySlots: 0, lastDate: null };
    current.slots += 1;
    if (slot.date === today) current.todaySlots += 1;
    if (!current.lastDate || slot.date > current.lastDate) current.lastDate = slot.date;
    sums.set(queue, current);
  }
  // Группы из опубликованного дня без отключений: слотов нет, но график на сегодня есть.
  for (const key of expected) {
    const fact = facts.get(key)!;
    for (const queue of fact.todayCovered) {
      if (!sums.has(queue)) {
        sums.set(queue, { queue, slots: 0, todaySlots: 0, lastDate: fact.lastDate });
      }
    }
  }

  return [...sums.values()]
    .sort((a, b) => compareQueueCodes(a.queue, b.queue))
    .map((row) => {
      const covered = expected.every((key) => {
        const fact = facts.get(key)!;
        return fact.todayCovered.has(row.queue) && !fact.todayOff.has(row.queue);
      });
      return {
        queue: row.queue,
        // Контракт `QueueSummary.slots` — часы отключений на ближайшие даты, а не вся история.
        slots: row.todaySlots,
        lastDate: row.lastDate,
        streets: 0,
        settlements: [],
        streetNames: [],
        ...(covered ? { covered: true } : {}),
      };
    });
}

/** Покрытие одной даты из снимка зеркала. */
function mirrorCoverageOn(
  snapshot: MirrorSnapshot,
  keys: string[],
  date: string,
): { queues: Set<string>; offQueues: Set<string>; sources: Set<string> } {
  const coverage = { queues: new Set<string>(), offQueues: new Set<string>(), sources: new Set<string>() };
  for (const entry of mirrorCoverageFor(snapshot, keys)) {
    if (entry.date !== date) continue;
    const queue = normalizeQueue(entry.queue);
    coverage.queues.add(queue);
    if (entry.hasOutages) coverage.offQueues.add(queue);
    coverage.sources.add('mirror');
  }
  return coverage;
}

/** Интервалы группы за дату из снимка зеркала. */
function mirrorIntervalsFor(
  snapshot: MirrorSnapshot,
  keys: string[],
  queue: string | readonly string[],
  date: string,
): ReturnType<typeof toIntervals> {
  const aliases = new Set((Array.isArray(queue) ? queue : [queue]).map((code) => normalizeQueue(code)));
  const rows = mirrorSlotRows(mirrorSlotsFor(snapshot, keys)).filter(
    (row) => row.date === date && aliases.has(normalizeQueue(row.queue)),
  );
  return toIntervals(rows, queue, date);
}

/** Ответ `/schedules` без D1: интервалы, покрытие и честный пустой график, если данных нет. */
function mirrorScheduleResponse(
  snapshot: MirrorSnapshot,
  keys: string[],
  queue: string,
  date: string,
  aliases: readonly string[] = [normalizeQueue(queue)],
): Record<string, unknown> {
  const intervals = mirrorIntervalsFor(snapshot, keys, aliases, date);
  const coverage = mirrorCoverageOn(snapshot, keys, date);
  const queueCovered =
    aliases.some((code) => coverage.queues.has(normalizeQueue(code))) || coverage.queues.has(ALL_CLEAR_QUEUE);
  const covered = queueCovered || intervals.length > 0;
  const offByFeed = aliases.some((code) => coverage.offQueues.has(normalizeQueue(code)));
  return {
    queue: normalizeQueue(queue),
    date,
    intervals,
    source: covered ? 'mirror' : null,
    covered,
    allClear: covered && intervals.length === 0 && !offByFeed,
    lastImportedAt: snapshot.timestamp ?? new Date(snapshot.fetchedAt).toISOString(),
  };
}



/** Ответ `/schedules/upcoming` без D1: те же бакеты, что собирает D1-путь. */
function mirrorUpcomingBuckets(
  snapshot: MirrorSnapshot,
  keys: string[],
  today: string,
  days: number,
): Array<Record<string, unknown>> {
  const wanted = Array.from({ length: days }, (_, index) => addDays(today, index));
  const slots = mirrorSlotsFor(snapshot, keys);
  const buckets: Array<Record<string, unknown>> = [];
  const nowMs = Date.now();
  for (const date of wanted) {
    const byQueue = new Map<string, SlotRow[]>();
    for (const row of mirrorSlotRows(slots.filter((slot) => slot.date === date))) {
      const list = byQueue.get(row.queue);
      if (list) list.push(row);
      else byQueue.set(row.queue, [row]);
    }
    for (const [queue, rows] of byQueue) {
      const intervals = toIntervals(rows, queue, date);
      if (intervals.length === 0) continue;
      buckets.push({
        queue,
        date,
        source: 'mirror',
        intervals,
        isActiveNow: intervals.some(
          (interval) => Date.parse(interval.startsAt) <= nowMs && nowMs < Date.parse(interval.endsAt),
        ),
        nextStartsAt:
          intervals.find((interval) => Date.parse(interval.startsAt) > nowMs)?.startsAt ?? null,
        settlements: [],
        streetNames: [],
      });
    }
  }
  return buckets.sort((a, b) => {
    const byDate = String(a['date']).localeCompare(String(b['date']));
    return byDate !== 0 ? byDate : compareQueueCodes(String(a['queue']), String(b['queue']));
  });
}

/** Тело `StatusResponse` без D1: все производные числа считаются по слотам зеркала. */
function mirrorStatusPayload(
  snapshot: MirrorSnapshot,
  keys: string[],
  today: string,
): Record<string, unknown> {
  const nowMs = Date.now();
  const allSlots = mirrorSlotRows(mirrorSlotsFor(snapshot, keys));
  const todaySlots = allSlots.filter((slot) => slot.date === today);
  const yesterdaySlots = allSlots.filter((slot) => slot.date === addDays(today, -1));
  const todayStats = daySlotStats(todaySlots, nowMs);
  const yesterdayStats = daySlotStats(yesterdaySlots, nowMs);
  const lastUpdatedAt = snapshot.timestamp ?? new Date(snapshot.fetchedAt).toISOString();
  const updatedMs = Date.parse(lastUpdatedAt);
  // Устаревание считаем по времени снимка, а не по факту ответа: зеркало отдаёт данные, даже
  // когда D1 недоступен, и подставлять сюда `dataStale: false` значило бы выдавать вчерашний
  // график за живой. Порог тот же, что в D1-ветке `/status`, — два часа.
  const dataStale = Number.isFinite(updatedMs) && nowMs - updatedMs > 2 * 60 * 60 * 1000;
  const buildWindow = (label: string, outageMinutes: number) => {
    const minutes = Math.min(24 * 60, Math.max(0, outageMinutes));
    return {
      windowLabel: label,
      windowMinutes: 24 * 60,
      outageMinutes: minutes,
      poweredMinutes: 24 * 60 - minutes,
      reliabilityPct: Math.round(((24 * 60 - minutes) / (24 * 60)) * 1000) / 10,
      outageCount: todayStats.activeGroups + todayStats.scheduledGroups,
      hasData: todayStats.activeGroups + todayStats.scheduledGroups > 0,
    };
  };
  return {
    grid: {
      level: todayStats.activeGroups > 0 ? 'warning' : 'stable',
      message:
        todayStats.activeGroups > 0
          ? 'За графіком ГПВ частину груп зараз знеструмлено'
          : '',
    },
    activeOutages: 0,
    scheduledOutages: todayStats.scheduledGroups,
    activeGroups: todayStats.activeGroups,
    scheduledGroups: todayStats.scheduledGroups,
    activeIncidents: 0,
    scheduledIncidents: 0,
    totalIncidents: 0,
    lastUpdatedAt,
    dataStale,
    lastError: null,
    pausedUntil: null,
    nextAttemptAt: nextCronAttempt(lastUpdatedAt, updatedMs),
    consecutiveParseFailures: 0,
    powerSummary: {
      today: buildWindow('за добу', todayStats.outageMinutes),
      last24h: buildWindow('за 24 години', yesterdayStats.outageMinutes),
    },
    totalQueues: new Set(todaySlots.map((row) => row.queue)).size,
    generatedAt: new Date(nowMs).toISOString(),
  };
}


/**
 * Ближайший тик планировщика после последнего обновления.
 *
 * Крон воркера работает каждые 20 минут (cron-маска с шагом 20), но `/status` отдавал
 * `nextAttemptAt: null`.
 * Фронт читал это как «автооновлення вимкнено» — прямо вопреки заголовку «Дані оновлюються
 * за розкладом». Данные приходили каждые 20 минут, планировщик был жив, а сообщение врало.
 * Считаем следующую границу сетки крона от последнего фактического обновления.
 */
function nextCronAttempt(lastUpdatedAt: string | null, nowMs: number, stepMinutes = 20): string | null {
  if (!lastUpdatedAt) return null;
  const parsed = Date.parse(lastUpdatedAt);
  if (!Number.isFinite(parsed)) return null;
  const stepMs = stepMinutes * 60_000;
  // Следующая граница сетки строго ПОСЛЕ последнего обновления: если апдейт случился ровно
  // в 03:20, следующий тик — 03:40, а не 03:20 (иначе счётчик показывал бы «0 минут назад»).
  const next = Math.floor((parsed - 0) / stepMs) * stepMs + stepMs;
  return new Date(next > nowMs ? next : next + stepMs).toISOString();
}

/**
 * Аварийный ответ из зеркала для маршрутов, которые упали на D1.
 *
 * Возвращает `null`, если маршрут не поддержан (тогда вызывающий отдаёт обычную ошибку).
 * Ни один путь ниже не обращается к D1: только снимок в памяти и чистые функции разбора.
 */
async function mirrorFallbackResponse(path: string, url: URL, env: Env): Promise<Response | null> {
  const supported = new Set([
    '/regions',
    '/queues',
    '/schedules',
    '/schedules/upcoming',
    '/status',
    '/sync',
  ]);
  if (!supported.has(path)) return null;

  const snapshot = await fetchMirror(env);
  if (!snapshot.ok || !snapshot.payload) {
    return json(
      {
        error: {
          code: 'MIRROR_UNAVAILABLE',
          message: `D1 недоступний, а зеркало не відповіло: ${snapshot.error ?? 'unknown'}`,
        },
      },
      503,
      { 'cache-control': 'no-store' },
    );
  }

  const requestedRegion = (url.searchParams.get('region') ?? '').trim();
  const canonicalRegion = canonicalRegionCpu(requestedRegion);
  const keys = mirrorRegionKeys(requestedRegion);
  const readKeys = keys.length > 0 ? keys : [...snapshot.cpus];
  const today = kyivToday();
  const headers = { 'cache-control': 'public, max-age=120' };

  if (path === '/regions') {
    return json({ data: mirrorRegionSummaries(snapshot, today) }, 200, headers);
  }

  if (path === '/queues') {
    const feedKeys = regionFeedKeysOf(canonicalRegion);
    const queueKeys = feedKeys.length > 0 ? feedKeys : readKeys;
    return json({ data: mirrorQueueList(snapshot, queueKeys, today) }, 200, headers);
  }

  if (path === '/schedules') {
    const queue = normalizeQueue(url.searchParams.get('queue') ?? '');
    const date = url.searchParams.get('date') ?? today;
    if (!queue) return json({ error: { code: 'VALIDATION_ERROR', message: 'queue обовʼязковий' } }, 400);
    const scheduleKeys = mirrorReadKeys(snapshot, requestedRegion, date, queue);
    const aliases = queueReadAliases(requestedRegion, queue);
    return json({ data: mirrorScheduleResponse(snapshot, scheduleKeys, queue, date, aliases) }, 200, headers);
  }

  if (path === '/schedules/upcoming') {
    const days = Math.min(7, Math.max(1, Number(url.searchParams.get('days') ?? 2) || 2));
    const upcomingKeys = mirrorReadKeys(snapshot, requestedRegion, today);
    return json({ data: mirrorUpcomingBuckets(snapshot, upcomingKeys, today, days) }, 200, headers);
  }

  if (path === '/status') {
    const statusKeys = mirrorReadKeys(snapshot, requestedRegion, today);
    return json(
      {
        data: {
          region: canonicalRegion || requestedRegion || null,
          ...mirrorStatusPayload(snapshot, statusKeys, today),
          d1QuotaExceeded: d1QuotaExceededAt !== null,
          d1UnavailableAt,
        },
      },
      200,
      headers,
    );
  }

  // `/sync`: один пакет из тех же снимков. Новости и справочник адресов в зеркале отсутствуют,
  // поэтому отдаём честные пустые массивы — фронтенд покажет EmptyState, а график уже будет.
  const days = Math.min(7, Math.max(1, Number(url.searchParams.get('days') ?? 2) || 2));
  const syncKeys = mirrorReadKeys(snapshot, requestedRegion, today);
  const status = {
    region: syncKeys[0] ?? canonicalRegion ?? requestedRegion ?? null,
    ...mirrorStatusPayload(snapshot, syncKeys, today),
    d1QuotaExceeded: d1QuotaExceededAt !== null,
    d1UnavailableAt,
  };
  const regions = mirrorRegionSummaries(snapshot, today);
  const buckets = mirrorUpcomingBuckets(snapshot, syncKeys, today, days);
  const feedKeys = regionFeedKeysOf(canonicalRegion);
  const queues = mirrorQueueList(snapshot, feedKeys.length > 0 ? feedKeys : readKeys, today);
  const schedulesByRegion: Record<string, { days: string[]; buckets: Array<Record<string, unknown>> }> = {};
  if (requestedRegion) {
    const wantedDays = Array.from({ length: days }, (_, index) => addDays(today, index));
    for (const key of new Set<string>([requestedRegion, canonicalRegion, ...syncKeys])) {
      if (key) schedulesByRegion[key] = { days: wantedDays, buckets };
    }
  }
  const body: Record<string, unknown> = {
    region: (syncKeys[0] ?? requestedRegion) || null,
    status,
    regions,
    queues,
    schedulesByRegion,
    settlements: [],
    settlementsTotal: 0,
    news: [],
    contacts: [],
  };
  const etag = computeSyncEtag(etagSource(body));
  return json(
    { data: { syncedAt: new Date().toISOString(), etag, ...body } },
    200,
    { ...headers, etag },
  );
}


/**
 * Каталог областей: `cpu`, имя, группы, последняя дата, покрытие на сегодня.
 *
 * Дублируется с кэшем изолята (`regionSummaries`): функция читает ВСЕ слоты и ВСЁ покрытие
 * таблицы группами, и `/regions` с `/sync` звали её на каждый запрос.
 */
async function regionSummariesUncached(env: Env): Promise<Array<Record<string, unknown>>> {
  const today = kyivToday();
  const [result, mirrorNames, coverageRows, todayRows] = await Promise.all([
    // Слоты + коды групп из покрытия одним запросом: у области, где оператор опубликовал день без
    // отключений, `schedule_slots` пуст по определению (мы храним только «тёмные» часы), и список
    // групп выходил пустым — человек не видел ни одной кнопки группы. Отдельным запросом это стоило
    // бы лишнего раунда к D1, а CPU-бюджет воркера — 10 мс на запрос. `*` — служебный код «день
    // опубликован целиком», а не группа, поэтому исключаем его здесь же.
    env.DB.prepare(
      `SELECT region AS cpu, source, queue, COUNT(*) AS slots, MAX(date) AS lastDate
       FROM schedule_slots WHERE date >= ? AND date <= ?
       GROUP BY region, source, queue
       UNION ALL
       SELECT region AS cpu, source, queue, 0 AS slots, NULL AS lastDate
       FROM schedule_coverage WHERE date = ? AND queue <> ?
       GROUP BY region, source, queue`,
    )
      .bind(today, addDays(today, 1), today, ALL_CLEAR_QUEUE)
      .all<{ cpu: string; source: string; queue: string; slots: number; lastDate: string | null }>(),
    loadMirrorRegionNames(env),
    // Покрытие за сегодня: «график опубликован, отключений в нём нет» — это не «нет данных».
    // Раньше область с опубликованным ГПВ без отключений выглядела ровно как неотданная зеркалом.
    env.DB.prepare(`SELECT region, source, queue, has_outages FROM schedule_coverage WHERE date = ?`)
      .bind(today)
      .all<{ region: string; source: string; queue: string; has_outages: number }>(),
    // Слоты ТОЛЬКО на сегодня и завтра. Без этого бейдж области показывал «6 сл.», хотя эти
    // полчаса лежали в БД с 1 июля: человек читал «N сл.» как «график на сегодня загружен» и не
    // понимал, почему на экране пусто. Считаем отдельным групповым запросом (одно чтение D1).
    env.DB.prepare(
      `SELECT region AS cpu, source, COUNT(*) AS n FROM schedule_slots
       WHERE date >= ? AND date <= ? GROUP BY region, source`,
    )
      .bind(today, addDays(today, 1))
      .all<{ cpu: string; source: string; n: number }>(),
  ]);

  const todaySlotsByRegion = new Map<string, number>();
  for (const row of todayRows.results ?? []) {
    todaySlotsByRegion.set(`${row.cpu}\u0000${row.source}`, row.n ?? 0);
  }

  type RegionFacts = { queues: Set<string>; slots: number; lastDate: string | null };
  const byRegion = new Map<string, RegionFacts>();
  const sourceKey = (cpu: string, source: string) => `${cpu}\u0000${source}`;
  for (const row of result.results ?? []) {
    const queue = normalizeQueue(row.queue);
    // Мусорные коды в список кнопок не пускаем: там попадаются «черга» из чужих источников.
    if (!isQueueCode(queue)) continue;
    const key = sourceKey(row.cpu, row.source);
    const entry = byRegion.get(key) ?? { queues: new Set<string>(), slots: 0, lastDate: null };
    entry.queues.add(queue);
    entry.slots += row.slots ?? 0;
    if (row.lastDate && (!entry.lastDate || row.lastDate > entry.lastDate)) entry.lastDate = row.lastDate;
    byRegion.set(key, entry);
  }

  const coverageByRegion = new Map<string, { covered: Set<string>; off: Set<string> }>();
  for (const row of coverageRows.results ?? []) {
    const key = sourceKey(row.region, row.source);
    const entry = coverageByRegion.get(key) ?? { covered: new Set<string>(), off: new Set<string>() };
    const queue = normalizeQueue(row.queue);
    // Если у области сегодня НОЛЬ слотов, то ни одной очереди с отключениями там быть не может:
    // источник не отдал графика. Строка покрытия, которая при этом обещает отключения, — фантом
    // (так проявлялись ЦЕК, ДнЕМ, Днепропетровщина и Ивано-Франковщина: `covered: true` при
    // `todaySlots: 0`, то есть область светилась зелёным, не имея ни одной цифры графика).
    // Публикацию дня БЕЗ отключений (`has_outages = 0`) уважаем — это честный allClear.
    const backedBySlots = (todaySlotsByRegion.get(key) ?? 0) > 0;
    if (backedBySlots || !row.has_outages) entry.covered.add(queue);
    if (row.has_outages) entry.off.add(queue);
    coverageByRegion.set(key, entry);
  }

  // Источники нельзя смешивать: у зеркала для Києва лежат исторические 60 групп `35/1`, а живой
  // график города — шесть групп `1…6`. Слияние давало 66 кнопок, среди которых человек выбирал
  // группу, которой у оператора нет. Для набора ключей одной области берём ОДИН источник: свежий
  // `energy-ua`, если он опубликовал сегодняшний день, иначе зеркало.
  const hasFacts = (cpu: string, source: string) =>
    (byRegion.get(sourceKey(cpu, source))?.queues.size ?? 0) > 0 ||
    (coverageByRegion.get(sourceKey(cpu, source))?.covered.size ?? 0) > 0;
  // Слоты — сильнее покрытия: у живого `energy-ua` бывает строка `schedule_coverage`, но
  // импорт слотов отстал, и тогда источник с реальными часами (зеркало) должен победить.
  const hasSlotFacts = (cpu: string, source: string) =>
    (byRegion.get(sourceKey(cpu, source))?.queues.size ?? 0) > 0 ||
    (todaySlotsByRegion.get(sourceKey(cpu, source)) ?? 0) > 0;
  const preferredSourceFor = (cpus: string[]): string | null => {
    if (cpus.some((cpu) => hasSlotFacts(cpu, 'energy-ua'))) return 'energy-ua';
    if (cpus.some((cpu) => hasSlotFacts(cpu, 'mirror'))) return 'mirror';
    if (cpus.some((cpu) => hasFacts(cpu, 'energy-ua'))) return 'energy-ua';
    if (cpus.some((cpu) => hasFacts(cpu, 'mirror'))) return 'mirror';
    // Незнакомый источник (старые импорты) не выбрасываем: показываем как есть.
    const other = [...byRegion.keys(), ...coverageByRegion.keys()]
      .map((key) => key.split('\u0000'))
      .find(([cpu]) => Boolean(cpu) && cpus.includes(cpu as string));
    return other?.[1] ?? null;
  };

  // Строки каталога. Каноническая область — одна строка (её `cpu` человек и видит), а данные для
  // неё берутся из ключей фида: у Киевской области это `kiivska-oblast`, у Киева — `kyiv`.
  const consumed = new Set<string>();
  const rows: Array<Record<string, unknown>> = [];

  /** Факты по ключу фида и выбранному источнику. Пустая запись законна — область не импортирована. */
  const factsOf = (cpu: string, source: string | null): RegionFacts =>
    (source ? byRegion.get(sourceKey(cpu, source)) : undefined) ??
    { queues: new Set<string>(), slots: 0, lastDate: null };

  for (const entry of REGION_CATALOG) {
    // Ключ каталога может быть ещё и ключом фида (зеркало когда-то отдавало `dnipropetrovska-oblast`
    // отдельно от ЦЕК/ДнЕМ): данные под ним не выбрасываем, а складываем в ту же строку.
    const ownKey = entry.cpu;
    const ownData = !entry.feedKeys.includes(ownKey) &&
      [...byRegion.keys(), ...coverageByRegion.keys()].some((key) => key.startsWith(`${ownKey}\u0000`))
      ? [ownKey]
      : [];
    const dataKeys = [...entry.feedKeys, ...ownData];
    const source = preferredSourceFor(dataKeys);
    const facts = dataKeys.map((key) => factsOf(key, source));
    // Ключи-синонимы (у Києва `kyiv` — зеркало, `kyiv-city` — живой источник) не должны мешать
    // покрытию: молчит только та сеть, у которой в выбранном источнике вообще есть данные.
    const activeKeys = dataKeys.filter((key) => hasFacts(key, source ?? ''));
    const coverages = activeKeys.map((key) => coverageByRegion.get(sourceKey(key, source ?? '')));
    for (const key of dataKeys) consumed.add(key);
    // Канонический `cpu` тоже считаем «разобранным»: иначе он вернулся бы второй строкой из списка
    // встроенных имён (`REGION_NAMES`) — дубль «Одеської області» рядом с самой собой.
    consumed.add(ownKey);

    const queues = new Set<string>();
    let slots = 0;
    let todaySlots = 0;
    let lastDate: string | null = null;
    for (const fact of facts) {
      for (const queue of fact.queues) queues.add(queue);
      slots += fact.slots;
      if (fact.lastDate && (!lastDate || fact.lastDate > lastDate)) lastDate = fact.lastDate;
    }
    for (const key of dataKeys) {
      todaySlots += source ? todaySlotsByRegion.get(sourceKey(key, source)) ?? 0 : 0;
    }
    const coveredNetworks = coverages.filter((coverage) => (coverage?.covered.size ?? 0) > 0).length;
    // Область считаем покрытой, только когда день опубликовали ВСЕ её источники (у области с одной
    // сетью — она сама): молчащая сеть — это «не знаем», а не «график есть».
    const covered = activeKeys.length > 0 && coveredNetworks === activeKeys.length;

    // Дата публикации для опубликованного дня БЕЗ отключений. Слотов у такого дня нет по
    // определению (мы храним только тёмные часы), поэтому `MAX(date)` по слотам даёт null, и
    // область отвечала `covered: true` при `lastDate: null`. Фронт читает `lastDate` как «график
    // есть» и показывал «не посчитали» — то есть честный allClear выглядел как отсутствие
    // данных. Здесь `covered` уже доказан покрытием, значит день действительно опубликован.
    const effectiveLastDate = covered && lastDate === null ? today : lastDate;
    rows.push({
      cpu: entry.cpu,
      nameUa: canonicalRegionName(entry.cpu, mirrorNames),
      nameEn: null,
      queues: [...queues].sort(compareQueueCodes),
      slots,
      // Часы отключений на сегодня/завтра: по этому полю бейдж области показывает «N сл.», а не
      // «сколько слотов когда-либо лежало в БД». Может быть 0 при `covered`: график вышел без
      // отключений — это «світло за графіком», а не «немає даних».
      todaySlots,
      // null, пока область не импортирована. Подставлять сегодняшнюю дату можно только там, где
      // покрытие доказано строкой `schedule_coverage`: у области, которую никто не импортировал,
      // даты по-прежнему нет, и фронт честно скажет «не знаем».
      lastDate: effectiveLastDate,
      feedKeys: [...entry.feedKeys],
      isActive: true,
      // `covered` — график на сегодня опубликован хотя бы по одной очереди;
      // `allClear` — опубликован, но часов отключений в нём нет (человеку это «світло за графіком»).
      // Поля нет вовсе, когда покрытия нет: «не знаем» и «отключений нет» должны различаться.
      covered,
      allClear: covered ? coverages.every((coverage) => (coverage?.off.size ?? 0) === 0) : undefined,
    });

    // Подобласти — только для областей с несколькими сетями: у 1:1 подстановка прозрачна, и
    // отдельная строка была бы дублем той же области. У ЦЕК и ДнЕМ общая нумерация черг, но
    // разные графики, поэтому человек выбирает сеть, а не «область целиком».
    if (entry.feedKeys.length > 1) {
      for (const key of entry.feedKeys) {
        const keySource = preferredSourceFor([key]);
        const fact = factsOf(key, keySource);
        const coverage = keySource ? coverageByRegion.get(sourceKey(key, keySource)) : undefined;
        const coveredNetwork = (coverage?.covered.size ?? 0) > 0;
        rows.push({
          cpu: key,
          nameUa: REGION_NAMES[key] ?? mirrorNames[key] ?? key,
          nameEn: null,
          queues: [...fact.queues].sort(compareQueueCodes),
          slots: fact.slots,
          todaySlots: keySource ? todaySlotsByRegion.get(sourceKey(key, keySource)) ?? 0 : 0,
          // Тот же случай, что и у канонической области: у опубликованного дня без отключений
          // слотов нет, а покрытие есть. Без даты такой allClear читался как «данных нет».
          lastDate: coveredNetwork && fact.lastDate === null ? today : fact.lastDate,
          feedKeys: [key],
          parentCpu: entry.cpu,
          isActive: true,
          covered: coveredNetwork,
          allClear: coveredNetwork ? (coverage?.off.size ?? 0) === 0 : undefined,
        });
      }
    }
  }

  // Ключи фида вне каталога (легасі-области, «мережі» Чернігівщини, имена из зеркала): отдаём как
  // есть с человеческой подписью — придумывать им область-родителя нельзя.
  const feedCpus = new Set<string>();
  for (const key of [...byRegion.keys(), ...coverageByRegion.keys()]) {
    const [cpu] = key.split('\u0000');
    if (cpu) feedCpus.add(cpu);
  }
  for (const cpu of new Set([...Object.keys(REGION_NAMES), ...Object.keys(mirrorNames), ...feedCpus])) {
    if (consumed.has(cpu)) continue;
    const cpuSource = preferredSourceFor([cpu]);
    const fact = factsOf(cpu, cpuSource);
    const coverage = cpuSource ? coverageByRegion.get(sourceKey(cpu, cpuSource)) : undefined;
    const coveredToday = (coverage?.covered.size ?? 0) > 0;
    rows.push({
      cpu,
      nameUa: REGION_NAMES[cpu] ?? mirrorNames[cpu] ?? cpu,
      nameEn: null,
      queues: [...fact.queues].sort(compareQueueCodes),
      slots: fact.slots,
      todaySlots: cpuSource ? todaySlotsByRegion.get(sourceKey(cpu, cpuSource)) ?? 0 : 0,
      // Как и в каталоге: покрытие без слотов = опубликованный день без отключений, и его дата
      // равна сегодняшней. `null` здесь читался фронтом как «графика нет».
      lastDate: coveredToday && fact.lastDate === null ? today : fact.lastDate,
      feedKeys: [cpu],
      isActive: cpu in REGION_NAMES || cpu in mirrorNames,
      covered: coveredToday,
      allClear: coveredToday ? (coverage?.off.size ?? 0) === 0 : undefined,
    });
  }

  // Порядок — как у Node-бэкенда: по украинскому названию, но подобласть сразу за родителем,
  // иначе «м. Дніпро (ЦЕК)» отрывается от «Дніпропетровської області».
  //
  // Ключ сортировки считаем ОДИН раз на строку: раньше `sortKeyOf` вызывался дважды на каждое
  // сравнение и лепил новую строку, а `.localeCompare(…, 'uk')` на каждое сравнение создавал
  // коллатор — на каталоге страны это миллисекунды CPU в каждом `/sync`.
  const nameByCpu = new Map(rows.map((row) => [String(row['cpu']), String(row['nameUa'])]));
  const decorated = rows.map((row) => {
    const parent = nameByCpu.get(String(row['parentCpu'] ?? ''));
    return { row, key: parent ? `${parent} ${String(row['nameUa'])}` : String(row['nameUa']) };
  });
  return decorated
    .sort((a, b) => compareUk(a.key, b.key) || compareUk(String(a.row['cpu']), String(b.row['cpu'])))
    .map((item) => item.row);
}

/** Каталог областей с кэшем изолята: он меняется от крона к крону, а не от запроса к запросу. */
async function regionSummaries(env: Env): Promise<Array<Record<string, unknown>>> {
  const rows = await cached('regions:all', () => regionSummariesUncached(env));
  // Точечно, а не «весь каталог или ничего»: у одних областей сегодняшние слоты в D1 есть,
  // у других импорт не прошёл. Сверяем каждую строку с зеркалом и подменяем только те,
  // где D1 молчит, а зеркало отдаёт реальные часы.
  const snapshot = await fetchMirror(env);
  if (!snapshot.ok || !snapshot.payload) return rows;
  const mirror = new Map(
    mirrorRegionSummaries(snapshot, kyivToday()).map((row) => [String(row.cpu), row]),
  );
  return rows.map((row) => {
    const live = mirror.get(String(row.cpu));
    if (!live) return row;
    const d1Slots = Number(row.todaySlots ?? 0);
    const mirrorSlots = Number(live.todaySlots ?? 0);
    if (d1Slots === 0 && mirrorSlots > 0) return live;
    if (row.covered !== true && live.covered === true) return live;
    return row;
  });
}

async function lastImportedAt(env: Env): Promise<string | null> {
  const row = await env.DB.prepare(`SELECT updated_at FROM snapshot_meta WHERE key = 'schedule'`).first<{
    updated_at: string;
  }>();
  return row?.updated_at ?? null;
}

/**
 * Схема гарантируется один раз на изолят.
 *
 * Проверка «`schedule_slots` не пуст → схема есть» оказалась ложной: таблица `schedule_coverage`
 * появилась в v2.9.0, а `ensureSchema` вызывался только при ПУСТОЙ базе. На живой D1 таблицы не было
 * вовсе, и `/regions`, `/queues`, `/schedules` падали с `D1_ERROR: no such table: schedule_coverage`.
 * Поэтому схему накатываем до чтения данных, а флаг в памяти изолята убирает лишние обращения к D1
 * (все запросы идемпотентны `IF NOT EXISTS`, так что повтор после перезапуска изолята безопасен).
 */
let schemaReady = false;

/**
 * Флаг «данные в базе уже есть». `ensureSchedule` зовётся на КАЖДЫЙ запрос, и каждый раз считал
 * строки в `schedule_slots`, хотя после первого успешного импорта делать это незачем: данные
 * переписывает крон, а не читатель. Флаг живёт в изоляте и сбрасывается вместе с ним; если базу
 * действительно очистят, крон (раз в 20 минут) вернёт график, и следующий холодный изолят
 * импортирует его сразу.
 */
let scheduleSeeded = false;

async function ensureSchemaOnce(env: Env): Promise<void> {
  if (schemaReady) return;
  await ensureSchema(env);
  schemaReady = true;
}

/**
 * Единственная точка, где воркер прикасается к данным по запросу.
 *
 * Если D1 ещё пуст (первый запуск до первого крона), график подтягивается с зеркала прямо
 * сейчас и тут же сохраняется — чтобы приложение не было пустым первые 20 минут после деплоя.
 */
async function ensureSchedule(env: Env): Promise<void> {
  // Сначала схема, потом данные: см. `ensureSchemaOnce` — иначе новая таблица не появится на уже
  // наполненной базе, и чтение падает вместо того, чтобы отдать пустой график.
  await ensureSchemaOnce(env);

  // Чистка протухшего — до раннего выхода. Раньше она стояла только внутри ветки «данных ещё
  // нет», поэтому протухшие слоты от июля месяца висели месяцами: крон запускал чистку, но
  // первый же запрос к /regions успевал отдать старьё, и человек видел «график есть».
  // Один DELETE с индексом по дате стоит копейки, а данные перестают вводить в заблуждение.
  await maybePruneHistory(env);

  // Проверка «данные уже есть» нужна только один раз на изолят: она открывает отдельный запрос к
  // D1 на каждом вызове, а `/sync` и `/status` зовут эту функцию всегда.
  if (scheduleSeeded) return;
  const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM schedule_slots`).first<{ n: number }>();
  if ((count?.n ?? 0) > 0) {
    scheduleSeeded = true;
    return;
  }
  const mirrorSync = await syncMirrorSchedule(env);
  console.log(
    `ensureSchedule: зеркало дало ${mirrorSync.slotsParsed} слотов и ${mirrorSync.coverageParsed} строк покрытия по ${mirrorSync.regionsImported} областям` +
      (mirrorSync.ok ? '' : ` (недоступно: ${mirrorSync.error ?? 'unknown'})`),
  );

  // Пустая база — единственный момент, когда импорт из Telegram по запросу человека допустим:
  // вызов ограничен одним разом, дальше данные приносит крон. Без него области, которых зеркало
  // не отдаёт, оставались бы «без данных» первые 20 минут после деплоя.
  try {
    const today = kyivToday();
    await importTelegramSchedules(env, [today, addDays(today, 1)]);
  } catch (error) {
    console.log(`ensureSchedule: Telegram недоступен (${String(error)})`);
  }

  const written = await env.DB.prepare(`SELECT COUNT(*) AS n FROM schedule_slots`).first<{ n: number }>();
  // Если данные всё-таки появились, второй раз считать строки незачем — до перезапуска изолята.
  if ((written?.n ?? 0) > 0) scheduleSeeded = true;
  console.log(`ensureSchedule: в D1 теперь ${written?.n ?? 0} слотов`);
}

/** Обрабатывает один GET-запрос `/api/v1/*`. */





/**
 * Карта домов улицы из компактного JSON ОСР: `{"1":"2/1","61-71":"5/1"}`.
 *
 * Пустая/битая строка — не ошибка: улица может быть без домов, и тогда очередь берётся
 * с уровня улицы или населённого пункта. Значения нормализуем здесь же, чтобы сравнение
 * с вводом человека шло каноническими кодами.
 */
function parseStringArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string').map((item) => normalizeQueue(item))
      : [];
  } catch {
    return [];
  }
}

function housesFromJson(raw: string | null | undefined): Array<{ housePattern: string; queue: string }> {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return [];
    return Object.entries(parsed as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim() !== '')
      .map(([pattern, queue]) => ({ housePattern: pattern, queue: normalizeQueue(queue) }))
      .filter((entry) => isQueueCode(entry.queue));
  } catch {
    return [];
  }
}

/** Список групп населённого пункта из `queues_json`; битый JSON — пустой список, а не 500. */
function queuesFromJson(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed
      .filter((value): value is string => typeof value === 'string')
      .map((value) => normalizeQueue(value))
      .filter((value) => isQueueCode(value)))];
  } catch {
    return [];
  }
}

interface DirectoryStreetRow {
  name: string;
  default_queue: string | null;
  houses_json: string | null;
  source: string | null;
}

/**
 * Улица из нового компактного справочника ОСР (одна строка на улицу с картой домов).
 *
 * Читаем отдельным запросом без JOIN: D1 на бесплатном тарифе считает прочитанные строки,
 * а улица и её дома нужны только когда человек уже выбрал улицу.
 */
async function loadDirectoryStreet(
  env: Env,
  filter: { clause: string; bindings: string[] },
  settlementNormalized: string,
  streetNormalized: string,
): Promise<DirectoryStreetRow | null> {
  if (!streetNormalized) return null;
  return env.DB.prepare(
    `SELECT name, default_queue, houses_json, source FROM directory_streets
     WHERE ${filter.clause} AND settlement_normalized = ? AND normalized = ?
     LIMIT 1`,
  )
    .bind(...filter.bindings, settlementNormalized, streetNormalized)
    .first<DirectoryStreetRow>();
}

/**
 * Ищет очередь по адресу: сначала конкретный дом, затем вся улица, затем всё село.
 *
 * Порядок именно от точного к общему: чем уже совпадение, тем надёжнее номер группы. Если на
 * улице несколько групп, а дом не указан, номер НЕ угадывается — возвращаются варианты
 * диапазонов, чтобы человек выбрал нужный сам.
 */
async function resolveAddress(
  env: Env,
  input: { regions: string[]; settlement: string; street: string; house: string },
): Promise<{
  queue: string | null;
  reason: 'exact-house' | 'whole-street' | 'whole-settlement' | 'not-found';
  source: string | null;
  options: Array<{ housePattern: string; queue: string }>;
}> {
  const settlementNormalized = normalizeAddress(input.settlement);
  const filter = regionIn(input.regions);
  // Без области искать негде: привязки размечены по областям, и запрос «по всей стране» вернул бы
  // чужой адрес. Раньше сюда подставлялся пустой `region = ''` — тот же «не найдено», но с запросом.
  if (filter.clause === '') return { queue: null, reason: 'not-found', source: null, options: [] };
  const streetNormalized = normalizeAddress(input.street);

  // Компактный справочник ОСР: одна строка на улицу и карта домов внутри неё. Читаем до
  // `address_queues`, потому что это самая свежая выгрузка оператора и она точнее ручных привязок.
  const directoryStreet = await loadDirectoryStreet(env, filter, settlementNormalized, streetNormalized);
  const streetHouses = housesFromJson(directoryStreet?.houses_json);

  // Уровень 1: конкретный дом на конкретной улице.
  //
  // Раньше здесь был запасной SELECT из `directory_houses`. Таблица намеренно оставлена пустой
  // (все дома переехали в компактный `directory_streets.houses_json`), и запрос к пустой таблице
  // на каждом промахе по номеру только тратил rows_read на Free Tier. Источник истины теперь
  // один — `houses_json` улицы, читается ниже через `loadDirectoryStreet`.
  if (streetNormalized && input.house) {
    // Дом из `houses_json`: номер ищем по шаблону, поэтому «12» находится и в диапазоне «1-19».
    // Диапазоны схлопнуты синхронизатором, и разворачивать их в отдельные строки не нужно.
    const exactStreetHouse = streetHouses.find((entry) => matchHouseNumber(input.house, entry.housePattern));
    if (exactStreetHouse) {
      return {
        queue: exactStreetHouse.queue,
        reason: 'exact-house',
        source: directoryStreet?.source ?? 'energy-ua',
        options: [],
      };
    }
  }

  const rows = await env.DB.prepare(
    `SELECT region, settlement_name, settlement_normalized, street_name, street_normalized,
            house_pattern, queue, source, updated_at
     FROM address_queues WHERE ${filter.clause} AND settlement_normalized = ?
     LIMIT 2000`,
  ).bind(...filter.bindings, settlementNormalized).all<AddressQueueRow>();
  const entries = rows.results ?? [];

  // `mirror` — это «в населённом пункте есть такие-то группы», а не «вся улица/село относится
  // к одной группе». Синхронизатор справочника когда-то схлопывал такие строки в одну и подставлял
  // первую группу; для Киева это давало ложное «1/1 на весь город». Такие подсказки не используем:
  // номер группы нельзя угадывать, его подтверждают только адресные привязки.
  const wholeSettlement = entries.filter((row) => !row.street_normalized && row.source !== 'mirror');

  // Старые точечные привязки дома проверяем после нового справочника: если дом есть в обеих
  // выгрузках, свежая карта ОСР уже ответила выше, а здесь остаются только дома, которых в ней нет.
  const streetEntries = streetNormalized
    ? entries.filter((row) => row.street_normalized === streetNormalized)
    : [];
  if (streetNormalized && input.house) {
    const exact = streetEntries.find((row) => matchHouseNumber(input.house, row.house_pattern));
    if (exact) {
      return { queue: normalizeQueue(exact.queue), reason: 'exact-house', source: exact.source, options: [] };
    }
  }

  // Уровень 2: вся улица одним номером группы.
  if (directoryStreet?.default_queue && isQueueCode(normalizeQueue(directoryStreet.default_queue))) {
    return {
      queue: normalizeQueue(directoryStreet.default_queue),
      reason: 'whole-street',
      source: directoryStreet.source ?? 'energy-ua',
      options: [],
    };
  }
  if (streetHouses.length > 0) {
    const distinct = [...new Set(streetHouses.map((entry) => entry.queue))];
    if (distinct.length === 1) {
      return { queue: distinct[0]!, reason: 'whole-street', source: directoryStreet?.source ?? 'energy-ua', options: [] };
    }
    // Дом не указан или не попал в карту — показываем диапазоны, не выбирая группу наугад.
    return {
      queue: null,
      reason: 'not-found',
      source: null,
      options: dedupeQueues(streetHouses),
    };
  }
  if (streetEntries.length > 0) {
    const distinct = [...new Set(streetEntries.map((row) => normalizeQueue(row.queue)))];
    if (distinct.length === 1) {
      return { queue: distinct[0]!, reason: 'whole-street', source: streetEntries[0]!.source, options: [] };
    }
    // Групп несколько, а дом не указан или в шаблоны не попал — показываем варианты по диапазонам.
    return {
      queue: null,
      reason: 'not-found',
      source: null,
      options: dedupeQueues(streetEntries.map((row) => ({
        housePattern: row.house_pattern === '*' ? row.street_name : `${row.street_name} (${row.house_pattern})`,
        queue: normalizeQueue(row.queue),
      }))),
    };
  }

  // Уровень 3: весь населённый пункт.
  const settlementDirectory = await env.DB.prepare(
    `SELECT default_queue, queues_json, source FROM directory_settlements
     WHERE ${filter.clause} AND normalized = ? LIMIT 1`,
  )
    .bind(...filter.bindings, settlementNormalized)
    .first<{ default_queue: string | null; queues_json: string | null; source: string | null }>();
  if (settlementDirectory?.default_queue && isQueueCode(normalizeQueue(settlementDirectory.default_queue))) {
    return {
      queue: normalizeQueue(settlementDirectory.default_queue),
      reason: 'whole-settlement',
      source: settlementDirectory.source ?? 'energy-ua',
      options: [],
    };
  }
  const settlementQueues = queuesFromJson(settlementDirectory?.queues_json);
  if (settlementQueues.length > 0) {
    return {
      queue: null,
      reason: 'not-found',
      source: null,
      options: settlementQueues.map((queue) => ({ housePattern: input.settlement, queue })),
    };
  }
  const distinctSettlement = [...new Set(wholeSettlement.map((row) => normalizeQueue(row.queue)))];
  if (distinctSettlement.length === 1) {
    return {
      queue: distinctSettlement[0]!,
      reason: 'whole-settlement',
      source: wholeSettlement[0]!.source,
      options: [],
    };
  }

  return {
    queue: null,
    reason: 'not-found',
    source: null,
    options: dedupeQueues(wholeSettlement.map((row) => ({
      housePattern: row.settlement_name,
      queue: normalizeQueue(row.queue),
    }))),
  };
}

/** Убирает повторы «дом → очередь» за нормалізованим ключем і сортує числово: «2» перед «18». */
function dedupeQueues(options: Array<{ housePattern: string; queue: string }>): Array<{ housePattern: string; queue: string }> {
  const seen = new Set<string>();
  const result: Array<{ housePattern: string; queue: string }> = [];
  for (const option of options) {
    const key = `${normalizeHouseNumber(option.housePattern)}|${option.queue}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(option);
  }
  result.sort((left, right) => {
    const leftNum = parseHouseNumber(left.housePattern) ?? Number.MAX_SAFE_INTEGER;
    const rightNum = parseHouseNumber(right.housePattern) ?? Number.MAX_SAFE_INTEGER;
    if (leftNum !== rightNum) return leftNum - rightNum;
    return left.housePattern.localeCompare(right.housePattern, 'uk');
  });
  return result;
}

/** Кворум народной привязки: минимум 3 голоса и не меньше 70% за одну группу. */
const COMMUNITY_QUORUM_VOTES = 3;
const COMMUNITY_QUORUM_SHARE = 0.7;

interface AddressVoteKey {
  region: string;
  settlementNorm: string;
  streetNorm: string;
  houseNorm: string;
}

interface AddressVoteTally {
  leaderQueue: string;
  leaderVotes: number;
  totalVotes: number;
  verified: boolean;
}

/**
 * Идентификатор голосующего для антинакрутки.
 *
 * IP + User-Agent + установочный id приложения. Хеш, а не сами значения: D1 не должен хранить
 * IP жителя — для подсчёта голосов достаточно несвязанного с личностью отпечатка. Первые
 * 16 символов SHA-256 (64 бита) дают достаточную уникальность и короткий первичный ключ.
 */

/**
 * Текущее распределение голосов по дому.
 *
 * `verified` — тот самый кворум. Если голоса разделились (например 2/2 и 2/1), лидер без 70%
 * остаётся `community_pending`: показывать его как проверенный факт нельзя.
 */
/**
 * Голосование и кворум удалены по решению владельца продукта (18.10.2026).
 *
 * Функция оставлена как честный заглушечный слой: источник официальных данных больше нельзя
 * переопределить голосованием, поэтому подтверждённой кем-то группы не существует.
 * Удалять её целиком опасно: на неё ссылается код формирования ответа `/addresses/resolve`.
 */
async function readAddressVotes(
  env: Env,
  key: AddressVoteKey,
  fallbackQueue = '',
): Promise<AddressVoteTally> {
  void env;
  void key;
  const rows: { results?: Array<{ queue: string; votes: number }> } = { results: [] };

  const tallies = (rows.results ?? []).map((row) => ({
    queue: normalizeQueue(row.queue),
    votes: Number(row.votes) || 0,
  }));
  const totalVotes = tallies.reduce((sum, item) => sum + item.votes, 0);
  const leader = tallies[0] ?? { queue: fallbackQueue, votes: 0 };
  return {
    leaderQueue: leader.queue,
    leaderVotes: leader.votes,
    totalVotes,
    verified:
      leader.votes >= COMMUNITY_QUORUM_VOTES &&
      totalVotes > 0 &&
      leader.votes / totalVotes >= COMMUNITY_QUORUM_SHARE,
  };
}

/**
 * Записывает голос и возвращает новое распределение.
 *
 * Первичный ключ включает `voter_hash`, поэтому повторная отправка меняет собственный голос,
 * а не добавляет второй. `WHERE queue <> excluded.queue` не тратит `rows_written`, когда
 * человек нажал «Підтвердити» повторно с той же группой.
 */

/**
 * Подтверждённый жителем адрес → голос за очередь и, после кворума, общий справочник D1.
 *
 * ПОЧЕМУ ГОЛОСА, А НЕ ПРЯМАЯ ЗАПИСЬ. `/addresses/contribute` раньше делал `INSERT OR REPLACE`
 * в `address_queues`, и один случайный клик соседа выдавался за проверенную привязку. Теперь
 * голос ложится в `address_queue_votes` (одна строка на человека и дом), а `address_queues`
 * пополняется только когда за группу >= 3 голосов и >= 70% — и только для домов, которых нет
 * в официальном справочнике.
 *
 * Названия населённого пункта и улицы пополняют `directory_*`: без этого следующий человек не
 * увидит подсказку и не сможет подтвердить тот же дом. Существующий `source` не понижается:
 * справочник `curated` остаётся справочником.
 *
 * `WHERE` в upsert'ах намеренно не перезаписывает строку, если ничего не изменилось: D1 на
 * бесплатном тарифе считает каждую запись, а повторные нажатия «Це моя група» не должны
 * расходовать лимит.
 */

/**
 * Сбрасывает справочные ответы по конкретному НП: подсказки улиц, домов и `resolve`.
 * Ключи `memoryCache` содержат нормализованный НП, а готовые HTTP-ответы — путь `/addresses/`;
 * после подтверждения сосед должен увидеть новый дом без ожидания TTL.
 */

/**
 * Хеш содержимого офлайн-пакета (FNV-1a, 32 бита) в форме weak-ETag.
 *
 * Копия из `@svitlo/shared`, а не импорт: воркер собирается wrangler'ом отдельно от монорепо и
 * намеренно не имеет ни одной зависимости — `@svitlo/shared` тянет за собой zod, и импорт
 * сломал бы бандл и деплой. Совпадение с Node здесь и не требуется: клиент присылает назад тот
 * хеш, который получил от того же самого источника.
 */
function computeSyncEtag(payload: unknown): string {
  const text = JSON.stringify(payload) ?? '';
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `W/"${hash.toString(16).padStart(8, '0')}"`;
}

/** Совпадает ли клиентский `If-None-Match` с нашим ETag (список через запятую, `W/`, `*`). */
function etagMatches(header: string | null, etag: string): boolean {
  if (!header) return false;
  const normalize = (value: string) => value.trim().replace(/^W\//u, '');
  const wanted = normalize(etag);
  return header
    .split(',')
    .map((part) => part.trim())
    .some((part) => part === '*' || normalize(part) === wanted);
}

/**
 * Ответ 304 без тела.
 *
 * Отдельная функция, а не `json(null, 304)`: workerd запрещает тело у ответов со статусом 304,
 * и попытка отдать `"null"` падала бы исключением прямо в рантайме. CORS-заголовки повторяем —
 * браузер отдаёт клиенту статус только вместе с ними.
 */
function notModified(headers: Record<string, string> = {}): Response {
  return new Response(null, {
    status: 304,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': ALLOWED_HEADERS,
      ...headers,
    },
  });
}

/**
 * Содержимое пакета, по которому считаем ETag: без полей, производных от времени запроса.
 *
 * Убираем два поля, и это не косметика:
 *   - `syncedAt` — момент сборки пакета, меняется каждый вызов;
 *   - `status.nextAttemptAt` и `status.generatedAt` — расписание следующего опроса и время сборки
 *     статуса, то есть `now + N минут`.
 * Пока они входили в хеш, два подряд вызова `/sync` давали разные ETag, `If-None-Match` не
 * совпадал никогда, и 304 не наступал: заголовок выглядел рабочим, но экономии не давал.
 */
function etagSource(body: Record<string, unknown>): unknown {
  const status = isJsonObject(body.status) ? body.status : {};
  const { nextAttemptAt: _next, generatedAt: _generated, ...restStatus } = status;
  return { ...body, status: restStatus };
}

const SYNC_NEWS_LIMIT = 20;

/**
 * Сколько строк привязок улиц читаем на область за один запрос.
 *
 * Справочник `address_queues` — это тысячи строк, но отдаём мы не больше 50 улиц на группу, поэтому
 * большой выборки не нужно. Лимит защищает CPU воркера от разбора всего справочника страны.
 */
const STREETS_ROW_LIMIT = 4000;

/**
 * Лимит НП в офлайн-пакете. Тот же, что в Node-бекенде, и по той же причине: список должен
 * покрывать реальную область, но не превращать стартовый пакет в мегабайты.
 */
const SYNC_SETTLEMENTS_LIMIT = 2000;

/**
 * Потолок строк, которые вообще читаются из справочников адресов для агрегата.
 *
 * `offlineSettlements` раньше делал `GROUP BY` по всей `address_queues` и всей
 * `directory_settlements` без LIMIT: на большой области это тысячи прочитанных строк на каждый
 * `/sync`, то есть прямой расход `rows_read`. Агрегат кэшируется на 10 минут, а этот лимит
 * не даёт одному запросу выесть дневной бюджет.
 */
const SETTLEMENTS_SCAN_LIMIT = 5000;

/**
 * Очереди области в форме `QueueSummary` — для `/queues` и офлайн-пакета `/sync`.
 *
 * Вынесено из обработчика `/queues` по той же причине, что и новости: тот же список нужен
 * пакету, а две копии одного SQL расходились бы по поведению.
 *
 * Ключей фида может быть несколько: область с несколькими сетями (м. Дніпро — ЦЕК и ДнЕМ) отдаётся
 * одним списком кодов групп, потому что это метаданные, а не часы отключений. «Світло за графіком»
 * при этом ставится только группе, которую БЕЗ отключений опубликовала КАЖДАЯ сеть: у ЦЕК и ДнЕМ
 * одинаковая нумерация черг, и молчание одной сети — это «не знаем», а не «светло».
 */
async function queueSummariesUncached(env: Env, regions: string[]): Promise<Array<Record<string, unknown>>> {
  const keys = [...new Set(regions.filter((region) => region))];
  if (keys.length === 0) return [];
  const placeholders = keys.map(() => '?').join(', ');
  const [slotRows, coverageRows] = await Promise.all([
    env.DB.prepare(
      `SELECT source, queue, COUNT(*) AS slots, MAX(date) AS lastDate
       FROM schedule_slots WHERE region IN (${placeholders}) AND date >= ?
       GROUP BY source, queue ORDER BY queue`,
    )
      .bind(...keys, kyivToday())
      .all<{ source: string; queue: string; slots: number; lastDate: string | null }>(),
    // Опубликованные на сегодня очереди. В области, где график вышел без отключений, `schedule_slots`
    // пуст (мы храним только «тёмные» часы), и без этого списка экран выбора группы писал
    // «графік не імпортовано» про существующий график.
    env.DB.prepare(
      `SELECT source, queue, has_outages FROM schedule_coverage
       WHERE region IN (${placeholders}) AND date = ?`,
    )
      .bind(...keys, kyivToday())
      .all<{ source: string; queue: string; has_outages: number }>(),
  ]);

  // Источники нельзя смешивать: у зеркала для Києва лежат исторические 60 групп `35/1`, а живой
  // график города — тоже 60 групп, но простыми числами `1…60`. Слияние давало 120 пунктов в списке
  // выбора, и человек выбирал код, которого у оператора нет. Поэтому для области берём ОДИН источник:
  // свежий `energy-ua`, а если его на сегодня нет — зеркало. Внутри одного источника коды уже совместимы.
  const presentSources = new Set([
    ...(slotRows.results ?? []).map((row) => row.source),
    ...(coverageRows.results ?? []).map((row) => row.source),
  ]);
  const preferredSource = presentSources.has('energy-ua')
    ? 'energy-ua'
    : presentSources.has('mirror')
      ? 'mirror'
      : null;
  const rows = (slotRows.results ?? []).filter((row) => !preferredSource || row.source === preferredSource);
  const coverages = (coverageRows.results ?? []).filter(
    (row) => !preferredSource || row.source === preferredSource,
  );

  // Очереди без слотов, но с публикацией. Строки с отключениями исключаем: там пустые слоты значат
  // отставший импорт, а не «світло за графіком». Если источник на сегодня ничего не опубликовал,
  // флага «без отключений» нет ни у одной группы — это «не знаем», а не «светло».
  const cleared = coverages.length === 0
    ? new Set<string>()
    : new Set(
        coverages
          .filter((row) => row.queue !== ALL_CLEAR_QUEUE && !row.has_outages)
          .map((row) => normalizeQueue(row.queue)),
      );
  // Порядок «1, 1/2, 2, 2/2, 10» — как в Node-бекенде (`compareQueueCodes`): строковая сортировка
  // ставила «10» перед «2», и список групп в двух сборках выглядел по-разному.
  const sums = new Map<string, { queue: string; slots: number; lastDate: string | null }>();
  for (const row of rows) {
    const queue = normalizeQueue(row.queue);
    sums.set(queue, { queue, slots: row.slots ?? 0, lastDate: row.lastDate ?? null });
  }
  for (const queue of cleared) {
    if (!sums.has(queue)) sums.set(queue, { queue, slots: 0, lastDate: null });
  }
  const list = [...sums.values()].sort((a, b) => compareQueueCodes(a.queue, b.queue));
  // Улицы всех групп одним запросом. Раньше на каждую группу шёл отдельный `SELECT` (у области с
  // 60 группами — 60 обращений к D1), и `/sync` упирался в лимит подзапросов бесплатного тарифа,
  // отвечая `503 error 1102` ещё до того, как успевал собрать пакет.
  //
  // Группируем по нормализованному коду: в привязках встречается `2.2`, а в списке групп — `2/2`,
  // и точное сравнение оставляло такие группы вовсе без улиц.
  const streetsByQueue = new Map<string, Set<string>>();
  if (list.length > 0) {
    const bound = await env.DB.prepare(
      `SELECT queue, street_name AS name FROM address_queues
       WHERE region IN (${placeholders}) AND queue <> '' AND street_name <> ''
       LIMIT ${STREETS_ROW_LIMIT}`,
    )
      .bind(...keys)
      .all<{ queue: string; name: string }>();
    for (const row of bound.results ?? []) {
      const queue = normalizeQueue(row.queue);
      const names = streetsByQueue.get(queue) ?? new Set<string>();
      names.add(row.name);
      streetsByQueue.set(queue, names);
    }
  }
  const streetNames = list.map((row) =>
    [...(streetsByQueue.get(row.queue) ?? [])].sort(compareUk).slice(0, 50),
  );
  return list.map((row, index) => ({
    queue: row.queue,
    slots: row.slots,
    lastDate: row.lastDate,
    // Географию групп (улицы/сёла) зеркало не отдаёт, а выдумывать её нельзя.
    streets: streetNames[index]?.length ?? 0,
    settlements: [],
    // streetNames обязателен: его читает чип мест рядом с выбором группы, и без него
    // компонент падал бы на undefined.map.
    streetNames: streetNames[index] ?? [],
    // Группа есть в опубликованном на сегодня ГПВ без единого часа отключения. Флага нет у остальных:
    // «не знаємо» и «графік є, відключень не заплановано» не должны выглядеть одинаково.
    ...(cleared.has(row.queue) ? { covered: true } : {}),
  }));
}

/**
 * Очереди области с кэшем изолята.
 *
 * Список групп — метаданные, но собирается он недёшево: покрытие дня по каждой сети плюс выборка
 * привязок улиц. До правки на каждую группу шёл отдельный запрос улиц (12 групп × 2 сети = 24
 * обращения, у большой области — за 60), и `/sync` упирался в лимит подзапросов.
 */
async function queueSummaries(env: Env, regions: string[]): Promise<Array<Record<string, unknown>>> {
  const keys = [...new Set(regions.filter((region) => region))].sort();
  // 10 минут: список групп и привязки улиц меняются вместе с каталогом, а не каждую минуту.
  return cached(`queues:${keys.join(',')}`, () => queueSummariesUncached(env, regions), AGGREGATE_CACHE_TTL_MS);
}

/**
 * НП области для офлайн-поиска адреса (мастер «область → НП → вулиця → дім»).
 *
 * Два источника сливаются, как и в Node-бекенде: `address_queues` — НП с известными группами
 * (в них есть `queues`), `directory_settlements` — справочник названий без групп. Второй
 * источник отдаёт `kind: null`: KOATUU-справочника типов в воркере нет, а выдумывать «село»
 * по названию нельзя.
 */
async function offlineSettlementsUncached(
  env: Env,
  regions: string[],
): Promise<{ items: Array<Record<string, unknown>>; total: number }> {
  const filter = regionIn(regions);
  if (filter.clause === '') return { items: [], total: 0 };
  const [bound, directory] = await Promise.all([
    env.DB.prepare(
      `SELECT settlement_name AS name, settlement_normalized AS normalized,
              GROUP_CONCAT(DISTINCT queue) AS queues
       FROM address_queues
       WHERE ${filter.clause} AND settlement_name <> ''
       GROUP BY settlement_normalized, settlement_name
       LIMIT ${SETTLEMENTS_SCAN_LIMIT}`,
    ).bind(...filter.bindings).all<{ name: string; normalized: string; queues: string | null }>(),
    env.DB.prepare(
      `SELECT name, normalized FROM directory_settlements WHERE ${filter.clause}
       LIMIT ${SETTLEMENTS_SCAN_LIMIT}`,
    ).bind(...filter.bindings).all<{ name: string; normalized: string }>(),
  ]);

  // Ключ — `normalized`: только по нему два источника и один НП опознаются как одно место.
  const merged = new Map<string, { name: string; kind: string | null; queues: string[] }>();
  for (const row of bound.results ?? []) {
    const key = row.normalized || normalizeAddress(row.name);
    if (!key) continue;
    const queues = (row.queues ?? '')
      .split(',')
      .map((queue) => normalizeQueue(queue))
      .filter((queue) => queue.length > 0);
    merged.set(key, { name: row.name.trim(), kind: null, queues: [...new Set(queues)] });
  }
  for (const row of directory.results ?? []) {
    const key = row.normalized || normalizeAddress(row.name);
    if (!key || merged.has(key)) continue;
    merged.set(key, { name: row.name.trim(), kind: null, queues: [] });
  }

  // Сначала НП с группами: в списке подсказок они полезнее, чем название из справочника без
  // графика. Сортировка именно по числу групп, а не по алфавиту — иначе нужное село уезжает
  // в хвост обрезанного списка.
  const all = [...merged.values()].sort((a, b) => b.queues.length - a.queues.length || compareUk(a.name, b.name));
  return { items: all.slice(0, SYNC_SETTLEMENTS_LIMIT), total: all.length };
}

/**
 * НП области с кэшем изолята.
 *
 * Ключ — те же ключи области, а не их порядок: `kyiv-city` и `kyiv` должны попадать в одну запись,
 * иначе кэш промахивался бы на каждом варианте написания. Сам запрос читает `directory_settlements`
 * целиком (тысячи строк) и сливает их в JS, поэтому кэш тут даёт больше всего: офлайн-пакет просит
 * НП почти на каждом старте приложения.
 */
async function offlineSettlements(
  env: Env,
  regions: string[],
): Promise<{ items: Array<Record<string, unknown>>; total: number }> {
  const keys = [...new Set(regions.filter((region) => region))].sort();
  return cached(
    `settlements:${keys.join(',')}`,
    () => offlineSettlementsUncached(env, regions),
    AGGREGATE_CACHE_TTL_MS,
  );
}

/**
 * Последние новости из общей таблицы `news` в форме `NewsItem`.
 *
 * Вынесено из обработчика `/news`, потому что тот же список нужен офлайн-пакету `/sync`: две
 * копии одного запроса разошлись бы, и в самолёте человек читал бы не ту ленту, что на главной.
 * `limit` уже провалидирован вызывающей стороной.
 */
async function newsItems(
  env: Env,
  options: { limit: number; region?: string; kind?: string; excludeKind?: string; ukraineWide?: boolean },
): Promise<Array<Record<string, unknown>>> {
  const where: string[] = [];
  const bindings: Array<string | number> = [];
  if (options.region) {
    // «Моя область» = посты региона + общие украинские (Укренерго/ДТЕК).
    if (options.ukraineWide) {
      where.push('(region_cpu = ? OR is_ukraine_wide = 1)');
    } else {
      where.push('region_cpu = ?');
    }
    bindings.push(options.region);
  } else if (options.ukraineWide) {
    where.push('is_ukraine_wide = 1');
  }
  if (options.kind) {
    where.push('kind = ?');
    bindings.push(options.kind);
  }
  if (options.excludeKind) {
    where.push('(kind IS NULL OR kind <> ?)');
    bindings.push(options.excludeKind);
  }
  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const result = await env.DB.prepare(
    `SELECT id, source_key, url, title, summary, published_at, first_seen_at,
            kind, region_cpu, is_ukraine_wide, image_urls, body
     FROM news ${clause}
     ORDER BY COALESCE(published_at, first_seen_at) DESC LIMIT ?`,
  ).bind(...bindings, options.limit).all<NewsRow>();
  const items = (result.results ?? []).map((row) => {
    let imageUrls: string[] = [];
    try {
      const parsed = JSON.parse(row.image_urls ?? '[]');
      if (Array.isArray(parsed)) imageUrls = parsed.filter((url): url is string => typeof url === 'string');
    } catch {
      imageUrls = [];
    }
    return {
      id: row.id,
      sourceKey: row.source_key,
      url: row.url,
      title: row.title,
      summary: row.summary ?? null,
      body: row.body ?? row.summary ?? null,
      publishedAt: row.published_at ?? null,
      firstSeenAt: row.first_seen_at,
      regionCpu: row.region_cpu ?? null,
      kind: row.kind ?? 'other',
      isUkraineWide: row.is_ukraine_wide !== 0,
      // tags и imageUrls ОБЯЗАТЕЛЬНЫ: по ним компоненты делают .map().
      tags: [],
      imageUrls,
      // Хэш содержимого нужен, чтобы не перерисовывать карточку, если текст не изменился.
      contentHash: `${row.id}:${row.published_at ?? row.first_seen_at}`,
    };
  });
  return items;
}

/**
 * Отключения по группам области на ближайшие `days` дней (сегодня, завтра…).
 *
 * Вынесено из `/schedules/upcoming` ради `/sync`: главная и офлайн-пакет обязаны показывать один и
 * тот же список. Возвращает готовые бакеты контракта `GroupOutageSummary`; пустой массив — честное
 * «отключений по графику нет».
 */
async function upcomingGroupBucketsUncached(
  env: Env,
  regions: string[],
  today: string,
  days: number,
): Promise<Array<Record<string, unknown>>> {
  // Без области бакетов нет: «отключения по всей стране» — не тот список, который поместится на
  // главной, и раньше этот вызов молча отдавал пустой массив.
  if (regions.length === 0) return [];
  const regionRows = await env.DB.prepare(
    `SELECT DISTINCT date FROM schedule_slots ORDER BY date`,
  ).all<{ date: string }>();

  // Срез только по тем датам, что уже начались или вот-вот начнутся: прошедшие дни человеку
  // не нужны, а тянуть их в приложение незачем.
  const wanted = Array.from({ length: days }, (_, index) => addDays(today, index));
  const dates = (regionRows.results ?? []).map((row) => row.date).filter((date) => wanted.includes(date));

  const buckets: Array<Record<string, unknown>> = [];
  for (const date of dates) {
    const rows = await loadSlots(env, regions, date);
    const byQueue = new Map<string, SlotRow[]>();
    for (const row of rows) {
      const key = normalizeQueue(row.queue);
      const list = byQueue.get(key);
      if (list) list.push(row);
      else byQueue.set(key, [row]);
    }
    for (const [queue, queueRows] of byQueue) {
      const intervals = toIntervals(queueRows, queue, date);
      if (intervals.length === 0) continue;
      const nowMs = Date.now();
      // Не подписываем слоты зеркалом по привычке: в D1 всё чаще лежит живой источник
      // `energy-ua`, и подпись должна совпадать с тем, что отдаёт `/schedules`.
      const sources = [...new Set(queueRows.map((row) => row.source ?? 'mirror'))];
      buckets.push({
        queue,
        date,
        source: sources.length === 1 ? sources[0]! : 'mixed',
        intervals,
        isActiveNow: intervals.some(
          (interval) => Date.parse(interval.startsAt) <= nowMs && nowMs < Date.parse(interval.endsAt),
        ),
        nextStartsAt: intervals.find((interval) => Date.parse(interval.startsAt) > nowMs)?.startsAt ?? null,
        settlements: [],
        streetNames: [],
      });
    }
  }

  buckets.sort((a, b) => {
    const dateDiff = String(a.date).localeCompare(String(b.date));
    if (dateDiff !== 0) return dateDiff;
    // Числовая сортировка кодов групп. Строковая давала «1, 10, 11, 2, 3…»: человек видел
    // после «Черга 1» сразу «Черга 10» и решал, что список сломан.
    return compareQueueCodes(String(a.queue), String(b.queue));
  });
  return buckets;
}

/** Отключения на ближайшие дни с кэшем изолята: `/schedules/upcoming` и `/sync` зовут её всегда. */
async function upcomingGroupBuckets(
  env: Env,
  regions: string[],
  today: string,
  days: number,
): Promise<Array<Record<string, unknown>>> {
  const keys = [...new Set(regions.filter((region) => region))].sort();
  const buckets = await cached(`upcoming:${keys.join(',')}:${today}:${days}`, () =>
    upcomingGroupBucketsUncached(env, regions, today, days),
  );
  if (buckets.length > 0) return buckets;

  // D1 может отдать пустой день, пока импорт слотов не прошёл (например, исчерпан лимит
  // записей). Зеркало в этот момент содержит живой график — без этой ветки главная и пакет
  // `/sync` показывали «Відключень немає» при реальных интервалах.
  const snapshot = await fetchMirror(env);
  if (!snapshot.ok || !snapshot.payload) return buckets;
  const mirrorKeys = [
    ...new Set(
      regions.flatMap((region) => mirrorReadKeys(snapshot, region, today)),
    ),
  ];
  if (mirrorKeys.length === 0) return buckets;
  return mirrorUpcomingBuckets(snapshot, mirrorKeys, today, days);
}

/**
 * Тело `StatusResponse` для области: тот же расчёт, что и у `/status`.
 *
 * Живёт отдельной функцией, потому что этим ответом гідратується и офлайн-пакет `/sync`. Счётчики
 * считаются по каноническим `outage_events` и по слотам графика (`schedule_slots`), а поля, которых
 * у воркера нет, заполняются нулями и null — не выдуманными значениями.
 */
async function buildStatusPayloadUncached(
  env: Env,
  regions: string[],
  today: string,
): Promise<Record<string, unknown>> {
  // Контракт повторяет StatusResponse из @svitlo/shared. Раньше здесь отдавался другой
  // набор полей (totalOutages/regionsWithData), и главная читала status.grid.level —
  // то есть `undefined.level`, и React падал в белый экран. Поля, которых у нас нет,
  // заполняем честными нулями и null, а НЕ выдумываем значения.
  //
  // Все шесть счётчиков приходят одним запросом (`statusCounters`), а слоты суток читаются ДВА
  // раза (сегодня и вчера) на все производные числа сразу: до этой правки `/status` делал 11
  // обращений к D1 и четыре прохода по одним и тем же слотам, и на бесплатном тарифе вылетал по
  // CPU (`503`, `error 1102`).
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const [counters, todaySlots, yesterdaySlots] = await Promise.all([
    statusCounters(env, regions, today),
    loadSlots(env, regions, today),
    loadSlots(env, regions, addDays(today, -1)),
  ]);
  const todayStats = daySlotStats(todaySlots, nowMs);
  const yesterdayStats = daySlotStats(yesterdaySlots, nowMs);
  const importedAt = counters.importedAt;
  const activeOutages = counters.activeOutages;
  const activeGroups = todayStats.activeGroups;

  // Окно «за добу» и «за 24 години»: считаем по интервалам выбранной области. Пока
  // воркер знает только графики групп, честная надёжность равна доле времени без света.
  const buildWindow = (label: string, windowMinutes: number, rawOutageMinutes: number, outageCount: number) => {
    // Отключение не может занять больше окна: если данные противоречат друг другу,
    // показываем «нет данных», а не отрицательный процент.
    const outageMinutes = Math.min(windowMinutes, Math.max(0, rawOutageMinutes));
    return {
    windowLabel: label,
    windowMinutes,
    outageMinutes,
    poweredMinutes: Math.max(0, windowMinutes - outageMinutes),
    reliabilityPct: windowMinutes > 0 ? Math.round(((windowMinutes - outageMinutes) / windowMinutes) * 1000) / 10 : 0,
    outageCount,
    // Нет ни одного интервала — показать «100% надёжности» было бы выдумкой,
    // поэтому честно помечаем окно как пустое.
    hasData: outageCount > 0,
    };
  };

  // Возвращается ТЕЛО статуса, без конверта `{ data }`. Конверт навешивают вызывающие: `/status`
  // оборачивает сам, а пакет `/sync` кладёт это же тело в `bundle.status`. Пока конверт жил здесь,
  // `/status` отдавал двойную вложенность (главная читает `data.grid.level` — то есть
  // `undefined.level` и белый экран), а в пакете лежало `status.data.grid`: экран после
  // гидратации офлайн-пакета получал те же `undefined`. Один лишний слой ломал оба эндпоинта.
  return {
    grid: {
      level: activeOutages > 0 ? 'emergency' : activeGroups > 0 ? 'warning' : 'stable',
      // Сообщение показывается под индикатором, и пустое при «warning» выглядит как
      // ошибка вёрстки, хотя состояние реальное.
      message:
        activeOutages > 0
          ? 'Є аварійні відключення'
          : activeGroups > 0
            ? 'За графіком ГПВ частину груп зараз знеструмлено'
            : '',
    },
    activeOutages,
    scheduledOutages: counters.scheduledOutages,
    activeGroups,
    scheduledGroups: todayStats.scheduledGroups,
    activeIncidents: activeOutages,
    scheduledIncidents: 0,
    totalIncidents: counters.incidents,
    lastUpdatedAt: importedAt,
    // Данные старше двух часов помечаем как устаревшие: показывать их как свежие нельзя.
    dataStale: importedAt !== null && nowMs - Date.parse(importedAt) > 2 * 60 * 60 * 1000,
    lastError: null,
    pausedUntil: null,
    nextAttemptAt: null,
    consecutiveParseFailures: 0,
    powerSummary: {
      today: buildWindow('за добу', 24 * 60, todayStats.outageMinutes, counters.groupsToday),
      last24h: buildWindow('за 24 години', 24 * 60, yesterdayStats.outageMinutes, counters.groups24h),
    },
    // Служебное: сколько всего групп знает воркер. Фронтенд это поле не читает, но оно
    // нужно для диагностики через curl, поэтому не выбрасываем.
    totalQueues: counters.totalQueues,
    generatedAt: nowIso,
  };
}

/** `buildStatusPayload` с кэшем изолята: ключ — набор ключей области и дата. */
async function buildStatusPayload(env: Env, regions: string[], today: string): Promise<Record<string, unknown>> {
  const payload = await cached(`status:${regions.join(',')}:${today}`, () =>
    buildStatusPayloadUncached(env, regions, today),
  );
  // Пока в D1 нет сегодняшних слотов, но зеркало их отдаёт, счётчики D1 — это «тихий ноль».
  // Отличить его от честного allClear можно по наличию слотов в зеркале: если там пусто,
  // день действительно опубликован без отключений.
  if (Number(payload.scheduledGroups ?? 0) > 0 || Number(payload.activeGroups ?? 0) > 0) return payload;
  const snapshot = await fetchMirror(env);
  if (!snapshot.ok || !snapshot.payload) return payload;
  const keys =
    regions.length > 0
      ? [...new Set(regions.flatMap((region) => mirrorReadKeys(snapshot, region, today)))]
      : [...snapshot.cpus];
  if (keys.length === 0) return payload;
  const mirror = mirrorStatusPayload(snapshot, keys, today);
  return Number(mirror.totalQueues ?? 0) > 0 ? mirror : payload;
}

/**
 * Справка по маршрутам, которые читают данные одной области: `/schedules`, `/schedules/upcoming`,
 * `/addresses/*`, `/outages`, `/outages/stats`, `/reliability`, `/status`, `/sync`,
 * `/street-queues*`. Публичные маршруты без области (`/news`, `/changelog`, `/health`, `/incidents`)
 * параметр `region` игнорируют.
 *
 * Отдельного списка «сюда нельзя многомережную область» больше нет: резолвинг ключей живёт в
 * `resolveDbRegions`/`resolveReadRegions`, и 400 `AMBIGUOUS_REGION` не отдаётся вовсе.
 */


/**
 * Собирает офлайн-пакет `/sync` (тело без `syncedAt` и его ETag).
 *
 * Вынесено из обработчика, чтобы результат можно было положить в кэш изолята: пакет стоит десятков
 * запросов к D1, а между обходами крона не меняется.
 */
async function syncBundle(
  env: Env,
  params: {
    requestedRegion: string;
    canonicalRegion: string;
    dbRegions: string[];
    readRegions: string[];
    today: string;
    days: number;
    /** Диагностика `?timing=1`: без него таймер выключен и ничего не стоит. */
    timer?: StepTimer;
  },
): Promise<{ body: Record<string, unknown>; etag: string }> {
  const { requestedRegion, canonicalRegion, dbRegions, readRegions, today, days } = params;
  const timer = params.timer;
  /** Обёртка ожидания: без `?timing=1` возвращает тот же промис, ничего не замеряя. */
  const measure = <T,>(step: string, work: Promise<T>): Promise<T> => (timer ? timer.measure(step, work) : work);
  const wantedDays = Array.from({ length: days }, (_, index) => addDays(today, index));
  // Ключи фида для метаданных области (черги, НП): у многомережной области это обе сети, у
  // остальных — её единственный ключ. Область, которой фид не отдаёт, остаётся под своим кодом.
  const syncFeedKeyList = regionFeedKeysOf(canonicalRegion);
  const syncFeedKeys = syncFeedKeyList.length > 0 ? syncFeedKeyList : dbRegions;

  // Параллельно: D1 в воркері допускає одночасні запити, а послідовний виклик склався б у суму
  // затримок. `status` і каталог обов'язкові — без них пакет безглуздий; порожній графік чи
  // порожня стрічка новин — законний стан, і пакет із ними все одно цінніший за порожній.
  // Справочник НП без привязок і список очередей — теж законний стан: без них офлайн-шар
  // просто не покаже підказок адреси, але графік віддасть.
  const [status, regions, buckets, news, queues, settlementList] = await Promise.all([
    measure('status', buildStatusPayload(env, readRegions, today)),
    measure('regions', regionSummaries(env)),
    measure(
      'buckets',
      readRegions.length > 0 ? upcomingGroupBuckets(env, readRegions, today, days) : Promise.resolve([]),
    ),
    measure('news', newsItems(env, { limit: SYNC_NEWS_LIMIT })),
    // Список групп — по ключах ФИДА: канонічний/легаси-дубль без покрытия обнулял бы «согласие всех
    // сетей», и офлайн-пакет приносил бы пустой перечень групп при живом графике.
    measure('queues', queueSummaries(env, syncFeedKeys)),
    // НП — тоже по всем сетям области: село может быть привязано к любой из них, а поиск идёт по
    // названию, поэтому объединение ничего не путает (у каждой подсказки свои коды групп).
    measure('settlements', offlineSettlements(env, syncFeedKeys)),
  ]);

  // График кладём под ВСЕ ключи области сразу: канонический `cpu` (то, что лежит в каталоге и в
  // ссылке), ключ фида (`kyiv`, `kiivska-oblast`) и сам запрошенный код. Клиент ищет слоты по
  // `schedulesByRegion[region]`, где `region` — то, что он отправил (а у людей в localStorage
  // остались и старые коды). Один ключ вместо трёх означал бы «графіка немає» при живом графике.
  const schedulesByRegion: Record<string, { days: string[]; buckets: Array<Record<string, unknown>> }> = {};
  if (requestedRegion) {
    const keys = new Set<string>([requestedRegion, canonicalRegion, ...readRegions]);
    for (const key of keys) if (key) schedulesByRegion[key] = { days: wantedDays, buckets };
  }

  const body = {
    // Эхо ключа, по которому реально прочитаны данные: так же отвечает Node-бэкенд (там это
    // результат `readRegionParam`). Для многомережной области это конкретная сеть (`dnipro-cek`) —
    // клиент узнаёт, чей график он получил, а в `schedulesByRegion` лежат и его собственные ключи.
    region: (readRegions[0] ?? requestedRegion) || null,
    status,
    regions,
    queues,
    schedulesByRegion,
    settlements: settlementList.items,
    settlementsTotal: settlementList.total,
    news,
    contacts: [],
  };
  // ETag считаем от содержимого, без полей, производных от времени запроса (`syncedAt`,
  // `status.nextAttemptAt`, `status.generatedAt`): иначе хеш менялся бы каждый вызов, и
  // `If-None-Match` не срабатывал бы никогда — то есть заголовок был бы декоративным.
  return { body, etag: computeSyncEtag(etagSource(body)) };
}

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname.replace(/^\/api\/v1/u, '').replace(/\/+$/u, '') || '/';

  // Данные в D1 лежат под ключами фида (`kyiv`, `kiivska-oblast`, `dnipro-cek`), а каталог отдаёт
  // канонические `cpu` (`kyiv-city`, `kyivska-oblast`, `dnipropetrovska-oblast`). Плюс у людей в
  // закладках и `localStorage` остались вообще старые коды. Поэтому ключи чтения собирает один
  // `resolveDbRegions`, а не «одна подстановка на запрос»: иначе запрос с ключом, которого нет в
  // слотах, отвечал «даних графіка немає» при живом графике.
  const requestedRegion = (url.searchParams.get('region') ?? '').trim();
  const canonicalRegion = canonicalRegionCpu(requestedRegion);
  const dbRegions = resolveDbRegions(requestedRegion);
  const today = kyivToday();

  // Ключи чтения по умолчанию: для многомережной области это одна сеть с данными на сегодня, для
  // остальных — все ключи области сразу (канонический + ключ фида). Тот, кто читает конкретную
  // очередь и дату (`/schedules`), уточняет выбор через `?queue=`: сеть с графиком именно этой черги.
  let readRegions = await resolveReadRegions(env, dbRegions, today);
  // Первичный ключ для эха в JSON (`/addresses/streets` возвращает `region`) и для проверки
  // «область не задана» (`/outages?region=all`).
  const region = readRegions[0] ?? requestedRegion;


  if (path === '/health') {
    return json({ status: 'ok', d1QuotaExceeded: d1QuotaExceededAt !== null, d1UnavailableAt });
  }

  if (path === '/changelog') {
    // Конверт и заголовки — как у Node-бэкенда (apps/api/src/routes/changelog.ts): приложение не
    // должно знать, кто именно отдал список. Раньше маршрута здесь не было, и карточка «Що
    // нового» на Cloudflare-сборке молча получала 404: серверные фиксы не доходили до людей,
    // у которых уже установлено приложение. ETag считаем от содержимого файла — он меняется
    // только с выкаткой, а не с каждым запросом, поэтому кеш браузера работает как надо.
    return json({ data: changelog }, 200, {
      'cache-control': 'public, max-age=300',
      etag: `W/"changelog-${changelog.version}-${changelog.totalFeatures + changelog.totalFixes + changelog.totalOptimizations}"`,
    });
  }

  if (path === '/version') {
    // Данные пишет tools/build-android-apk.sh вместе с APK: версия и SHA-256 относятся ровно
    // к тому файлу, который лежит на Pages. Без совпадения хеша Android-обёртка установку
    // остановит — поэтому здесь не должно быть «красивой», но вымышленной версии.
    return json({ data: versionInfo }, 200, {
      'cache-control': 'public, max-age=300',
      etag: `W/"version-${versionInfo.version}-${versionInfo.sha256.slice(0, 12)}"`,
    });
  }

  await ensureSchedule(env);

  if (path === '/regions') {
    const data = await regionSummaries(env);
    // Каталог меняется раз в сутки, а не каждые 20 минут.
    return json({ data }, 200, { 'cache-control': 'public, max-age=300' });
  }

  if (path === '/queues') {
    // Список групп — метаданные, поэтому многомережную область читаем целиком: коды групп ЦЕК и
    // ДнЕМ объединяются, а «світло за графіком» ставится только с согласия обеих сетей. Ключи берём
    // именно ключи ФИДА (`dnipro-cek`/`dnipro-dnem`, `kyiv`, `kiivska-oblast`): канонический или
    // легаси-дубль без покрытия обнулял бы «согласие всех сетей» — и человек видел пустой список
    // групп там, где оператор опубликовал график. Область, которой фид не отдаёт, читается под своим
    // кодом — ответ честно пустой.
    const feedKeys = regionFeedKeysOf(canonicalRegion);
    const queueRegionKeys = feedKeys.length > 0 ? feedKeys : dbRegions.length > 0 ? dbRegions : [region];
    return json({ data: await queueSummaries(env, queueRegionKeys) }, 200, { 'cache-control': 'public, max-age=300' });
  }

  if (path === '/schedules') {
    const queue = normalizeQueue(url.searchParams.get('queue') ?? '');
    const date = url.searchParams.get('date') ?? today;
    if (!queue) return json({ error: { code: 'VALIDATION_ERROR', message: 'queue обовʼязковий' } }, 400);
    // Коды чтения: у Києва «1» и «1/1» — одна группа, поэтому слоты и покрытие ищем под обеими формами.
    const queueAliases = queueReadAliases(requestedRegion, queue);
    // Сеть многомережной области выбираем по факту: та, у которой на эту дату есть график этой черги.
    readRegions = await resolveReadRegions(env, dbRegions, date, queue);
    const [rows, coverage] = await Promise.all([loadSlots(env, readRegions, date), coverageOfDay(env, readRegions, date)]);
    const intervals = toIntervals(rows, queueAliases, date);
    // Три состояния, которые раньше сливались в одно «пусто» и давали «Немає даних»:
    //   интервалы есть          → график опубликован, есть часы отключений;
    //   покрытие без отключений → allClear: график опубликован, «світло за графіком»;
    //   ни того, ни другого     → covered: false, оператор на эту дату ничего не публиковал.
    const queueCovered =
      queueAliases.some((code) => coverage.queues.has(code)) || coverage.queues.has(ALL_CLEAR_QUEUE);
    const covered = queueCovered || intervals.length > 0;
    // «Світло за графіком» ставим, только если фід не видит отключений у этой очереди: пустые слоты
    // при `has_outages = 1` — это отставший импорт, и обещать свет было бы прямой брехнью.
    const offByFeed = queueAliases.some((code) => coverage.offQueues.has(code));
    // Источник берём у самих слотов: раньше здесь было жёстко 'mirror', и слоты, собранные из
    // Telegram, выдавались за данные зеркала — источник в интерфейсе был бы неправдой.
    const slotSource = rows.find((row) => row.source)?.source ?? null;
    const lastImported = await lastImportedAt(env);
    if (intervals.length === 0) {
      // Пустой D1 ещё не значит «світло за графіком»: при исчерпанном лимите записей
      // сегодняшние слоты не импортировались. Сверяемся с живым зеркалом и отдаём его
      // интервалы, если они есть, — иначе Київ показывал зелёное при реальных отключениях.
      const snapshot = await fetchMirror(env);
      if (snapshot.ok && snapshot.payload) {
        const scheduleKeys = mirrorReadKeys(snapshot, requestedRegion, date, queue);
        const mirrorData = mirrorScheduleResponse(
          snapshot,
          scheduleKeys,
          queue,
          date,
          queueAliases,
        );
        if ((mirrorData.intervals as unknown[]).length > 0) {
          return json({ data: mirrorData }, 200, { 'cache-control': 'public, max-age=60' });
        }
      }
    }
    return json({
      data: {
        queue,
        date,
        intervals,
        source: intervals.length > 0 ? slotSource : queueCovered ? ([...coverage.sources][0] ?? null) : null,
        covered,
        allClear: covered && intervals.length === 0 && !offByFeed,
        lastImportedAt: lastImported,
      },
    }, 200, { 'cache-control': 'public, max-age=60' });
  }

  if (path === '/schedules/upcoming') {
    const days = Math.min(7, Math.max(1, Number(url.searchParams.get('days') ?? 2) || 2));
    // Список отключений области считает общий помощник: он же наполняет `/sync`.
    return json({ data: await upcomingGroupBuckets(env, readRegions, today, days) }, 200, {
      'cache-control': 'public, max-age=60',
    });
  }

  if (path === '/news') {
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? 20) || 20));
    const kind = url.searchParams.get('kind') ?? undefined;
    const excludeKind = url.searchParams.get('excludeKind') ?? undefined;
    const region = url.searchParams.get('region') ?? undefined;
    const ukraineWide = url.searchParams.get('ukraineWide') === 'true';
    const items = await newsItems(env, { limit, kind, excludeKind, region, ukraineWide });
    // `stale` — не ошибка, а честный признак пустой ленты: по нему фронтенд показывает
    // «даних немає», а не пустую вёрстку.
    const latest = items[0]?.publishedAt as string | null | undefined;
    const stale = items.length === 0 || (latest ? Date.now() - Date.parse(latest) > 24 * 3600 * 1000 : true);
    return json({ data: items, meta: { count: items.length, limit, stale } }, 200, {
      'cache-control': 'public, max-age=60',
    });
  }

  // Источники новостей: сколько записей собрано с каждой площадки и когда видели последнюю.
  // Маршрут нужен приложению: на «Інфо» по нему видно, кого именно мы читаем и не заглох ли
  // источник. Раньше здесь был 404, и подпись «Джерела: N» молча отсутствовала — выглядело как
  // «данные с сервера не приходят», хотя лента работала.
  if (path === '/news/sources') {
    const rows = await env.DB.prepare(
      `SELECT source_key, COUNT(*) AS items, MAX(first_seen_at) AS last_seen
       FROM news GROUP BY source_key ORDER BY source_key`,
    ).all<{ source_key: string; items: number; last_seen: string | null }>();
    const data = (rows.results ?? []).map((row) => ({
      sourceKey: row.source_key,
      // Каналы операторов читаем как публичные веб-страницы Telegram — это и есть вид источника.
      kind: 'telegram',
      baseUrl: null,
      regionCpu: null,
      enabled: true,
      lastOkAt: row.last_seen,
      // Текста ошибки зеркало не хранит: сбой сбора видно по отсутствию свежих записей.
      // Выдумывать сообщение нельзя — UI показал бы вымышленную причину.
      lastError: null,
      itemsCount: row.items,
    }));
    return json({ data }, 200, { 'cache-control': 'public, max-age=300' });
  }

  if (path === '/addresses/settlements') {
    const query = (url.searchParams.get('q') ?? '').trim();
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') ?? 10) || 10));
    const needle = normalizeAddress(query);
    const settlementsFilter = regionIn(readRegions.length > 0 ? readRegions : [''], 'd.region');
    const rows = await env.DB.prepare(
      `SELECT d.name, d.normalized, d.default_queue, d.queues_json, d.streets_count
       FROM directory_settlements d WHERE ${settlementsFilter.clause} AND d.normalized LIKE ?
       ORDER BY d.name COLLATE NOCASE LIMIT ${limit}`,
    )
      .bind(...settlementsFilter.bindings, needle ? `%${needle}%` : '%')
      .all<{
        name: string;
        normalized: string;
        default_queue: string | null;
        queues_json: string | null;
        streets_count: number;
      }>();
    return json({
      data: (rows.results ?? []).map((row) => ({
        name: row.name,
        normalized: row.normalized,
        defaultQueue: row.default_queue ? normalizeQueue(row.default_queue) : null,
        queues: parseStringArray(row.queues_json),
        streetsCount: row.streets_count ?? 0,
      })),
      region,
    });
  }

  if (path === '/addresses/streets') {
    const settlementInput = (url.searchParams.get('settlement') ?? '').trim();
    const query = (url.searchParams.get('q') ?? '').trim();
    if (settlementInput.length < 2) return json({ data: [], wholeSettlementQueue: null });
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') ?? 10) || 10));
    const settlement = await canonicalDirectorySettlement(env, readRegions, settlementInput);
    const settlementNormalized = normalizeAddress(settlement);
    const needle = normalizeAddress(query);

    // Улицы берём из каталога и публичных привязок. Геокодер не подмешивает похожие улицы
    // из соседних населённых пунктов; перечень mirror/community не считается адресным каталогом.
    const streetRegions = regionIn(readRegions.length > 0 ? readRegions : ['']);
    const known = await env.DB.prepare(
      `SELECT name, normalized, source FROM directory_streets
       WHERE ${streetRegions.clause} AND settlement_normalized = ? AND normalized LIKE ?
       LIMIT ${STREETS_ROW_LIMIT}`,
    ).bind(...streetRegions.bindings, settlementNormalized, `%${needle}%`)
      .all<{ name: string; normalized: string; source: string | null }>();

    const bound = await env.DB.prepare(
      `SELECT DISTINCT street_name AS name, street_normalized AS normalized FROM address_queues
       WHERE ${streetRegions.clause} AND settlement_normalized = ? AND street_normalized <> '' AND street_normalized LIKE ?
         AND source NOT IN ('community', 'mirror')
       LIMIT ${STREETS_ROW_LIMIT}`,
    ).bind(...streetRegions.bindings, settlementNormalized, `%${needle}%`)
      .all<{ name: string; normalized: string }>();

    const streets: Array<{ name: string; normalized: string; source: PlaceSource }> = [
      ...(bound.results ?? []).map((row) => ({ name: row.name, normalized: row.normalized, source: 'address_queues' as const })),
      ...(known.results ?? []).map((row) => ({
        name: row.name,
        normalized: row.normalized,
        source: (row.source === 'osm' ? 'osm' : 'curated') as PlaceSource,
      })),
    ];

    let places: Array<{ name: string; normalized: string; source: PlaceSource }> = dedupePlaces(streets);

    // Если на всё село известна одна очередь — отдаём её, чтобы мастер сразу показал ответ.
    // `source = 'mirror'` исключаем: это перечень групп населённого пункта, а не привязка адреса.
    const whole = await env.DB.prepare(
      `SELECT DISTINCT queue FROM address_queues
       WHERE ${streetRegions.clause} AND settlement_normalized = ? AND street_normalized = ''
         AND source NOT IN ('mirror', 'community')
       LIMIT 100`,
    ).bind(...streetRegions.bindings, settlementNormalized).all<{ queue: string }>();
    const queues = [...new Set((whole.results ?? []).map((row) => normalizeQueue(row.queue)))];
    // Новый компактный справочник хранит вывод «одна группа на весь НП» отдельно: если улицы
    // ещё не импортированы в address_queues, подсказка всё равно должна появиться.
    const settlementDirectory = await env.DB.prepare(
      `SELECT default_queue FROM directory_settlements
       WHERE ${streetRegions.clause} AND normalized = ? LIMIT 1`,
    )
      .bind(...streetRegions.bindings, settlementNormalized)
      .first<{ default_queue: string | null }>();
    const directoryQueue = settlementDirectory?.default_queue
      ? normalizeQueue(settlementDirectory.default_queue)
      : null;
    const wholeSettlementQueue = queues.length === 1
      ? queues[0]!
      : directoryQueue && isQueueCode(directoryQueue)
        ? directoryQueue
        : null;

    return json({
      // Ограничение обязательно: при пустом запросе SQL возвращает все улицы НП, а панель
      // чипов рассчитана на два десятка. Без slice ответ раздувался бы до тысяч строк.
      data: places.slice(0, limit),
      wholeSettlementQueue,
      region,
    });
  }

  if (path === '/addresses/houses') {
    // Дома выбранной улицы вместе с их группами. Это отдельный запрос, а не часть resolve:
    // человек выбирает улицу ещё до дома, и список нужен для чипов «12 → 2/2», а не для ответа.
    const settlementInput = (url.searchParams.get('settlement') ?? '').trim();
    const street = (url.searchParams.get('street') ?? '').trim();
    if (settlementInput.length < 2 || street.length < 2) {
      return json({ data: [], wholeStreetQueue: null });
    }
    const filter = regionIn(readRegions.length > 0 ? readRegions : ['']);
    if (filter.clause === '') return json({ data: [], wholeStreetQueue: null });

    const settlement = await canonicalDirectorySettlement(env, readRegions, settlementInput);
    const settlementNormalized = normalizeAddress(settlement);
    const streetNormalized = normalizeAddress(street);
    // Ключи — ровно те, по которым ищет индекс address_queues (region + settlement + street).
    // Результат живёт 10 минут: справочник меняется импортом, а не каждым нажатием чипа.
    const cacheKey = `address-houses:${filter.clause}:${filter.bindings.join(',')}:${settlementNormalized}:${streetNormalized}`;
    const result = await cached(cacheKey, async () => {
      // Компактный справочник ОСР хранит все дома улицы одной строкой. Он основной источник
      // чипов: именно эти данные приходят из живого графика, а `directory_houses` — старый импорт.
      const streetDirectory = await loadDirectoryStreet(env, filter, settlementNormalized, streetNormalized);
      const streetHouses = housesFromJson(streetDirectory?.houses_json);
      // Раньше сюда же подмешивался SELECT из `directory_houses`. Таблица намеренно пуста:
      // все дома живут в `houses_json` улицы, и запрос к пустой таблице на каждом открытии
      // списка домов только съедал rows_read на Free Tier. Убрано осознанно.
      const knownHouseNumbers = new Set(streetHouses.map((row) => row.housePattern));
      const legacyRows = await env.DB.prepare(
        `SELECT house_pattern, queue FROM address_queues
         WHERE ${filter.clause} AND settlement_normalized = ? AND street_normalized = ?
         ORDER BY house_pattern
         LIMIT 200`,
      )
        .bind(...filter.bindings, settlementNormalized, streetNormalized)
        .all<{ house_pattern: string; queue: string }>();

      const entries = [
        ...streetHouses.map((row) => ({ ...row, source: 'directory' })),
        ...(legacyRows.results ?? [])
          .filter((row) => !knownHouseNumbers.has(row.house_pattern))
          .map((row) => ({ housePattern: row.house_pattern, queue: row.queue, source: 'legacy' })),
      ];
      const wholeQueue = streetDirectory?.default_queue
        ? normalizeQueue(streetDirectory.default_queue)
        : null;
      const whole = entries.find((row) => (row.housePattern === '*' || row.housePattern === '') && row.queue);
      const houses = dedupeQueues(
        entries
          .filter((row) => row.housePattern !== '*' && row.housePattern !== '')
          .map((row) => ({ housePattern: row.housePattern, queue: row.queue ? normalizeQueue(row.queue) : '' })),
      );

      return {
        data: houses,
        wholeStreetQueue: wholeQueue && isQueueCode(wholeQueue)
          ? wholeQueue
          : whole?.queue
            ? normalizeQueue(whole.queue)
            : null,
      };
    }, AGGREGATE_CACHE_TTL_MS);

    return json(result);
  }

  if (path === '/addresses/resolve') {
    const settlementInput = (url.searchParams.get('settlement') ?? '').trim();
    if (settlementInput.length < 2) {
      return json({ error: { code: 'VALIDATION_ERROR', message: 'settlement обовʼязковий' } }, 400);
    }
    const settlement = await canonicalDirectorySettlement(env, readRegions, settlementInput);
    const street = (url.searchParams.get('street') ?? '').trim();
    const house = (url.searchParams.get('house') ?? '').trim();

    const resolved = await resolveAddress(env, { regions: readRegions, settlement, street, house });

    // Народный кворум. Голоса читаем только когда официальной привязки нет: справочник ОСР
    // сильнее любого числа кликов, и голосование не должно «переголосовать» выгрузку оператора.
    const officialBinding = Boolean(resolved.queue) && resolved.source !== 'community';
    const houseNormalized = house ? normalizeHouseNumber(house) : '';
    const streetNormalized = normalizeAddress(street);
    let tally: AddressVoteTally | null = null;
    if (!officialBinding && streetNormalized && houseNormalized) {
      const votes = await readAddressVotes(env, {
        region,
        settlementNorm: normalizeAddress(settlement),
        streetNorm: streetNormalized,
        houseNorm: houseNormalized,
      });
      if (votes.totalVotes > 0) tally = votes;
    }

    const communityQueue = !officialBinding && tally ? tally.leaderQueue : null;
    const queue = communityQueue ?? resolved.queue;
    if (!queue) {
      return json({
        data: {
          queue: null,
          options: resolved.options,
          reason: 'not-found',
          source: null,
          confidence: null,
          votesCount: 0,
          schedule: null,
        },
      });
    }

    // Расписание найденной группы на сегодня отдаём сразу: человек узнал номер группы и
    // заодно видит, есть ли сейчас свет, не делая второй запрос.
    const [rows, coverage] = await Promise.all([
      loadSlots(env, readRegions, today),
      coverageOfDay(env, readRegions, today),
    ]);
    const intervals = toIntervals(rows, queue, today);
    // Покрытие читаем и здесь: иначе мастер поиска писал «графіку на сьогодні немає» про группу,
    // у которой график опубликован, а отключений в нём нет (та же разница, что в `/schedules`).
    const queueCovered = coverage.queues.has(queue) || coverage.queues.has(ALL_CLEAR_QUEUE);
    const covered = queueCovered || intervals.length > 0;
    const offByFeed = coverage.offQueues.has(queue);
    // Источник — у самих слотов: жёсткий 'mirror' выдавал данные Telegram за данные зеркала.
    const slotSource = rows.find((row) => row.source)?.source ?? null;
    // `community_verified` — только реальный кворум. Один-два голоса остаются
    // `community_pending`, чтобы случайный клик соседа не выглядел проверенным фактом.
    const confidence = communityQueue
      ? tally!.verified
        ? 'community_verified'
        : 'community_pending'
      : resolved.source === 'community'
        ? 'community_verified'
        : 'official';
    return json({
      data: {
        queue,
        options: resolved.options,
        reason: communityQueue
          ? tally!.verified
            ? 'community-verified'
            : 'community-pending'
          : resolved.reason,
        source: communityQueue ? 'community' : resolved.source,
        confidence,
        votesCount: communityQueue ? tally!.leaderVotes : 0,
        schedule: {
          queue,
          date: today,
          intervals,
          source: intervals.length > 0 ? slotSource : queueCovered ? ([...coverage.sources][0] ?? null) : null,
          lastImportedAt: await lastImportedAt(env),
          covered,
          allClear: covered && intervals.length === 0 && !offByFeed,
        },
      },
    });
  }

  // Старый маршрут ведёт в тот же кворум: раньше он делал `INSERT OR REPLACE` поверх
  // официальных привязок, и один запрос мог молча переписать справочник оператора.

  // Остальные разделы зеркало не отдаёт, и выдумывать их нельзя. Честная пустая выдача:
  // фронтенд на ней показывает свой EmptyState, а не рисует вымышленные отключения.
  if (path === '/outages') {
    // `region=all` и запрос без области — список по стране; иначе читаем все ключи области: каждое
    // событие несёт свой `regionCpu`, поэтому события двух сетей м. Дніпро не путаются между собой.
    const outageFilter = !region || region === 'all' ? regionIn([]) : regionIn(dbRegions);
    const rows = await env.DB.prepare(
      `SELECT external_id, region, starts_at, ends_at, area_name, addresses_raw, reason, kind, source_url
       FROM outage_events WHERE ${outageFilter.clause || '1=1'} AND ends_at >= ? ORDER BY starts_at DESC LIMIT 300`,
    )
      .bind(...outageFilter.bindings, new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .all<Record<string, string>>();
    const data = (rows.results ?? []).map((row) => ({
      id: row['external_id']!,
      startsAt: row['starts_at']!,
      endsAt: row['ends_at']!,
      areaName: row['area_name']!,
      addressesRaw: row['addresses_raw']!,
      // Нормализованный адрес считается на бэкенде; здесь отдаём исходный, нормализованный
      // человек всё равно получит при следующем сохранении через адресный мастер.
      addressesNormalized: row['addresses_raw']!,
      streets: [],
      kind: row['kind'] === 'emergency' ? ('repair' as const) : (row['kind'] as 'repair' | 'gpv'),
      // Статус не хранится колонкой: он выводится из времени. Раньше поле просто не
      // отдавалось, и фронтенд собирал ключ `outages.${status}` из `undefined` — в интерфейсе
      // это выглядело как «outages.undefined».
      status: outageStatus(row['starts_at']!, row['ends_at']!),
      reason: row['reason'] ?? null,
      queue: null,
      regionCpu: row['region']!,
      sourceUrl: row['source_url'] ?? null,
    }));
    // Мета пагинации повторяет эталон: page/limit/total/totalPages. Поля count здесь нет —
    // фронтенд его не читает, а лишнее поле сбивало бы с толку при сверке контрактов.
    const limit = Math.min(300, Math.max(1, Number(url.searchParams.get('limit') ?? 50) || 50));
    const page = Math.max(1, Number(url.searchParams.get('page') ?? 1) || 1);
    return json({
      data,
      meta: { page, limit, total: data.length, totalPages: Math.max(1, Math.ceil(data.length / limit)) },
    });
  }

  if (path === '/outages/stats') {
    const sinceMonth = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const active = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM outage_events WHERE starts_at <= ? AND ends_at >= ?`,
    ).bind(new Date().toISOString(), new Date().toISOString()).first<{ n: number }>();
    const scheduled = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM outage_events WHERE starts_at > ?`,
    ).bind(new Date().toISOString()).first<{ n: number }>();
    // Разбивки считаем по тем отключениям, что мы реально собрали. Массивы обязаны
    // существовать всегда: компонент тепловой карты делает по ним .map(), и на пустом
    // ответе без них был бы white screen.
    const events = await env.DB.prepare(
      region
        ? `SELECT starts_at, ends_at, area_name FROM outage_events WHERE region = ? AND starts_at >= ?`
        : `SELECT starts_at, ends_at, area_name FROM outage_events WHERE starts_at >= ?`,
    ).bind(...(region ? [region, sinceMonth] : [sinceMonth])).all<{ starts_at: string; ends_at: string; area_name: string }>();

    const byHour = new Map<number, { count: number; minutes: number }>();
    const byDay = new Map<string, { count: number; minutes: number }>();
    const byArea = new Map<string, { count: number; minutes: number }>();
    const heatmap = new Map<number, number>();

    for (const event of events.results ?? []) {
      const startsAt = Date.parse(event.starts_at);
      const endsAt = Date.parse(event.ends_at);
      if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= startsAt) continue;
      const minutes = Math.round((endsAt - startsAt) / 60_000);
      const hour = new Date(startsAt).getUTCHours();
      const day = event.starts_at.slice(0, 10);
      const area = event.area_name || 'Невідомо';
      // День недели и час идут по UTC — в тепловой карте важна относительная картина,
      // а киевский сдвиг в ней всё равно не читается.
      const dayOfWeek = new Date(startsAt).getUTCDay();

      byHour.set(hour, addBucket(byHour.get(hour), minutes));
      byDay.set(day, addBucket(byDay.get(day), minutes));
      byArea.set(area, addBucket(byArea.get(area), minutes));
      const cell = dayOfWeek * 24 + hour;
      heatmap.set(cell, (heatmap.get(cell) ?? 0) + 1);
    }

    return json({
      data: {
        totalActive: active?.n ?? 0,
        totalScheduled: scheduled?.n ?? 0,
        byHour: [...byHour.entries()].map(([hour, value]) => ({ hour, ...value })).sort((a, b) => a.hour - b.hour),
        byDay: [...byDay.entries()].map(([date, value]) => ({ date, ...value })).sort((a, b) => a.date.localeCompare(b.date)),
        byArea: [...byArea.entries()].map(([areaName, value]) => ({ areaName, ...value })).sort((a, b) => a.areaName.localeCompare(b.areaName)),
        heatmap: [...heatmap.entries()].map(([cell, count]) => ({
          dayOfWeek: Math.floor(cell / 24), hour: cell % 24, count,
        })),
      },
    });
  }

  if (path === '/incidents') {
    // Аварийные перерывы (тип 2) показываем отдельным списком: у них есть место и причина,
    // и без них страница «Аварии» была бы пустой.
    const rows = await env.DB.prepare(
      `SELECT external_id, area_name, starts_at, ends_at, reason FROM outage_events
       WHERE kind = 'emergency' AND ends_at >= ? ORDER BY starts_at DESC LIMIT 100`,
    ).bind(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()).all<Record<string, string>>();
    // Имена полей — по контракту Incident из @svitlo/shared. Здесь было `startsAt` вместо
    // `startedAt`, и страница инцидентов падала с «Invalid time value»: она читала
    // incident.startedAt, получала undefined, а new Date(undefined) в date-fns бросает.
    // Не хватало также description и severity — они обязательны в типе.
    const data = (rows.results ?? []).map((row) => ({
      id: row['external_id']!,
      title: row['reason'] ?? 'Аварійна перерва',
      description: row['reason'] ?? '',
      startedAt: row['starts_at']!,
      etaAt: row['ends_at'] ?? null,
      severity: 'warning',
      status: 'open',
      kind: 'outage',
      areaName: row['area_name'] ?? null,
    }));
    return json({ data });
  }
  if (path === '/reliability') {
    // Контракт ReliabilityReport: from/to/days/weeks/months/groups + необязательные
    // byRegionSummary и queue. Раньше воркер отдавал несуществующие byBucket/totalGroups и не
    // отдавал обязательные поля, которые читает страница «Надёжность».
    //
    // Считаем честно по собранным данным: нет слотов — окно с hasData:false, это «нет данных»,
    // а не «100% надёжности». Будущие сутки (кроме завтрашнего прогноза) не отдаём вовсе —
    // день, о котором ещё ничего не известно, выглядел на графике как провал.
    const now = new Date();
    const to = today;
    const fromDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const from = fromDate.toISOString().slice(0, 10);

    // `?queue=2/2` — цифры конкретной группы. Без параметра отчёт остаётся средним по группам.
    const queueParam = (url.searchParams.get('queue') ?? '').trim();
    const queueCode = queueParam ? normalizeQueue(queueParam) : null;
    if (queueCode && !isQueueCode(queueCode)) {
      return json({ error: { code: 'VALIDATION_ERROR', message: 'queue має бути кодом черги, напр. 2/2' } }, 400);
    }

    // Отчёт строится по десяткам окон (дни месяца + недели + месяц + сводки) и меняется от крона к
    // крону, а не от запроса к запросу. Без кэша каждый заход на «Надійність» занимал больше 10 мс
    // CPU и получал от Cloudflare `503 error 1102`, хотя данные те же.
    //
    // `?timing=1` — диагностика: печатает в `wrangler tail`, из чего сложился CPU отчёта, и
    // считает отчёт заново (отдельный ключ кэша), иначе замер попал бы на готовый ответ.
    const timer = stepTimer(url.searchParams.get('timing') === '1');
    const reportCacheKey = `reliability:${readRegions.join(',')}:${today}:${queueCode ?? ''}${timer.enabled ? ':timing' : ''}`;
    const cachedReport = memoryCache.get(reportCacheKey);
    if (cachedReport && cachedReport.expiresAt > Date.now()) return json({ data: cachedReport.payload });

    const monthStart = `${from}T00:00:00.000Z`;
    const monthEnd = `${to}T23:59:59.999Z`;

    // Считаем по слотам графика, а не отдаём пустые оболочки. Раньше бакеты дней/недель/
    // месяцев были заглушками с hasData:false, и «Статистика електропостачання» выглядела
    // обнулённой, хотя графики в базе есть и считать их умеем.
    //
    // Все окна отчёта считаются из ОДНОГО чтения слотов (`loadReliabilityIndex`): день, неделя и
    // месяц — это наборы целых дат внутри месяца, а сводка по областям берёт те же строки без
    // фильтра области. Раньше каждое окно ходило в D1 само (около 40 запросов на заход) — это
    // и был весь CPU отчёта.
    const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
    const tomorrow = addDays(today, 1);
    const loadPhaseAt = timer.now();
    const index = await loadReliabilityIndex(env, from, tomorrow);
    timer.mark('load', loadPhaseAt);
    const regionSet = new Set(readRegions);
    /** Окно отчёта по уже прочитанным слотам: даты окна берём в UTC, как в запросе к D1. */
    const window = (
      key: string,
      label: string,
      startIso: string,
      endIso: string,
      windowMinutes: number,
    ): ReliabilityWindow => {
      const fromMs = Date.parse(startIso);
      const toMs = Date.parse(endIso);
      return {
        key,
        label,
        start: startIso,
        end: endIso,
        ...reliabilityTotals(
          index,
          regionSet,
          queueCode,
          isoDate(fromMs),
          isoDate(toMs),
          fromMs,
          toMs,
          windowMinutes,
        ),
      };
    };

    // Дни берём только по сегодня включительно, плюс завтра — оператор уже публикует график на
    // завтра, и без него «Надійність» отставала бы от расписания на сутки.
    const daySpecs = Array.from({ length: daysInMonth }, (_, index) => {
      const day = index + 1;
      const iso = `${from.slice(0, 8)}${String(day).padStart(2, '0')}`;
      return { iso, label: labelDayIso(iso) };
    }).filter(({ iso }) => iso <= tomorrow);
    // Сегодняшние сутки ещё не прожиты: окно дня обрезаем по «сейчас», как Node-отчёт. Считать
    // по ним 24 часа значило бы держать в знаменателе время, о котором мы ничего не знаем.
    const nowMs = Date.now();
    const kyivMidnight = localSlotToUtc(today, '00:00', false);
    const elapsedTodayMinutes = Math.max(1, Math.round((nowMs - Date.parse(kyivMidnight)) / 60_000));
    const daysPhaseAt = timer.now();
    const dayTotals = daySpecs.map(({ iso, label }) => {
      const isToday = iso === today;
      return {
        iso,
        bucket: window(
          `day:${iso}`,
          label,
          isToday ? kyivMidnight : `${iso}T00:00:00.000Z`,
          isToday ? new Date(nowMs).toISOString() : `${iso}T23:59:59.999Z`,
          isToday ? elapsedTodayMinutes : 24 * 60,
        ),
      };
    });
    const dayWindows: ReliabilityWindow[] = dayTotals
      // Завтрашний день показываем только если на него уже есть график: пустой прогноз — это
      // снова «день без света», только подписанный будущим числом.
      .filter(({ iso, bucket }) => iso <= today || bucket.hasData)
      .map(({ iso, bucket }) => (iso > today ? { ...bucket, isForecast: true } : bucket));
    timer.mark('days', daysPhaseAt);

    // Недели режем по календарным понедельникам, как в Node-отчёте: окно недели — от её
    // понедельника до воскресенья, но не дальше `tomorrow` (дальше графика ещё нет), поэтому
    // знаменатель недели зависит от того, сколько её суток уже покрыто.
    // Если понедельника в отчётном периоде ещё не было (месяц начался во вторник или позже),
    // отдаём одну неделю-остаток от начала месяца: пустой раздел «Тижні» при наличии данных
    // выглядел бы как поломка.
    const weeksPhaseAt = timer.now();
    const weekWindows: ReliabilityWindow[] = [];
    for (let day = 1; day <= daysInMonth; day += 1) {
      const iso = `${from.slice(0, 8)}${String(day).padStart(2, '0')}`;
      if (new Date(`${iso}T00:00:00Z`).getUTCDay() !== 1) continue;
      if (iso > tomorrow) break;
      const sunday = addDays(iso, 6);
      const spanEnd = sunday < tomorrow ? sunday : tomorrow;
      weekWindows.push(
        window(
          `week:${iso}`,
          `${labelDayIso(iso)} – ${labelDayIso(spanEnd)}`,
          `${iso}T00:00:00.000Z`,
          `${spanEnd}T23:59:59.999Z`,
          (daysBetweenIso(iso, spanEnd) + 1) * 24 * 60,
        ),
      );
    }
    if (weekWindows.length === 0) {
      weekWindows.push(
        window(
          `week:${from}`,
          `${labelDayIso(from)} – ${labelDayIso(tomorrow)}`,
          monthStart,
          `${tomorrow}T23:59:59.999Z`,
          (daysBetweenIso(from, tomorrow) + 1) * 24 * 60,
        ),
      );
    }
    timer.mark('weeks', weeksPhaseAt);

    // Сводка по одной группе: те же правила и то же окно, что у месячного бакета, но по её слотам.
    const queuePhaseAt = timer.now();
    const queueSummary = queueCode
      ? (() => {
          const totals = reliabilityTotals(
            index,
            regionSet,
            queueCode,
            from,
            today,
            Date.parse(monthStart),
            Date.parse(monthEnd),
            daysInMonth * 24 * 60,
          );
          return {
            queue: queueCode,
            windowMinutes: totals.windowMinutes,
            outageMinutes: totals.outageMinutes,
            poweredMinutes: totals.poweredMinutes,
            reliabilityPct: totals.reliabilityPct,
            hasData: totals.hasData,
          };
        })()
      : null;
    timer.mark('queue', queuePhaseAt);
    const monthPhaseAt = timer.now();
    const monthWindows = [
      window(`month:${to.slice(0, 7)}`, labelMonthIso(from), monthStart, monthEnd, daysInMonth * 24 * 60),
    ];
    timer.mark('month', monthPhaseAt);
    const groupsPhaseAt = timer.now();
    // По группам — тот же расчёт по фактически прошедшим суткам (без завтрашнего прогноза:
    // у этой сводки нет пометки «прогноз», и подмешивать в неё будущее значило бы выдавать
    // ещё не наступившее за факт). Знаменатель — дни, за которые график есть,
    // см. reliabilityByQueue.
    const groupWindows = reliabilityByQueue(index, regionSet, from, today, daysInMonth * 24 * 60);
    timer.mark('groups', groupsPhaseAt);
    const regionPhaseAt = timer.now();
    // Сводка по областям: сравнение «як у мене і як поруч». Регион берём из слота, поэтому
    // она не зависит от параметра `region`.
    const regionSummary = reliabilityByRegion(
      index,
      from,
      today,
      daysInMonth * 24 * 60,
      await loadMirrorRegionNames(env),
    );
    timer.mark('byRegion', regionPhaseAt);

    const report = {
      from,
      to,
      generatedAt: new Date().toISOString(),
      days: dayWindows,
      weeks: weekWindows,
      // Подпись месяца — по дате начала отчёта. Передаём именно дату (`from`), а не
      // `monthStart` с уже приклеенным временем: `labelMonthIso` сам добавляет `T00:00:00.000Z`,
      // и на строке с двумя временами `new Date(...)` даёт Invalid Date, то есть 500
      // «Invalid time value» на всём маршруте `/reliability`.
      months: monthWindows,
      groups: groupWindows,
      byRegionSummary: regionSummary,
      queue: queueSummary,
    };
    remember(reportCacheKey, report);
    timer.done('/reliability');
    return json({ data: report }, 200, { 'cache-control': 'public, max-age=60' });
  }

  if (path === '/street-queues') return json({ data: [] });

  // График по улице. Привязки улиц к чергам зеркало не ведёт (это выверенный справочник
  // бэкенда), поэтому отвечаем тем же контрактом, что Node для непривязанного адреса:
  // «вулиця не прив'язана». 404 здесь выглядел бы как поломка приложения.
  if (path === '/street-queues/schedule') {
    const street = (url.searchParams.get('street') ?? '').trim();
    if (street.length < 2) {
      return json({ error: { code: 'VALIDATION_ERROR', message: 'street обовʼязковий (мінімум 2 символи)' } }, 400);
    }
    const date = (url.searchParams.get('date') ?? today).trim();
    return json({
      data: {
        street,
        streetNormalized: normalizeAddress(street),
        queue: null,
        date,
        intervals: [],
        source: null,
        lastImportedAt: null,
        region,
      },
    });
  }

  // Особовий рахунок: довідник ведёт только эталонный бэкенд (данные выверены вручную, это
  // персональные данные абонентов). Отвечаем тем же кодом, что и он: приложение показывает
  // человеческое «номера немає в довіднику», а не техническое «Немає маршруту».
  if (path.startsWith('/places/')) {
    const account = decodeURIComponent(path.slice('/places/'.length));
    if (!/^\d{9,12}$/u.test(account)) {
      return json({ error: { code: 'VALIDATION_ERROR', message: 'Особовий рахунок — 9–12 цифр' } }, 400);
    }
    return json(
      { error: { code: 'PLACE_NOT_FOUND', message: 'Цього особового рахунку немає в довіднику' } },
      404,
    );
  }

  if (path === '/addresses/suggest') {
    // Раньше здесь был пустой массив, и адресный поиск в облаке не предлагал ничего.
    // Теперь ищем по тому же, что уже есть в D1: справочник улиц и привязки к очередям.
    const query = (url.searchParams.get('q') ?? '').trim();
    const needle = normalizeAddress(query);
    const limit = Math.min(20, Math.max(1, Number(url.searchParams.get('limit') ?? 8) || 8));
    if (needle.length < 2) return json({ data: [] });

    // Названия колонок у таблиц РАЗНЫЕ, и это уже стоило 500-й ошибки: в address_queues
    // улица лежит в street_name/street_normalized, а в directory_streets — в name/normalized,
    // где ещё и нет колонки с названием села. Поэтому UNION собираем через подзапросы,
    // приводящие обе таблицы к общему виду.
    // Без области фильтровать не по чему, и жёсткое `region = ''` возвращало пустоту:
    // адресная строка в мастере работает ДО выбора области. Поэтому фильтр по области
    // добавляется только тогда, когда область действительно задана (иначе ключей нет и условия нет).
    const queueRegion = regionIn(readRegions);
    const streetRegion = regionIn(readRegions, 'ds.region');
    const whereRegion = queueRegion.clause ? `AND ${queueRegion.clause}` : '';
    const whereStreetRegion = streetRegion.clause ? `AND ${streetRegion.clause}` : '';
    // Порядок биндингов обязан совпадать с порядком плейсхолдеров В SQL, а он здесь
    // «LIKE, потом region», а не наоборот. Раньше область подставлялась первым, и при
    // заданном регионе запрос молча возвращал пустоту.
    const bindings: string[] = [
      `%${needle}%`,
      ...queueRegion.bindings,
      `%${needle}%`,
      ...streetRegion.bindings,
      String(limit),
    ];

    const rows = await env.DB.prepare(
      `SELECT name, settlement, normalized FROM (
         SELECT street_name AS name, settlement_name AS settlement, street_normalized AS normalized
         FROM address_queues
         WHERE street_normalized LIKE ? AND street_normalized <> '' ${whereRegion}
       )
       UNION
       SELECT name, settlement, normalized FROM (
         SELECT ds.name AS name, '' AS settlement, ds.normalized AS normalized
         FROM directory_streets ds
         WHERE ds.normalized LIKE ? ${whereStreetRegion}
       )
       LIMIT ?`,
    ).bind(...bindings)
      .all<{ name: string; settlement: string; normalized: string }>();

    const seen = new Set<string>();
    const data = (rows.results ?? [])
      .filter((row) => {
        if (seen.has(row.normalized)) return false;
        seen.add(row.normalized);
        return true;
      })
      .map((row) => ({ name: row.name, normalized: row.normalized, settlement: row.settlement }));

    return json({ data });
  }
  if (path === '/status') {
    // Расчёт вынесен в `buildStatusPayload`: тем же телом гідратується офлайн-пакет `/sync`.
    const timer = stepTimer(url.searchParams.get('timing') === '1');
    const started = timer.now();
    const status = timer.enabled
      ? await timer.measure('status', buildStatusPayloadUncached(env, readRegions, today))
      : await buildStatusPayload(env, readRegions, today);
    timer.mark('all', started);
    timer.done('/status');
    return json(
      {
        data: {
          ...status,
          d1QuotaExceeded: d1QuotaExceededAt !== null,
          d1UnavailableAt,
        },
      },
      200,
      { 'cache-control': 'public, max-age=120' },
    );
  }

  if (path === '/sync') {
    // Один пакет для офлайн-старту застосунку: стан мережі + каталог областей + графік на сьогодні
    // й завтра + останні новини. Контракт той самий, що у Node-бекенда (`/api/v1/sync`), тому
    // фронтенд не знає й не має знати, з ким саме він розмовляє.
    //
    // Сборка пакета — самый тяжёлый путь воркера (десятки запросов к D1: статус, каталог, слоты,
    // список групп с улицами, справочник НП, новости). В пределах минуты он не меняется, поэтому
    // готовое тело и ETag держим в кэше изолята: иначе первый же `/sync` на холодном изоляте
    // вылетал по CPU (`503`, `error 1102`), и приложение оставалось без офлайн-пакета.
    const days = Math.min(7, Math.max(1, Number(url.searchParams.get('days') ?? 2) || 2));
    // `?timing=1` — диагностика: считаем пакет заново (кэш обходим) и печатаем разбивку по шагам
    // в `wrangler tail`. Обычный запрос этой ветки не касается и платит только за `cached()`.
    const timer = stepTimer(url.searchParams.get('timing') === '1');
    const syncCacheKey = `sync:${requestedRegion}|${canonicalRegion}|${readRegions.join(',')}|${days}|${today}`;
    const bundle = timer.enabled
      ? await syncBundle(env, { requestedRegion, canonicalRegion, dbRegions, readRegions, today, days, timer })
      : await cached(syncCacheKey, () => syncBundle(env, { requestedRegion, canonicalRegion, dbRegions, readRegions, today, days }));
    timer.done('/sync');
    const headers = { 'cache-control': 'public, max-age=120', etag: bundle.etag };
    if (etagMatches(request.headers.get('if-none-match'), bundle.etag)) return notModified(headers);
    // Конверт `{ data }` — как у Node-бекенда и как у остальных маршрутов: офлайн-шар клиента
    // не должен иметь отдельного случая для одного эндпоинта.
    return json({ data: { syncedAt: new Date().toISOString(), etag: bundle.etag, ...bundle.body } }, 200, headers);
  }
  return json({ error: { code: 'NOT_FOUND', message: `Немає маршруту ${path}` } }, 404);
}

/** Возвращает копию ответа с пометкой источника кэша — по ней удобно проверять curl'ом. */
function markCachedResponse(response: Response, kind: 'memory' | 'edge'): Response {
  const headers = new Headers(response.headers);
  headers.set('x-svitlo-cache', kind);
  return new Response(response.body, { status: response.status, headers });
}

/** Отдаёт APK-релиз из R2 с поддержкой Range (докачка/менеджер загрузок Android). */
async function serveApk(request: Request, env: Env, fileName: string): Promise<Response> {
  const bucket = env.APK_BUCKET;
  if (!bucket) {
    return json({ error: { code: 'APK_UNAVAILABLE', message: 'APK-хранилище не налаштоване' } }, 503, {
      'cache-control': 'no-store',
    });
  }

  const rangeHeader = request.headers.get('range');
  const object = await bucket.get(fileName, rangeHeader ? { range: request.headers } : undefined);
  if (!object) {
    return json({ error: { code: 'APK_NOT_FOUND', message: 'Файл не знайдено' } }, 404, {
      'cache-control': 'no-store',
    });
  }

  const headers = new Headers({
    'content-type': 'application/vnd.android.package-archive',
    'content-disposition': `attachment; filename="${fileName}"`,
    'cache-control': 'public, max-age=300',
    'access-control-allow-origin': '*',
    'accept-ranges': 'bytes',
    etag: object.httpEtag,
  });
  // R2 может вернуть `range` даже на обычный GET; 206 отдаём только если клиент просил Range.
  const range = rangeHeader ? object.range : undefined;
  const rangeStart = range && 'offset' in range ? range.offset : undefined;
  const rangeLength = range && 'length' in range ? range.length : undefined;
  const partial =
    typeof rangeStart === 'number' &&
    typeof rangeLength === 'number' &&
    rangeStart === 0 &&
    rangeLength < object.size;
  if (partial) {
    headers.set('content-length', String(rangeLength));
    headers.set('content-range', `bytes ${rangeStart}-${rangeStart + rangeLength - 1}/${object.size}`);
  } else if (object.size != null) {
    headers.set('content-length', String(object.size));
  }

  const status = partial ? 206 : 200;
  if (request.method === 'HEAD') return new Response(null, { status, headers });
  return new Response(object.body, { status, headers });
}

export default {
  async fetch(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight: браузер спрашивает это до любого запроса с другого домена.
    if (request.method === 'OPTIONS') {
      // Разрешаем ровно те заголовки, о которых спрашивает клиент: список приходится повторять,
      // иначе preflight отклоняется целиком (см. ALLOWED_HEADERS).
      const requested = request.headers.get('access-control-request-headers');
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET, POST, OPTIONS',
          'access-control-allow-headers':
            requested && requested.trim().length > 0 ? requested : ALLOWED_HEADERS,
          'access-control-max-age': '86400',
        },
      });
    }

    // APK из R2: Cloudflare Pages не принимает файлы больше 25 MiB, а release-APK React Native
    // весит ~100 MiB. Отдаём его потоком через Worker, с Range и CORS — WebView скачивает
    // так же, как обычный файл по ссылке.
    if (request.method === 'GET' || request.method === 'HEAD') {
      const apkMatch = /^\/(?:download\/)?(svitlo-[\w.-]+\.apk)$/u.exec(url.pathname);
      if (apkMatch) return serveApk(request, env, apkMatch[1]!);
    }

    const path = url.pathname.replace(/^\/api\/v1/u, '').replace(/\/+$/u, '') || '/';
    const cacheable = isCacheableApiRequest(request, url);
    const cacheKey = httpCacheKey(url);

    // Уровень 1: память изолята. Повторное открытие приложения не должно коснуться D1 вообще.
    if (cacheable) {
      const memoryHit = await readHttpMemoryCache(cacheKey);
      if (memoryHit) return markCachedResponse(memoryHit, 'memory');

      // Уровень 2: Cache API. Он живёт в конкретном дата-центре, но переживает перезапуск
      // изолята и обслуживает других людей рядом без единого `rows_read`.
      try {
        if (typeof caches !== 'undefined' && caches.default) {
          const edgeHit = await caches.default.match(new Request(cacheKey, { method: 'GET' }));
          if (edgeHit) {
            const body = await edgeHit.clone().text();
            rememberHttpResponse(cacheKey, edgeHit, body);
            return markCachedResponse(edgeHit, 'edge');
          }
        }
      } catch {
        // Cache API недоступен (локальный miniflare, ограничение аккаунта) — это не ошибка:
        // просто идём в D1/зеркало.
      }
    }

    try {
      let response: Response;
      try {
        response = await handleApi(request, env, url);
      } catch (error) {
        // D1 исчерпал дневной лимит — не отдаём 500, а собираем ответ из живого зеркала.
        if (isD1Unavailable(error)) {
          d1UnavailableAt = new Date().toISOString();
          // Дневной лимит — отдельная отметка: только она объясняет человеку, почему график
          // не обновляется, хотя связь есть (см. `isD1QuotaError`).
          if (isD1QuotaError(error)) d1QuotaExceededAt = d1UnavailableAt;
          const fallback = await mirrorFallbackResponse(path, url, env);
          if (fallback) {
            console.warn(`handleApi ${url.pathname}: D1 недоступен, ответ собран из зеркала`);
            response = fallback;
          } else {
            throw error;
          }
        } else {
          throw error;
        }
      }

      if (!cacheable || response.status !== 200) return response;

      // Готовое тело кладём в оба уровня. `cache-control` добавляем, если маршрут его не задал:
      // Cloudflare Cache API иначе может отказаться сохранять ответ.
      const headers = new Headers(response.headers);
      if (!headers.has('cache-control')) headers.set('cache-control', 'public, max-age=120');
      const body = await response.clone().text();
      const cacheResponse = new Response(body, { status: response.status, headers });
      rememberHttpResponse(cacheKey, cacheResponse, body);

      if (typeof caches !== 'undefined' && caches.default) {
        const edgeWrite = caches.default
          .put(new Request(cacheKey, { method: 'GET' }), cacheResponse.clone())
          .catch(() => undefined);
        if (ctx) ctx.waitUntil(edgeWrite);
      }
      return cacheResponse;
    } catch (error) {
      // Отвечаем 500 с внятным телом, но без стектрейса наружу: он бесполезен пользователю
      // и может засветить внутренние детали воркера. Стек при этом ОБЯЗАН остаться в логах
      // (`wrangler tail`): без него 500 на живом воркере не разобрать — тело ответа говорит
      // только «Invalid time value» и не называет ни строки, ни ветки расчёта.
      const message = error instanceof Error ? error.message : 'unknown';
      console.error(`handleApi ${url.pathname}: ${message}`, error instanceof Error ? error.stack : String(error));
      return json({ error: { code: 'INTERNAL_ERROR', message } }, 500);
    }
  },

  scheduled,
};

