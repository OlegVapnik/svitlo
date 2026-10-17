import type { ScheduleIntervalUtc } from '@svitlo/shared';
import type { DaySchedule } from './day-schedule.js';
import { UNCERTAIN_STATE_CODE } from './day-schedule.js';
import { OFF_STATE_CODE, formatMinutesUk, kyivOffset } from './scheduleWindow.js';

/**
 * Планування побутових справ за вікнами зі світлом.
 *
 * Навіщо окремий модуль: «коли встигну випрати» — це та сама арифметика, що й смуга 24 годин, але
 * з додатковою умовою «вікно має бути не коротшим за тривалість справи». Якщо рахувати це в JSX,
 * цифри на картці розійдуться з таймлайном при першій же зміні графіка.
 *
 * Правило чесності: вікно вважається зеленим лише тоді, коли оператор опублікував добу. Порожній
 * `intervals` без `covered` — це «даних немає», а не «світло цілу добу».
 */

/** Побутова справа: тривалість у хвилинах, без тексту й іконок (вони живуть в i18n/UI). */
export type PowerTaskId = 'laundry' | 'boiler' | 'battery' | 'work';

export interface PowerTask {
  id: PowerTaskId;
  durationMinutes: number;
}

export const POWER_TASKS: readonly PowerTask[] = [
  { id: 'laundry', durationMinutes: 120 },
  { id: 'boiler', durationMinutes: 180 },
  { id: 'battery', durationMinutes: 90 },
  { id: 'work', durationMinutes: 240 },
] as const;

/** Неперервний відрізок зі світлом у абсолютному часі (UTC ms). */
export interface GreenWindow {
  startMs: number;
  endMs: number;
}

/** Результат планування однієї справи. */
export type PowerTaskPlan =
  | {
      kind: 'now';
      task: PowerTask;
      window: GreenWindow;
      /** Скільки ще триватиме світло від «зараз». */
      remainingMinutes: number;
      next: GreenWindow | null;
    }
  | {
      kind: 'later';
      task: PowerTask;
      best: GreenWindow;
      next: GreenWindow | null;
    }
  | { kind: 'none'; task: PowerTask };

/** Початок і кінець київської доби в UTC ms. */
export function dayBounds(date: string): { startMs: number; endMs: number } {
  const startMs = Date.parse(`${date}T00:00:00Z`) - kyivOffset(date) * 60_000;
  return { startMs, endMs: startMs + 24 * 60 * 60_000 };
}

/** `HH:MM` за Києвом для абсолютного моменту. */
export function formatKyivHm(epochMs: number): string {
  return new Intl.DateTimeFormat('uk-UA', {
    timeZone: 'Europe/Kyiv',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(epochMs));
}

/** `HH:MM – HH:MM` за Києвом. Кінець доби показуємо як `24:00`, а не `00:00`: інакше вікно
 * «14:00 – 00:00» читається як нульова тривалість. */
export function formatWindowRange(window: GreenWindow): string {
  const end = formatKyivHm(window.endMs);
  return `${formatKyivHm(window.startMs)} – ${end === '00:00' ? '24:00' : end}`;
}

function intervalBounds(interval: ScheduleIntervalUtc): GreenWindow | null {
  const startMs = Date.parse(interval.startsAt);
  const endMs = Date.parse(interval.endsAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
  return { startMs, endMs };
}

/**
 * Вікна зі світлом на переданих добах, починаючи з `now`.
 *
 * Відключення й «можливо вимкнуть» (код 2) однаково розривають вікно: обіцяти пральну машину в
 * невизначеній півгодині не можна. День без `covered` і без інтервалів не дає вікон взагалі.
 */
export function greenWindows(days: readonly DaySchedule[], now: Date): GreenWindow[] {
  const nowMs = now.getTime();
  const result: GreenWindow[] = [];

  for (const day of days) {
    const known = day.intervals.length > 0 || day.covered === true;
    if (!known) continue;
    const { startMs: dayStart, endMs: dayEnd } = dayBounds(day.date);
    if (dayEnd <= nowMs) continue;

    const blocked = day.intervals
      .filter(
        (interval) =>
          interval.stateCode === OFF_STATE_CODE || interval.stateCode === UNCERTAIN_STATE_CODE,
      )
      .map(intervalBounds)
      .filter((window): window is GreenWindow => Boolean(window))
      .map((window) => ({
        startMs: Math.max(dayStart, window.startMs),
        endMs: Math.min(dayEnd, window.endMs),
      }))
      .filter((window) => window.endMs > window.startMs)
      .sort((a, b) => a.startMs - b.startMs);

    let cursor = Math.max(nowMs, dayStart);
    for (const window of blocked) {
      if (window.endMs <= cursor) continue;
      if (window.startMs > cursor) {
        result.push({ startMs: cursor, endMs: Math.min(window.startMs, dayEnd) });
      }
      cursor = Math.max(cursor, window.endMs);
      if (cursor >= dayEnd) break;
    }
    if (cursor < dayEnd) result.push({ startMs: cursor, endMs: dayEnd });
  }

  // Сусідні вікна на межі доби склеюємо: «23:00–24:00» + «00:00–02:00» — це одне вікно на 3 год.
  const merged: GreenWindow[] = [];
  for (const window of result) {
    const previous = merged[merged.length - 1];
    if (previous && previous.endMs === window.startMs) previous.endMs = window.endMs;
    else merged.push({ ...window });
  }
  return merged.filter((window) => window.endMs > window.startMs);
}

/** Перше вікно, яке вміщає справу, починаючи з `now` (або null). */
function findBest(windowList: readonly GreenWindow[], nowMs: number, needMinutes: number): GreenWindow | null {
  for (const window of windowList) {
    if (window.endMs <= nowMs) continue;
    const start = Math.max(nowMs, window.startMs);
    if (window.endMs - start >= needMinutes * 60_000) {
      return { startMs: start, endMs: window.endMs };
    }
  }
  return null;
}

/** Наступне підходяще вікно після `best`. */
function findNext(
  windowList: readonly GreenWindow[],
  best: GreenWindow,
  needMinutes: number,
): GreenWindow | null {
  return (
    windowList.find(
      (window) => window.startMs >= best.endMs && window.endMs - window.startMs >= needMinutes * 60_000,
    ) ?? null
  );
}

/**
 * План однієї справи.
 *
 * `now` — світло є зараз і його вистачає на всю справу; `later` — найближче підходяще вікно;
 * `none` — у відомих даних підходящого вікна немає. Останній стан не означає «світла не буде»:
 * він означає лише «у завантаженому графіку такого вікна немає».
 */
export function planPowerTask(task: PowerTask, days: readonly DaySchedule[], now: Date): PowerTaskPlan {
  const nowMs = now.getTime();
  const windows = greenWindows(days, now);
  const need = task.durationMinutes;

  const current = windows.find((window) => window.startMs <= nowMs && nowMs < window.endMs);
  if (current && current.endMs - nowMs >= need * 60_000) {
    const next = windows.find(
      (window) =>
        window.startMs >= current.endMs && window.endMs - window.startMs >= need * 60_000,
    );
    return {
      kind: 'now',
      task,
      window: { startMs: nowMs, endMs: current.endMs },
      remainingMinutes: Math.round((current.endMs - nowMs) / 60_000),
      next: next ?? null,
    };
  }

  const best = findBest(windows, nowMs, need);
  if (!best) return { kind: 'none', task };
  return {
    kind: 'later',
    task,
    best,
    next: findNext(windows, best, need),
  };
}

/** Плани для всіх побутових справ у порядку `POWER_TASKS`. */
export function planPowerTasks(
  days: readonly DaySchedule[],
  now: Date,
  tasks: readonly PowerTask[] = POWER_TASKS,
): PowerTaskPlan[] {
  return tasks.map((task) => planPowerTask(task, days, now));
}

/** Підпис тривалості справи: «2 год», «1.5 год» → у нас цілі хвилини, тому «1 год 30 хв». */
export function taskDurationLabel(task: PowerTask): string {
  return formatMinutesUk(task.durationMinutes);
}

