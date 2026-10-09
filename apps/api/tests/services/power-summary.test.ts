import { describe, expect, test } from 'vitest';
import { computeWindowSummary, kyivDayStart, mergeIntervals, totalMinutes } from '../../src/services/power-summary.js';

describe('mergeIntervals', () => {
  test('об’єднує перетинні інтервали й не рахує ту саму хвилину двічі', () => {
    const merged = mergeIntervals([
      { start: 0, end: 60_000 },
      { start: 30_000, end: 120_000 },
      { start: 300_000, end: 360_000 },
    ]);
    expect(merged).toEqual([
      { start: 0, end: 120_000 },
      { start: 300_000, end: 360_000 },
    ]);
  });

  test('відкидає порожні та від’ємні проміжки', () => {
    expect(mergeIntervals([{ start: 10, end: 10 }, { start: 50, end: 20 }])).toEqual([]);
  });
});

describe('totalMinutes', () => {
  test('рахує сумарну тривалість у хвилинах з урахуванням перетинів', () => {
    const minutes = totalMinutes([
      { start: 0, end: 30 * 60_000 },
      { start: 10 * 60_000, end: 40 * 60_000 },
    ]);
    expect(minutes).toBe(40);
  });
});

describe('kyivDayStart', () => {
  test('початок доби влітку — 21:00Z попереднього дня (UTC+3)', () => {
    // 2026-10-07 12:00Z — ще літній час в Україні (EEST, UTC+3).
    expect(kyivDayStart(new Date('2026-10-07T12:00:00Z')).toISOString()).toBe('2026-10-06T21:00:00.000Z');
  });

  test('початок доби взимку — 22:00Z попереднього дня (UTC+2)', () => {
    expect(kyivDayStart(new Date('2026-01-15T12:00:00Z')).toISOString()).toBe('2026-01-14T22:00:00.000Z');
  });
});

describe('computeWindowSummary', () => {
  const start = new Date('2026-10-07T00:00:00Z');
  const end = new Date('2026-10-08T00:00:00Z'); // рівно 1440 хвилин

  test('без записів віддає 100% і позначку «немає даних»', () => {
    const summary = computeWindowSummary('за добу', start, end, []);
    expect(summary.windowMinutes).toBe(1440);
    expect(summary.outageMinutes).toBe(0);
    expect(summary.poweredMinutes).toBe(1440);
    expect(summary.reliabilityPct).toBe(100);
    expect(summary.hasData).toBe(false);
  });

  test('рахує без світла / зі світлом / надійність і не дублює перетини', () => {
    const summary = computeWindowSummary('за добу', start, end, [
      { startsAt: new Date('2026-10-07T14:30:00Z'), endsAt: new Date('2026-10-07T15:30:00Z') }, // 60 хв
      { startsAt: new Date('2026-10-07T15:00:00Z'), endsAt: new Date('2026-10-07T16:00:00Z') }, // +30 хв (перетин 30)
    ]);
    expect(summary.outageMinutes).toBe(90);
    expect(summary.poweredMinutes).toBe(1350);
    expect(summary.reliabilityPct).toBeCloseTo(93.8, 1);
    expect(summary.outageCount).toBe(2);
    expect(summary.hasData).toBe(true);
  });

  test('обрізає відключення, що виходять за межі вікна', () => {
    const summary = computeWindowSummary('за добу', start, end, [
      { startsAt: new Date('2026-10-06T22:00:00Z'), endsAt: new Date('2026-10-07T01:00:00Z') }, // у вікні лише 60 хв
    ]);
    expect(summary.outageMinutes).toBe(60);
    expect(summary.poweredMinutes).toBe(1380);
  });
});
