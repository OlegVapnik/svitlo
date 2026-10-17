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

import { isQueueCode, matchHouseNumber, normalizeAddress, normalizeQueue } from './address.js';
import { searchSettlements } from './settlements.js';
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

interface Env {
  DB: D1Database;
  MIRROR_SCHEDULE_URL: string;
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

/** Зеркало отдаёт код 2 = «свет выключен»; остальные коды — свет есть. */
const MIRROR_OFF_CODE = 2;

/**
 * Момент перевода часов: последнее воскресенье месяца (0 — январь) в 01:00 UTC.
 *
 * Украина переходит на летнее время в последнее воскресенье марта в 03:00 по местному (01:00 UTC),
 * а возвращается к зимнему — в последнее воскресенье октября в 04:00 по местному (01:00 UTC).
 * Правило действует с 1996 года и не менялось, поэтому его можно считать арифметикой.
 */
function lastSundayOneUtc(year: number, monthIndex: number): number {
  const lastDayOfMonth = new Date(Date.UTC(year, monthIndex + 1, 0));
  const day = lastDayOfMonth.getUTCDate() - lastDayOfMonth.getUTCDay();
  return Date.UTC(year, monthIndex, day, 1, 0, 0);
}

/**
 * Сдвиг киевского времени относительно UTC в минутах для момента `ms`: +120 зимой, +180 летом.
 *
 * Раньше здесь стоял `Intl.DateTimeFormat` с `timeZoneName: 'longOffset'`, а в `localSlotToUtc` —
 * ещё один форматтер с итеративным уточнением через `formatToParts`. Оба создавались ЗАНОВО на
 * каждый слот: область с сотнями получасовок давала десятки миллисекунд CPU, а лимит воркера на
 * бесплатном тарифе — 10 мс, и `/status`, `/sync`, `/reliability` отвечали 503 `error 1102`
 * («Worker exceeded CPU time limit»). Арифметика вместо ICU даёт тот же результат (совпадение
 * проверено сверкой с прежним расчётом на всех получасовках 2024–2027 годов) и стоит доли
 * микросекунды.
 */
/**
 * Границы летнего времени по годам (последнее воскресенье марта и октября) и последний
 * использованный год: слоты одного ответа лежат в одном-двух годах, а `lastSundayOneUtc` — это
 * `new Date` на каждую границу.
 */
const KYIV_DST_BOUNDS = new Map<number, [number, number]>();

/** Год, для которого уже посчитаны границы, вместе с его началом и концом в UTC. */
let kyivYearCache = { year: 0, start: 0, end: 0 };

function kyivOffsetMinutesAt(ms: number): number {
  // Границы летнего времени ищем один раз на год и запоминаем: `lastSundayOneUtc` строит `Date`,
  // а `localSlotToUtc` спрашивает сдвиг до трёх раз на каждую границу слота — на месяце слотов
  // это тысячи лишних `Date` в горячем пути `/reliability` и `/status`.
  let year = kyivYearCache.year;
  if (year === 0 || ms < kyivYearCache.start || ms >= kyivYearCache.end) {
    year = new Date(ms).getUTCFullYear();
    const bounds = KYIV_DST_BOUNDS.get(year) ?? [lastSundayOneUtc(year, 2), lastSundayOneUtc(year, 9)];
    KYIV_DST_BOUNDS.set(year, bounds);
    kyivYearCache = { year, start: Date.UTC(year, 0, 1), end: Date.UTC(year + 1, 0, 1) };
  }
  const bounds = KYIV_DST_BOUNDS.get(year)!;
  return ms >= bounds[0] && ms < bounds[1] ? 180 : 120;
}

/**
 * Локальное время графика (дата + «HH:MM» по Киеву) → ISO-UTC.
 *
 * Сдвиг часового пояса нужен потому, что интервалы отдаются фронтенду как UTC и сравниваются
 * с текущим временем: без него интервал «20:00–22:00 по Киеву» съезжал бы на час в зависимости
 * от того, летом это или зимой.
 *
 * Конец суток (`timeTo === '00:00'`) означает интервал до полуночи следующего дня, а не
 * пустой интервал — так же трактует это Node-бэкенд.
 */
function localSlotToUtc(date: string, time: string, end: boolean): string {
  if (end && time === '00:00') {
    const next = new Date(`${date}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    const nextDate = next.toISOString().slice(0, 10);
    const nextMidnight = Date.parse(`${nextDate}T00:00:00Z`);
    return new Date(nextMidnight - kyivOffsetMinutesAt(nextMidnight) * 60_000).toISOString();
  }
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const [hour, minute] = time.split(':').map(Number) as [number, number];
  const target = Date.UTC(year, month - 1, day, hour, minute);
  // Сдвиг ищем сходимостью, но без ICU: на каждом проходе сравниваем «желаемое» локальное время с
  // тем, которое даёт текущая догадка, и сдвигаем её на разницу. Это ровно тот же алгоритм, что был
  // здесь на `Intl`/`formatToParts`, только представление локального времени считается арифметикой
  // (3 прохода по числу). В час перевода стрелок локальное время неоднозначно; сохраняем прежний
  // выбор — тот, к которому приводила итерация с `Intl`, чтобы уже отданные интервалы не поехали.
  let guess = target;
  for (let i = 0; i < 3; i += 1) {
    const wallClock = guess + kyivOffsetMinutesAt(guess) * 60_000;
    const delta = target - wallClock;
    if (!delta) break;
    guess += delta;
  }
  return new Date(guess).toISOString();
}

/**
 * Київське «дата + час» в UTC-миллисекунды — тот же расчёт, что у `localSlotToUtc`.
 *
 * Отдельная функция нужна из-за цены строк: `localSlotToUtc` строит ISO-строку, а вызывающий её тут
 * же разбирает `Date.parse`. В отчёте надёжности это по два преобразования на каждую границу каждого
 * слота (месяц × группы × 2), то есть миллисекунды CPU на пустом месте. `end && time === '00:00'` —
 * полночь СЛЕДУЮЩЕГО дня: так зеркало записывает «до конца суток».
 */
function kyivWallClockMs(date: string, time: string, end: boolean): number {
  const wallMs =
    Date.UTC(
      Number(date.slice(0, 4)),
      Number(date.slice(5, 7)) - 1,
      Number(date.slice(8, 10)),
      Number(time.slice(0, 2)),
      Number(time.slice(3, 5)),
    ) + (end && time === '00:00' ? 86_400_000 : 0);
  // Сходимость та же, что в `localSlotToUtc`: сравниваем желаемое локальное время с тем, которое
  // даёт текущая догадка, и сдвигаем её на разницу.
  let guess = wallMs;
  for (let i = 0; i < 3; i += 1) {
    const delta = wallMs - (guess + kyivOffsetMinutesAt(guess) * 60_000);
    if (!delta) break;
    guess += delta;
  }
  return guess;
}

/** 48 получасовых подписей суток: `00:00`, `00:30`, … `23:30`. */
function halfHourLabels(): string[] {
  return Array.from({ length: 48 }, (_, index) =>
    `${String(Math.floor(index / 2)).padStart(2, '0')}:${index % 2 === 0 ? '00' : '30'}`,
  );
}

/** Код группы зеркала → код группы приложения: `2.2` → `2/2`, `3` → `3`. */
function queueFromGroupKey(groupKey: string): string | null {
  const match = /^(\d{1,2})(?:\.(\d{1,2}))?$/u.exec(groupKey.trim());
  if (!match) return null;
  return match[2] ? `${match[1]}/${match[2]}` : match[1]!;
}

function cellCode(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string' && /^\d{1,2}$/u.test(value.trim())) return Number(value.trim());
  return null;
}

/**
 * Последовательность получасовых кодов → интервалы отключений (код 2), со склейкой соседних
 * ячеек в один отрезок. Склейка нужна, чтобы «с 00:00 по 04:00» показалось одним интервалом,
 * а не двумястами получасовками.
 */
function offIntervalsFromCodes(codes: Array<number | null>, labels: string[]): Array<{ timeFrom: string; timeTo: string }> {
  const intervals: Array<{ timeFrom: string; timeTo: string }> = [];
  let start: number | null = null;
  for (let index = 0; index <= codes.length; index += 1) {
    const isOff = index < codes.length && codes[index] === MIRROR_OFF_CODE;
    if (isOff && start === null) start = index;
    if (!isOff && start !== null) {
      intervals.push({
        timeFrom: labels[start]!,
        // Конец суток отдаём как `00:00` — так же делает оператор, так это понимает фронтенд.
        timeTo: index === codes.length ? '00:00' : labels[index]!,
      });
      start = null;
    }
  }
  return intervals;
}

/** Мапа `{"08:00": 2, …}` одного дня → интервалы отключений. */
function offIntervalsFromDayMap(day: unknown): Array<{ timeFrom: string; timeTo: string }> {
  if (typeof day !== 'object' || day === null || Array.isArray(day)) return [];
  const map = day as Record<string, unknown>;
  const labels = halfHourLabels();
  return offIntervalsFromCodes(
    labels.map((label) => cellCode(map[label])),
    labels,
  );
}

/** Компактный массив на 48 кодов (второй формат ядра: `region.today` / `region.tomorrow`). */
function offIntervalsFromCompactArray(arr: unknown): Array<{ timeFrom: string; timeTo: string }> {
  if (!Array.isArray(arr) || arr.length !== 48) return [];
  const labels = halfHourLabels();
  return offIntervalsFromCodes(arr.map((value) => cellCode(value)), labels);
}

function isYmd(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/u.test(value);
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface Slot {
  region: string;
  queue: string;
  date: string;
  timeFrom: string;
  timeTo: string;
}

/**
 * Разворачивает `{body: "<json>"}` во внутренний JSON.
 *
 * Зеркало отдаёт полезную нагрузку JSON-строкой внутри поля `body`, поэтому без этого шага
 * слоты не найдутся. Поддерживаем и вариант без обёртки — тогда `regions` лежит в корне.
 */
function unwrapMirrorPayload(raw: unknown): Record<string, unknown> | null {
  if (!isJsonObject(raw)) return null;
  const body = raw['body'];
  if (typeof body === 'string') {
    try {
      const inner: unknown = JSON.parse(body);
      return isJsonObject(inner) ? inner : null;
    } catch {
      return null;
    }
  }
  if (isJsonObject(body)) return body;
  if ('regions' in raw || 'data' in raw) return raw;
  return null;
}

function regionsOf(payload: Record<string, unknown>): unknown[] | null {
  const direct = payload['regions'];
  if (Array.isArray(direct)) return direct;
  const data = payload['data'];
  if (isJsonObject(data) && Array.isArray(data['regions'])) return data['regions'] as unknown[];
  return null;
}

/** Слоты отключений одной области из разобранного payload зеркала. Чистая функция. */
function extractSlots(payload: Record<string, unknown>, regionCpu: string): Slot[] {
  const regions = regionsOf(payload);
  if (!regions) return [];
  const region = regions.find((item) => isJsonObject(item) && item['cpu'] === regionCpu);
  if (!isJsonObject(region)) return [];

  const slots: Slot[] = [];
  const dateToday = typeof payload['date_today'] === 'string' ? payload['date_today'] : null;
  const dateTomorrow = typeof payload['date_tomorrow'] === 'string' ? payload['date_tomorrow'] : null;

  // Формат 2: компактные массивы `today`/`tomorrow`. Без названия группы в самом регионе код
  // группы взять неоткуда — тогда честно не пишем ничего.
  if (Array.isArray(region['today'])) {
    const queue = queueFromGroupKey(String(region['group'] ?? ''));
    if (!queue) return [];
    for (const [date, compact] of [
      [dateToday, region['today']],
      [dateTomorrow, region['tomorrow']],
    ] as Array<[string | null, unknown]>) {
      if (!date || !isYmd(date)) continue;
      for (const interval of offIntervalsFromCompactArray(compact)) {
        slots.push({ region: regionCpu, queue, date, ...interval });
      }
    }
    return slots;
  }

  // Формат 1 (реальный): `schedule[groupKey][date][HH:MM] = code`.
  const schedule = region['schedule'];
  if (!isJsonObject(schedule)) return [];
  for (const [groupKey, byDate] of Object.entries(schedule)) {
    const queue = queueFromGroupKey(groupKey);
    if (!queue || !isJsonObject(byDate)) continue;
    for (const [date, day] of Object.entries(byDate)) {
      if (!isYmd(date)) continue;
      for (const interval of offIntervalsFromDayMap(day)) {
        slots.push({ region: regionCpu, queue, date, ...interval });
      }
    }
  }
  return slots;
}

/**
 * Строка покрытия ГПВ: «на эту дату оператор опубликовал график, и эта очередь в нём есть».
 *
 * Отдельно от `Slot` (`Slot` — только часы отключений). Причина: зеркало отдаёт
 * `schedule[группа][дата][HH:MM] = код`, где код 1 — «светло по графику», код 2 — «отключение».
 * По одним слотам (код 2) невозможно отличить «оператор опубликовал график без отключений» от
 * «оператор на эту дату ничего не публиковал»: и то, и другое давало пустой список слотов, и
 * приложение писало «Немає даних» там, где график есть.
 */
interface CoverageEntry {
  region: string;
  date: string;
  queue: string;
  /** Есть ли в опубликованном ГПВ хотя бы одна получасовка отключения для этой очереди. */
  hasOutages: boolean;
}

/**
 * Очередь-маркер «оператор сообщил про всю область целиком», а не про конкретную очередь.
 *
 * Нужна для постов вида «Графіки не діють» / «Погодинні відключення не застосовуються»: оператор
 * говорит про область и дату, а не про номер очереди. Такой пост — это покрытие (график
 * опубликован) без отключений, и именно поэтому регион перестаёт выглядеть «без данных».
 */
const ALL_CLEAR_QUEUE = '*';

/**
 * Кэш в памяти изолята. TTL — минута: данные обновляет крон раз в 20 минут, поэтому минута не
 * отдаёт человеку устаревший график, зато снимает с D1 и с CPU всё, что повторяется в пределах
 * минуты.
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
const MEMORY_CACHE_TTL_MS = 60_000;

/** Сколько записей держим: ключ включает область и параметры, поэтому записей немного. */
const MEMORY_CACHE_LIMIT = 120;

const memoryCache = new Map<string, { expiresAt: number; payload: unknown }>();

/**
 * Результат `producer` на `MEMORY_CACHE_TTL_MS` по строковому ключу.
 *
 * Отдаётся тот же объект, что и в первый раз: вызывающие только читают его (кладут в `json` или в
 * тело пакета), поэтому копировать не нужно.
 */
async function cached<T>(key: string, producer: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = memoryCache.get(key);
  if (hit && hit.expiresAt > now) return hit.payload as T;
  const payload = await producer();
  remember(key, payload);
  return payload;
}

/**
 * Кладёт готовое значение в кэш изолята.
 *
 * Нужен там, где тело ответа собирается не одной функцией (`/reliability`, `/sync`): кэшировать
 * приходится уже собранный объект, а не результат вызова-обёртки.
 */
function remember(key: string, payload: unknown): void {
  if (memoryCache.size >= MEMORY_CACHE_LIMIT) {
    // `Map` хранит порядок вставки: первый ключ — самая старая запись.
    const oldest = memoryCache.keys().next();
    if (!oldest.done) memoryCache.delete(oldest.value);
  }
  memoryCache.set(key, { expiresAt: Date.now() + MEMORY_CACHE_TTL_MS, payload });
}

/** Сбрасывает кэш изолята: вызывается после крона, который переписал данные. */
function clearMemoryCache(): void {
  memoryCache.clear();
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

/** Покрытие одной области из разобранного payload зеркала. Чистая функция. */
function extractCoverage(payload: Record<string, unknown>, regionCpu: string): CoverageEntry[] {
  const regions = regionsOf(payload);
  if (!regions) return [];
  const region = regions.find((item) => isJsonObject(item) && item['cpu'] === regionCpu);
  if (!isJsonObject(region)) return [];

  const labels = halfHourLabels();
  const entries: CoverageEntry[] = [];
  const push = (queue: string, date: string, codes: Array<number | null>) => {
    entries.push({
      region: regionCpu,
      date,
      queue,
      hasOutages: codes.some((code) => code === MIRROR_OFF_CODE),
    });
  };

  const dateToday = typeof payload['date_today'] === 'string' ? payload['date_today'] : null;
  const dateTomorrow = typeof payload['date_tomorrow'] === 'string' ? payload['date_tomorrow'] : null;

  // Формат 2: компактные массивы на 48 получасовок. Без имени группы взять её неоткуда.
  if (Array.isArray(region['today'])) {
    const queue = queueFromGroupKey(String(region['group'] ?? ''));
    if (!queue) return [];
    for (const [date, compact] of [
      [dateToday, region['today']],
      [dateTomorrow, region['tomorrow']],
    ] as Array<[string | null, unknown]>) {
      if (!date || !isYmd(date) || !Array.isArray(compact) || compact.length !== 48) continue;
      push(queue, date, compact.map((value) => cellCode(value)));
    }
    return entries;
  }

  // Формат 1 (реальный): `schedule[groupKey][date][HH:MM] = code`.
  const schedule = region['schedule'];
  if (!isJsonObject(schedule)) return [];
  for (const [groupKey, byDate] of Object.entries(schedule)) {
    const queue = queueFromGroupKey(groupKey);
    if (!queue || !isJsonObject(byDate)) continue;
    for (const [date, day] of Object.entries(byDate)) {
      if (!isYmd(date) || !isJsonObject(day)) continue;
      push(queue, date, labels.map((label) => cellCode(day[label])));
    }
  }

  // Регион отдал список групп, но НИ ОДНОЙ даты с графиком (`schedule: { "1.1": {} }`) — именно так
  // зеркало присылает Киев. Это не «нет данных», а «график опубликован, отключений не
  // запланировано»: без служебной строки покрытия область с живым графиком показывала «Даних
  // графіка немає». Пишем `ALL_CLEAR_QUEUE` на сегодня — по ней `covered`/`allClear` станут true, и
  // человек увидит «Світло за графіком (відключень не заплановано)».
  if (entries.length === 0 && Object.keys(schedule).length > 0) {
    const date = dateToday && isYmd(dateToday) ? dateToday : kyivToday();
    entries.push({ region: regionCpu, date, queue: ALL_CLEAR_QUEUE, hasOutages: false });
  }
  return entries;
}

/** Склеивает покрытие: одна строка на (область, дата, очередь). */
function mergeCoverage(entries: CoverageEntry[]): CoverageEntry[] {
  const byKey = new Map<string, CoverageEntry>();
  for (const entry of entries) {
    const key = `${entry.region}|${entry.date}|${entry.queue}`;
    const existing = byKey.get(key);
    if (existing) existing.hasOutages = existing.hasOutages || entry.hasOutages;
    else byKey.set(key, { ...entry });
  }
  return [...byKey.values()];
}

/**
 * Склеивает соседние интервалы группы в один.
 *
 * Зеркало отдаёт получасовки, поэтому отключение с 00:00 до 04:00 приходит двадцатью
 * восемью интервалами. Фронтенд ждёт готовые интервалы, а человек — одно окно в графике.
 */
function mergeSlots(slots: Slot[]): Slot[] {
  const byKey = new Map<string, Slot[]>();
  for (const slot of slots) {
    const key = `${slot.region}|${slot.queue}|${slot.date}`;
    const list = byKey.get(key);
    if (list) list.push(slot);
    else byKey.set(key, [slot]);
  }

  const merged: Slot[] = [];
  for (const list of byKey.values()) {
    list.sort((a, b) => a.timeFrom.localeCompare(b.timeFrom));
    for (const slot of list) {
      const last = merged[merged.length - 1];
      // Склеиваем, только если предыдущий интервал того же отключения заканчивается там же,
      // где следующий начинается, и оба принадлежат той же группе/дате.
      const sameSeries =
        last !== undefined &&
        last.region === slot.region &&
        last.queue === slot.queue &&
        last.date === slot.date;
      if (sameSeries && last.timeTo === slot.timeFrom) last.timeTo = slot.timeTo;
      else merged.push({ ...slot });
    }
  }
  return merged;
}

/**
 * Названия областей.
 *
 * Взяты из каталога `regions` нашего же проекта (миграция 0012), а не придуманы: зеркало
 * названий не отдаёт, но и выдумывать их нельзя — человек узнает свою область по этому тексту.
 *
 * Список полный (24 области + Киев + городские сети Дніпра), а не только знакомые слоты: зеркало
 * отдаёт области шире, чем мы видели в первых прогонах, и на области вне этого списка человек
 * получал в подписи технический слаг (`dnipropetrovska-oblast`) — по нему свою область не узнать.
 * Если зеркало присылает своё `name_ua`, оно подставляется как резерв (см. `regionSummaries`).
 */
const REGION_NAMES: Record<string, string> = {
  'chernihivska-oblast': 'Чернігівська область',
  'kyiv': 'Київ',
  'kiivska-oblast': 'Київська область',
  'lvivska-oblast': 'Львівська область',
  'poltavska-oblast': 'Полтавська область',
  'cherkaska-oblast': 'Черкаська область',
  'kharkivska-oblast': 'Харківська область',
  'khmelnytska-oblast': 'Хмельницька область',
  'ivano-frankivska-oblast': 'Івано-Франківська область',
  'rivnenska-oblast': 'Рівненська область',
  'ternopilska-oblast': 'Тернопільська область',
  'zakarpatska-oblast': 'Закарпатська область',
  'zaporizka-oblast': 'Запорізька область',
  'zhytomyrska-oblast': 'Житомирська область',
  'dnipropetrovska-oblast': 'Дніпропетровська область',
  'dnipro-dnem': 'м. Дніпро (ДнЕМ)',
  'dnipro-cek': 'м. Дніпро (ЦЕК)',
  'volynska-oblast': 'Волинська область',
  'vinnytska-oblast': 'Вінницька область',
  'mykolaivska-oblast': 'Миколаївська область',
  'odeska-oblast': 'Одеська область',
  'khersonska-oblast': 'Херсонська область',
  'donetska-oblast': 'Донецька область',
  'luhanska-oblast': 'Луганська область',
  'sumska-oblast': 'Сумська область',
  'kirovohradska-oblast': 'Кіровоградська область',
  'chernivetska-oblast': 'Чернівецька область',
};

/**
 * Канонические названия областей и их ключи фида — копия `packages/shared/src/regions-catalog.ts`.
 *
 * Копия, а не импорт: воркер собирается wrangler'ом отдельно от монорепо и намеренно не тянет
 * `@svitlo/shared` (тот везёт за собой zod). Источник правды — общий модуль, здесь только то, что
 * нужно воркеру: какие ключи фида стоят за областью.
 *
 * Зачем: человек ищет «Київська область», «Київ», «Дніпропетровська область», а данные зеркала
 * лежат под `kiivska-oblast`, `kyiv` и двумя ключами м. Дніпро (`dnipro-cek` — ЦЕК,
 * `dnipro-dnem` — ДнЕМ). Пока каталог отдавал ключи фида, поиск по названию не находил область, а
 * выбор `dnipropetrovska-oblast` давал пустой график при живой области.
 *
 * Порожний `feedKeys` — область, которую фид не отдаёт вовсе: она остаётся в каталоге с нулями,
 * чтобы человек нашёл свою область и увидел честное «даних немає».
 */
const REGION_CATALOG: Array<{ cpu: string; feedKeys: string[] }> = [
  { cpu: 'vinnytska-oblast', feedKeys: [] },
  { cpu: 'volynska-oblast', feedKeys: [] },
  { cpu: 'dnipropetrovska-oblast', feedKeys: ['dnipro-cek', 'dnipro-dnem'] },
  { cpu: 'donetska-oblast', feedKeys: [] },
  { cpu: 'zhytomyrska-oblast', feedKeys: ['zhytomyrska-oblast'] },
  { cpu: 'zakarpatska-oblast', feedKeys: ['zakarpatska-oblast'] },
  { cpu: 'zaporizka-oblast', feedKeys: ['zaporizka-oblast'] },
  { cpu: 'ivano-frankivska-oblast', feedKeys: ['ivano-frankivska-oblast'] },
  { cpu: 'kyiv-city', feedKeys: ['kyiv'] },
  { cpu: 'kyivska-oblast', feedKeys: ['kiivska-oblast'] },
  { cpu: 'kirovohradska-oblast', feedKeys: [] },
  { cpu: 'luhanska-oblast', feedKeys: [] },
  { cpu: 'lvivska-oblast', feedKeys: ['lvivska-oblast'] },
  { cpu: 'mykolaivska-oblast', feedKeys: [] },
  { cpu: 'odeska-oblast', feedKeys: [] },
  { cpu: 'poltavska-oblast', feedKeys: ['poltavska-oblast'] },
  { cpu: 'rivnenska-oblast', feedKeys: ['rivnenska-oblast'] },
  { cpu: 'sumska-oblast', feedKeys: [] },
  { cpu: 'ternopilska-oblast', feedKeys: ['ternopilska-oblast'] },
  { cpu: 'kharkivska-oblast', feedKeys: ['kharkivska-oblast'] },
  { cpu: 'khersonska-oblast', feedKeys: [] },
  { cpu: 'khmelnytska-oblast', feedKeys: ['khmelnytska-oblast'] },
  { cpu: 'cherkaska-oblast', feedKeys: ['cherkaska-oblast'] },
  { cpu: 'chernivetska-oblast', feedKeys: [] },
  { cpu: 'chernihivska-oblast', feedKeys: ['chernihivska-oblast'] },
];

/** Опечатки из старых закладок и ссылок: «dnipropetrovnska» (без «е»). */
const REGION_ALIASES: Record<string, string> = {
  'dnipropetrovnska-oblast': 'dnipropetrovska-oblast',
};

const REGION_BY_CPU = new Map(REGION_CATALOG.map((entry) => [entry.cpu, entry]));

/** Ключ фида → канонический `cpu`. Копия той же карты, что в shared: без неё `kyiv` не находил
 * `kyiv-city`, и запрос со старым ключом из закладки читал пустую область. */
const CANONICAL_BY_FEED_KEY = new Map<string, string>();
for (const entry of REGION_CATALOG) {
  for (const feedKey of entry.feedKeys) {
    if (feedKey !== entry.cpu) CANONICAL_BY_FEED_KEY.set(feedKey, entry.cpu);
  }
}

/** Все ключи фида, какие вообще бывают: по ним отличаем «сеть» (`dnipro-cek`) от «области». */
const FEED_KEYS = new Set<string>(REGION_CATALOG.flatMap((entry) => entry.feedKeys));

/** Канонический `cpu` для того, что пришло снаружи: ключ фида, псевдоним или уже канонический. */
function canonicalRegionCpu(cpu: string): string {
  const value = cpu.trim();
  if (REGION_BY_CPU.has(value)) return value;
  const alias = REGION_ALIASES[value];
  if (alias) return alias;
  return CANONICAL_BY_FEED_KEY.get(value) ?? value;
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

/** `column IN (?, …)` по ключам чтения. Пустой список — фильтра по области нет («вся страна»). */
function regionIn(regions: string[], column = 'region'): { clause: string; bindings: string[] } {
  const keys = [...new Set(regions.filter((key) => key))];
  if (keys.length === 0) return { clause: '', bindings: [] };
  return { clause: `${column} IN (${keys.map(() => '?').join(', ')})`, bindings: keys };
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
  const [slots, coverage] = await Promise.all([
    env.DB.prepare(
      `SELECT region, COUNT(*) AS slots,
              SUM(CASE WHEN queue = ? THEN 1 ELSE 0 END) AS queueSlots
       FROM schedule_slots WHERE ${filter.clause} AND date = ? GROUP BY region`,
    )
      .bind(queue ?? '', ...filter.bindings, date)
      .all<{ region: string; slots: number; queueSlots: number }>(),
    env.DB.prepare(
      `SELECT region, COUNT(*) AS n FROM schedule_coverage WHERE ${filter.clause} AND date = ? GROUP BY region`,
    )
      .bind(...filter.bindings, date)
      .all<{ region: string; n: number }>(),
  ]);
  for (const row of slots.results ?? []) {
    stats.set(row.region, { slots: row.slots ?? 0, queueSlots: row.queueSlots ?? 0, coverage: 0 });
  }
  for (const row of coverage.results ?? []) {
    const current = stats.get(row.region) ?? { slots: 0, queueSlots: 0, coverage: 0 };
    current.coverage = row.n ?? 0;
    stats.set(row.region, current);
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
  const pick =
    candidates.find((key) => (stats.get(key)?.queueSlots ?? 0) > 0) ??
    candidates.find((key) => (stats.get(key)?.slots ?? 0) > 0) ??
    candidates.find((key) => (stats.get(key)?.coverage ?? 0) > 0) ??
    candidates[0];
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
  const canonical = canonicalRegionCpu(cpu);
  const entry = REGION_BY_CPU.get(canonical);
  if (entry) return [...entry.feedKeys];
  return [canonical];
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

/** Читает зеркало. Любая ошибка → `null`: лучше пустой график, чем правдоподобный мусор. */
async function fetchMirror(env: Env): Promise<{ payload: Record<string, unknown>; timestamp: string | null } | null> {
  try {
    const response = await fetch(env.MIRROR_SCHEDULE_URL, {
      headers: { 'user-agent': 'svitlo-cf-worker', accept: 'application/json' },
    });
    if (!response.ok) {
      console.warn(`mirror: HTTP ${response.status} на ${env.MIRROR_SCHEDULE_URL}`);
      return null;
    }
    const raw: unknown = await response.json();
    const payload = unwrapMirrorPayload(raw);
    if (!payload) {
      console.warn('mirror: неожиданный формат ответа (не читается regions/body)');
      return null;
    }
    const timestamp = isJsonObject(raw) && typeof raw['timestamp'] === 'string' ? raw['timestamp'] : null;
    return { payload, timestamp };
  } catch (error) {
    // Логируем причину: молча проглоченная ошибка сети выглядит как «у оператора нет графика»,
    // и это стоило бы нам недель тишины в проде вместо одного сообщения в логах.
    console.warn(`mirror: сеть недоступна (${error instanceof Error ? error.message : 'unknown'})`);
    return null;
  }
}

interface NewsRow {
  id: string;
  source_key: string;
  url: string;
  title: string;
  summary: string | null;
  published_at: string | null;
  first_seen_at: string;
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
    items.push({
      id: `${sourceKey}:${link}`,
      source_key: sourceKey,
      url: link,
      title,
      summary,
      published_at: datetime ?? null,
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
  const result = await env.DB.prepare(
    `SELECT region, queue, date, time_from, time_to FROM schedule_slots WHERE date >= ? AND date <= ?`,
  )
    .bind(fromDate, toDate)
    .all<{ region: string; queue: string; date: string; time_from: string; time_to: string }>();

  const byQueue = new Map<string, { region: string; queue: string; slots: ReliabilitySlot[] }>();
  for (const row of result.results ?? []) {
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
  return { byQueue };
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
  if (queues === 0) {
    return { windowMinutes, outageMinutes: 0, poweredMinutes: 0, reliabilityPct: 0, hasData: false, outageCount: 0 };
  }
  const effectiveWindow =
    windowMinutes <= 24 * 60
      ? Math.max(1, windowMinutes)
      : Math.max(24 * 60, Math.min(windowMinutes, daysWithData.size * 24 * 60));
  const average = Math.round(sumMinutes / queues);
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
        hasData: outageMinutes > 0,
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
}

/**
 * Лимит D1 на число связанных переменных в одном prepared-запросе (SQLITE_MAX_VARIABLE_NUMBER).
 * Не «размер запроса» и не «число строк»: превышение даёт «too many SQL variables».
 */
const MAX_VARIABLES = 100;

/** Колонок в строке schedule_slots — от этого зависит размер пачки вставки. */
const COLUMNS = 6;

/**
 * Записывает слоты в D1.
 *
 * Авторитетный источник (зеркало) заменяет данные за затронутые (область, дата), но только
 * начиная со вчерашнего дня: зеркало отдаёт лишь ближайшие даты и не должно стирать уже
 * собранную историю — от неё зависят «Статистика електропостачання» и надёжность. Раньше крон
 * удалял ВСЕ пришедшие (область, дата), включая прошлые сутки, и история обнулялась при каждом
 * обходе.
 *
 * Дополнительный источник (Telegram) снимает только СВОИ строки за (область, очередь, дата) и
 * вставляет с `INSERT OR IGNORE`: полный график оператора из зеркала он не перетирает, а
 * конфликт по ключу (область, очередь, дата, начало интервала) оставляет зеркалу. Та же
 * семантика, что у Node-бэкенда (`importTelegramScheduleSlots`,
 * `apps/api/src/services/telegram-schedule.service.ts`).
 */
async function saveSlots(env: Env, slots: Slot[], options: { source?: string; replace?: boolean } = {}): Promise<void> {
  if (slots.length === 0) return;
  const source = options.source ?? 'mirror';
  const replace = options.replace ?? true;
  // Граница истории: вчера и позже — перетираем (там данные меняются в течение суток), раньше —
  // только дополняем новыми интервалами, записанные строки не трогаем.
  const historyBorder = addDays(kyivToday(), -1);

  if (replace) {
    const touched = new Set<string>();
    for (const slot of slots) if (slot.date >= historyBorder) touched.add(`${slot.region}|${slot.date}`);
    // Сначала чистим только те (область, дата), которые реально пришли: иначе старые слоты
    // другой области за ту же дату были бы стёрты вместе с новыми.
    for (const key of touched) {
      const [region, date] = key.split('|') as [string, string];
      await env.DB.prepare(`DELETE FROM schedule_slots WHERE region = ? AND date = ?`).bind(region, date).run();
    }
  } else {
    const touched = new Set<string>();
    for (const slot of slots) touched.add(`${slot.region}|${slot.queue}|${slot.date}`);
    for (const key of touched) {
      const [region, queue, date] = key.split('|') as [string, string, string];
      await env.DB.prepare(
        `DELETE FROM schedule_slots WHERE region = ? AND queue = ? AND date = ? AND source = ?`,
      ).bind(region, queue, date, source).run();
    }
  }

  // Пачка = MAX_VARIABLES / COLUMNS. Раньше было 90 строк (540 переменных), и любая запись
  // падала с «too many SQL variables»: лимит D1 — это число связанных переменных, а не байт.
  const CHUNK = Math.max(1, Math.floor(MAX_VARIABLES / COLUMNS));
  const verb = replace ? 'INSERT OR REPLACE' : 'INSERT OR IGNORE';
  for (let start = 0; start < slots.length; start += CHUNK) {
    const chunk = slots.slice(start, start + CHUNK);
    const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
    const values = chunk.flatMap((slot) => [slot.region, slot.queue, slot.date, slot.timeFrom, slot.timeTo, source]);
    const statement = env.DB.prepare(
      `${verb} INTO schedule_slots (region, queue, date, time_from, time_to, source)
       VALUES ${placeholders}`,
    );
    await statement.bind(...values).run();
  }
}

/** Строка покрытия ГПВ из D1. */
interface CoverageRow {
  region: string;
  date: string;
  queue: string;
  has_outages: number;
  source: string;
}

/** Колонок в строке schedule_coverage — от этого зависит размер пачки вставки. */
const COVERAGE_COLUMNS = 6;

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
  if (entries.length === 0) return;
  const source = options.source ?? 'mirror';
  const replace = options.replace ?? true;
  const now = new Date().toISOString();
  const historyBorder = addDays(kyivToday(), -1);

  if (replace) {
    const touched = new Set<string>();
    for (const entry of entries) if (entry.date >= historyBorder) touched.add(`${entry.region}|${entry.date}`);
    for (const key of touched) {
      const [region, date] = key.split('|') as [string, string];
      await env.DB.prepare(`DELETE FROM schedule_coverage WHERE region = ? AND date = ?`).bind(region, date).run();
    }
  } else {
    // Дополнительный источник снимает только свои строки за (область, дата, очередь): пост
    // «графіки не діють» мог смениться постом «черга 6/2 з 16:40», и старое «світло за графіком»
    // не должно пережить эту новость.
    const touched = new Set<string>();
    for (const entry of entries) touched.add(`${entry.region}|${entry.date}|${entry.queue}`);
    for (const key of touched) {
      const [region, date, queue] = key.split('|') as [string, string, string];
      await env.DB.prepare(
        `DELETE FROM schedule_coverage WHERE region = ? AND date = ? AND queue = ? AND source = ?`,
      ).bind(region, date, queue, source).run();
    }
  }

  const CHUNK = Math.max(1, Math.floor(MAX_VARIABLES / COVERAGE_COLUMNS));
  for (let start = 0; start < entries.length; start += CHUNK) {
    const chunk = entries.slice(start, start + CHUNK);
    const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
    const values = chunk.flatMap((entry) => [
      entry.region,
      entry.date,
      entry.queue,
      entry.hasOutages ? 1 : 0,
      source,
      now,
    ]);
    // OR IGNORE: строку зеркала не перетирает дополнение из Telegram. Для зеркала старые строки
    // за дату уже сняты выше, поэтому IGNORE не мешает обновлению.
    await env.DB.prepare(
      `INSERT OR IGNORE INTO schedule_coverage (region, date, queue, has_outages, source, updated_at)
       VALUES ${placeholders}`,
    ).bind(...values).run();
  }
}

/** Покрытие одной области за диапазон дат (включительно). */
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

async function saveNews(env: Env, items: Array<Omit<NewsRow, 'first_seen_at'>>): Promise<void> {
  if (items.length === 0) return;
  const now = new Date().toISOString();
  // 7 колонок на публикацию — тот же лимит в 100 переменных: 100/7 = 14 строк.
  const CHUNK = Math.max(1, Math.floor(MAX_VARIABLES / 7));
  for (let start = 0; start < items.length; start += CHUNK) {
    const chunk = items.slice(start, start + CHUNK);
    const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ');
    const values = chunk.flatMap((item) => [
      item.id,
      item.source_key,
      item.url,
      item.title,
      item.summary,
      item.published_at,
      now,
    ]);
    // INSERT OR IGNORE: первый_seen_at не перетираем, иначе дата обнаружения «обнулялась» бы
    // при каждом кроне и новости вечно выглядели бы только что найденными.
    await env.DB.prepare(
      `INSERT OR IGNORE INTO news (id, source_key, url, title, summary, published_at, first_seen_at)
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

  const mirror = await fetchMirror(env);
  if (mirror) {
    const raw: Slot[] = [];
    const coverage: CoverageEntry[] = [];
    const names: Record<string, string> = {};
    for (const item of regionsOf(mirror.payload) ?? []) {
      if (!isJsonObject(item)) continue;
      const cpu = item['cpu'];
      if (typeof cpu !== 'string' || !cpu) continue;
      raw.push(...extractSlots(mirror.payload, cpu));
      // Покрытие — тем же обходом: без него «график опубликован, но отключений в нём нет»
      // (коды 1 = «світло за графіком») снова выглядело бы как «Немає даних».
      coverage.push(...extractCoverage(mirror.payload, cpu));
      const nameUa = item['name_ua'];
      if (typeof nameUa === 'string' && nameUa.trim()) names[cpu] = nameUa.trim();
    }
    await saveSlots(env, mergeSlots(raw));
    await saveCoverage(env, mergeCoverage(coverage));
    await saveMirrorRegionNames(env, names);
    mirrorSlots = raw.length;
    mirrorCoverage = coverage.length;
    mirrorTimestamp = mirror.timestamp ?? null;
    mirrorRegions = Object.keys(names).length;
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
  } catch (error) {
    console.log(`scheduled: не удалось перенести ГПВ в outage_events (${String(error)})`);
  }

  if (mirror || telegram.slots > 0) {
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
  if (mirror || telegram.slots > 0) {
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
 */
async function nominatim(
  params: Record<string, string>,
  allowedAddressTypes: string[],
): Promise<unknown[]> {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('countrycodes', 'ua');
  url.searchParams.set('Accept-Language', 'uk');
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  try {
    const response = await fetch(url.toString(), {
      headers: { 'user-agent': 'SvitloUA/2.2', accept: 'application/json' },
    });
    if (!response.ok) return [];
    const parsed: unknown = await response.json();
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => {
      if (typeof item !== 'object' || item === null) return false;
      const kind = (item as Record<string, unknown>)['addresstype'];
      return typeof kind === 'string' && allowedAddressTypes.includes(kind);
    });
  } catch {
    // Справочник недоступен — возвращаем то, что есть в D1, а не ошибку: поиск по адресу
    // не должен ломаться из-за внешнего сервиса.
    return [];
  }
}

/**
 * `addresstype` объектов OSM, которые считаем населённым пунктом. Всё остальное (музеи, больницы,
 * магазины) отбрасываем: в подсказке населённых пунктов «Центральна районна лікарня» — это шум.
 */
const SETTLEMENT_ADDRESS_TYPES = [
  'city', 'town', 'village', 'hamlet', 'municipality', 'suburb', 'county', 'state', 'region', 'borough',
];

/** Типы OSM, которые считаем улицей. */
const STREET_ADDRESS_TYPES = ['street', 'road', 'residential', 'pedestrian', 'primary', 'secondary', 'tertiary'];

/** Приводит объект Nominatim к `{ name, normalized, lat, lon, source }`. */
function nominatimToPlace(item: unknown, source: 'osm'): {
  name: string;
  normalized: string;
  lat: number | null;
  lon: number | null;
  source: 'osm';
} | null {
  if (typeof item !== 'object' || item === null) return null;
  const record = item as Record<string, unknown>;
  const name = typeof record['name'] === 'string' ? record['name'] : String(record['display_name'] ?? '').split(',')[0] ?? '';
  const trimmed = name.trim();
  if (!trimmed) return null;
  return {
    name: trimmed,
    normalized: normalizeAddress(trimmed),
    lat: typeof record['lat'] === 'string' ? Number(record['lat']) : null,
    lon: typeof record['lon'] === 'string' ? Number(record['lon']) : null,
    source,
  };
}

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

/**
 * Сегодня по Киеву (`YYYY-MM-DD`).
 *
 * Без `Intl`: форматтер создавался на каждый вызов, а `kyivToday()` зовут и в горячем пути
 * (`/status`, `/queues`, `/schedules`), где каждый миллисекунд CPU на счету.
 */
function kyivToday(): string {
  const now = Date.now();
  return new Date(now + kyivOffsetMinutesAt(now) * 60_000).toISOString().slice(0, 10);
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

/** Сохраняет имена областей от зеркала, не теряя уже известные (объединение, а не замена). */
async function saveMirrorRegionNames(env: Env, names: Record<string, string>): Promise<void> {
  const fresh = Object.entries(names).filter(([, name]) => name.trim().length > 0);
  if (fresh.length === 0) return;
  const merged = { ...(await loadMirrorRegionNames(env)), ...Object.fromEntries(fresh) };
  await env.DB.prepare(`INSERT OR REPLACE INTO snapshot_meta (key, value, updated_at) VALUES (?, ?, ?)`)
    .bind('mirror_regions', JSON.stringify(merged), new Date().toISOString())
    .run();
}

/**
 * Интервалы группы за дату в форме `ScheduleIntervalUtc`, склеенные в окна отключений.
 *
 * Пустой массив означает «по этой группе отключений в этот день нет» — это законное состояние,
 * фронтенд по нему честно покажет «свет будет», а не ошибку.
 */
function toIntervals(rows: SlotRow[], queue: string, date: string) {
  const wanted = normalizeQueue(queue);
  return rows
    .filter((row) => normalizeQueue(row.queue) === wanted)
    .sort((a, b) => a.time_from.localeCompare(b.time_from))
    .map((row) => ({
      startsAt: localSlotToUtc(date, row.time_from, false),
      endsAt: localSlotToUtc(date, row.time_to, true),
      // Локальное время оператора («20:00»). Обязательное поле контракта
      // GroupOutageInterval: без него карточка ближайших отключений на главной рисовала
      // «– –» вместо времени, хотя сам график был загружен. Наш скрипт сверки контрактов
      // это пропустил — он сравнивал форму массива, но не заходил внутрь элемента списка.
      localTimeFrom: row.time_from,
      localTimeTo: row.time_to,
      stateCode: OFF_STATE.code,
      stateName: OFF_STATE.name,
      stateColor: OFF_STATE.color,
    }));
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
      `SELECT region AS cpu, queue, COUNT(*) AS slots, MAX(date) AS lastDate
       FROM schedule_slots GROUP BY region, queue
       UNION ALL
       SELECT region AS cpu, queue, 0 AS slots, NULL AS lastDate
       FROM schedule_coverage WHERE queue <> ? GROUP BY region, queue`,
    ).bind(ALL_CLEAR_QUEUE).all<{ cpu: string; queue: string; slots: number; lastDate: string | null }>(),
    loadMirrorRegionNames(env),
    // Покрытие за сегодня: «график опубликован, отключений в нём нет» — это не «нет данных».
    // Раньше область с опубликованным ГПВ без отключений выглядела ровно как неотданная зеркалом.
    env.DB.prepare(`SELECT region, queue, has_outages FROM schedule_coverage WHERE date = ?`)
      .bind(today)
      .all<{ region: string; queue: string; has_outages: number }>(),
    // Слоты ТОЛЬКО на сегодня и завтра. Без этого бейдж области показывал «6 сл.», хотя эти
    // полчаса лежали в БД с 1 июля: человек читал «N сл.» как «график на сегодня загружен» и не
    // понимал, почему на экране пусто. Считаем отдельным групповым запросом (одно чтение D1),
    // а `slots` оставляем как общее число загруженных слотов — по нему видно историю.
    env.DB.prepare(
      `SELECT region AS cpu, COUNT(*) AS n FROM schedule_slots WHERE date >= ? AND date <= ? GROUP BY region`,
    )
      .bind(today, addDays(today, 1))
      .all<{ cpu: string; n: number }>(),
  ]);

  const todaySlotsByRegion = new Map<string, number>();
  for (const row of todayRows.results ?? []) todaySlotsByRegion.set(row.cpu, row.n ?? 0);

  const byRegion = new Map<string, { queues: Set<string>; slots: number; lastDate: string | null }>();
  for (const row of result.results ?? []) {
    const queue = normalizeQueue(row.queue);
    // Мусорные коды в список кнопок не пускаем: там попадаются «черга» из чужих источников.
    if (!isQueueCode(queue)) continue;
    const entry = byRegion.get(row.cpu) ?? { queues: new Set<string>(), slots: 0, lastDate: null };
    entry.queues.add(queue);
    entry.slots += row.slots ?? 0;
    if (row.lastDate && (!entry.lastDate || row.lastDate > entry.lastDate)) entry.lastDate = row.lastDate;
    byRegion.set(row.cpu, entry);
  }

  const coverageByRegion = new Map<string, { covered: Set<string>; off: Set<string> }>();
  for (const row of coverageRows.results ?? []) {
    const entry = coverageByRegion.get(row.region) ?? { covered: new Set<string>(), off: new Set<string>() };
    entry.covered.add(normalizeQueue(row.queue));
    if (row.has_outages) entry.off.add(normalizeQueue(row.queue));
    coverageByRegion.set(row.region, entry);
  }

  // Строки каталога. Каноническая область — одна строка (её `cpu` человек и видит), а данные для
  // неё берутся из ключей фида: у Киевской области это `kiivska-oblast`, у Киева — `kyiv`.
  const consumed = new Set<string>();
  const rows: Array<Record<string, unknown>> = [];

  /** Факты по ключу фида: слоты и черги из БД. Пустая запись законна — область не импортирована. */
  const factsOf = (cpu: string) => byRegion.get(cpu) ?? { queues: new Set<string>(), slots: 0, lastDate: null };

  for (const entry of REGION_CATALOG) {
    // Ключ каталога может быть ещё и ключом фида (зеркало когда-то отдавало `dnipropetrovska-oblast`
    // отдельно от ЦЕК/ДнЕМ): данные под ним не выбрасываем, а складываем в ту же строку.
    const ownKey = entry.cpu;
    const ownData = !entry.feedKeys.includes(ownKey) && (byRegion.has(ownKey) || coverageByRegion.has(ownKey)) ? [ownKey] : [];
    const dataKeys = [...entry.feedKeys, ...ownData];
    const facts = dataKeys.map(factsOf);
    const coverages = dataKeys.map((key) => coverageByRegion.get(key));
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
    for (const key of dataKeys) todaySlots += todaySlotsByRegion.get(key) ?? 0;
    const coveredNetworks = coverages.filter((coverage) => (coverage?.covered.size ?? 0) > 0).length;
    // Область считаем покрытой, только когда день опубликовали ВСЕ её источники (у области с одной
    // сетью — она сама): молчащая сеть — это «не знаем», а не «график есть».
    const covered = dataKeys.length > 0 && coveredNetworks === dataKeys.length;
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
      // null, пока область не импортирована. Подставлять сегодняшнюю дату значило бы врать:
      // фронтенд по `lastDate` решает, есть ли график, и увидел бы «есть» у пустой области.
      lastDate,
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
        const fact = factsOf(key);
        const coverage = coverageByRegion.get(key);
        const coveredNetwork = (coverage?.covered.size ?? 0) > 0;
        rows.push({
          cpu: key,
          nameUa: REGION_NAMES[key] ?? mirrorNames[key] ?? key,
          nameEn: null,
          queues: [...fact.queues].sort(compareQueueCodes),
          slots: fact.slots,
          todaySlots: todaySlotsByRegion.get(key) ?? 0,
          lastDate: fact.lastDate,
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
  for (const cpu of new Set([...Object.keys(REGION_NAMES), ...Object.keys(mirrorNames), ...byRegion.keys()])) {
    if (consumed.has(cpu)) continue;
    const fact = factsOf(cpu);
    const coverage = coverageByRegion.get(cpu);
    const coveredToday = (coverage?.covered.size ?? 0) > 0;
    rows.push({
      cpu,
      nameUa: REGION_NAMES[cpu] ?? mirrorNames[cpu] ?? cpu,
      nameEn: null,
      queues: [...fact.queues].sort(compareQueueCodes),
      slots: fact.slots,
      todaySlots: todaySlotsByRegion.get(cpu) ?? 0,
      lastDate: fact.lastDate,
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
  return cached('regions:all', () => regionSummariesUncached(env));
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
  // Проверка «данные уже есть» нужна только один раз на изолят: она открывает отдельный запрос к
  // D1 на каждом вызове, а `/sync` и `/status` зовут эту функцию всегда.
  if (scheduleSeeded) return;
  const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM schedule_slots`).first<{ n: number }>();
  if ((count?.n ?? 0) > 0) {
    scheduleSeeded = true;
    return;
  }
  const mirror = await fetchMirror(env);
  if (mirror) {
    const raw: Slot[] = [];
    const coverage: CoverageEntry[] = [];
    const names: Record<string, string> = {};
    for (const item of regionsOf(mirror.payload) ?? []) {
      if (!isJsonObject(item)) continue;
      const cpu = item['cpu'];
      if (typeof cpu !== 'string' || !cpu) continue;
      raw.push(...extractSlots(mirror.payload, cpu));
      coverage.push(...extractCoverage(mirror.payload, cpu));
      const nameUa = item['name_ua'];
      if (typeof nameUa === 'string' && nameUa.trim()) names[cpu] = nameUa.trim();
    }
    console.log(
      `ensureSchedule: зеркало дало ${raw.length} слотов и ${coverage.length} строк покрытия по ${regionsOf(mirror.payload)?.length ?? 0} областям`,
    );
    await saveSlots(env, mergeSlots(raw));
    await saveCoverage(env, mergeCoverage(coverage));
    await saveMirrorRegionNames(env, names);
  }

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



/** Похоже ли название на улицу: OSM в ответе на запрос «улица, село» отдаёт и дома с номерами. */
function isStreetLike(name: string): boolean {
  const value = name.trim();
  if (!value) return false;
  if (/\d+/u.test(value)) return false;
  return /^(вул\.|вулиця|просп\.|проспект|пров\.|провулок|переулок|пер\.|шосе|бульвар|б\.|пл\.|площа|узв\.|ім\.|наб\.|набережна)/iu.test(value);
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
  const rows = await env.DB.prepare(
    `SELECT region, settlement_name, settlement_normalized, street_name, street_normalized,
            house_pattern, queue, source, updated_at
     FROM address_queues WHERE ${filter.clause} AND settlement_normalized = ?`,
  ).bind(...filter.bindings, settlementNormalized).all<AddressQueueRow>();
  const entries = rows.results ?? [];
  if (entries.length === 0) {
    return { queue: null, reason: 'not-found', source: null, options: [] };
  }

  const streetNormalized = normalizeAddress(input.street);
  const wholeSettlement = entries.filter((row) => !row.street_normalized);

  // Уровень 1: конкретный дом на конкретной улице.
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

/** Убирает повторы вариантов «дома → очередь», сохраняя порядок. */
function dedupeQueues(options: Array<{ housePattern: string; queue: string }>): Array<{ housePattern: string; queue: string }> {
  const seen = new Set<string>();
  const result: Array<{ housePattern: string; queue: string }> = [];
  for (const option of options) {
    const key = `${option.housePattern}|${option.queue}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(option);
  }
  return result;
}

/**
 * Народная привязка: человек сам называет очередь своего адреса, если её ещё нет в базе.
 *
 * Ограничения на публикацию сознательные:
 *   - очередь должна быть настоящим кодом (1/1…6/2), иначе в базу попадёт мусор;
 *   - сохраняется ОДИН адрес за раз, без имени и телефона — персональных данных не собираем;
 *   - источник помечается `community`, поэтому в интерфейсе видно, что привязка народная,
 *     и её можно перепроверить, а не выдать за выгрузку оператора.
 */
async function handleContribute(request: Request, env: Env): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: { code: 'VALIDATION_ERROR', message: 'Очікується JSON' } }, 400);
  }
  if (typeof body !== 'object' || body === null) {
    return json({ error: { code: 'VALIDATION_ERROR', message: 'Очікується об’єкт' } }, 400);
  }

  const payload = body as Record<string, unknown>;
  const region = String(payload['region'] ?? '').trim();
  const settlement = String(payload['settlement'] ?? '').trim();
  const street = String(payload['street'] ?? '').trim();
  const house = String(payload['house'] ?? '').trim();
  const queue = normalizeQueue(String(payload['queue'] ?? ''));

  if (!region || settlement.length < 2) {
    return json({ error: { code: 'VALIDATION_ERROR', message: 'region і settlement обовʼязкові' } }, 400);
  }
  if (!isQueueCode(queue)) {
    return json({ error: { code: 'VALIDATION_ERROR', message: `Невірний код черги «${queue}»` } }, 400);
  }

  const housePattern = house || '*';
  await env.DB.prepare(
    `INSERT OR REPLACE INTO address_queues
       (region, settlement_name, settlement_normalized, street_name, street_normalized,
        house_pattern, queue, source, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'community', ?)`,
  )
    .bind(
      region,
      settlement,
      normalizeAddress(settlement),
      street,
      normalizeAddress(street),
      housePattern,
      queue,
      new Date().toISOString(),
    )
    .run();

  return json({
    data: { saved: true, queue, source: 'community', housePattern },
  }, 201);
}

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
  const [rows, coverages] = await Promise.all([
    env.DB.prepare(
      `SELECT queue, COUNT(*) AS slots, MAX(date) AS lastDate
       FROM schedule_slots WHERE region IN (${placeholders}) GROUP BY queue ORDER BY queue`,
    ).bind(...keys).all<{ queue: string; slots: number; lastDate: string | null }>(),
    // Опубликованные на сегодня очереди. В области, где график вышел без отключений, `schedule_slots`
    // пуст (мы храним только «тёмные» часы), и без этого списка экран выбора группы писал
    // «графік не імпортовано» про существующий график.
    Promise.all(keys.map((key) => coverageOfDay(env, [key], kyivToday()))),
  ]);
  // Очереди без слотов, но с публикацией. `offQueues` исключаем: там пустые слоты значат отставший
  // импорт, а не «світло за графіком». Пересечение по сетям: группа остаётся «без отключений», только
  // если так её опубликовала КАЖДАЯ сеть, а сеть, которая на эту дату вообще ничего не опубликовала,
  // лишает флага все группы — это «не знаем», а не «светло».
  const published = coverages.map(
    (coverage) =>
      new Set([...coverage.queues].filter((queue) => queue !== ALL_CLEAR_QUEUE && !coverage.offQueues.has(queue))),
  );
  const cleared =
    published.length === 0 || coverages.some((coverage) => coverage.queues.size === 0)
      ? new Set<string>()
      : published.reduce((acc, here) => new Set([...acc].filter((queue) => here.has(queue))));
  // Порядок «1, 1/2, 2, 2/2, 10» — как в Node-бекенде (`compareQueueCodes`): строковая сортировка
  // ставила «10» перед «2», и список групп в двух сборках выглядел по-разному.
  const sums = new Map<string, { queue: string; slots: number; lastDate: string | null }>();
  for (const row of rows.results ?? []) {
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
  return cached(`queues:${keys.join(',')}`, () => queueSummariesUncached(env, regions));
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
       GROUP BY settlement_normalized, settlement_name`,
    ).bind(...filter.bindings).all<{ name: string; normalized: string; queues: string | null }>(),
    env.DB.prepare(
      `SELECT name, normalized FROM directory_settlements WHERE ${filter.clause}`,
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
  return cached(`settlements:${keys.join(',')}`, () => offlineSettlementsUncached(env, regions));
}

/**
 * Последние новости из общей таблицы `news` в форме `NewsItem`.
 *
 * Вынесено из обработчика `/news`, потому что тот же список нужен офлайн-пакету `/sync`: две
 * копии одного запроса разошлись бы, и в самолёте человек читал бы не ту ленту, что на главной.
 * `limit` уже провалидирован вызывающей стороной.
 */
async function newsItems(env: Env, limit: number): Promise<Array<Record<string, unknown>>> {
  const result = await env.DB.prepare(
    `SELECT id, source_key, url, title, summary, published_at, first_seen_at
     FROM news ORDER BY COALESCE(published_at, first_seen_at) DESC LIMIT ?`,
  ).bind(limit).all<NewsRow>();
  const items = (result.results ?? []).map((row) => ({
    id: row.id,
    sourceKey: row.source_key,
    url: row.url,
    title: row.title,
    summary: row.summary ?? null,
    body: row.summary ?? null,
    publishedAt: row.published_at ?? null,
    firstSeenAt: row.first_seen_at,
    regionCpu: null,
    // Вид публикации зеркалом не отдаётся; «ukraine» честнее, чем выдуманный «outage».
    kind: 'ukraine',
    isUkraineWide: true,
    // tags и imageUrls ОБЯЗАТЕЛЬНЫ: по ним компоненты делают .map(). Раньше воркер отдавал
    // несуществующее imageUrl вместо imageUrls — это и ломало рендер вкладки «Новини».
    tags: [],
    imageUrls: [],
    // Хэш содержимого нужен, чтобы не перерисовывать карточку, если текст не изменился.
    // Считаем из того, что реально есть.
    contentHash: `${row.id}:${row.published_at ?? row.first_seen_at}`,
  }));
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
      buckets.push({
        queue,
        date,
        source: 'mirror',
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
    return String(a.queue).localeCompare(String(b.queue));
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
  return cached(`upcoming:${keys.join(',')}:${today}:${days}`, () =>
    upcomingGroupBucketsUncached(env, regions, today, days),
  );
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
      today: buildWindow('за добу', 24 * 60, todayStats.outageMinutes, counters.outagesToday),
      last24h: buildWindow('за 24 години', 24 * 60, yesterdayStats.outageMinutes, counters.outages24h),
    },
    // Служебное: сколько всего групп знает воркер. Фронтенд это поле не читает, но оно
    // нужно для диагностики через curl, поэтому не выбрасываем.
    totalQueues: counters.totalQueues,
    generatedAt: nowIso,
  };
}

/** `buildStatusPayload` с кэшем изолята: ключ — набор ключей области и дата. */
async function buildStatusPayload(env: Env, regions: string[], today: string): Promise<Record<string, unknown>> {
  return cached(`status:${regions.join(',')}:${today}`, () => buildStatusPayloadUncached(env, regions, today));
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
    measure('news', newsItems(env, SYNC_NEWS_LIMIT)),
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
    return json({ status: 'ok' });
  }

  if (path === '/changelog') {
    // Конверт и заголовки — как у Node-бэкенда (apps/api/src/routes/changelog.ts): приложение не
    // должно знать, кто именно отдал список. Раньше маршрута здесь не было, и карточка «Що
    // нового» на Cloudflare-сборке молча получала 404: серверные фиксы не доходили до людей,
    // у которых уже установлено приложение. ETag считаем от содержимого файла — он меняется
    // только с выкаткой, а не с каждым запросом, поэтому кеш браузера работает как надо.
    return json({ data: changelog }, 200, {
      'cache-control': 'public, max-age=300',
      etag: `W/"changelog-${changelog.entries.length}-${changelog.entries[0]?.hash ?? '0'}"`,
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
    // Сеть многомережной области выбираем по факту: та, у которой на эту дату есть график этой черги.
    readRegions = await resolveReadRegions(env, dbRegions, date, queue);
    const [rows, coverage] = await Promise.all([loadSlots(env, readRegions, date), coverageOfDay(env, readRegions, date)]);
    const intervals = toIntervals(rows, queue, date);
    // Три состояния, которые раньше сливались в одно «пусто» и давали «Немає даних»:
    //   интервалы есть          → график опубликован, есть часы отключений;
    //   покрытие без отключений → allClear: график опубликован, «світло за графіком»;
    //   ни того, ни другого     → covered: false, оператор на эту дату ничего не публиковал.
    const queueCovered = coverage.queues.has(queue) || coverage.queues.has(ALL_CLEAR_QUEUE);
    const covered = queueCovered || intervals.length > 0;
    // «Світло за графіком» ставим, только если фід не видит отключений у этой очереди: пустые слоты
    // при `has_outages = 1` — это отставший импорт, и обещать свет было бы прямой брехнью.
    const offByFeed = coverage.offQueues.has(queue);
    // Источник берём у самих слотов: раньше здесь было жёстко 'mirror', и слоты, собранные из
    // Telegram, выдавались за данные зеркала — источник в интерфейсе был бы неправдой.
    const slotSource = rows.find((row) => row.source)?.source ?? null;
    return json({
      data: {
        queue,
        date,
        intervals,
        source: intervals.length > 0 ? slotSource : queueCovered ? ([...coverage.sources][0] ?? null) : null,
        covered,
        allClear: covered && intervals.length === 0 && !offByFeed,
        lastImportedAt: await lastImportedAt(env),
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
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') ?? 20) || 20));
    const items = await newsItems(env, limit);
    // `stale` — не ошибка, а честный признак пустой ленты: по нему фронтенд показывает
    // «даних немає», а не пустую вёрстку.
    return json({ data: items, meta: { count: items.length, limit, stale: items.length === 0 } });
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
    if (query.length < 2) return json({ data: [] });
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') ?? 10) || 10));
    const needle = normalizeAddress(query);

    // Сначала наши данные: они проверены и размечены своим источником.
    const settlementsFilter = regionIn(readRegions.length > 0 ? readRegions : [''], 'd.region');
    const ours = await env.DB.prepare(
      `SELECT d.name AS name, d.normalized AS normalized, 'curated' AS source
       FROM directory_settlements d WHERE ${settlementsFilter.clause} AND d.normalized LIKE ?`,
    ).bind(...settlementsFilter.bindings, `%${needle}%`).all<{ name: string; normalized: string; source: 'curated' }>();

    // Тип аннотирован явно: без него TypeScript сужает `source` до литерала 'curated'
    // и не даёт потом положить рядом подсказки из OSM.
    let places: Array<{ name: string; normalized: string; lat: number | null; lon: number | null; source: PlaceSource }> =
      (ours.results ?? []).map((row) => ({
        name: row.name,
        normalized: row.normalized,
        lat: null,
        lon: null,
        source: 'curated',
      }));

    // Статический справочник: города и центры громад ищутся по префиксу в памяти, мгновенно
    // и без сети. Nominatim для них не годится: он требует полное слово, поэтому «Черніг»
    // не находил «Чернігів», а человек именно так и набирает название.
    const fromDirectory = searchSettlements(query, region || undefined, limit);
    for (const hit of fromDirectory) {
      places.push({
        name: hit.name,
        normalized: normalizeAddress(hit.name),
        lat: hit.lat,
        lon: hit.lon,
        source: 'directory',
      });
    }
    places = dedupePlaces(places).slice(0, limit);

    // Хутора и посёлки справочник не покрывает (их десятки тысяч) — их ищем в OSM.
    //
    // Условие обращения к OSM намеренно мягче, чем «справочник пуст»: как только человек
    // дописал хотя бы 4 символа, но совпадений всё ещё мало, мы спрашиваем и OSM. Иначе
    // запрос «Чорн» показывал бы только Чернігів и молчал про село Чорна, а это ровно тот
    // случай, когда человеку нужна подсказка больше всего.
    //
    // Короткие запросы («Че», «Біл») в OSM не спрашиваем: они дают шум и десятки посторонних
    // объектов, а по справочнику ответ и так мгновенный.
    if (places.length === 0 || (query.length >= 4 && places.length < 5)) {
      const osm = await nominatim(
        {
          featuretype: 'settlement',
          // Область в запрос НЕ подставляем: проверено на живых ответах Nominatim, что
          // «Чернігівська область» в запросе ломает поиск («Чернігів, Чернігівська область» —
          // 0 результатов, а «Чернігів» — город). Ограничение страны делает countrycodes=ua,
          // а область сужаем уже фильтром по каталогу регионов на фронтенде.
          q: query,
          // Запас ×3: часть строк отсеется по addresstype (реки, парки, магазины с тем же
          // именем), и без запаса подсказка выходила бы пустой при непустом ответе OSM.
          limit: String(limit * 3),
        },
        SETTLEMENT_ADDRESS_TYPES,
      );
      for (const item of osm) {
        const place = nominatimToPlace(item, 'osm');
        if (place) places.push(place);
      }
    }
    return json({ data: dedupePlaces(places).slice(0, limit) });
  }

  if (path === '/addresses/streets') {
    const settlement = (url.searchParams.get('settlement') ?? '').trim();
    const query = (url.searchParams.get('q') ?? '').trim();
    if (settlement.length < 2) return json({ data: [], wholeSettlementQueue: null });
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') ?? 10) || 10));
    const settlementNormalized = normalizeAddress(settlement);
    const needle = normalizeAddress(query);

    // Улицы берём из двух мест: справочник (знаем улицу, но не её очередь) и привязки
    // (знаем и улицу, и очередь). Показываем оба — очереди может ещё не быть, и это честно.
    const streetRegions = regionIn(readRegions.length > 0 ? readRegions : ['']);
    const known = await env.DB.prepare(
      `SELECT name, normalized FROM directory_streets
       WHERE ${streetRegions.clause} AND settlement_normalized = ? AND normalized LIKE ?`,
    ).bind(...streetRegions.bindings, settlementNormalized, `%${needle}%`)
      .all<{ name: string; normalized: string }>();

    const bound = await env.DB.prepare(
      `SELECT DISTINCT street_name AS name, street_normalized AS normalized FROM address_queues
       WHERE ${streetRegions.clause} AND settlement_normalized = ? AND street_normalized <> '' AND street_normalized LIKE ?`,
    ).bind(...streetRegions.bindings, settlementNormalized, `%${needle}%`)
      .all<{ name: string; normalized: string }>();

    const streets: Array<{ name: string; normalized: string; source: PlaceSource }> = [
      ...(bound.results ?? []).map((row) => ({ name: row.name, normalized: row.normalized, source: 'address_queues' as const })),
      ...(known.results ?? []).map((row) => ({ name: row.name, normalized: row.normalized, source: 'curated' as const })),
    ];

    let places: Array<{ name: string; normalized: string; source: PlaceSource }> = dedupePlaces(streets);

    // Если в нашем справочнике ничего нет (а это большинство сёл) — берём улицы из OSM.
    if (places.length === 0 && query.length >= 2) {
      const osm = await nominatim(
        { q: `${query}, ${settlement}`, limit: String(limit * 3) },
        STREET_ADDRESS_TYPES,
      );
      const mapped: Array<{ name: string; normalized: string; source: PlaceSource }> = [];
      for (const item of osm) {
        const place = nominatimToPlace(item, 'osm');
        // OSM отдаёт и дома, и проезды — оставляем только то, что похоже на улицу.
        if (place && isStreetLike(place.name)) {
          mapped.push({ name: place.name, normalized: place.normalized, source: 'osm' });
        }
      }
      places = dedupePlaces(mapped).slice(0, limit);
    }

    // Если на всё село известна одна очередь — отдаём её, чтобы мастер сразу показал ответ.
    const whole = await env.DB.prepare(
      `SELECT DISTINCT queue FROM address_queues
       WHERE ${streetRegions.clause} AND settlement_normalized = ? AND street_normalized = ''`,
    ).bind(...streetRegions.bindings, settlementNormalized).all<{ queue: string }>();
    const queues = [...new Set((whole.results ?? []).map((row) => normalizeQueue(row.queue)))];

    return json({
      data: places,
      wholeSettlementQueue: queues.length === 1 ? queues[0] : null,
      region,
    });
  }

  if (path === '/addresses/resolve') {
    const settlement = (url.searchParams.get('settlement') ?? '').trim();
    if (settlement.length < 2) {
      return json({ error: { code: 'VALIDATION_ERROR', message: 'settlement обовʼязковий' } }, 400);
    }
    const street = (url.searchParams.get('street') ?? '').trim();
    const house = (url.searchParams.get('house') ?? '').trim();

    const resolved = await resolveAddress(env, { regions: readRegions, settlement, street, house });
    if (!resolved.queue) {
      return json({
        data: { queue: null, options: resolved.options, reason: 'not-found', source: null, schedule: null },
      });
    }

    // Расписание найденной группы на сегодня отдаём сразу: человек узнал номер группы и
    // заодно видит, есть ли сейчас свет, не делая второй запрос.
    const [rows, coverage] = await Promise.all([
      loadSlots(env, readRegions, today),
      coverageOfDay(env, readRegions, today),
    ]);
    const intervals = toIntervals(rows, resolved.queue, today);
    // Покрытие читаем и здесь: иначе мастер поиска писал «графіку на сьогодні немає» про группу,
    // у которой график опубликован, а отключений в нём нет (та же разница, что в `/schedules`).
    const queueCovered = coverage.queues.has(resolved.queue) || coverage.queues.has(ALL_CLEAR_QUEUE);
    const covered = queueCovered || intervals.length > 0;
    const offByFeed = coverage.offQueues.has(resolved.queue);
    // Источник — у самих слотов: жёсткий 'mirror' выдавал данные Telegram за данные зеркала.
    const slotSource = rows.find((row) => row.source)?.source ?? null;
    return json({
      data: {
        queue: resolved.queue,
        options: resolved.options,
        reason: resolved.reason,
        source: resolved.source,
        schedule: {
          queue: resolved.queue,
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

  if (path === '/addresses/contribute') return handleContribute(request, env);

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
    const data = (rows.results ?? []).map((row) => ({
      id: row['external_id']!,
      title: row['reason'] ?? 'Аварійна перерва',
      areaName: row['area_name']!,
      startsAt: row['starts_at']!,
      etaAt: row['ends_at']!,
      status: 'open',
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
    return json({ data: status });
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
    const headers = { 'cache-control': 'no-store', etag: bundle.etag };
    if (etagMatches(request.headers.get('if-none-match'), bundle.etag)) return notModified(headers);
    // Конверт `{ data }` — как у Node-бекенда и как у остальных маршрутов: офлайн-шар клиента
    // не должен иметь отдельного случая для одного эндпоинта.
    return json({ data: { syncedAt: new Date().toISOString(), etag: bundle.etag, ...bundle.body } }, 200, headers);
  }
  return json({ error: { code: 'NOT_FOUND', message: `Немає маршруту ${path}` } }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
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

    try {
      return await handleApi(request, env, url);
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
