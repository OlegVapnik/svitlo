import { describe, expect, test } from 'vitest';
import type { QueueScheduleData, ScheduleIntervalUtc } from '@svitlo/shared';
import { dayPowerState } from './day-status.js';

/**
 * Разделение двух «пустых» — главный смысл статуса дня. Тесты фиксируют оба:
 * опубликованный день без отключений (allClear, зелёный) и отсутствие данных (unknown, серый).
 */

const DAY = '2026-10-10';

/** Лето: Киев = UTC+3. Локальные 08:00–11:00 → 05:00–08:00Z. */
const dayWithOff: ScheduleIntervalUtc[] = [
  { startsAt: '2026-10-09T21:00:00.000Z', endsAt: '2026-10-10T05:00:00.000Z', stateCode: 1, stateName: 'Світло є', stateColor: '#63AA18' },
  { startsAt: '2026-10-10T05:00:00.000Z', endsAt: '2026-10-10T08:00:00.000Z', stateCode: 3, stateName: 'Відключення', stateColor: '#E33535' },
  { startsAt: '2026-10-10T08:00:00.000Z', endsAt: '2026-10-10T21:00:00.000Z', stateCode: 1, stateName: 'Світло є', stateColor: '#63AA18' },
];

const schedule = (over: Partial<QueueScheduleData>): QueueScheduleData => ({
  queue: '1',
  date: DAY,
  intervals: [],
  source: null,
  lastImportedAt: null,
  ...over,
});

describe('dayPowerState: два разных «пустых»', () => {
  test('опубликованный день без отключений — allClear, не unknown', () => {
    const result = dayPowerState(schedule({ allClear: true, covered: true, source: 'mirror' }), DAY);
    expect(result.state).toBe('allClear');
    expect(result.summary).toBeNull();
  });

  test('covered без allClear (импорт отстал) — unknown, а не зелёный', () => {
    const result = dayPowerState(schedule({ covered: true, allClear: false, source: 'mirror' }), DAY);
    expect(result.state).toBe('unknown');
  });

  test('графика нет вовсе — unknown', () => {
    expect(dayPowerState(undefined, DAY).state).toBe('unknown');
    expect(dayPowerState(schedule({}), DAY).state).toBe('unknown');
  });
});

describe('dayPowerState: день с интервалами', () => {
  test('сейчас идёт отключение — off', () => {
    const now = new Date('2026-10-10T06:00:00.000Z');
    expect(dayPowerState(schedule({ intervals: dayWithOff }), DAY, now).state).toBe('off');
  });

  test('отключение меньше часа впереди — warning', () => {
    const now = new Date('2026-10-10T04:30:00.000Z');
    expect(dayPowerState(schedule({ intervals: dayWithOff }), DAY, now).state).toBe('warning');
  });

  test('светло и отключение не скоро — on', () => {
    const now = new Date('2026-10-10T09:00:00.000Z');
    expect(dayPowerState(schedule({ intervals: dayWithOff }), DAY, now).state).toBe('on');
  });
});
