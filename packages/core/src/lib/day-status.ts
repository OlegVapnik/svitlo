import type { QueueScheduleData } from '@svitlo/shared';
import { scheduleWindow, type ScheduleWindow } from './scheduleWindow';

/**
 * Статус доби по графіку групи — спільний розрахунок для веба і застосунку.
 *
 * Тут навмисно НЕ чотири стани, а пʼять. Два різні «порожні» не можна зводити до одного:
 * «оператор нічого не опублікував» — це `unknown` (сірий), а «опублікував добу без відключень» —
 * це `allClear` (зелений). Раніше порожній список інтервалів завжди ставав `unknown`, і Київ із
 * опублікованим днем без відключень показував «Даних графіка немає» замість «Світло є».
 *
 * Ключове правило продукту лишається: зелений при ВІДСУТНОСТІ даних заборонений. Тому `allClear`
 * вимагає явного підтвердження дня (`allClear === true`), а не самого лише порожнього масиву.
 */

/** Порог «скоро вимкнуть», у хвилинах. Єдиний для героя, теми і хука стану мережі. */
export const SOON_MINUTES = 60;

export type DayPowerState = 'on' | 'warning' | 'off' | 'allClear' | 'unknown';

export interface DayStatus {
  state: DayPowerState;
  /** Вікно доби, коли є інтервали; для `allClear`/`unknown` — `null` (лічити нема чого). */
  summary: ScheduleWindow | null;
}

/**
 * Визначає стан доби за графіком групи.
 *
 * `covered` без `allClear` — це відсталий імпорт (фід уже бачить відключення, а слотів ще немає),
 * тому такий день лишається `unknown`, а не зеленим.
 */
export function dayPowerState(
  schedule: QueueScheduleData | undefined,
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
