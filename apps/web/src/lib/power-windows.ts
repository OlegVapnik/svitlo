import type { ScheduleIntervalUtc } from '@svitlo/shared';
import { kyivDateKey } from './outage-dates.js';
import { OFF_STATE_CODE, kyivOffset, minutesOfDay } from './scheduleWindow.js';

/**
 * «Коли увімкнути прилади»: пошук безперервних вікон зі світлом на сьогодні й завтра.
 *
 * Навіщо окремий модуль. Питання «чи встигну я прання за 2 години до наступного відключення?»
 * — це арифметика над тими самими інтервалами, що й смуга 24 годин, і вона мусить бути однакова
 * в усіх місцях. Тому тут немає React і немає форматування: тільки хвилини київської доби. Текст
 * («Найкраще вікно: 14:00 – 18:00») складає компонент через i18n.
 *
 * Що вважаємо світлом. Усе, що не позначено як відключення: оператор малює добу суцільно, і
 * «дірка» в покритті означає світло, а не невідомість. Виняток — код 2 («можливо вимкнуть»):
 * радити пральну машину в такий годинник означало б обіцяти світло, якого оператор не гарантує,
 * тому такий відрізок теж розриває вікно.
 */

/** Код оператора «можливо вимкнуть»: не відключення, але й не гарантоване світло. */
export const UNCERTAIN_STATE_CODE = 2;

const DAY_MINUTES = 24 * 60;

/** Одна київська доба графіка. */
export interface DaySchedule {
  /** Київська дата YYYY-MM-DD. */
  date: string;
  intervals: ScheduleIntervalUtc[];
  /**
   * Оператор опублікував ГПВ на цю добу (навіть якщо годин відключень у ній немає).
   * Без цього прапорця порожній `intervals` — це «даних немає», а не «світло цілу добу».
   */
  covered?: boolean;
}

/** Безперервний відрізок зі світлом у межах київської доби. */
export interface LightWindow {
  date: string;
  /** Початок у хвилинах від 00:00 (0..1440). */
  start: number;
  /** Кінець у хвилинах від 00:00 (0..1440). */
  end: number;
  /** Довжина вікна в хвилинах. */
  minutes: number;
}

/** «Зараз» у хвилинах київської доби для конкретної дати; null — цієї доби не зараз. */
function nowMinutesOf(date: string, now: Date): number | null {
  if (date !== kyivDateKey(now)) return null;
  const dayStartMs = Date.parse(`${date}T00:00:00Z`) - kyivOffset(date) * 60_000;
  return Math.round((now.getTime() - dayStartMs) / 60_000);
}

/** Відрізки, у які світло не гарантоване: відключення та «можливо вимкнуть». */
function blockedSpans(day: DaySchedule): Array<[number, number]> {
  return day.intervals
    .filter((interval) => interval.stateCode === OFF_STATE_CODE || interval.stateCode === UNCERTAIN_STATE_CODE)
    .map((interval) => [minutesOfDay(interval.startsAt, day.date), minutesOfDay(interval.endsAt, day.date)] as [number, number])
    .filter(([start, end]) => end > start)
    .sort((left, right) => left[0] - right[0]);
}

function pushWindow(windows: LightWindow[], date: string, start: number, end: number): void {
  const from = Math.max(0, Math.min(DAY_MINUTES, Math.round(start)));
  const to = Math.max(0, Math.min(DAY_MINUTES, Math.round(end)));
  if (to <= from) return;
  windows.push({ date, start: from, end: to, minutes: to - from });
}

/**
 * Вікна зі світлом на передані доби (сьогодні + завтра).
 *
 * Сьогоднішнє вікно обрізається по «зараз»: минуле вже не допоможе вирішити, чи встигне прання.
 * Доби без даних (`intervals` порожні й `covered` не виставлений) не дають вікон узагалі —
 * вигадувати «світло цілу добу» там, де оператор нічого не публікував, не можна.
 */
export function lightWindows(days: readonly DaySchedule[], now: Date = new Date()): LightWindow[] {
  const windows: LightWindow[] = [];
  const todayKey = kyivDateKey(now);

  for (const day of days) {
    // Минулі доби не показуємо навіть якщо їх випадково передали.
    if (day.date < todayKey) continue;
    if (day.intervals.length === 0 && day.covered !== true) continue;

    const nowMinutes = nowMinutesOf(day.date, now);
    let cursor = nowMinutes == null ? 0 : Math.max(0, nowMinutes);

    for (const [start, end] of blockedSpans(day)) {
      if (end <= cursor) continue;
      if (start > cursor) pushWindow(windows, day.date, cursor, Math.min(start, DAY_MINUTES));
      cursor = Math.max(cursor, end);
      if (cursor >= DAY_MINUTES) break;
    }
    if (cursor < DAY_MINUTES) pushWindow(windows, day.date, cursor, DAY_MINUTES);
  }

  return windows;
}

/** Результат підбору вікна під тривалість приладу. */
export interface PowerSuggestion {
  /** 'now' — світло вже є й часу вистачає; 'best' — найкраще вікно попереду; 'none' — не встигаємо. */
  kind: 'now' | 'best' | 'none';
  window: LightWindow | null;
  /** Запас понад тривалість приладу в хвилинах (kind='now' | 'best'). */
  slack: number;
  /** Скільки хвилин лишилося від «зараз» до кінця поточного вікна. */
  remaining: number;
}

/**
 * Підбирає вікно під прилад тривалістю `taskMinutes`.
 *
 * Порядок переваг:
 *   1. Світло вже є і його вистачає на весь прилад — людині не треба чекати.
 *   2. Найбільший запас серед майбутніх вікон (за рівного запасу — раніше): запас і є тією
 *      «+2 год», яку бачить людина у підписі.
 *   3. Якщо не встигаємо ніде — найдовше вікно, щоб чесно сказати, скільки його вистачить.
 */
export function planPowerWindow(
  days: readonly DaySchedule[],
  taskMinutes: number,
  now: Date = new Date(),
): PowerSuggestion {
  const windows = lightWindows(days, now);
  const todayKey = kyivDateKey(now);
  const nowMinutes = nowMinutesOf(todayKey, now);

  const current =
    nowMinutes == null
      ? null
      : windows.find((window) => window.date === todayKey && window.start <= nowMinutes && nowMinutes < window.end) ?? null;
  const remaining = current && nowMinutes != null ? current.end - nowMinutes : 0;

  if (current && remaining >= taskMinutes) {
    return { kind: 'now', window: current, slack: remaining - taskMinutes, remaining };
  }

  let best: LightWindow | null = null;
  let bestSlack = -1;
  for (const window of windows) {
    if (window.minutes < taskMinutes) continue;
    const slack = window.minutes - taskMinutes;
    if (slack > bestSlack) {
      best = window;
      bestSlack = slack;
    }
  }
  if (best) return { kind: 'best', window: best, slack: bestSlack, remaining: 0 };

  let longest: LightWindow | null = null;
  for (const window of windows) {
    if (longest == null || window.minutes > longest.minutes) longest = window;
  }
  return { kind: 'none', window: longest, slack: 0, remaining: 0 };
}

/**
 * Момент початку вікна в мілісекундах (UTC). Потрібен таймеру нагадування: інтервали в нас
 * зберігаються в хвилинах київської доби, а `setTimeout` рахує реальний час.
 */
export function windowStartMs(window: LightWindow): number {
  return Date.parse(`${window.date}T00:00:00Z`) - kyivOffset(window.date) * 60_000 + window.start * 60_000;
}
