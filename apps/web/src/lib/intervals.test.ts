import { describe, expect, it } from 'vitest';
import { formatMinutes, mergeIntervals } from './intervals.js';

/**
 * Слоты берём «как есть» от парсера: интервал задан UTC-строкой, а склейка читает
 * киевские минуты. Октябрь — UTC+3, поэтому 18:00 по Киеву это 15:00Z.
 */
const slot = (fromUtcHours: number, toUtcHours: number): { startsAt: string; endsAt: string } => ({
  startsAt: new Date(Date.UTC(2026, 9, 17, fromUtcHours)).toISOString(),
  endsAt: new Date(Date.UTC(2026, 9, 17, toUtcHours)).toISOString(),
});

describe('mergeIntervals', () => {
  it('склеивает смежные получасовые слоты в одно окно', () => {
    // 18:00–18:30 … 23:30–00:00 по Киеву = 15:00Z–21:00Z.
    const slots = [
      slot(15, 15.5), slot(15.5, 16), slot(16, 16.5),
      slot(16.5, 17), slot(17, 17.5), slot(17.5, 18),
      slot(18, 18.5), slot(18.5, 19), slot(19, 19.5),
      slot(19.5, 20), slot(20, 20.5), slot(20.5, 21),
    ];

    expect(mergeIntervals(slots)).toEqual([{ startMin: 18 * 60, endMin: 24 * 60 }]);
  });

  it('оставляет разрыв, если между слотами есть время света', () => {
    // 15:00Z–16:00Z и 18:00Z–19:00Z — это 18:00–19:00 и 21:00–22:00 по Киеву.
    const windows = mergeIntervals([slot(15, 16), slot(18, 19)]);
    expect(windows).toEqual([
      { startMin: 18 * 60, endMin: 19 * 60 },
      { startMin: 21 * 60, endMin: 22 * 60 },
    ]);
  });

  it('выбрасывает вырожденный интервал нулевой длины', () => {
    // Регрессия: интервал без конца слота попадал в график карточкой «00:00 – 00:00 · 0 хв».
    expect(mergeIntervals([slot(0, 0), slot(15, 16)])).toEqual([
      { startMin: 18 * 60, endMin: 19 * 60 },
    ]);
  });

  it('не создаёт нулевое окно на переходе через полночь', () => {
    // 23:30 → 00:00 по Киеву: хвост после полуночи пустой и не должен попасть в график.
    const windows = mergeIntervals([{ startsAt: '2026-10-17T20:30:00.000Z', endsAt: '2026-10-17T21:00:00.000Z' }]);
    expect(windows).toEqual([{ startMin: 23 * 60 + 30, endMin: 24 * 60 }]);
  });

  it('разбивает переход через полночь на два окна суток', () => {
    const windows = mergeIntervals([{ startsAt: '2026-10-17T20:30:00.000Z', endsAt: '2026-10-17T22:00:00.000Z' }]);
    expect(windows).toEqual([
      { startMin: 0, endMin: 60 },
      { startMin: 23 * 60 + 30, endMin: 24 * 60 },
    ]);
  });
});

describe('formatMinutes', () => {
  it('пишет конец суток как 24:00, а не 00:00', () => {
    // Регрессия: «06:00 – 00:00» читается как шаг назад по времени.
    expect(formatMinutes(24 * 60)).toBe('24:00');
  });

  it('печатает минуты суток с ведущим нулём', () => {
    expect(formatMinutes(0)).toBe('00:00');
    expect(formatMinutes(6 * 60 + 30)).toBe('06:30');
  });
});