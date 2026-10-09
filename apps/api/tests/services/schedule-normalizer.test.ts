import { describe, expect, test } from 'vitest';
import {
  operatorScheduleResponseSchema,
  scheduleImportRequestSchema,
  type OperatorScheduleResponse,
} from '@energy-monitor/shared';
import { normalizeScheduleResponse } from '../../src/services/schedule-normalizer.js';

const sample: OperatorScheduleResponse = {
  status: 'ok',
  aData: [
    { time_from: '00:00', time_to: '07:00', queue: 1 },
    { time_from: '07:00', time_to: '07:30', queue: 2 },
    { time_from: '07:30', time_to: '10:00', queue: 3 },
    { time_from: '10:00', time_to: '10:30', queue: 2 },
    { time_from: '10:30', time_to: '17:30', queue: 1 },
    { time_from: '17:30', time_to: '18:00', queue: 2 },
    { time_from: '18:00', time_to: '20:30', queue: 3 },
    { time_from: '20:30', time_to: '21:00', queue: 2 },
    { time_from: '21:00', time_to: '00:00', queue: 1 },
  ],
  aState: {
    1: { name: 'Не відключається', color: '#63aa18' },
    2: { name: 'Розмін черги/підчерги', color: '#AFAFAF' },
    3: { name: 'Відключення', color: '#E33535' },
  },
};

describe('operator schedule schema', () => {
  test('parses the operator response', () => {
    const parsed = operatorScheduleResponseSchema.parse(sample);
    expect(parsed.aData).toHaveLength(9);
    expect(parsed.aState[1]?.name).toBe('Не відключається');
  });

  test('ignores the token field entirely (не принимать, не сохранять)', () => {
    const request = scheduleImportRequestSchema.parse({ queue: '2/2', date: '2026-10-07', payload: sample, token: 'must-be-dropped' });
    expect(JSON.stringify(request)).not.toContain('must-be-dropped');
  });

  test('rejects invalid time formats and unknown state codes', () => {
    expect(() => scheduleImportRequestSchema.parse({ queue: '2/2', date: '2026-10-07', payload: { ...sample, aData: [{ time_from: '24:00', time_to: '00:00', queue: 1 }] } })).toThrow();
    expect(() => scheduleImportRequestSchema.parse({ queue: '2/2', date: '2026-10-07', payload: { ...sample, aData: [{ time_from: '01:00', time_to: '02:00', queue: 9 }] } })).toThrow();
    expect(() => scheduleImportRequestSchema.parse({ queue: '2/2', date: '07.10.2026', payload: sample })).toThrow();
  });
});

describe('schedule normalization to UTC', () => {
  test('converts winter-date intervals to UTC+2 and treats 00:00 as end of day', () => {
    const intervals = normalizeScheduleResponse(sample, '2026-01-15');
    const first = intervals[0]!;
    expect(first.startsAt).toBe('2026-01-14T22:00:00.000Z');
    expect(first.endsAt).toBe('2026-01-15T05:00:00.000Z');
    const last = intervals[intervals.length - 1]!;
    expect(last.endsAt).toBe('2026-01-15T22:00:00.000Z');
  });

  test('converts summer-date intervals to UTC+3', () => {
    const intervals = normalizeScheduleResponse(sample, '2026-07-01');
    expect(intervals[0]!.startsAt).toBe('2026-06-30T21:00:00.000Z');
    expect(intervals[0]!.endsAt).toBe('2026-07-01T04:00:00.000Z');
  });

  test('DST transition date 2026-10-25 resolves midnight using Kyiv winter offset', () => {
    const intervals = normalizeScheduleResponse(sample, '2026-10-25');
    expect(intervals[0]!.startsAt).toBe('2026-10-24T21:00:00.000Z');
    expect(intervals[0]!.endsAt).toBe('2026-10-25T05:00:00.000Z');
    expect(intervals.find((interval) => interval.stateCode === 3)!.startsAt).toBe('2026-10-25T05:30:00.000Z');
    expect(intervals.find((interval) => interval.stateCode === 3)!.endsAt).toBe('2026-10-25T08:00:00.000Z');
  });

  test('preserves source wall-clock times on the winter-time change date', async () => {
    const { mergeRawScheduleSlots } = await import('../../src/services/schedule-import.service.js');
    const slots = mergeRawScheduleSlots(sample);
    expect(slots[0]).toMatchObject({ time_from: '00:00', time_to: '07:00' });
    expect(slots.at(-1)).toMatchObject({ time_from: '21:00', time_to: '00:00' });
  });

  test('merges neighbouring intervals of the same state code', () => {
    const response: OperatorScheduleResponse = {
      status: 'ok',
      aData: [
        { time_from: '00:00', time_to: '03:00', queue: 1 },
        { time_from: '03:00', time_to: '05:00', queue: 1 },
        { time_from: '05:00', time_to: '00:00', queue: 1 },
      ],
      aState: sample.aState,
    };
    const intervals = normalizeScheduleResponse(response, '2026-01-15');
    expect(intervals).toHaveLength(1);
    expect(intervals[0]!.startsAt).toBe('2026-01-14T22:00:00.000Z');
    expect(intervals[0]!.endsAt).toBe('2026-01-15T22:00:00.000Z');
  });

  test('keeps state name and color from aState (не хардкодятся)', () => {
    const intervals = normalizeScheduleResponse(sample, '2026-01-15');
    const outage = intervals.find((interval) => interval.stateCode === 3)!;
    expect(outage.stateName).toBe('Відключення');
    expect(outage.stateColor).toBe('#E33535');
  });

  test('demo queues expose 6-digit HEX colours in Ukrainian', async () => {
    const { DEMO_SCHEDULES } = await import('../../src/services/schedule-mock.service.js');
    for (const payload of Object.values(DEMO_SCHEDULES)) {
      for (const state of Object.values(payload.aState)) expect(state.color).toMatch(/^#[0-9A-Fa-f]{6}$/u);
      expect(payload.aState['2']?.name).toContain('Розмін черги/підчерги');
    }
  });
});
