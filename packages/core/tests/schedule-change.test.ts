import { describe, expect, it } from 'vitest';

import type { KeyValueStorage } from '../src/storage.ts';
import {
  forgetScheduleChange,
  legacyScheduleSnapshotKey,
  pruneScheduleRevisions,
  readScheduleRevisions,
  rememberSchedule,
  scheduleRevisionsKey,
} from '../src/lib/schedule-change.ts';

/** Мок localStorage: той самий контракт, що в браузера, але без DOM. */
function createMockLocalStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  let failReads = false;
  let failWrites = false;
  const store: KeyValueStorage = {
    getItem(key) {
      if (failReads) throw new Error('storage disabled');
      return data.get(key) ?? null;
    },
    setItem(key, value) {
      if (failWrites) throw new Error('quota exceeded');
      data.set(key, value);
    },
    removeItem(key) {
      data.delete(key);
    },
    keys: () => [...data.keys()],
  };
  return {
    store,
    data,
    breakReads: () => {
      failReads = true;
    },
    breakWrites: () => {
      failWrites = true;
    },
  };
}

const interval = (startsAt: string, endsAt: string) => ({ startsAt, endsAt });
const early = '2026-10-30T06:00:00.000Z';
const later = '2026-10-30T09:00:00.000Z';

describe('rememberSchedule — історія ревізій', () => {
  it('перший запуск за добу → null, але базовий зріз збережено', () => {
    const mock = createMockLocalStorage();
    const intervals = [interval('2026-10-30T16:00:00.000Z', '2026-10-30T18:00:00.000Z')];

    expect(rememberSchedule('chernihiv', '2/2', '2026-10-30', intervals, mock.store, new Date(early))).toBeNull();

    const saved = readScheduleRevisions('chernihiv', '2/2', '2026-10-30', mock.store);
    expect(saved?.initialIntervals).toEqual(intervals);
    expect(saved?.lastIntervals).toEqual(intervals);
    expect(saved?.revisions).toEqual([]);
    expect(saved?.firstSeenAt).toBe(early);
  });

  it('ключ містить чергу: 2/2 і 4/1 не порівнюються між собою', () => {
    const mock = createMockLocalStorage();
    const first = [interval('2026-10-30T16:00:00.000Z', '2026-10-30T18:00:00.000Z')];
    const second = [interval('2026-10-30T18:00:00.000Z', '2026-10-30T20:00:00.000Z')];

    rememberSchedule('kyiv', '2/2', '2026-10-30', first, mock.store, new Date(early));
    // Друга черга бачить свій перший запуск, а не «зміну» відносно 2/2.
    expect(rememberSchedule('kyiv', '4/1', '2026-10-30', second, mock.store, new Date(later))).toBeNull();
    expect(mock.data.has(scheduleRevisionsKey('kyiv', '2/2', '2026-10-30'))).toBe(true);
    expect(mock.data.has(scheduleRevisionsKey('kyiv', '4/1', '2026-10-30'))).toBe(true);
    expect(mock.data.has('svitlo.schedule-revisions.kyiv.2026-10-30')).toBe(false);
  });

  it('той самий графік удруге без ревізій → null', () => {
    const mock = createMockLocalStorage();
    const intervals = [interval('2026-10-30T16:00:00.000Z', '2026-10-30T18:00:00.000Z')];

    rememberSchedule('kyiv', '2/2', '2026-10-30', intervals, mock.store, new Date(early));
    forgetScheduleChange('kyiv', '2/2', '2026-10-30');

    expect(rememberSchedule('kyiv', '2/2', '2026-10-30', intervals, mock.store, new Date(later))).toBeNull();
  });

  it('додане вікно → ревізія з конкретними годинами', () => {
    const mock = createMockLocalStorage();
    rememberSchedule('lviv', '1/1', '2026-10-30', [], mock.store, new Date(early));

    const notice = rememberSchedule(
      'lviv',
      '1/1',
      '2026-10-30',
      [interval('2026-10-30T16:00:00.000Z', '2026-10-30T17:30:00.000Z')],
      mock.store,
      new Date(later),
    );

    expect(notice?.addedMinutes).toBe(90);
    expect(notice?.revisions).toHaveLength(1);
    expect(notice?.revisions[0]?.detectedAt).toBe(later);
    expect(notice?.revisions[0]?.summary).toBe(
      'Графік оновлено: +1 год 30 хв без світла (додано 18:00–19:30)',
    );
    expect(notice?.revisions[0]?.addedRanges).toEqual([
      { startMin: 18 * 60, endMin: 19 * 60 + 30, start: '18:00', end: '19:30' },
    ]);
  });

  it('повторний рефреш з тим самим графіком НЕ стирає плашку', () => {
    const mock = createMockLocalStorage();
    rememberSchedule('odesa', '3/1', '2026-10-30', [], mock.store, new Date(early));
    const changed = rememberSchedule(
      'odesa',
      '3/1',
      '2026-10-30',
      [interval('2026-10-30T16:00:00.000Z', '2026-10-30T17:00:00.000Z')],
      mock.store,
      new Date(later),
    );
    expect(changed?.revisions).toHaveLength(1);

    // Фоновий /sync або перезапуск: кеш у пам'яті порожній, читаємо лише сховище.
    forgetScheduleChange('odesa', '3/1', '2026-10-30');
    const afterRefresh = rememberSchedule(
      'odesa',
      '3/1',
      '2026-10-30',
      [interval('2026-10-30T16:00:00.000Z', '2026-10-30T17:00:00.000Z')],
      mock.store,
      new Date('2026-10-30T12:00:00.000Z'),
    );

    expect(afterRefresh).not.toBeNull();
    expect(afterRefresh?.revisions).toHaveLength(1);
    expect(afterRefresh?.summary).toBe(changed?.summary);
  });

  it('кілька правок за добу накопичуються, остання стає заголовком', () => {
    const mock = createMockLocalStorage();
    rememberSchedule('kharkiv', '5/1', '2026-10-30', [], mock.store, new Date(early));
    rememberSchedule(
      'kharkiv',
      '5/1',
      '2026-10-30',
      [interval('2026-10-30T16:00:00.000Z', '2026-10-30T17:00:00.000Z')],
      mock.store,
      new Date(later),
    );
    const second = rememberSchedule(
      'kharkiv',
      '5/1',
      '2026-10-30',
      [
        interval('2026-10-30T16:00:00.000Z', '2026-10-30T17:00:00.000Z'),
        interval('2026-10-30T19:00:00.000Z', '2026-10-30T19:30:00.000Z'),
      ],
      mock.store,
      new Date('2026-10-30T12:00:00.000Z'),
    );

    expect(second?.revisions).toHaveLength(2);
    expect(second?.revisions[1]?.summary).toBe(
      'Графік оновлено: +30 хв без світла (додано 21:00–21:30)',
    );
    expect(second?.summary).toBe(second?.revisions[1]?.summary);
    expect(second?.initialIntervals).toEqual([]);
    expect(second?.currentIntervals).toHaveLength(2);
  });

  it('Plan vs Fact: втрачені хвилини базового плану знижують точність', () => {
    const mock = createMockLocalStorage();
    rememberSchedule(
      'dnipro',
      '6/1',
      '2026-10-30',
      [interval('2026-10-30T16:00:00.000Z', '2026-10-30T18:00:00.000Z')],
      mock.store,
      new Date(early),
    );
    // Половину плану скасували: 60 з 120 хвилин лишилися.
    const notice = rememberSchedule(
      'dnipro',
      '6/1',
      '2026-10-30',
      [interval('2026-10-30T16:00:00.000Z', '2026-10-30T17:00:00.000Z')],
      mock.store,
      new Date(later),
    );

    expect(notice?.removedRanges).toEqual([
      { startMin: 19 * 60, endMin: 20 * 60, start: '19:00', end: '20:00' },
    ]);
    expect(notice?.planAccuracyPercent).toBe(50);
  });

  it('інша доба має власний стан і не порівнюється із сусідньою', () => {
    const mock = createMockLocalStorage();
    rememberSchedule('vinnytsia', '1/2', '2026-10-30', [], mock.store, new Date(early));

    expect(
      rememberSchedule(
        'vinnytsia',
        '1/2',
        '2026-10-31',
        [interval('2026-10-31T16:00:00.000Z', '2026-10-31T17:00:00.000Z')],
        mock.store,
        new Date(later),
      ),
    ).toBeNull();
    expect(mock.data.has(scheduleRevisionsKey('vinnytsia', '1/2', '2026-10-31'))).toBe(true);
  });

  it('битий JSON у сховищі → як перший запуск, без падіння', () => {
    const mock = createMockLocalStorage({
      [scheduleRevisionsKey('sumy', '1/1', '2026-10-30')]: '{не json',
    });

    expect(
      rememberSchedule(
        'sumy',
        '1/1',
        '2026-10-30',
        [interval('2026-10-30T16:00:00.000Z', '2026-10-30T17:00:00.000Z')],
        mock.store,
        new Date(early),
      ),
    ).toBeNull();
  });

  it('недоступне сховище (приватний режим) не ламає виклик', () => {
    const mock = createMockLocalStorage();
    mock.breakReads();

    expect(
      rememberSchedule(
        'poltava',
        '2/2',
        '2026-10-30',
        [interval('2026-10-30T16:00:00.000Z', '2026-10-30T17:00:00.000Z')],
        mock.store,
        new Date(early),
      ),
    ).toBeNull();
    expect(readScheduleRevisions('poltava', '2/2', '2026-10-30', mock.store)).toBeNull();
  });

  it('помилка запису не заважає показати зміну', () => {
    const mock = createMockLocalStorage();
    rememberSchedule('rivne', '2/1', '2026-10-30', [], mock.store, new Date(early));
    mock.breakWrites();

    const notice = rememberSchedule(
      'rivne',
      '2/1',
      '2026-10-30',
      [interval('2026-10-30T16:00:00.000Z', '2026-10-30T16:30:00.000Z')],
      mock.store,
      new Date(later),
    );

    expect(notice?.addedMinutes).toBe(30);
    expect(notice?.revisions).toHaveLength(1);
  });
});

describe('pruneScheduleRevisions', () => {
  it('видаляє ключі старші за 7 днів і старий формат без черги', () => {
    const oldKey = scheduleRevisionsKey('kyiv', '1/1', '2026-10-20');
    const freshKey = scheduleRevisionsKey('kyiv', '1/1', '2026-10-29');
    const legacyKey = legacyScheduleSnapshotKey('kyiv', '2026-10-29');
    const mock = createMockLocalStorage({ [oldKey]: '{}', [freshKey]: '{}', [legacyKey]: '{}' });

    pruneScheduleRevisions(mock.store, '2026-10-30');

    expect(mock.data.has(oldKey)).toBe(false);
    expect(mock.data.has(freshKey)).toBe(true);
    expect(mock.data.has(legacyKey)).toBe(false);
  });
});
