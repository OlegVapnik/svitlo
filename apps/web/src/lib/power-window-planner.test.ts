import { describe, expect, test } from 'vitest';
import type { ScheduleIntervalUtc } from '@svitlo/shared';
import {
  POWER_TASKS,
  formatWindowRange,
  greenWindows,
  planPowerTask,
  type PowerTask,
} from './power-window-planner.js';
import type { DaySchedule } from './day-schedule.js';

const off = (from: string, to: string): ScheduleIntervalUtc => ({
  startsAt: from,
  endsAt: to,
  stateCode: 3,
  stateName: 'Відключення',
  stateColor: '#F43F5E',
});

const laundry: PowerTask = { id: 'laundry', durationMinutes: 120 };
const work: PowerTask = { id: 'work', durationMinutes: 240 };

describe('power-window-planner: вікна зі світлом', () => {
  test('день без графіка не дає зелених вікон', () => {
    const day: DaySchedule = { date: '2026-10-10', intervals: [] };
    expect(greenWindows([day], new Date('2026-10-10T07:00:00.000Z'))).toEqual([]);
  });

  test('відключення 12:00–14:00 ділить добу на два вікна', () => {
    const day: DaySchedule = {
      date: '2026-10-10',
      intervals: [off('2026-10-10T09:00:00.000Z', '2026-10-10T11:00:00.000Z')],
    };
    const windows = greenWindows([day], new Date('2026-10-10T07:00:00.000Z'));
    expect(windows.map(formatWindowRange)).toEqual(['10:00 – 12:00', '14:00 – 24:00']);
  });

  test('«можливо вимкнуть» теж не вважається світлом', () => {
    const uncertain: ScheduleIntervalUtc = {
      ...off('2026-10-10T09:00:00.000Z', '2026-10-10T10:00:00.000Z'),
      stateCode: 2,
    };
    const day: DaySchedule = { date: '2026-10-10', intervals: [uncertain] };
    const windows = greenWindows([day], new Date('2026-10-10T07:00:00.000Z'));
    expect(windows.map(formatWindowRange)).toEqual(['10:00 – 12:00', '13:00 – 24:00']);
  });

  test('вікна на межі двох діб склеюються', () => {
    const days: DaySchedule[] = [
      { date: '2026-10-10', intervals: [], covered: true },
      { date: '2026-10-11', intervals: [], covered: true },
    ];
    const windows = greenWindows(days, new Date('2026-10-10T07:00:00.000Z'));
    expect(windows).toHaveLength(1);
    expect(formatWindowRange(windows[0]!)).toBe('10:00 – 24:00');
    // Вікно справді тягнеться до кінця наступної доби, а не обрізається на півночі.
    expect(windows[0]!.endMs - windows[0]!.startMs).toBe(38 * 60 * 60_000);
  });
});

describe('power-window-planner: план справи', () => {
  const day: DaySchedule = {
    date: '2026-10-10',
    intervals: [off('2026-10-10T09:00:00.000Z', '2026-10-10T11:00:00.000Z')],
  };

  test('прання встигає у поточне вікно рівно на дві години', () => {
    const plan = planPowerTask(laundry, [day], new Date('2026-10-10T07:00:00.000Z'));
    expect(plan.kind).toBe('now');
    if (plan.kind !== 'now') return;
    expect(plan.remainingMinutes).toBe(120);
    expect(plan.next).not.toBeNull();
  });

  test('роботі на 4 години поточного вікна мало — пропонує наступне', () => {
    const plan = planPowerTask(work, [day], new Date('2026-10-10T07:00:00.000Z'));
    expect(plan.kind).toBe('later');
    if (plan.kind !== 'later') return;
    expect(formatWindowRange(plan.best)).toBe('14:00 – 24:00');
  });

  test('після останнього відключення показує поточне вікно', () => {
    const plan = planPowerTask(POWER_TASKS[3]!, [day], new Date('2026-10-10T12:00:00.000Z'));
    expect(plan.kind).toBe('now');
  });

  test('без підходящого вікна повертає none, а не вигаданий час', () => {
    const plan = planPowerTask(work, [day], new Date('2026-10-10T19:00:00.000Z'));
    expect(plan.kind).toBe('none');
  });
});
