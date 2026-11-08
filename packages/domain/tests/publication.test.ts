import { describe, expect, it } from 'vitest';

import {
  dayPowerState,
  isSchedulePublished,
  minutesOfDay,
  kyivOffset,
  offMinutesOf,
  scheduleWindow,
  slotProgress,
} from '../src/publication.ts';
import { mergeIntervals } from '../src/daily-intervals.ts';

// 2026-10-17 — літній час (UTC+3): 15:00Z = 18:00 за Києвом.
const off = (from: string, to: string) => ({ startsAt: from, endsAt: to, stateCode: 3 });
const on = (from: string, to: string) => ({ startsAt: from, endsAt: to, stateCode: 1 });

const evening = [off('2026-10-17T15:00:00Z', '2026-10-17T17:00:00Z')];

describe('kyivOffset', () => {
  it('влітку +180, узимку +120 хвилин', () => {
    expect(kyivOffset('2026-07-01')).toBe(180);
    expect(kyivOffset('2026-12-01')).toBe(120);
    // 25.10.2026 — день переходу; о 12:00 UTC Київ уже на зимовому часі.
    expect(kyivOffset('2026-10-25')).toBe(120);
  });
});

describe('minutesOfDay', () => {
  it('переводить ISO у хвилини київських суток', () => {
    expect(minutesOfDay('2026-10-17T15:00:00Z', '2026-10-17')).toBe(18 * 60);
    expect(minutesOfDay('2026-12-01T15:00:00Z', '2026-12-01')).toBe(17 * 60);
    expect(minutesOfDay('2026-10-17T21:00:00Z', '2026-10-17')).toBe(24 * 60);
  });
});

describe('scheduleWindow', () => {
  it('бачить відключення, що триває зараз', () => {
    const summary = scheduleWindow(evening, '2026-10-17', new Date('2026-10-17T15:30:00Z'));
    expect(summary.isOff).toBe(true);
    expect(summary.nowMinutes).toBe(18 * 60 + 30);
    expect(summary.backInMinutes).toBe(90);
    expect(summary.offMinutes).toBe(120);
    expect(summary.offEndsAt).toBe('2026-10-17T17:00:00Z');
  });

  it('коли світло є — рахує хвилини до найближчого відключення', () => {
    const summary = scheduleWindow(evening, '2026-10-17', new Date('2026-10-17T13:00:00Z'));
    expect(summary.isOff).toBe(false);
    expect(summary.nextInMinutes).toBe(120);
    expect(summary.nextStartsAt).toBe('2026-10-17T15:00:00Z');
  });

  it('для чужої доби nowMinutes = null', () => {
    expect(scheduleWindow(evening, '2026-10-18', new Date('2026-10-17T15:30:00Z')).nowMinutes).toBeNull();
  });

  it('не рахує в offMinutes інтервали «світло є»', () => {
    const mixed = [...evening, on('2026-10-17T17:00:00Z', '2026-10-17T18:00:00Z')];
    expect(scheduleWindow(mixed, '2026-10-17', new Date('2026-10-17T12:00:00Z')).offMinutes).toBe(120);
  });
});

describe('dayPowerState', () => {
  const at = (iso: string) => new Date(iso);

  it('порожній графік без allClear — unknown, а не «світло є»', () => {
    expect(dayPowerState({ intervals: [] }, '2026-10-17', at('2026-10-17T12:00:00Z')).state).toBe('unknown');
    expect(dayPowerState(undefined, '2026-10-17', at('2026-10-17T12:00:00Z')).state).toBe('unknown');
  });

  it('порожній графік з allClear — allClear', () => {
    expect(dayPowerState({ intervals: [], allClear: true }, '2026-10-17', at('2026-10-17T12:00:00Z')).state).toBe(
      'allClear',
    );
  });

  it('off / warning / on за часом доби', () => {
    const schedule = { intervals: evening };
    expect(dayPowerState(schedule, '2026-10-17', at('2026-10-17T15:30:00Z')).state).toBe('off');
    // 60 хвилин до відключення — це порог «скоро вимкнуть».
    expect(dayPowerState(schedule, '2026-10-17', at('2026-10-17T14:00:00Z')).state).toBe('warning');
    expect(dayPowerState(schedule, '2026-10-17', at('2026-10-17T10:00:00Z')).state).toBe('on');
  });
});

describe('slotProgress', () => {
  it('під час відключення показує прогрес слота', () => {
    const progress = slotProgress(evening, '2026-10-17', new Date('2026-10-17T15:30:00Z'));
    expect(progress).toEqual({ percent: 25, elapsedMinutes: 30, remainingMinutes: 90 });
  });

  it('повертає null, коли відключень попереду немає', () => {
    expect(slotProgress(evening, '2026-10-17', new Date('2026-10-17T18:00:00Z'))).toBeNull();
  });

  it('між відключеннями показує вікно «світло є»', () => {
    const two = [
      off('2026-10-17T05:00:00Z', '2026-10-17T06:00:00Z'),
      off('2026-10-17T15:00:00Z', '2026-10-17T17:00:00Z'),
    ];
    // 12:00Z = 15:00 за Києвом; вікно «світло є» — з 09:00 до 18:00, пройшло 6 із 9 годин.
    const progress = slotProgress(two, '2026-10-17', new Date('2026-10-17T12:00:00Z'));
    expect(progress).toEqual({ percent: 67, elapsedMinutes: 360, remainingMinutes: 180 });
  });
});

describe('isSchedulePublished', () => {
  it('прошедшее отключение всё равно доказывает публикацию', () => {
    // 12:00–14:00 за Києвом; зараз 15:27 — отключение уже позади.
    const past = [off('2026-10-17T09:00:00Z', '2026-10-17T11:00:00Z')];
    const now = new Date('2026-10-17T12:27:00Z');
    const status = dayPowerState({ intervals: past, covered: false }, '2026-10-17', now);

    expect(status.state).toBe('on');
    expect(status.summary?.nextStartsAt).toBeNull();
    expect(isSchedulePublished({ intervals: past, covered: false })).toBe(true);
  });

  it('covered: true без слотов — опубликовано, пусто без флагов — нет', () => {
    expect(isSchedulePublished({ intervals: [], covered: true })).toBe(true);
    expect(isSchedulePublished({ intervals: [], allClear: true })).toBe(true);
    expect(isSchedulePublished({ intervals: [], covered: false, allClear: false })).toBe(false);
    expect(isSchedulePublished(undefined)).toBe(false);
  });
});

describe('mergeIntervals & offMinutesOf', () => {
  it('зливає перекриваючі інтервали без подвоєння суми', () => {
    // Двічі однакове вікно 16:30–23:30 (990–1410 хв = 420 хв = 7 год)
    const merged = mergeIntervals([
      { start: 990, end: 1410 },
      { start: 990, end: 1410 },
    ]);
    expect(merged).toEqual([{ start: 990, end: 1410 }]);
  });

  it('зливає вкладені та суміжні інтервали', () => {
    const merged = mergeIntervals([
      { start: 60, end: 180 },
      { start: 120, end: 240 },
      { start: 240, end: 300 },
      { start: 400, end: 500 },
    ]);
    expect(merged).toEqual([
      { start: 60, end: 300 },
      { start: 400, end: 500 },
    ]);
  });

  it('offMinutesOf коректно рахує 7 годин замість 14 при дублюванні ГПВ та обмежень', () => {
    // 2026-11-05 (зимовий час UTC+2): 14:30Z..21:30Z = 16:30..23:30 за Києвом = 7 годин (420 хв)
    const duplicateIntervals = [
      off('2026-11-05T14:30:00Z', '2026-11-05T21:30:00Z'),
      off('2026-11-05T14:30:00Z', '2026-11-05T21:30:00Z'),
    ];
    expect(offMinutesOf(duplicateIntervals, '2026-11-05')).toBe(420);
  });
});
