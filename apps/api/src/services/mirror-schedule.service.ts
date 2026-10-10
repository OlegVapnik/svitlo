/**
 * Погодинний ГПВ із публічного «дзеркала» операторських даних
 * (`MIRROR_SCHEDULE_URL`, типово `https://dtek-api.svitlo-proxy.workers.dev/`).
 *
 * Навіщо це потрібно (HANDOFF §18.9): метод оператора `POST /api/info_schedule` — заглушка
 * (`aData: null`), а `info_schedule_part` закритий Cloudflare Turnstile, який ми не обходимо.
 * Telegram-канал дає лише «зміни» (окремі черги + час), а не повний добовий ГПВ. Дзеркало ж віддає
 * ПОВНИЙ ГПВ по області: 48 півгодинних значень на кожну чергу й на сьогодні+завтра. Той самий
 * формат читає Java-ядро `core/` (`BlackoutScheduleProvider`), тож контракт перевірений не лише нами.
 *
 * Формат відповіді (перевірено 10.10.2026 живим запитом):
 *   {"body":"{\"date_today\":\"2026-10-10\",\"date_tomorrow\":\"2026-10-11\",\"regions\":[
 *      {\"cpu\":\"chernihivska-oblast\",\"name_ua\":\"Чернігівська область\",
 *       \"schedule\":{\"2.2\":{\"2026-10-10\":{\"08:00\":2,\"08:30\":2,\"09:00\":1,...}}}}]}",
 *    "timestamp":"..."}
 * `body` — вкладений JSON **рядком**, тому спершу розгортаємо його; верхній рівень `regions` буває
 * і без обгортки (варіант `data.regions` ядро теж підтримує).
 *
 * Персональних даних немає: лише код черги (`2.2` → `2/2`), дата й півгодинний код стану. Капчі
 * немає. Коди станів такі самі, як у `core/`: `2` — відключення, `3` — можливе відключення,
 * `0`/`1` — світло є. Записуємо в `schedule_slots` лише **відключення** (`state_code = 3`,
 * «Відключення», `#E33535` — як у telegram-імпорті): код `3` дзеркала не має відповідника в легенді
 * оператора (`aState`), а вигадувати йому назву ми не будемо.
 */
import type { OperatorStateCode } from '@svitlo/shared';
import { env } from '../config.js';
import { logger } from '../utils/logger.js';
import { compareQueueCodes } from './queues.service.js';

/** Джерело в `schedule_slots.source`: видно, що слоти прийшли з дзеркала, а не зі «змін» каналу. */
export const MIRROR_SCHEDULE_SOURCE = 'mirror';

/**
 * Стан «відключення» — той самий, що використовує telegram-імпорт (`TELEGRAM_OFF_STATE`):
 * код 3, «Відключення», `#E33535`. Тест фіксує рівність двох констант, щоб вони не розійшлися.
 */
export const MIRROR_OFF_STATE = { code: 3 as OperatorStateCode, name: 'Відключення', color: '#E33535' };

/** Код півгодинної комірки в дзеркалі, що означає фактичне відключення (`core/`: 2 → POWER_OFF). */
export const MIRROR_OFF_CODE = 2;

/** Слот у термінах `schedule_slots` — те, що реально їде в БД. */
export type MirrorSlot = {
  queue: string;
  date: string;
  timeFrom: string;
  timeTo: string;
  stateCode: OperatorStateCode;
  stateName: string;
  stateColor: string;
};

/** Розібраний знімок дзеркала (усі черги, які там є, на обидві дати). */
export type MirrorSchedule = {
  /**
   * Коли ми забрали payload (мс). Для діагностики й тестів; рішення «вже імпортовано» ухвалюється
   * за складом інтервалів у БД, а не за цим часом (див. `ensureMirrorSchedule`).
   */
  fetchedAtMs: number;
  /** `timestamp` від дзеркала (рядком, як віддав сервіс) — лише для логів/метаданих. */
  sourceTimestamp: string | null;
  /** Регіон (`cpu`), який узяли. */
  regionCpu: string;
  slots: MirrorSlot[];
};

export type MirrorImportResult = {
  /** Скільки рядків реально записано. */
  imported: number;
  /** Черги, яких торкнувся імпорт. */
  queues: string[];
  /** Дати (YYYY-MM-DD), яких торкнувся імпорт. */
  dates: string[];
  /** Області (`cpu`), яких торкнувся імпорт: мультирегіональний імпорт пише кілька одразу. */
  regions: string[];
  /** Слотів дзеркала на ці черги/дати не було — писати нічого. */
  empty: boolean;
};

/** 48 півгодинних підписів доби: `00:00`, `00:30`, … `23:30` (як `HALF_HOUR_LABELS` у `core/`). */
export function halfHourLabels(): string[] {
  return Array.from({ length: 48 }, (_, index) =>
    `${String(Math.floor(index / 2)).padStart(2, '0')}:${index % 2 === 0 ? '00' : '30'}`,
  );
}

/**
 * Ключ групи дзеркала → код черги застосунку: `2.2` → `2/2`, `3` → `3`.
 * Некоректний ключ (не число/не група) повертає `null` — такий рядок пропускаємо, а не падаємо.
 */
export function queueFromGroupKey(groupKey: string): string | null {
  const match = /^(\d{1,2})(?:\.(\d{1,2}))?$/u.exec(groupKey.trim());
  if (!match) return null;
  return match[2] ? `${match[1]}/${match[2]}` : match[1]!;
}

/**
 * Зворотне до `queueFromGroupKey`: код черги застосунку (`2/2`) → ключ групи фіда (`2.2`).
 * Потрібне каталогу `region_queues.group_key`, щоб парсер міг зіставляти групу фіда й чергу в БД.
 */
export function groupKeyFromQueueCode(queue: string): string {
  return queue.trim().replace('/', '.');
}

/** Розгортає `{body: "<json>"}` у внутрішній JSON; віддає `null`, якщо формат неочікуваний. */
export function unwrapMirrorPayload(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const body = obj['body'];
  if (typeof body === 'string') {
    try {
      const inner: unknown = JSON.parse(body);
      return typeof inner === 'object' && inner !== null && !Array.isArray(inner) ? (inner as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  if (typeof body === 'object' && body !== null && !Array.isArray(body)) return body as Record<string, unknown>;
  if ('regions' in obj || 'data' in obj) return obj;
  return null;
}

/** Коди з JSON бувають числами або рядками — приймаємо обидва, решту вважаємо «світло є». */
function cellCode(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string' && /^\d{1,2}$/u.test(value.trim())) return Number(value.trim());
  return null;
}

/**
 * Перетворює послідовність півгодинних кодів у інтервали відключень (код `2`), зливаючи сусідні
 * комірки в один відрізок. «Кінець доби» віддаємо як `00:00` — так само робить оператор і так це
 * розуміє `getQueueSchedule` (інтервал до кінця поточної доби, а не порожній інтервал).
 */
export function offIntervalsFromCodes(codes: Array<number | null>, labels: string[]): Array<{ timeFrom: string; timeTo: string }> {
  const intervals: Array<{ timeFrom: string; timeTo: string }> = [];
  let start: number | null = null;
  for (let index = 0; index <= codes.length; index += 1) {
    const isOff = index < codes.length && codes[index] === MIRROR_OFF_CODE;
    if (isOff && start === null) start = index;
    if (!isOff && start !== null) {
      intervals.push({ timeFrom: labels[start]!, timeTo: index === codes.length ? '00:00' : labels[index]! });
      start = null;
    }
  }
  return intervals;
}

/** Мапа `{"08:00": 2, …}` одного дня дзеркала → інтервали відключень. */
export function offIntervalsFromDayMap(day: unknown): Array<{ timeFrom: string; timeTo: string }> {
  if (typeof day !== 'object' || day === null || Array.isArray(day)) return [];
  const map = day as Record<string, unknown>;
  const labels = halfHourLabels();
  return offIntervalsFromCodes(labels.map((label) => cellCode(map[label])), labels);
}

/** Компактний масив на 48 кодів (другий формат ядра: `region.today` / `region.tomorrow`). */
export function offIntervalsFromCompactArray(arr: unknown): Array<{ timeFrom: string; timeTo: string }> {
  if (!Array.isArray(arr) || arr.length !== 48) return [];
  const labels = halfHourLabels();
  return offIntervalsFromCodes(arr.map((value) => cellCode(value)), labels);
}
/** Регіон шукаємо за `cpu`; підтримуємо і `regions` у корені, і `data.regions` (як `core/`). */
function regionsOf(payload: Record<string, unknown>): unknown[] | null {
  const direct = payload['regions'];
  if (Array.isArray(direct)) return direct;
  const data = payload['data'];
  if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    const nested = (data as Record<string, unknown>)['regions'];
    if (Array.isArray(nested)) return nested;
  }
  return null;
}

function isYmd(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/u.test(value);
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Дістає з розібраного payload слоти однієї області. Чиста функція — тестується без мережі й БД.
 * Порожній масив означає «у дзеркалі немає цієї області або немає відключень», а не помилку.
 */
export function extractMirrorSlots(payload: Record<string, unknown>, regionCpu: string): MirrorSlot[] {
  const regions = regionsOf(payload);
  if (!regions) throw new Error('Дзеркало повернуло JSON без масиву regions');
  const region = regions.find((item) => isJsonObject(item) && item['cpu'] === regionCpu);
  if (!isJsonObject(region)) return [];

  const slots: MirrorSlot[] = [];
  const dateToday = typeof payload['date_today'] === 'string' ? payload['date_today'] : null;
  const dateTomorrow = typeof payload['date_tomorrow'] === 'string' ? payload['date_tomorrow'] : null;

  // Формат 2: компактні масиви `today`/`tomorrow` (той, що ядро читає першим). Без назви черги в
  // самому регіоні код черги взяти нема звідки — тоді чесно нічого не записуємо.
  if (Array.isArray(region['today'])) {
    const queue = queueFromGroupKey(String(region['group'] ?? ''));
    if (!queue) return [];
    const byDate: Array<[string | null, unknown]> = [
      [dateToday, region['today']],
      [dateTomorrow, region['tomorrow']],
    ];
    for (const [date, compact] of byDate) {
      if (!date || !isYmd(date)) continue;
      for (const interval of offIntervalsFromCompactArray(compact)) slots.push(toMirrorSlot(queue, date, interval));
    }
    return slots;
  }

  // Формат 1 (реальний): `schedule[groupKey][date][HH:MM] = code`.
  const schedule = region['schedule'];
  if (!isJsonObject(schedule)) return [];
  for (const [groupKey, byDate] of Object.entries(schedule)) {
    const queue = queueFromGroupKey(groupKey);
    if (!queue || !isJsonObject(byDate)) continue;
    for (const [date, day] of Object.entries(byDate)) {
      if (!isYmd(date)) continue;
      for (const interval of offIntervalsFromDayMap(day)) slots.push(toMirrorSlot(queue, date, interval));
    }
  }
  return slots;
}

function toMirrorSlot(queue: string, date: string, interval: { timeFrom: string; timeTo: string }): MirrorSlot {
  return {
    queue,
    date,
    timeFrom: interval.timeFrom,
    timeTo: interval.timeTo,
    stateCode: MIRROR_OFF_STATE.code,
    stateName: MIRROR_OFF_STATE.name,
    stateColor: MIRROR_OFF_STATE.color,
  };
}

/** HTTP-запит до дзеркала. `fetchImpl` інжектується, щоб тести не ходили в мережу. */
export async function fetchMirrorScheduleRaw(fetchImpl: typeof fetch = fetch): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(env.MIRROR_SCHEDULE_URL, {
      method: 'GET',
      headers: { accept: 'application/json', 'user-agent': env.PARSER_USER_AGENT },
      signal: AbortSignal.timeout(env.MIRROR_SCHEDULE_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(`Дзеркало ГПВ недоступне: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) throw new Error(`Дзеркало ГПВ відповіло HTTP ${response.status}`);
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new Error('Дзеркало ГПВ повернуло не JSON');
  }
}

/** Розбирає сирий payload у знімок; кидає помилку лише коли формат зовсім не той. */
export function parseMirrorSchedule(raw: unknown, regionCpu = env.MIRROR_SCHEDULE_REGION, fetchedAtMs = Date.now()): MirrorSchedule {
  const payload = unwrapMirrorPayload(raw);
  if (!payload) throw new Error('Дзеркало ГПВ повернуло неочікуваний формат');
  const sourceTimestamp = isJsonObject(raw) ? raw['timestamp'] : null;
  return mirrorScheduleFromPayload(
    payload,
    regionCpu,
    sourceTimestamp === null || sourceTimestamp === undefined ? null : String(sourceTimestamp),
    fetchedAtMs,
  );
}

/**
 * Спільне ядро `parseMirrorSchedule` і кешу: ГОТОВИЙ (уже розгорнутий) payload → графік однієї
 * області. Виділено окремо, бо кеш тримає payload, а не графік: дзеркало віддає всі області одним
 * запитом, і парсити 220 КБ на кожну область окремо (та ще й на кожен запит сторінки) не потрібно.
 */
export function mirrorScheduleFromPayload(
  payload: Record<string, unknown>,
  regionCpu: string,
  sourceTimestamp: string | null,
  fetchedAtMs: number,
): MirrorSchedule {
  return {
    fetchedAtMs,
    sourceTimestamp,
    regionCpu,
    slots: extractMirrorSlots(payload, regionCpu),
  };
}

/**
 * Кеш payload у пам'яті процесу: cron і сторінка можуть смикати імпорт часто, а дзеркало віддає
 * один знімок (≈220 КБ) на ВСІ області України. TTL за замовчуванням 10 хв — менший за
 * `PARSE_INTERVAL_MINUTES` (30 хв), тож зайвих запитів не буде, але свіжість лишається.
 *
 * Прострочений, але наявний знімок не чекає на мережу: його віддають одразу, а свіжий тягнуть у фоні
 * (stale-while-revalidate). Дзеркало — сторонній worker, і його повільна/невдала відповідь не має
 * додавати секунд у `GET /api/v1/schedules` (там усе одно є `try/catch` і збережені слоти).
 *
 * Кешуємо САМЕ payload (все, що віддало дзеркало), а не графік однієї області: у мультирегіональному
 * світі «Львівська» і «Чернігівська» — це лише різні ключі в тому самому payload. Тому одна мережева
 * відповідь обслуговує будь-яку кількість областей без жодного додаткового запиту.
 */
let cache: { expiresAtMs: number; payload: Record<string, unknown>; sourceTimestamp: string | null; fetchedAtMs: number } | null = null;
/** Memo «область → знімок» для поточного `cache`; скидається разом із ним (див. `refresh`). */
let scheduleByRegion = new Map<string, MirrorSchedule>();
let inFlight: Promise<MirrorSchedule | null> | null = null;
/** Номер запиту: потрібен, щоб пізніший refresh не «загубив» позначку inFlight попереднього. */
let refreshSeq = 0;
/** До цього моменту нових запитів до дзеркала не робимо (пауза після збою). */
let retryAfterMs = 0;

/**
 * Пауза після невдалого запиту. Потрібна, бо при холодному кеші `GET /api/v1/schedules` чекає на
 * мережу: якщо дзеркало «висить», кожне відкриття сторінки чекало б до `MIRROR_SCHEDULE_TIMEOUT_MS`.
 * 30 с — компроміс: збій не множиться на кожен запит, але дані не «залипають» надовго.
 */
export const MIRROR_FAILURE_BACKOFF_MS = 30_000;

/** Скидає кеш і паузу після збою (тести та ручний прогін із адмінки з `force`). */
export function resetMirrorCache(): void {
  cache = null;
  scheduleByRegion = new Map();
  inFlight = null;
  retryAfterMs = 0;
  refreshSeq += 1;
}

/**
 * Знімок однієї області з уже завантаженого payload. Об'єкт мемоїзується: сторінки й тести
 * порівнюють знімки за посиланням (`toBe`), і кожен виклик не має збирати нову копію.
 */
function scheduleForRegion(region: string): MirrorSchedule {
  const memo = scheduleByRegion.get(region);
  if (memo) return memo;
  if (!cache) throw new Error('Дзеркало ГПВ: немає завантаженого payload');
  const schedule = mirrorScheduleFromPayload(cache.payload, region, cache.sourceTimestamp, cache.fetchedAtMs);
  scheduleByRegion.set(region, schedule);
  return schedule;
}

/** Знімок області з кеша, або `null`, якщо кеша немає (без кидання помилок). */
function cachedSchedule(region: string): MirrorSchedule | null {
  return cache ? scheduleForRegion(region) : null;
}

async function refresh(fetchImpl?: typeof fetch): Promise<MirrorSchedule> {
  const raw = await fetchMirrorScheduleRaw(fetchImpl);
  const payload = unwrapMirrorPayload(raw);
  if (!payload) throw new Error('Дзеркало ГПВ повернуло неочікуваний формат');
  const timestamp = isJsonObject(raw) ? raw['timestamp'] : null;
  cache = {
    expiresAtMs: Date.now() + env.MIRROR_SCHEDULE_TTL_SEC * 1000,
    payload,
    sourceTimestamp: timestamp === null || timestamp === undefined ? null : String(timestamp),
    fetchedAtMs: Date.now(),
  };
  // Кеш замінено — старі знімки областей більше не актуальні (інакше тест ловить «той самий» об'єкт).
  scheduleByRegion = new Map();
  retryAfterMs = 0;
  return scheduleForRegion(env.MIRROR_SCHEDULE_REGION);
}

/**
 * Стартує оновлення. `dedupe` (типово) віддає вже наявний у польоті запит — щоб два одночасні
 * виклики не смикнули дзеркало двічі. Помилку не кидає назовні: `null` означає «свіжого немає».
 */
function startRefresh(fetchImpl?: typeof fetch, dedupe = true): Promise<MirrorSchedule | null> {
  if (dedupe && inFlight) return inFlight;
  const seq = (refreshSeq += 1);
  const pending: Promise<MirrorSchedule | null> = refresh(fetchImpl)
    .catch((error: unknown) => {
      // Пауза після збою: наступні запити сторінки не чекають на мережу, поки не спливе backoff.
      retryAfterMs = Date.now() + MIRROR_FAILURE_BACKOFF_MS;
      logger.warn({ err: error }, 'Mirror schedule refresh failed; serving cached snapshot if any');
      return null;
    })
    .finally(() => {
      if (refreshSeq === seq) inFlight = null;
    });
  inFlight = pending;
  return pending;
}

/**
 * Знімок дзеркала для області (типово — `MIRROR_SCHEDULE_REGION`).
 *
 * `region` — будь-яка область України з фіда: дзеркало віддає їх усі одним payload, тож окремого
 * запиту на область не потрібно, і `?region=kyivska-oblast` коштує стільки ж, скільки чернігівський.
 */
export async function loadMirrorSchedule(
  options: { fetchImpl?: typeof fetch; nowMs?: number; force?: boolean; region?: string } = {},
): Promise<MirrorSchedule> {
  const region = options.region ?? env.MIRROR_SCHEDULE_REGION;
  const nowMs = options.nowMs ?? Date.now();
  if (!options.force && cache && cache.expiresAtMs > nowMs) return scheduleForRegion(region);
  // Пауза після збою: не смикаємо мережу на кожен запит сторінки (див. MIRROR_FAILURE_BACKOFF_MS).
  if (!options.force && nowMs < retryAfterMs) {
    const stored = cachedSchedule(region);
    if (stored) return stored;
    throw new Error('Дзеркало ГПВ тимчасово недоступне (пауза після збою), збереженого знімка немає');
  }
  // Є прострочений знімок — віддаємо його негайно, свіжий тягнемо у фоні.
  if (!options.force && cache) {
    void startRefresh(options.fetchImpl);
    return scheduleForRegion(region);
  }
  const fresh = await startRefresh(options.fetchImpl, !options.force);
  // `fresh` завжди типової області; для іншої беремо той самий свіжий payload через memo.
  if (fresh) return region === env.MIRROR_SCHEDULE_REGION ? fresh : scheduleForRegion(region);
  const stored = cachedSchedule(region);
  if (stored) return stored;
  throw new Error('Дзеркало ГПВ недоступне, а збереженого знімка немає');
}

/** Слоти дзеркала разом з областю, до якої вони належать (`region` — частина ключа в БД). */
type RegionalSlots = { region: string; slots: MirrorSlot[] };

/**
 * Пише слоти дзеркала в `schedule_slots` (`source = 'mirror'`) за ОДНУ транзакцію — для однієї або
 * кількох областей одразу.
 *
 * Ідемпотентно й безпечно для інших джерел: спершу видаляємо ЛИШЕ власні рядки за тими самими
 * областю/чергою/датою, потім вставляємо з `onConflictDoNothing` — ручний, операторський і
 * telegram-імпорт не затираються, а їхні конфліктні рядки лишаються за ними
 * (як в `importTelegramScheduleSlots`).
 *
 * Чому одна транзакція на всі області: частково оновлена Україна («у сусідів графік новий, у нас
 * старий») виглядає як справжній графік, але ним не є — це гірше за чесний збій імпорту.
 */
async function writeMirrorSlots(batches: RegionalSlots[]): Promise<MirrorImportResult> {
  const slots = batches.flatMap((batch) => batch.slots.map((slot) => ({ ...slot, region: batch.region })));
  const keys = [...new Set(slots.map((slot) => `${slot.region}|${slot.queue}|${slot.date}`))];

  let imported = 0;
  if (keys.length > 0) {
    const { db } = await import('../db/connection.js');
    const { scheduleSlots } = await import('../db/schema.js');
    const { and, eq } = await import('drizzle-orm');
    await db.transaction(async (tx) => {
      for (const key of keys) {
        const [region, queue, date] = key.split('|');
        await tx.delete(scheduleSlots).where(and(
          eq(scheduleSlots.region, region!),
          eq(scheduleSlots.queue, queue!),
          eq(scheduleSlots.date, date!),
          eq(scheduleSlots.source, MIRROR_SCHEDULE_SOURCE),
        ));
      }
      for (const slot of slots) {
        const rows = await tx.insert(scheduleSlots).values({
          region: slot.region,
          queue: slot.queue,
          date: slot.date,
          timeFrom: slot.timeFrom,
          timeTo: slot.timeTo,
          stateCode: slot.stateCode,
          stateName: slot.stateName,
          stateColor: slot.stateColor,
          source: MIRROR_SCHEDULE_SOURCE,
        }).onConflictDoNothing().returning({ id: scheduleSlots.id });
        imported += rows.length;
      }
    });
  }

  return {
    imported,
    queues: [...new Set(slots.map((slot) => slot.queue))].sort(compareQueueCodes),
    dates: [...new Set(slots.map((slot) => slot.date))].sort(),
    regions: [...new Set(slots.map((slot) => slot.region))].sort(),
    empty: slots.length === 0,
  };
}

/** Запис слотів ОДНІЄЇ області (публічний вхід для наявних викликів і тестів). */
export async function importMirrorSchedule(
  schedule: MirrorSchedule,
  filter: { queues?: string[]; dates?: string[] } = {},
): Promise<MirrorImportResult> {
  const queues = filter.queues ? new Set(filter.queues) : null;
  const dates = filter.dates ? new Set(filter.dates) : null;
  return writeMirrorSlots([{
    region: schedule.regionCpu,
    slots: schedule.slots.filter((slot) => (!queues || queues.has(slot.queue)) && (!dates || dates.has(slot.date))),
  }]);
}

/**
 * Останній відомий знімок дзеркала ЛИШЕ з кеша — БЕЗ мережі.
 *
 * Для публічних читань каталогу областей: сторінка не має чекати на сторонній worker і не має права
 * валитися від його таймауту. Кеш наповнює планувальник імпорту (кожні 30–60 хв), тож він практично
 * завжди теплий; холодний кеш — це `null`, і каталог тоді чесно береться лише з БД.
 * Прострочений кеш теж віддаємо: перелік областей і черг — метадані, а не дані про відключення
 * (застарілість слотів видно в `lastDate`).
 */
export function peekMirrorSnapshot(): { payload: Record<string, unknown>; regions: string[] } | null {
  if (!cache) return null;
  return { payload: cache.payload, regions: regionsFromPayload(cache.payload).map((region) => region.cpu) };
}

/**
 * Оновлює каталог областей і черг (`regions`, `region_queues`) тим, що є у фіді.
 *
 * Потрібно, щоб `/api/v1/regions` знав про область ще до появи першого слота, і щоб було видно, які
 * черги в області взагалі існують (навіть коли цього дня в них немає відключень). Помилку тут ковтає
 * викликач: каталог — метадані, а слоти вже записані, тож губити їх через невдалий upsert не можна.
 */
async function syncRegionCatalog(entries: Array<{ cpu: string; nameUa: string; queues: string[] }>): Promise<void> {
  if (entries.length === 0) return;
  const { db } = await import('../db/connection.js');
  const { regions, regionQueues } = await import('../db/schema.js');
  const { sql } = await import('drizzle-orm');
  await db.transaction(async (tx) => {
    for (const entry of entries) {
      await tx
        .insert(regions)
        .values({ cpu: entry.cpu, nameUa: entry.nameUa })
        .onConflictDoUpdate({
          target: regions.cpu,
          set: { nameUa: entry.nameUa, isActive: true, updatedAt: sql`now()` },
        });
      for (const queue of entry.queues) {
        await tx
          .insert(regionQueues)
          .values({ cpu: entry.cpu, queue, groupKey: groupKeyFromQueueCode(queue) })
          .onConflictDoUpdate({
            target: [regionQueues.cpu, regionQueues.queue],
            set: { lastSeenAt: sql`now()`, isActive: true },
          });
      }
    }
  });
}

/**
 * Забирає свіжий payload (з TTL-кешем) і пише в БД УСІ області, які є у фіді, за одну транзакцію.
 * Для cron і адмін-кнопки. `MIRROR_SCHEDULE_IMPORT_REGIONS` (порожньо = всі) звужує набір.
 */
export async function importMirrorScheduleFromSource(
  options: { fetchImpl?: typeof fetch; force?: boolean; regions?: string[] } = {},
): Promise<MirrorImportResult> {
  const snapshot = await loadMirrorSnapshot({ fetchImpl: options.fetchImpl, force: options.force });
  const configured = env.MIRROR_SCHEDULE_IMPORT_REGIONS;
  const regions = options.regions ?? (configured.length > 0 ? configured : snapshot.regions);
  const batches = regions.map((region) => ({
    region,
    slots: mirrorScheduleFromPayload(snapshot.payload, region, snapshot.sourceTimestamp, snapshot.fetchedAtMs).slots,
  }));
  const result = await writeMirrorSlots(batches);
  // Каталог синхронізуємо ПІСЛЯ слотів і НЕ валимо імпорт, якщо він не вдався: слоти — головне.
  try {
    const names = new Map(regionsFromPayload(snapshot.payload).map((region) => [region.cpu, region.nameUa]));
    await syncRegionCatalog(regions.map((cpu) => ({
      cpu,
      nameUa: names.get(cpu) ?? cpu,
      queues: queueCodesOfRegion(snapshot.payload, cpu),
    })));
  } catch (error) {
    logger.warn({ err: error }, 'Mirror region catalog sync failed; slots are stored');
  }
  return result;
}

/**
 * «Сирий» знімок усього фіда (усі області) + метадані. Основа для каталогу областей і
 * мультирегіонального імпорту: розбирати 220 КБ на кожну область окремо не потрібно.
 *
 * Кидає, якщо ні кеша, ні мережі — викликач вирішує, чи це помилка (імпорт), чи привід узяти дані з БД
 * (каталог областей).
 */
export async function loadMirrorSnapshot(
  options: { fetchImpl?: typeof fetch; force?: boolean } = {},
): Promise<{ payload: Record<string, unknown>; sourceTimestamp: string | null; fetchedAtMs: number; regions: string[] }> {
  try {
    await loadMirrorSchedule(options);
  } catch {
    // Свідомо ковтаємо: якщо в кеші щось є, воно ще придатне (див. коментар у loadMirrorRegions).
  }
  if (!cache) throw new Error('Дзеркало ГПВ недоступне, а збереженого знімка немає');
  return {
    payload: cache.payload,
    sourceTimestamp: cache.sourceTimestamp,
    fetchedAtMs: cache.fetchedAtMs,
    regions: regionsFromPayload(cache.payload).map((region) => region.cpu),
  };
}

/**
 * Області у payload дзеркала: `cpu` + українська назва. Чиста функція — тестується без мережі.
 * Назва відсутня у фіді → показуємо `cpu`, бо вигадувати назву області не можна.
 */
export function regionsFromPayload(payload: Record<string, unknown>): Array<{ cpu: string; nameUa: string }> {
  const regions = regionsOf(payload) ?? [];
  const seen = new Map<string, string>();
  for (const item of regions) {
    if (!isJsonObject(item)) continue;
    const cpu = typeof item['cpu'] === 'string' ? item['cpu'].trim() : '';
    if (!cpu) continue;
    const rawName = item['name_ua'];
    seen.set(cpu, typeof rawName === 'string' && rawName.trim() !== '' ? rawName.trim() : cpu);
  }
  return [...seen.entries()].map(([cpu, nameUa]) => ({ cpu, nameUa }));
}

/**
 * Коди черг області у форматі застосунку (`2.2` → `2/2`). Беремо і з розібраних слотів, і з ключів
 * `schedule`: черга з самими лише «світло є» (коди 0/1) слотів відключень не дає, але в списку черг
 * області бути мусить — саме її обирає людина.
 */
export function queueCodesOfRegion(payload: Record<string, unknown>, regionCpu: string): string[] {
  const codes = new Set(extractMirrorSlots(payload, regionCpu).map((slot) => slot.queue));
  const region = (regionsOf(payload) ?? []).find((item) => isJsonObject(item) && item['cpu'] === regionCpu);
  if (isJsonObject(region)) {
    const schedule = region['schedule'];
    if (isJsonObject(schedule)) {
      for (const key of Object.keys(schedule)) {
        const queue = queueFromGroupKey(key);
        if (queue) codes.add(queue);
      }
    }
    // Компактний формат (масиви `today`/`tomorrow`) не має ключів черг — черга лежить у `group`.
    if (Array.isArray(region['today'])) {
      const queue = queueFromGroupKey(String(region['group'] ?? ''));
      if (queue) codes.add(queue);
    }
  }
  return [...codes].sort(compareQueueCodes);
}

/**
 * Каталог областей із дзеркала. `null` — дзеркало недоступне і кеша немає: викликач віддає те, що вже
 * є в БД (або чесну порожнечу). Навмисно НЕ кидає: `/api/v1/regions` не має падати через worker.
 */
export async function loadMirrorRegions(
  options: { fetchImpl?: typeof fetch; force?: boolean } = {},
): Promise<Array<{ cpu: string; nameUa: string }> | null> {
  try {
    await loadMirrorSchedule(options);
  } catch {
    // див. вище: свіжий знімок не потрібен, якщо в кеші є придатний.
  }
  return cache ? regionsFromPayload(cache.payload) : null;
}

/** Черги однієї області з кеша/мережі; `null` — дзеркало недоступне і кеша немає. */
export async function loadMirrorRegionQueues(
  regionCpu: string,
  options: { fetchImpl?: typeof fetch; force?: boolean } = {},
): Promise<string[] | null> {
  try {
    await loadMirrorSchedule({ ...options, region: regionCpu });
  } catch {
    // див. loadMirrorRegions
  }
  return cache ? queueCodesOfRegion(cache.payload, regionCpu) : null;
}

/**
 * Підтягує дзеркало під конкретну чергу й дату, якщо в БД ще немає свіжішого імпорту звідти.
 * Викликається з `GET /api/v1/schedules`: «Мої черги» показують реальний ГПВ одразу, без кнопки
 * «Оновити» й без очікування cron. `null` — дзеркало вимкнено конфігом.
 */
export async function ensureMirrorSchedule(
  queue: string,
  date: string,
  options: { fetchImpl?: typeof fetch; region?: string } = {},
): Promise<MirrorImportResult | null> {
  if (!env.MIRROR_SCHEDULE_ENABLED) return null;
  const schedule = await loadMirrorSchedule({ fetchImpl: options.fetchImpl, region: options.region });
  const region = schedule.regionCpu;
  if (!schedule.slots.some((slot) => slot.queue === queue && slot.date === date)) {
    return { imported: 0, queues: [], dates: [], regions: [], empty: true };
  }

  const { db } = await import('../db/connection.js');
  const { scheduleSlots } = await import('../db/schema.js');
  const { and, eq } = await import('drizzle-orm');
  const wanted = schedule.slots.filter((slot) => slot.queue === queue && slot.date === date);
  // «Вже імпортовано» визначаємо за СКЛАДОМ інтервалів, а не за часом створення рядка: час залежить
  // від годинника БД і процесу api (у контейнерах він спільний, але покладатися на це не можна).
  // Порівняння множин дає той самий результат і заодно самовідновлює втрачені/змінені рядки.
  // Область — частина ключа: «2/2 у Львівській» і «2/2 у Чернігівській» це різні графіки.
  const existing = await db
    .select({ timeFrom: scheduleSlots.timeFrom, timeTo: scheduleSlots.timeTo, source: scheduleSlots.source })
    .from(scheduleSlots)
    .where(and(eq(scheduleSlots.region, region), eq(scheduleSlots.queue, queue), eq(scheduleSlots.date, date)));
  const wantedKeys = wanted.map((slot) => `${slot.timeFrom}|${slot.timeTo}`);
  const mirrorKeys = new Set(
    existing.filter((row) => row.source === MIRROR_SCHEDULE_SOURCE).map((row) => `${row.timeFrom}|${row.timeTo}`),
  );
  // Унікальний індекс `schedule_slots` — (region, queue, date, time_from) БЕЗ джерела, тож рядок іншого
  // джерела (telegram/ручний) за тим самим часом перемагає нашу вставку (`onConflictDoNothing`).
  const occupiedByOtherSource = new Set(
    existing.filter((row) => row.source !== MIRROR_SCHEDULE_SOURCE).map((row) => row.timeFrom),
  );
  const importWouldChangeNothing =
    // немає наших застарілих рядків (їх довелося б видаляти)...
    [...mirrorKeys].every((key) => wantedKeys.includes(key)) &&
    // ...і кожен бажаний інтервал або вже в нас, або його початок зайнятий іншим джерелом.
    wanted.every((slot) => mirrorKeys.has(`${slot.timeFrom}|${slot.timeTo}`) || occupiedByOtherSource.has(slot.timeFrom));
  // Дзеркало віддає той самий знімок до наступного оновлення — повторний імпорт нічого не змінить,
  // а сторінка ходить сюди на кожен запит, тож без цієї перевірки був би зайвий запис у БД.
  if (importWouldChangeNothing) {
    return { imported: 0, queues: [queue], dates: [date], regions: [region], empty: false };
  }
  const result = await importMirrorSchedule(schedule, { queues: [queue], dates: [date] });
  logger.info({ region, queue, date, imported: result.imported }, 'Mirror schedule ensured for requested queue/date');
  return result;
}

