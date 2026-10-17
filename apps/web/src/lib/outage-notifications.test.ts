import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { GroupOutageSummary } from '@svitlo/shared';
import {
  OUTAGE_LEAD_MINUTES,
  RESTORE_LEAD_MINUTES,
  alertKey,
  collectUpcomingAlerts,
  filterUnnotified,
  intervalsForQueues,
  markNotified,
} from './outage-notifications.js';

const NOW = Date.parse('2026-10-16T12:00:00.000Z');
const minutes = (count: number): number => count * 60_000;
const iso = (offsetMinutes: number): string => new Date(NOW + minutes(offsetMinutes)).toISOString();

const interval = (queue: string, startOffset: number, endOffset: number) => ({
  queue,
  startsAt: iso(startOffset),
  endsAt: iso(endOffset),
});

describe('collectUpcomingAlerts', () => {
  test('предупреждает о начале ровно за 30 минут и раньше этого окна молчит', () => {
    expect(collectUpcomingAlerts([interval('2/2', OUTAGE_LEAD_MINUTES, 90)], NOW)).toHaveLength(1);
    expect(collectUpcomingAlerts([interval('2/2', OUTAGE_LEAD_MINUTES - 1, 90)], NOW)).toHaveLength(1);
    expect(collectUpcomingAlerts([interval('2/2', OUTAGE_LEAD_MINUTES + 1, 90)], NOW)).toHaveLength(0);
  });

  test('предупреждает о возвращении света за 15 минут и не раньше', () => {
    const alerts = collectUpcomingAlerts([interval('2/2', -120, RESTORE_LEAD_MINUTES)], NOW);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].kind).toBe('restoring');
    expect(alerts[0].minutesLeft).toBe(RESTORE_LEAD_MINUTES);

    expect(collectUpcomingAlerts([interval('2/2', -120, RESTORE_LEAD_MINUTES + 1)], NOW)).toHaveLength(0);
  });

  test('про уже начавшееся отключение предупреждает о конце, а не о начале', () => {
    const alerts = collectUpcomingAlerts([interval('2/2', -10, 5)], NOW);
    expect(alerts.map((item) => item.kind)).toEqual(['restoring']);
    expect(alerts[0].minutesLeft).toBe(5);
  });

  test('прошедшее отключение не поминает: это история, а не предупреждение', () => {
    expect(collectUpcomingAlerts([interval('2/2', -180, -60)], NOW)).toHaveLength(0);
  });

  test('«за 0 хвилин» не показываем: минимум — одна минута', () => {
    const alerts = collectUpcomingAlerts([interval('2/2', 0.4, 60)], NOW);
    expect(alerts[0].minutesLeft).toBe(1);
  });

  test('одна и та же граница двух интервалов даёт одно предупреждение', () => {
    const duplicated = [interval('2/2', 10, 60), interval('2/2', 10, 60)];
    expect(collectUpcomingAlerts(duplicated, NOW)).toHaveLength(1);
  });

  test('разные очереди и разные границы предупреждают каждая о своём', () => {
    const alerts = collectUpcomingAlerts(
      [interval('1/1', 10, 60), interval('2/2', 20, 60), interval('3/1', -60, 5)],
      NOW,
    );
    expect(alerts.map((item) => `${item.kind}:${item.queue}`)).toEqual([
      'restoring:3/1',
      'starting:1/1',
      'starting:2/2',
    ]);
  });

  test('битые интервалы отбрасываются, а не превращаются в предупреждение', () => {
    const broken = [
      { queue: '2/2', startsAt: 'не дата', endsAt: iso(10) },
      { queue: '', startsAt: iso(5), endsAt: iso(60) },
      { queue: 'мусор', startsAt: iso(5), endsAt: iso(60) },
      { queue: '2/2', startsAt: iso(-30), endsAt: iso(-30) },
      { queue: '2/2', startsAt: iso(-30), endsAt: iso(-40) },
    ];
    expect(collectUpcomingAlerts(broken, NOW)).toEqual([]);
  });

  test('код очереди нормализуется: «2/2» из закладки и «2/2» из графика — одно', () => {
    expect(collectUpcomingAlerts([interval(' 2/2 ', 10, 60)], NOW)[0].queue).toBe('2/2');
  });

  test('пустой список интервалов — пустой список предупреждений', () => {
    expect(collectUpcomingAlerts([], NOW)).toEqual([]);
  });
});

describe('intervalsForQueues', () => {
  const bucket = (queue: string, rows: Array<[number, number]>): GroupOutageSummary =>
    ({
      queue,
      date: '2026-10-16',
      intervals: rows.map(([from, to]) => ({ startsAt: iso(from), endsAt: iso(to), stateCode: null })),
    }) as unknown as GroupOutageSummary;

  test('берёт интервалы только названных очередей и обеих суток графика', () => {
    const buckets = [
      bucket('1/1', [[10, 60]]),
      bucket('2/2', [[-60, 5], [1440 + 30, 1440 + 90]]),
      bucket('3/1', [[5, 30]]),
    ];
    const found = intervalsForQueues(buckets, ['2/2']);
    expect(found).toHaveLength(2);
    expect(found.map((item) => item.queue)).toEqual(['2/2', '2/2']);
  });

  test('замечает все очереди человека сразу — и «мої черги», и закладки', () => {
    const buckets = [bucket('1/1', [[10, 60]]), bucket('2/2', [[10, 60]]), bucket('3/1', [[10, 60]])];
    expect(intervalsForQueues(buckets, ['1/1', '3/1']).map((item) => item.queue)).toEqual(['1/1', '3/1']);
  });

  test('пустой список очередей — не «всё подряд», а ничего', () => {
    expect(intervalsForQueues([bucket('1/1', [[10, 60]])], [])).toEqual([]);
  });

  test('битые интервалы графика пропускаются, целые остаются', () => {
    const dirty = {
      queue: '2/2',
      date: '2026-10-16',
      intervals: [{ startsAt: iso(10) }, { endsAt: iso(60) }, { startsAt: iso(10), endsAt: iso(60) }],
    } as unknown as GroupOutageSummary;
    expect(intervalsForQueues([dirty], ['2/2'])).toHaveLength(1);
  });
});

describe('дедупликация показанных предупреждений', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    };
  });

  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  const alert = (queue: string, offsetMinutes: number) =>
    collectUpcomingAlerts([interval(queue, offsetMinutes, offsetMinutes + 60)], NOW)[0];

  test('показанное предупреждение больше не повторяется', () => {
    const first = alert('2/2', 10);
    expect(filterUnnotified([first], NOW)).toHaveLength(1);

    markNotified([first], NOW);
    expect(filterUnnotified([first], NOW)).toEqual([]);
  });

  test('вторая очередь тем же предупреждением не глушится', () => {
    const one = alert('1/1', 10);
    const two = alert('2/2', 10);
    markNotified([one], NOW);
    expect(filterUnnotified([one, two], NOW)).toEqual([two]);
  });

  test('ключ содержит время: завтрашнее отключение той же очереди — новое предупреждение', () => {
    const today = alert('2/2', 10);
    // То же самое отключение, но сутки спустя: на момент проверки до него снова 10 минут.
    const tomorrow = collectUpcomingAlerts([interval('2/2', 1440 + 10, 1440 + 60)], NOW + minutes(1440))[0];
    expect(today.key).not.toBe(tomorrow.key);

    markNotified([today], NOW);
    expect(filterUnnotified([tomorrow], NOW)).toEqual([tomorrow]);
  });

  test('записи старше полутора суток не мешают новой попытке', () => {
    const stale = alert('2/2', 10);
    markNotified([stale], NOW);
    const muchLater = NOW + 40 * 60 * 60 * 1000;
    expect(filterUnnotified([stale], muchLater)).toEqual([stale]);
  });

  test('битая запись в сховище не мешает показать предупреждение', () => {
    localStorage.setItem('svitlo:notified-alerts:v1', 'не json');
    const item = alert('2/2', 10);
    expect(filterUnnotified([item], NOW)).toEqual([item]);
  });

  test('форма ключа предупреждения зафиксирована: тип, очередь, время', () => {
    expect(alertKey('starting', '2/2', '2026-10-16T12:30:00.000Z')).toBe(
      'starting:2/2:2026-10-16T12:30:00.000Z',
    );
  });
});
