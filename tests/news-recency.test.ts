import { describe, expect, it } from 'vitest';

import { filterRecentNews, NEWS_MAX_AGE_DAYS } from '../src/lib/news-recency';

const now = new Date('2026-11-02T12:00:00Z');
const item = (publishedAt: string | null) => ({ publishedAt, title: publishedAt ?? 'no-date' });

describe('news-recency', () => {
  it('тримає новини за останні 4 дні', () => {
    const items = [
      item('2026-11-02T10:00:00Z'),
      item('2026-10-30T09:00:00Z'),
      item('2026-10-29T23:00:00Z'),
      item('2026-10-28T09:00:00Z'),
    ];

    expect(filterRecentNews(items, now).map((i) => i.publishedAt)).toEqual([
      '2026-11-02T10:00:00Z',
      '2026-10-30T09:00:00Z',
      '2026-10-29T23:00:00Z',
    ]);
  });

  it('записи без дати не зникають', () => {
    expect(filterRecentNews([item(null)], now)).toHaveLength(1);
    expect(filterRecentNews([item('не дата')], now)).toHaveLength(1);
  });

  it('вікно можна змінити', () => {
    const items = [item('2026-11-01T09:00:00Z'), item('2026-10-25T09:00:00Z')];
    expect(filterRecentNews(items, now, 2)).toHaveLength(1);
    expect(NEWS_MAX_AGE_DAYS).toBe(4);
  });
});
