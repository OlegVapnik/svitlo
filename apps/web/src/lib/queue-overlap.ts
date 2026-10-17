import { OFF_STATE_CODE, minutesOfDay } from './scheduleWindow.js';
import { UNCERTAIN_STATE_CODE, type DaySchedule } from './day-schedule.js';

/**
 * «Перетин груп»: дві 24-годинні шкали й третя — коли світло є в обох місцях, хоч в одному,
 * або ніде.
 *
 * Навіщо окрема арифметика. Порівняння двох черг — це не дві картинки поруч, а саме перетин:
 * людина шукає години, коли можна бути вдома або на роботі зі світлом. Тому кожні півгодини
 * класифікуються один раз, і з цієї класифікації будуються і смуги, і цифри під ними —
 * щоб підпис «можна переждати 2 год» не розходився з тим, що намальовано.
 */

/** Півгодинний слот київської доби: саме така дискретність у графіків операторів. */
export const SLOT_MINUTES = 30;
export const SLOTS_PER_DAY = 24 * 60 / SLOT_MINUTES;

/** Стан однієї групи у слоті. */
export type SlotState = 'on' | 'off' | 'unknown';

/** Спільний стан двох груп у слоті. */
export type OverlapState = 'both' | 'either' | 'none' | 'unknown';

/**
 * Розкладає добу на 48 слотів для однієї групи.
 *
 * Немає жодного інтервалу й немає підтвердженого покриття — усі слоти `unknown`. Це важливо:
 * порожній графік не можна намалювати зеленим, інакше «перетин» обіцяв би світло там, де
 * оператор нічого не публікував.
 */
export function slotStates(day: DaySchedule): SlotState[] {
  const known = day.intervals.length > 0 || day.covered === true;
  const states: SlotState[] = new Array(SLOTS_PER_DAY).fill(known ? 'on' : 'unknown');

  for (const interval of day.intervals) {
    if (interval.stateCode !== OFF_STATE_CODE && interval.stateCode !== UNCERTAIN_STATE_CODE) continue;
    const from = minutesOfDay(interval.startsAt, day.date);
    const to = minutesOfDay(interval.endsAt, day.date);
    for (let index = 0; index < SLOTS_PER_DAY; index += 1) {
      const slotStart = index * SLOT_MINUTES;
      const slotEnd = slotStart + SLOT_MINUTES;
      // Слот «вимкнений», якщо відключення хоч частково його перекриває: півгодини — це вже
      // реальне вікно, і обіцяти в ньому світло не можна.
      if (slotStart < to && slotEnd > from) states[index] = 'off';
    }
  }

  return states;
}

/** Перетин двох шкал: обидві зі світлом / хоч одна / обидві без / немає даних. */
export function overlapStates(a: readonly SlotState[], b: readonly SlotState[]): OverlapState[] {
  const length = Math.min(a.length, b.length);
  const result: OverlapState[] = [];
  for (let index = 0; index < length; index += 1) {
    const left = a[index];
    const right = b[index];
    if (left === 'unknown' || right === 'unknown') {
      result.push('unknown');
    } else if (left === 'on' && right === 'on') {
      result.push('both');
    } else if (left === 'on' || right === 'on') {
      result.push('either');
    } else {
      result.push('none');
    }
  }
  return result;
}

export interface OverlapSummary {
  /** Слотів, коли світло є в обох місцях. */
  both: number;
  /** Слотів, коли світло є хоч в одному місці (можна переждати). */
  either: number;
  /** Слотів, коли обидві точки без світла. */
  none: number;
  /** Слотів без даних хоч по одній групі. */
  unknown: number;
}

export function overlapSummary(states: readonly OverlapState[]): OverlapSummary {
  const summary: OverlapSummary = { both: 0, either: 0, none: 0, unknown: 0 };
  for (const state of states) summary[state] += 1;
  return summary;
}

/** Слоти → хвилини: підписи під шкалою рахуються в годинах і хвилинах. */
export function slotsToMinutes(slots: number): number {
  return slots * SLOT_MINUTES;
}

/** Неперервний відрізок спільного блэкауту в хвилинах від початку київської доби. */
export interface OverlapWindow {
  from: number;
  to: number;
}

/**
 * Склеює сусідні слоти `none` в інтервали: «12:00–14:00, 18:30–19:00».
 *
 * Підсумкової цифри «Z год» мало: людині потрібно знати, коли саме обидві точки без світла,
 * щоб спланувати дорогу між ними. Рахуємо з тієї ж класифікації, що й смуги, тому підпис не
 * може розійтися з намальованим.
 */
export function overlapIntervals(states: readonly OverlapState[]): OverlapWindow[] {
  const windows: OverlapWindow[] = [];
  let start: number | null = null;
  for (let index = 0; index <= states.length; index += 1) {
    const isNone = index < states.length && states[index] === 'none';
    if (isNone && start === null) start = index * SLOT_MINUTES;
    if (!isNone && start !== null) {
      windows.push({ from: start, to: index * SLOT_MINUTES });
      start = null;
    }
  }
  return windows;
}
