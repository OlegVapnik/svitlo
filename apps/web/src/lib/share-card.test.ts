import { describe, expect, test } from 'vitest';
import type { OperatorStateCode, ScheduleIntervalUtc } from '@svitlo/shared';
import { cardDateLabel, cardOutages, cardSegments, shareCardFileName } from './share-card.js';

/** Летние сутки: Киев = UTC+3, поэтому 09:00Z — это 12:00 по Киеву. */
const interval = (stateCode: OperatorStateCode, from: string, to: string): ScheduleIntervalUtc => ({
  startsAt: from,
  endsAt: to,
  stateCode,
  stateName: stateCode === 3 ? 'Відключення' : 'Світло є',
  stateColor: '#000000',
});

describe('Картка графіка: данные для canvas', () => {
  test('на шкалу попадают только «нет света» и «возможно», по порядку', () => {
    const segments = cardSegments(
      [
        interval(3, '2026-10-10T14:00:00.000Z', '2026-10-10T16:00:00.000Z'), // 17:00–19:00
        interval(1, '2026-10-10T07:00:00.000Z', '2026-10-10T08:00:00.000Z'), // свет — не сегмент
        interval(2, '2026-10-10T09:00:00.000Z', '2026-10-10T10:00:00.000Z'), // 12:00–13:00
      ],
      '2026-10-10',
    );
    expect(segments).toEqual([
      { from: 720, to: 780, tone: 'uncertain' },
      { from: 1020, to: 1140, tone: 'off' },
    ]);
  });

  test('в список под шкалой идут только реальные отключения', () => {
    const outages = cardOutages(
      [
        interval(3, '2026-10-10T09:00:00.000Z', '2026-10-10T11:00:00.000Z'),
        interval(2, '2026-10-10T12:00:00.000Z', '2026-10-10T13:00:00.000Z'),
      ],
      '2026-10-10',
    );
    expect(outages).toEqual([{ from: 720, to: 840, tone: 'off' }]);
  });

  test('дата карточки — по-украински, месяц из Intl', () => {
    expect(cardDateLabel('2026-10-17')).toContain('жовтня');
    expect(cardDateLabel('2026-10-17')).toContain('2026');
    // Битая дата не должна превращаться в «Invalid Date» на картинке.
    expect(cardDateLabel('bad')).toBe('bad');
  });

  test('имя файла не содержит «/» из кода очереди', () => {
    expect(shareCardFileName({ date: '2026-10-17', queue: '2/2' })).toBe('svitlo-2026-10-17-2-2.png');
    expect(shareCardFileName({ date: '2026-10-17', queue: '6/1' })).toBe('svitlo-2026-10-17-6-1.png');
  });
});
