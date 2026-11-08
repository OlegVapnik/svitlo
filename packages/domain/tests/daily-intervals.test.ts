import { describe, expect, it } from 'vitest';

import { mergeIntervals, mergeMinuteRanges } from '../src/daily-intervals.ts';

describe('mergeMinuteRanges', () => {
  it('склеює суміжні відрізки', () => {
    expect(
      mergeMinuteRanges([
        { startMin: 18 * 60, endMin: 18 * 60 + 30 },
        { startMin: 18 * 60 + 30, endMin: 19 * 60 },
      ]),
    ).toEqual([{ startMin: 1080, endMin: 1140 }]);
  });

  it('склеює перекривні й нечутливий до порядку', () => {
    expect(
      mergeMinuteRanges([
        { startMin: 600, endMin: 720 },
        { startMin: 660, endMin: 780 },
        { startMin: 300, endMin: 360 },
      ]),
    ).toEqual([
      { startMin: 300, endMin: 360 },
      { startMin: 600, endMin: 780 },
    ]);
  });

  it('викидає порожні й некоректні відрізки', () => {
    expect(
      mergeMinuteRanges([
        { startMin: 100, endMin: 100 },
        { startMin: 200, endMin: 150 },
        { startMin: Number.NaN, endMin: 300 },
        { startMin: 400, endMin: 420 },
      ]),
    ).toEqual([{ startMin: 400, endMin: 420 }]);
  });

  it('не склеює відрізки через проміжок', () => {
    expect(
      mergeMinuteRanges([
        { startMin: 0, endMin: 60 },
        { startMin: 90, endMin: 120 },
      ]),
    ).toEqual([
      { startMin: 0, endMin: 60 },
      { startMin: 90, endMin: 120 },
    ]);
  });
});

describe('mergeIntervals', () => {
  it('переводить ISO у хвилини київської доби', () => {
    // 15:00Z улітку — це 18:00 за Києвом (UTC+3).
    expect(mergeIntervals([{ startsAt: '2026-10-17T15:00:00Z', endsAt: '2026-10-17T16:00:00Z' }])).toEqual([
      { startMin: 1080, endMin: 1140 },
    ]);
  });

  it('склеює получасові слоти в одне вікно', () => {
    const slots = [
      { startsAt: '2026-10-17T15:00:00Z', endsAt: '2026-10-17T15:30:00Z' },
      { startsAt: '2026-10-17T15:30:00Z', endsAt: '2026-10-17T16:00:00Z' },
      { startsAt: '2026-10-17T16:00:00Z', endsAt: '2026-10-17T18:00:00Z' },
    ];
    expect(mergeIntervals(slots)).toEqual([{ startMin: 1080, endMin: 1260 }]);
  });

  it('розбиває інтервал через північ на два денних вікна', () => {
    // 23:30–00:30 за Києвом улітку: 20:30Z–21:30Z.
    expect(mergeIntervals([{ startsAt: '2026-10-17T20:30:00Z', endsAt: '2026-10-17T21:30:00Z' }])).toEqual([
      { startMin: 0, endMin: 30 },
      { startMin: 1410, endMin: 1440 },
    ]);
  });

  it('не створює фантомного хвоста для 23:30 → 00:00', () => {
    expect(mergeIntervals([{ startsAt: '2026-10-17T20:30:00Z', endsAt: '2026-10-17T21:00:00Z' }])).toEqual([
      { startMin: 1410, endMin: 1440 },
    ]);
  });

  it('викидає вироджений інтервал і некоректні дати', () => {
    expect(
      mergeIntervals([
        { startsAt: '2026-10-17T15:00:00Z', endsAt: '2026-10-17T15:00:00Z' },
        { startsAt: 'не дата', endsAt: '2026-10-17T16:00:00Z' },
      ]),
    ).toEqual([]);
  });
});
