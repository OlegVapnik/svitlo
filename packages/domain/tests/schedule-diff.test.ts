import { describe, expect, it } from 'vitest';

import { diffScheduleIntervals } from '../src/schedule-diff.ts';
import { localSlotToUtc } from '../src/kyiv-time.ts';

/**
 * Слот за київським настінним часом → інтервал у тому вигляді, у якому його віддає API.
 * Тести не повинні залежати від переходу на зимовий/літній час, тому години задаємо локальні.
 */
const at = (from: string, to: string) => ({
  startsAt: localSlotToUtc('2026-10-30', from, false),
  endsAt: localSlotToUtc('2026-10-30', to, true),
});

describe('diffScheduleIntervals', () => {
  it('однакові зрізи → без змін і без summary', () => {
    const prev = [at('18:00', '20:00')];
    const next = [at('18:00', '20:00')];

    expect(diffScheduleIntervals(prev, next)).toEqual({
      addedMinutes: 0,
      removedMinutes: 0,
      addedRanges: [],
      removedRanges: [],
      changed: false,
      summary: null,
      summaryUk: null,
    });
  });

  it('порожній prev (перший запуск) → changed=false навіть при наявних відключеннях', () => {
    const diff = diffScheduleIntervals([], [at('18:00', '20:00')]);

    expect(diff.changed).toBe(false);
    expect(diff.summary).toBeNull();
    expect(diff.addedRanges).toEqual([]);
  });

  it('порожній збережений зріз із emptyPrevIsFirstRun:false → поява годин це зміна', () => {
    const diff = diffScheduleIntervals([], [at('18:00', '19:00')], { emptyPrevIsFirstRun: false });

    expect(diff.addedMinutes).toBe(60);
    expect(diff.changed).toBe(true);
    expect(diff.addedRanges).toEqual([{ startMin: 18 * 60, endMin: 19 * 60, start: '18:00', end: '19:00' }]);
  });

  it('доданий інтервал рахує лише нові хвилини й показує конкретне вікно', () => {
    const diff = diffScheduleIntervals([at('18:00', '20:00')], [at('08:00', '09:30'), at('18:00', '20:00')]);

    expect(diff.addedMinutes).toBe(90);
    expect(diff.removedMinutes).toBe(0);
    expect(diff.changed).toBe(true);
    expect(diff.addedRanges).toEqual([{ startMin: 8 * 60, endMin: 9 * 60 + 30, start: '08:00', end: '09:30' }]);
    expect(diff.summary).toBe('Графік оновлено: +1 год 30 хв без світла (додано 08:00–09:30)');
    expect(diff.summaryUk).toBe(diff.summary);
  });

  it('прибране вікно → відключення зменшено з конкретними годинами', () => {
    const diff = diffScheduleIntervals([at('08:00', '10:00'), at('18:00', '20:00')], [at('18:00', '20:00')]);

    expect(diff.addedMinutes).toBe(0);
    expect(diff.removedMinutes).toBe(120);
    expect(diff.changed).toBe(true);
    expect(diff.removedRanges).toEqual([{ startMin: 8 * 60, endMin: 10 * 60, start: '08:00', end: '10:00' }]);
    expect(diff.summary).toBe('Відключення зменшено на 2 год (скасовано 08:00–10:00)');
  });

  it('частковий зсув вікна → додано і віднято одночасно, перетин не рахується двічі', () => {
    const diff = diffScheduleIntervals([at('18:00', '20:00')], [at('19:00', '21:00')]);

    expect(diff.addedMinutes).toBe(60);
    expect(diff.removedMinutes).toBe(60);
    expect(diff.changed).toBe(true);
    expect(diff.addedRanges).toEqual([{ startMin: 20 * 60, endMin: 21 * 60, start: '20:00', end: '21:00' }]);
    expect(diff.removedRanges).toEqual([{ startMin: 18 * 60, endMin: 19 * 60, start: '18:00', end: '19:00' }]);
    expect(diff.summary).toBe(
      'Графік змінився: +1 год (20:00–21:00), −1 год (18:00–19:00)',
    );
  });

  it('розбиття того самого вікна на слоти не вважається зміною', () => {
    const diff = diffScheduleIntervals(
      [at('18:00', '20:00')],
      [at('18:00', '18:30'), at('18:30', '19:00'), at('19:00', '20:00')],
    );

    expect(diff.changed).toBe(false);
  });

  it('увесь графік прибрано → changed=true', () => {
    const diff = diffScheduleIntervals([at('08:00', '09:00')], []);

    expect(diff.addedMinutes).toBe(0);
    expect(diff.removedMinutes).toBe(60);
    expect(diff.changed).toBe(true);
    expect(diff.summary).toBe('Відключення зменшено на 1 год (скасовано 08:00–09:00)');
  });

  it('сусідні додані вікна склеюються в одне', () => {
    const diff = diffScheduleIntervals([], [at('18:00', '18:30'), at('18:30', '19:00')], {
      emptyPrevIsFirstRun: false,
    });

    expect(diff.addedRanges).toEqual([{ startMin: 18 * 60, endMin: 19 * 60, start: '18:00', end: '19:00' }]);
    expect(diff.summary).toBe('Графік оновлено: +1 год без світла (додано 18:00–19:00)');
  });

  it('некоректні інтервали ігноруються, а не ламають підрахунок', () => {
    const diff = diffScheduleIntervals(
      [{ startsAt: 'не дата', endsAt: '2026-10-30T10:00:00.000Z' }],
      [at('18:00', '18:30')],
    );

    expect(diff.changed).toBe(false);
  });

  it('о 20:21 зниклий слот 15:00–18:00 не вважається скасуванням', () => {
    const diff = diffScheduleIntervals([at('15:00', '18:00')], [], {
      emptyPrevIsFirstRun: false,
      nowMinutesOfDay: 20 * 60 + 21,
    });

    expect(diff.changed).toBe(false);
    expect(diff.removedMinutes).toBe(0);
    expect(diff.removedRanges).toEqual([]);
    expect(diff.summary).toBeNull();
  });

  it('минула частина вікна відсікається, майбутня — рахується', () => {
    const diff = diffScheduleIntervals([at('18:00', '21:00')], [at('18:00', '19:00')], {
      emptyPrevIsFirstRun: false,
      nowMinutesOfDay: 18 * 60 + 30,
    });

    expect(diff.changed).toBe(true);
    expect(diff.removedMinutes).toBe(120);
    expect(diff.removedRanges).toEqual([
      { startMin: 19 * 60, endMin: 21 * 60, start: '19:00', end: '21:00' },
    ]);
  });

  it('зміна в майбутньому менша за 30 хвилин не створює ревізію', () => {
    const diff = diffScheduleIntervals([at('18:00', '19:00')], [at('18:00', '19:15')], {
      emptyPrevIsFirstRun: false,
      nowMinutesOfDay: 17 * 60,
    });

    expect(diff.changed).toBe(false);
    expect(diff.addedMinutes).toBe(0);
    expect(diff.summary).toBeNull();
  });
});
