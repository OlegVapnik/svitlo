import { describe, expect, it } from 'vitest';

import { scheduleChangeView } from '../src/lib/schedule-change-view';

const notice = {
  addedMinutes: 90,
  removedMinutes: 0,
  addedRanges: [{ startMin: 1260, endMin: 1350, start: '21:00', end: '22:30' }],
  removedRanges: [],
  summary: 'Графік оновлено: +1 год 30 хв без світла (додано 21:00–22:30)',
  summaryUk: 'Графік оновлено: +1 год 30 хв без світла (додано 21:00–22:30)',
  detectedAt: '2026-10-30T11:20:00.000Z',
  revisions: [
    {
      detectedAt: '2026-10-30T11:20:00.000Z',
      detectedAtLabel: '14:20',
      addedMinutes: 90,
      removedMinutes: 0,
      addedRanges: [{ startMin: 1260, endMin: 1350, start: '21:00', end: '22:30' }],
      removedRanges: [],
      summary: 'Графік оновлено: +1 год 30 хв без світла (додано 21:00–22:30)',
      summaryUk: 'Графік оновлено: +1 год 30 хв без світла (додано 21:00–22:30)',
    },
  ],
  initialIntervals: [],
  currentIntervals: [],
  planAccuracyPercent: 0,
};

describe('scheduleChangeView', () => {
  it('без notice нічого не показує', () => {
    expect(scheduleChangeView(null)).toBeNull();
  });

  it('коли годин побільшало — trend more, час і кількість ревізій', () => {
    expect(scheduleChangeView(notice)).toEqual({
      trend: 'more',
      title: 'Що змінилось',
      summary: 'Графік оновлено: +1 год 30 хв без світла (додано 21:00–22:30)',
      timeLabel: '14:20',
      historyCount: 1,
    });
  });

  it('коли відключення прибрали — trend less', () => {
    const view = scheduleChangeView({
      ...notice,
      addedMinutes: 0,
      removedMinutes: 60,
      summary: 'Відключення зменшено на 1 год (скасовано 18:00–19:00)',
      revisions: [],
    });

    expect(view?.trend).toBe('less');
    expect(view?.summary).toBe('Відключення зменшено на 1 год (скасовано 18:00–19:00)');
    expect(view?.historyCount).toBe(0);
  });
});
