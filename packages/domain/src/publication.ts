/**
 * Публікація графіка: що зараз показувати людині за цю добу.
 *
 * Тут два різні питання, які легко переплутати:
 *  - «чи оператор опублікував добу?» — це прапорці покриття (`covered`) і «світло цілу добу»
 *    (`allClear`);
 *  - «що зі світлом зараз?» — це вікно графіка (`scheduleWindow`) і стан доби (`dayPowerState`).
 *
 * Правила чисті (графік + момент часу), тому живуть у домені: їх однаково рахують веб, застосунок
 * і Worker у `/sync`. Раніше вони лежали в `packages/core` двома файлами, а воркер мав власне
 * обчислення прапорців — і клієнт із сервером могли розійтися в тому, що вважати «даних немає».
 *
 * Жодних залежностей: типи тут структурні (мінімум полів), щоб домен не тягнув `@svitlo/shared`.
 */
import { kyivOffsetMinutesAt } from './kyiv-time.ts';
import { mergeIntervals } from './daily-intervals.ts';

/** Код стану оператора: 1 — світло є, 2 — розмін черги/підчерги, 3 — відключення. */
export const OFF_STATE_CODE = 3;

/** Порог «скоро вимкнуть», у хвилинах. Єдиний для героя, теми й хука стану мережі. */
export const SOON_MINUTES = 60;

/** Мінімум полів інтервалу, який потрібен цим правилам. */
export interface ScheduleIntervalLike {
  startsAt: string;
  endsAt: string;
  stateCode: number;
}

/** Мінімум полів добового графіка групи. */
export interface DayScheduleLike {
  intervals?: readonly ScheduleIntervalLike[] | null;
  /** Оператор явно підтвердив добу без відключень. */
  allClear?: boolean | null;
  /** Доба офіційно покрита джерелами (навіть якщо слотів немає). */
  covered?: boolean | null;
}

export type DayPowerState = 'on' | 'warning' | 'off' | 'allClear' | 'unknown';

export interface ScheduleWindow {
  /** Минута доби для «зараз» або null, якщо зараз не ця доба (наприклад, графік на завтра). */
  nowMinutes: number | null;
  /** Інтервал, у який потрапляє «зараз». */
  current: ScheduleIntervalLike | null;
  /** Чи є відключення просто зараз (stateCode 3). */
  isOff: boolean;
  /** Кінець поточного відключення. */
  offEndsAt: string | null;
  /** Початок найближчого відключення попереду. */
  nextStartsAt: string | null;
  /** Хвилин до найближчого відключення (коли світло є). */
  nextInMinutes: number | null;
  /** Хвилин до повернення світла (коли відключення йде). */
  backInMinutes: number | null;
  /** Скільки хвилин без світла за добу за графіком. */
  offMinutes: number;
}

export interface DayStatus {
  state: DayPowerState;
  /** Вікно доби, коли є інтервали; для `allClear`/`unknown` — null. */
  summary: ScheduleWindow | null;
}

export interface SlotProgress {
  /** Частка пройденого слота, 0..100. */
  percent: number;
  elapsedMinutes: number;
  remainingMinutes: number;
}

/** Літнє/зимове зміщення Києва в хвилинах для дати `YYYY-MM-DD`. */
export function kyivOffset(date: string): number {
  return kyivOffsetMinutesAt(Date.parse(`${date}T12:00:00Z`));
}

/** Минута доби (0..1440) для моменту ISO, що потрапив у вибрані київські сутки. */
export function minutesOfDay(iso: string, date: string): number {
  const offsetMin = kyivOffset(date);
  const value = (Date.parse(iso) - Date.parse(`${date}T00:00:00Z`) + offsetMin * 60_000) / 60_000;
  return Math.max(0, Math.min(24 * 60, Math.round(value)));
}

/** Скільки хвилин без світла за добу за графіком (з дедуплікацією та злиттям накладань). */
export function offMinutesOf(intervals: readonly ScheduleIntervalLike[], date: string): number {
  const rawIntervals = intervals
    .filter((interval) => interval.stateCode === OFF_STATE_CODE)
    .map((interval) => ({
      start: minutesOfDay(interval.startsAt, date),
      end: minutesOfDay(interval.endsAt, date),
    }));

  const merged = mergeIntervals(rawIntervals);
  return merged.reduce((sum, item) => sum + (item.end - item.start), 0);
}

/** Зведення за добу: що зараз, коли наступне відключення, скільки без світла за день. */
export function scheduleWindow(
  intervals: readonly ScheduleIntervalLike[],
  date: string,
  now: Date = new Date(),
): ScheduleWindow {
  const dayStartUtcMs = Date.parse(`${date}T00:00:00Z`) - kyivOffset(date) * 60_000;
  const isChosenDay = now.getTime() >= dayStartUtcMs && now.getTime() < dayStartUtcMs + 24 * 60 * 60_000;
  const nowMinutes = isChosenDay ? (now.getTime() - dayStartUtcMs) / 60_000 : null;

  const current =
    intervals.find(
      (interval) =>
        nowMinutes != null &&
        minutesOfDay(interval.startsAt, date) <= nowMinutes &&
        nowMinutes < minutesOfDay(interval.endsAt, date),
    ) ?? null;
  const isOff = current?.stateCode === OFF_STATE_CODE;

  const nextOff =
    intervals.find(
      (interval) => interval.stateCode === OFF_STATE_CODE && minutesOfDay(interval.startsAt, date) > (nowMinutes ?? -1),
    ) ?? null;

  // Округлюємо до цілих хвилин: інакше в UI потрапляє «через 4 год 30.13751666666667 хв».
  const nextInMinutes =
    nextOff && nowMinutes != null ? Math.max(0, Math.round(minutesOfDay(nextOff.startsAt, date) - nowMinutes)) : null;
  const backInMinutes =
    isOff && current && nowMinutes != null
      ? Math.max(0, Math.round(minutesOfDay(current.endsAt, date) - nowMinutes))
      : null;

  return {
    nowMinutes,
    current,
    isOff,
    offEndsAt: isOff && current ? current.endsAt : null,
    nextStartsAt: nextOff?.startsAt ?? null,
    nextInMinutes,
    backInMinutes,
    offMinutes: offMinutesOf(intervals, date),
  };
}

/** Мінімум полів, потрібних, щоб відповісти «графік опубліковано?». */
export interface SchedulePublicationLike {
  intervals?: readonly unknown[] | null;
  covered?: boolean | null;
  allClear?: boolean | null;
}

/**
 * Чи оператор опублікував графік на цю добу.
 *
 * Головне правило: **наявність хоч одного інтервалу доводить публікацію**. Якщо оператор дав
 * слоти на 12:00–14:00, доба вже опублікована — незалежно від того, що каже `covered`, і
 * незалежно від того, що зараз 15:27 і всі слоти вже в минулому. Раніше Hero виводив
 * «Графік ще не опубліковано» саме через те, що дивився лише на майбутні відключення.
 *
 * `covered: true` без слотів — теж публікація (оператор підтвердив добу, просто відключень
 * немає). Порожній графік без жодного прапорця — ні: це «даних немає».
 */
export function isSchedulePublished(
  schedule: SchedulePublicationLike | null | undefined,
): boolean {
  if (!schedule) return false;
  if ((schedule.intervals?.length ?? 0) > 0) return true;
  return schedule.covered === true || schedule.allClear === true;
}

/**
 * Визначає стан доби за графіком групи.
 *
 * Порожній список інтервалів — це НЕ «світло є»: без явного `allClear` така доба `unknown`.
 * Правило продукту: зелений при відсутності даних заборонений.
 */
export function dayPowerState(
  schedule: DayScheduleLike | undefined,
  date: string,
  now: Date = new Date(),
): DayStatus {
  if (!schedule) return { state: 'unknown', summary: null };

  const intervals = schedule.intervals ?? [];
  if (intervals.length === 0) {
    return schedule.allClear === true
      ? { state: 'allClear', summary: null }
      : { state: 'unknown', summary: null };
  }

  const summary = scheduleWindow(intervals, date, now);
  if (summary.isOff) return { state: 'off', summary };
  if (summary.nextInMinutes != null && summary.nextInMinutes <= SOON_MINUTES) {
    return { state: 'warning', summary };
  }
  return { state: 'on', summary };
}

/**
 * Прогрес поточного слота — основа волнистої смуги в Hero.
 *
 * Слот — це «відключення» (поки світла немає) або вікно «світло є»: від кінця попереднього
 * відключення до початку наступного. Другий випадок потрібен, щоб смуга не зникала, коли все
 * добре: людина бачить, скільки ще спокійного часу лишилося.
 *
 * Повертає null, якщо рахувати нема чого: графіка немає, показані не сьогоднішні сутки або
 * відключень попереду більше не буде.
 */
export function slotProgress(
  intervals: readonly ScheduleIntervalLike[],
  date: string,
  now: Date = new Date(),
): SlotProgress | null {
  const summary = scheduleWindow(intervals, date, now);
  const nowMinutes = summary.nowMinutes;
  if (nowMinutes == null || intervals.length === 0) return null;

  if (summary.isOff && summary.current) {
    return buildSlot(
      minutesOfDay(summary.current.startsAt, date),
      minutesOfDay(summary.current.endsAt, date),
      nowMinutes,
    );
  }

  if (!summary.nextStartsAt) return null;
  const nextStart = minutesOfDay(summary.nextStartsAt, date);
  const previousEnds = intervals
    .map((interval) => minutesOfDay(interval.endsAt, date))
    .filter((end) => end <= nowMinutes);
  const from = previousEnds.length > 0 ? Math.max(...previousEnds) : 0;
  return buildSlot(from, nextStart, nowMinutes);
}

function buildSlot(from: number, to: number, nowMinutes: number): SlotProgress | null {
  if (to <= from) return null;
  const point = Math.max(from, Math.min(to, nowMinutes));
  return {
    percent: Math.round(((point - from) / (to - from)) * 100),
    elapsedMinutes: Math.round(point - from),
    remainingMinutes: Math.round(to - point),
  };
}
