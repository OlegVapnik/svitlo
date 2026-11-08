/**
 * «Що змінилось у графіку»: історія ревізій доби й порівняння зі свіжим зрізом.
 *
 * Сховище — платформенний `storage` із `@svitlo/core` (localStorage у вебі, kv-store у
 * застосунку), тому бізнес-код не знає, де саме лежить зріз. Читання й запис загорнуті в
 * try/catch: приватний режим браузера або переповнена квота не повинні ламати головний екран.
 *
 * Ключ містить область, ЧЕРГУ й дату. Без черги перемикання `2/2` → `4/1` давало порівняння
 * двох різних графіків і фальшиве «графік змінився». Без дати о півночі кожен користувач
 * бачив би зміну на весь день.
 *
 * Головна відмінність від старого «останній зріз»: після першої зміни ревізії зберігаються
 * до кінця доби. Повторний `/sync`, перезапуск застосунку або однаковий графік більше не
 * стирають плашку — вона показує останню правку й усю історію за день.
 */
import {
  clockLabel,
  diffScheduleIntervals,
  kyivDateKeyFromMs,
  kyivMinuteOfDay,
  mergeIntervals,
  type IsoInterval,
  type TimeRange,
} from '@svitlo/domain';
import { storage, type KeyValueStorage } from '../storage';

/** Одна виявлена правка графіка: коли, скільки хвилин і які саме вікна. */
export interface ScheduleRevision {
  /** Момент, коли клієнт уперше побачив цю правку (ISO). */
  detectedAt: string;
  /** Той самий момент у київському часі (`HH:MM`) для плашки. */
  detectedAtLabel: string;
  addedMinutes: number;
  removedMinutes: number;
  addedRanges: TimeRange[];
  removedRanges: TimeRange[];
  /** Готова фраза з конкретними годинами. */
  summary: string;
  /** Те саме під явною назвою для нового UI. */
  summaryUk: string;
}

/** Те, що показує банер: остання правка + історія за добу. */
export interface ScheduleChangeNotice {
  addedMinutes: number;
  removedMinutes: number;
  /** Вікна останньої правки, щоб UI міг показати їх без пошуку в історії. */
  addedRanges: TimeRange[];
  removedRanges: TimeRange[];
  summary: string;
  summaryUk: string;
  /** Коли сталася остання правка (ISO). */
  detectedAt: string;
  /** Усі правки за добу, від найстарішої до найновішої. */
  revisions: ScheduleRevision[];
  /** Базовий графік, який клієнт уперше побачив за цю добу. */
  initialIntervals: IsoInterval[];
  /** Поточний графік. */
  currentIntervals: IsoInterval[];
  /** Наскільки початковий план збігся з фактом, 0…100; `null` — немає даних. */
  planAccuracyPercent: number | null;
}

/** Збережений стан доби для пари «область + черга». */
export interface ScheduleRevisionsState {
  initialIntervals: IsoInterval[];
  lastIntervals: IsoInterval[];
  revisions: ScheduleRevision[];
  firstSeenAt: string;
  updatedAt: string;
}

const KEY_PREFIX = 'svitlo.schedule-revisions.v2';
/** Старий формат без `.v2`: міг містити фейкові ревізії, тому такі ключі прибираємо. */
const PREVIOUS_KEY_PREFIX = 'svitlo.schedule-revisions';
const LEGACY_KEY_PREFIX = 'svitlo.schedule-prev';
const KEEP_DAYS = 7;

/** Ключ сховища: `svitlo.schedule-revisions.v2.<regionCpu>.<queue>.<date>`. */
export function scheduleRevisionsKey(regionCpu: string, queue: string, date: string): string {
  return `${KEY_PREFIX}.${regionCpu}.${queue}.${date}`;
}

/** Старий ключ без черги — лишаємо для читання/очищення під час міграції. */
export function legacyScheduleSnapshotKey(regionCpu: string, date: string): string {
  return `${LEGACY_KEY_PREFIX}.${regionCpu}.${date}`;
}

/**
 * Останній обчислений результат на ключ.
 *
 * React у StrictMode викликає ефекти двічі, а кожен рефетч віддає новий масив інтервалів.
 * Без кешу другий виклик уже порівнював би свіжий зріз сам із собою. Тут же повторний виклик
 * з тим самим підписом повертає той самий notice — включно з ревізіями, якщо вони вже є.
 */
const noticeCache = new Map<string, { signature: string; notice: ScheduleChangeNotice | null }>();

/** Лише поля, які реально потрібні для порівняння: імена й кольори стану не зберігаємо. */
function normalizeIntervals(intervals: readonly IsoInterval[]): IsoInterval[] {
  return intervals
    .filter(
      (interval) =>
        typeof interval?.startsAt === 'string' &&
        typeof interval?.endsAt === 'string' &&
        !Number.isNaN(Date.parse(interval.startsAt)) &&
        !Number.isNaN(Date.parse(interval.endsAt)),
    )
    .map((interval) => ({ startsAt: interval.startsAt, endsAt: interval.endsAt }))
    .sort((left, right) => left.startsAt.localeCompare(right.startsAt) || left.endsAt.localeCompare(right.endsAt));
}

/** Підпис зрізу: порядок слотів від джерела не повинен виглядати як зміна графіка. */
function signatureOf(intervals: readonly IsoInterval[]): string {
  return JSON.stringify(normalizeIntervals(intervals));
}

function normalizeRanges(ranges: unknown): TimeRange[] {
  if (!Array.isArray(ranges)) return [];
  return ranges
    .filter((range): range is Partial<TimeRange> => Boolean(range) && typeof range === 'object')
    .filter(
      (range) =>
        typeof range.startMin === 'number' &&
        typeof range.endMin === 'number' &&
        typeof range.start === 'string' &&
        typeof range.end === 'string',
    )
    .map((range) => ({
      startMin: range.startMin!,
      endMin: range.endMin!,
      start: range.start!,
      end: range.end!,
    }));
}

/** Київський `HH:MM` для ISO-моменту; порожньо, якщо дата не розібралася. */
function revisionTimeLabel(iso: string): string {
  const minute = kyivMinuteOfDay(iso);
  return minute === null ? '' : clockLabel(minute);
}

function normalizeRevision(value: unknown): ScheduleRevision | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<ScheduleRevision>;
  if (
    typeof candidate.detectedAt !== 'string' ||
    typeof candidate.addedMinutes !== 'number' ||
    typeof candidate.removedMinutes !== 'number' ||
    typeof candidate.summary !== 'string'
  ) {
    return null;
  }
  return {
    detectedAt: candidate.detectedAt,
    detectedAtLabel:
      typeof candidate.detectedAtLabel === 'string' && candidate.detectedAtLabel
        ? candidate.detectedAtLabel
        : revisionTimeLabel(candidate.detectedAt),
    addedMinutes: candidate.addedMinutes,
    removedMinutes: candidate.removedMinutes,
    addedRanges: normalizeRanges(candidate.addedRanges),
    removedRanges: normalizeRanges(candidate.removedRanges),
    summary: candidate.summary,
    summaryUk: typeof candidate.summaryUk === 'string' ? candidate.summaryUk : candidate.summary,
  };
}

/** Безпечне читання стану: битий JSON або чужа структура — це «стану немає», а не падіння. */
export function readScheduleRevisions(
  regionCpu: string,
  queue: string,
  date: string,
  store: KeyValueStorage = storage,
): ScheduleRevisionsState | null {
  try {
    const raw = store.getItem(scheduleRevisionsKey(regionCpu, queue, date));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const candidate = parsed as Partial<ScheduleRevisionsState>;
    if (!Array.isArray(candidate.initialIntervals) || !Array.isArray(candidate.lastIntervals)) return null;
    const revisions = Array.isArray(candidate.revisions)
      ? candidate.revisions.map(normalizeRevision).filter((item): item is ScheduleRevision => item !== null)
      : [];
    return {
      initialIntervals: normalizeIntervals(candidate.initialIntervals),
      lastIntervals: normalizeIntervals(candidate.lastIntervals),
      revisions,
      firstSeenAt: typeof candidate.firstSeenAt === 'string' ? candidate.firstSeenAt : '',
      updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : '',
    };
  } catch {
    // Немає доступу до сховища або лежить невалідний JSON — поводимось як при першому запуску.
    return null;
  }
}

/** Запис стану; помилки квоти ковтаємо, бо банер — підказка, а не критичні дані. */
function writeScheduleRevisions(
  regionCpu: string,
  queue: string,
  date: string,
  state: ScheduleRevisionsState,
  store: KeyValueStorage,
): void {
  try {
    store.setItem(scheduleRevisionsKey(regionCpu, queue, date), JSON.stringify(state));
  } catch {
    // Сховище недоступне: порівняння спрацює наступного разу від старого зрізу.
  }
}

/** Чи можна видаляти ключ: дата в кінці ключа старша за `KEEP_DAYS`. */
function isExpiredKey(key: string, today: string): boolean {
  const date = key.slice(key.lastIndexOf('.') + 1);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) return false;
  const age = Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(age) && age > KEEP_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * Чистить ключі старші за тиждень. Без цього кожна доба й кожна черга лишали б у сховищі
 * вічний JSON, і через місяць localStorage/kv-store роздувався б до квоти.
 */
export function pruneScheduleRevisions(store: KeyValueStorage = storage, today: string): void {
  try {
    const keys = store.keys?.();
    if (!keys) return;
    for (const key of keys) {
      const isV2 = key.startsWith(`${KEY_PREFIX}.`);
      if (isV2 && isExpiredKey(key, today)) store.removeItem(key);
      // Старий формат (без .v2) більше не читаємо: він міг містити ревізії, пораховані
      // без відсікання минулих годин. Видаляємо всі такі ключі, а не лише прострочені.
      if (!isV2 && key.startsWith(`${PREVIOUS_KEY_PREFIX}.`)) store.removeItem(key);
      // Старий формат без черги теж не читаємо: він може містити графік іншої черги.
      if (key.startsWith(LEGACY_KEY_PREFIX)) store.removeItem(key);
    }
  } catch {
    // Сховище недоступне — прибирання не критичне для поточного рендера.
  }
}

function totalMinutes(intervals: readonly IsoInterval[]): number {
  return mergeIntervals([...intervals]).reduce((sum, range) => sum + (range.endMin - range.startMin), 0);
}

/**
 * Plan vs Fact: скільки початкового плану дожило до поточного графіка.
 *
 * Якщо базовий план був порожній, точність 100% лише коли й зараз порожньо: поява годин —
 * це не «план виконано», а нові дані. Інакше віднімаємо від плану скасовані хвилини.
 */
function planAccuracy(initial: readonly IsoInterval[], current: readonly IsoInterval[]): number | null {
  const initialMinutes = totalMinutes(initial);
  const currentMinutes = totalMinutes(current);
  if (initialMinutes === 0) return currentMinutes === 0 ? 100 : 0;
  const removed = diffScheduleIntervals(initial, current, { emptyPrevIsFirstRun: false }).removedMinutes;
  return Math.max(0, Math.min(100, Math.round(((initialMinutes - removed) / initialMinutes) * 100)));
}

function buildNotice(state: ScheduleRevisionsState): ScheduleChangeNotice | null {
  const latest = state.revisions[state.revisions.length - 1];
  if (!latest) return null;
  return {
    addedMinutes: latest.addedMinutes,
    removedMinutes: latest.removedMinutes,
    addedRanges: latest.addedRanges,
    removedRanges: latest.removedRanges,
    summary: latest.summary,
    summaryUk: latest.summaryUk,
    detectedAt: latest.detectedAt,
    revisions: [...state.revisions],
    initialIntervals: state.initialIntervals,
    currentIntervals: state.lastIntervals,
    planAccuracyPercent: planAccuracy(state.initialIntervals, state.lastIntervals),
  };
}

/**
 * Порівнює свіжий зріз із збереженим, дописує ревізію і повертає історію за добу.
 *
 * `null` означає «показувати нічого»: перший запуск за добу, ідентичний графік без жодної
 * ревізії або недоступне сховище. Якщо ревізії вже є, повторний виклик з тим самим графіком
 * повертає ТОЙ САМИЙ notice — плашка не зникає після рефрешу чи перезапуску.
 */
export function rememberSchedule(
  regionCpu: string,
  queue: string,
  date: string,
  intervals: readonly IsoInterval[],
  store: KeyValueStorage = storage,
  now: Date = new Date(),
): ScheduleChangeNotice | null {
  const normalized = normalizeIntervals(intervals);
  const signature = signatureOf(normalized);
  const key = scheduleRevisionsKey(regionCpu, queue, date);

  const cached = noticeCache.get(key);
  if (cached && cached.signature === signature) return cached.notice;

  const nowIso = now.toISOString();
  const previous = readScheduleRevisions(regionCpu, queue, date, store);

  // Перший запуск за добу: запам'ятовуємо базовий графік, але плашку не показуємо.
  if (!previous) {
    writeScheduleRevisions(
      regionCpu,
      queue,
      date,
      {
        initialIntervals: normalized,
        lastIntervals: normalized,
        revisions: [],
        firstSeenAt: nowIso,
        updatedAt: nowIso,
      },
      store,
    );
    pruneScheduleRevisions(store, date);
    noticeCache.set(key, { signature, notice: null });
    return null;
  }

  // Графік не змінився: повертаємо накопичену історію, а не null. Це і є виправлення
  // «плашка зникає після першого ж фонового /sync».
  if (signatureOf(previous.lastIntervals) === signature) {
    const notice = buildNotice(previous);
    noticeCache.set(key, { signature, notice });
    return notice;
  }

  const today = kyivDateKeyFromMs(now.getTime());
  const nowMinutesOfDay = date === today ? kyivMinuteOfDay(now.toISOString()) ?? 0 : 0;
  const diff = diffScheduleIntervals(previous.lastIntervals, normalized, {
    emptyPrevIsFirstRun: false,
    nowMinutesOfDay,
  });  if (!diff.changed || !diff.summary || !diff.summaryUk) {
    // Теоретично недосяжно, але захищає від порожньої ревізії при дивному джерелі.
    writeScheduleRevisions(
      regionCpu,
      queue,
      date,
      { ...previous, lastIntervals: normalized, updatedAt: nowIso },
      store,
    );
    const notice = buildNotice(previous);
    noticeCache.set(key, { signature, notice });
    return notice;
  }

  const revision: ScheduleRevision = {
    detectedAt: nowIso,
    detectedAtLabel: revisionTimeLabel(nowIso),
    addedMinutes: diff.addedMinutes,
    removedMinutes: diff.removedMinutes,
    addedRanges: diff.addedRanges,
    removedRanges: diff.removedRanges,
    summary: diff.summary,
    summaryUk: diff.summaryUk,
  };
  const nextState: ScheduleRevisionsState = {
    ...previous,
    lastIntervals: normalized,
    revisions: [...previous.revisions, revision],
    updatedAt: nowIso,
  };
  writeScheduleRevisions(regionCpu, queue, date, nextState, store);
  pruneScheduleRevisions(store, date);
  const notice = buildNotice(nextState);
  noticeCache.set(key, { signature, notice });
  return notice;
}

/**
 * Скидає пам'ять про зміни для доби й черги.
 *
 * Потрібно при зміні області/черги в тестах і після ручного «скинути кеш»: інакше кеш
 * у пам'яті повертав би notice, якого в сховищі вже немає.
 */
export function forgetScheduleChange(regionCpu: string, queue: string, date: string): void {
  noticeCache.delete(scheduleRevisionsKey(regionCpu, queue, date));
}
