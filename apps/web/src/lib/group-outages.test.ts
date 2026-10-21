import { describe, expect, test } from 'vitest';
import type { GroupOutageInterval, GroupOutageSummary, Outage } from '@svitlo/shared';
import { mergeGroupOutages, synthesizeGroupOutages } from './group-outages.js';

const TODAY = '2026-10-18';
const TOMORROW = '2026-10-19';

const off = (from: string, to: string): GroupOutageInterval => ({
  startsAt: from,
  endsAt: to,
  localTimeFrom: from.slice(11, 16),
  localTimeTo: to.slice(11, 16),
  stateCode: 3,
  stateName: 'Відключення',
  stateColor: '#F43F5E',
});

const bucket = (date: string, queue: string, intervals: GroupOutageInterval[]): GroupOutageSummary => ({
  queue,
  date,
  source: 'mirror',
  intervals,
  settlements: [],
  streetNames: [],
  isActiveNow: false,
  nextStartsAt: null,
});

const options = {
  regionCpu: 'lvivska-oblast',
  areaName: 'Львівська область',
  todayKey: TODAY,
  tomorrowKey: TOMORROW,
  // 12:00 за Києвом: окно 10:00–13:00 идёт сейчас, 18:00–21:00 — впереди.
  nowMs: Date.parse('2026-10-18T12:00:00+03:00'),
};

describe('synthesizeGroupOutages: только сегодня и завтра', () => {
  test('архивные июльские слоты не превращаются в текущий график', () => {
    const result = synthesizeGroupOutages(
      [bucket('2026-07-14', '2/1', [off('2026-07-14T10:00:00+03:00', '2026-07-14T13:00:00+03:00')])],
      options,
    );
    expect(result).toEqual([]);
  });

  test('окна сегодня и завтра попадают в список с пометкой группы', () => {
    const result = synthesizeGroupOutages(
      [
        bucket(TODAY, '2/2', [
          off('2026-10-18T10:00:00+03:00', '2026-10-18T13:00:00+03:00'),
          off('2026-10-18T18:00:00+03:00', '2026-10-18T21:00:00+03:00'),
        ]),
        bucket(TOMORROW, '2/2', [off('2026-10-19T08:00:00+03:00', '2026-10-19T10:00:00+03:00')]),
      ],
      options,
    );

    expect(result).toHaveLength(3);
    expect(result.every((outage) => outage.kind === 'group' && outage.group === '2/2')).toBe(true);
    expect(result.map((outage) => outage.status)).toEqual(['active', 'scheduled', 'scheduled']);
  });

  test('слоты не-отключения и битые интервалы отбрасываются', () => {
    const broken: GroupOutageInterval = { ...off('2026-10-18T10:00:00+03:00', '2026-10-18T13:00:00+03:00'), stateCode: 1 };
    const result = synthesizeGroupOutages(
      [bucket(TODAY, '1/1', [broken, off('2026-10-18T15:00:00+03:00', '2026-10-18T14:00:00+03:00')])],
      options,
    );
    expect(result).toEqual([]);
  });
});

const outage = (id: string, group: string | undefined, startsAt: string, endsAt: string): Outage => ({
  id,
  startsAt,
  endsAt,
  areaName: 'Львівська область',
  addressesRaw: '',
  addressesNormalized: '',
  kind: group ? 'group' : 'repair',
  group,
  reason: null,
  status: 'scheduled',
  queue: null,
  source: 'mirror',
  sourceId: '',
  contentHash: '',
  firstSeenAt: startsAt,
  updatedAt: startsAt,
});

describe('mergeGroupOutages: без дублей и без потери разных очередей', () => {
  test('одинаковое окно из API и расписания остаётся одной карточкой', () => {
    const api = [outage('api-1', '2/2', '2026-10-18T10:00:00+03:00', '2026-10-18T13:00:00+03:00')];
    const synthesized = [outage('gpv-1', '2/2', '2026-10-18T10:00:00+03:00', '2026-10-18T13:00:00+03:00')];
    expect(mergeGroupOutages(api, synthesized)).toHaveLength(1);
  });

  test('две разные очереди в одно время — не дубль', () => {
    const api = [outage('api-1', '2/1', '2026-10-18T10:00:00+03:00', '2026-10-18T13:00:00+03:00')];
    const synthesized = [outage('gpv-1', '2/2', '2026-10-18T10:00:00+03:00', '2026-10-18T13:00:00+03:00')];
    expect(mergeGroupOutages(api, synthesized)).toHaveLength(2);
  });
});
