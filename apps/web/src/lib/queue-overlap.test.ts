import { describe, expect, test } from 'vitest';
import type { ScheduleIntervalUtc } from '@svitlo/shared';
import {
  SLOTS_PER_DAY,
  overlapStates,
  overlapSummary,
  slotStates,
  slotsToMinutes,
  type SlotState,
} from './queue-overlap.js';
import type { DaySchedule } from './day-schedule.js';

const off = (from: string, to: string): ScheduleIntervalUtc => ({
  startsAt: from,
  endsAt: to,
  stateCode: 3,
  stateName: 'Відключення',
  stateColor: '#F43F5E',
});

describe('slotStates: сутки разбиты на 48 получасов', () => {
  test('пустой график без покрытия — все слоты «неизвестно», а не зелёные', () => {
    const states = slotStates({ date: '2026-10-10', intervals: [] });
    expect(states).toHaveLength(SLOTS_PER_DAY);
    expect(new Set(states)).toEqual(new Set<SlotState>(['unknown']));
  });

  test('покрытие без отключений — все слоты со светом', () => {
    const states = slotStates({ date: '2026-10-10', intervals: [], covered: true });
    expect(new Set(states)).toEqual(new Set<SlotState>(['on']));
  });

  test('отключение 12:00–14:00 (09:00–11:00Z) гасит ровно четыре получаса', () => {
    const day: DaySchedule = {
      date: '2026-10-10',
      intervals: [off('2026-10-10T09:00:00.000Z', '2026-10-10T11:00:00.000Z')],
    };
    const states = slotStates(day);
    expect(states[23]).toBe('on'); // 11:30–12:00
    expect(states.slice(24, 28)).toEqual(['off', 'off', 'off', 'off']); // 12:00–14:00
    expect(states[28]).toBe('on'); // 14:00–14:30
  });

  test('отключение, задевающее половину слота, гасит весь слот', () => {
    // 12:15–12:45 по Киеву = 09:15–09:45Z: слот 12:00–12:30 и 12:30–13:00 оба «выключены».
    const day: DaySchedule = {
      date: '2026-10-10',
      intervals: [off('2026-10-10T09:15:00.000Z', '2026-10-10T09:45:00.000Z')],
    };
    const states = slotStates(day);
    expect(states[24]).toBe('off');
    expect(states[25]).toBe('off');
  });
});

describe('overlapStates: перетин двух групп', () => {
  const pattern = (states: SlotState[]): SlotState[] => states;

  test('обе со светом — both; одна — either; обе без — none', () => {
    const cells = overlapStates(
      pattern(['on', 'on', 'off', 'off']),
      pattern(['on', 'off', 'on', 'off']),
    );
    expect(cells).toEqual(['both', 'either', 'either', 'none']);
  });

  test('неизвестность любой группы не превращается в «светло»', () => {
    expect(overlapStates(pattern(['unknown', 'on']), pattern(['on', 'unknown']))).toEqual([
      'unknown',
      'unknown',
    ]);
  });

  test('сводка считает слоты, а не проценты', () => {
    const summary = overlapSummary(['both', 'both', 'either', 'none', 'unknown']);
    expect(summary).toEqual({ both: 2, either: 1, none: 1, unknown: 1 });
    expect(slotsToMinutes(summary.both)).toBe(60);
  });
});
