import { describe, expect, it } from 'vitest';

import {
  buildOutageEvents,
  groupOutageEventsByQueue,
  repairEvents,
  buildWidgetSnapshot,
  groupOutagesByPlace,
  groupOutagesByReason,
  mergeUpcomingGroups,
} from '../src/lib/outages.ts';
import { formatDayHeading } from '../src/lib/date.ts';
import type { GroupOutageSummary, Outage } from '@svitlo/shared';

const interval = (from: string, to: string) => ({
  startsAt: from,
  endsAt: to,
  stateCode: 3 as const,
  stateName: 'Відключення',
  stateColor: '#f00',
  localTimeFrom: '',
  localTimeTo: '',
});

const group = (
  queue: string,
  times: Array<[string, string]>,
  date = '2026-10-28',
  extras: Partial<GroupOutageSummary> = {},
): GroupOutageSummary => ({
  queue,
  date,
  source: 'mirror',
  intervals: times.map(([from, to]) => interval(from, to)),
  settlements: [],
  streetNames: [],
  isActiveNow: false,
  nextStartsAt: null,
  ...extras,
});

const outage = (overrides: Partial<Outage>): Outage => ({
  id: 'x',
  startsAt: '2026-10-28T10:00:00Z',
  endsAt: '2026-10-28T12:00:00Z',
  areaName: 'Чернігів',
  addressesRaw: '',
  addressesNormalized: '',
  status: 'active',
  source: 'test',
  sourceId: '',
  contentHash: '',
  firstSeenAt: '',
  updatedAt: '',
  ...overrides,
});

describe('mergeUpcomingGroups', () => {
  it('склеивает одинаковые окна и собирает очереди', () => {
    const merged = mergeUpcomingGroups([
      group('2/2', [['2026-10-28T10:00:00Z', '2026-10-28T12:00:00Z']]),
      group('1/1', [['2026-10-28T10:00:00Z', '2026-10-28T12:00:00Z']], '2026-10-28', {
        isActiveNow: true,
      }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.queues).toEqual(['1/1', '2/2']);
    expect(merged[0]!.isActiveNow).toBe(true);
  });

  it('разные окна и даты остаются разными карточками', () => {
    const merged = mergeUpcomingGroups([
      group('1/1', [['2026-10-28T10:00:00Z', '2026-10-28T12:00:00Z']]),
      group('1/1', [['2026-10-28T13:00:00Z', '2026-10-28T15:00:00Z']]),
      group('1/1', [['2026-10-29T10:00:00Z', '2026-10-29T12:00:00Z']], '2026-10-29'),
    ]);
    expect(merged).toHaveLength(3);
  });

  it('объединяет улицы и населённые пункты без дублей', () => {
    const merged = mergeUpcomingGroups([
      group('1/1', [['2026-10-28T10:00:00Z', '2026-10-28T12:00:00Z']], '2026-10-28', {
        streetNames: ['Шевченка'],
        settlements: ['Чернігів'],
      }),
      group('2/2', [['2026-10-28T10:00:00Z', '2026-10-28T12:00:00Z']], '2026-10-28', {
        streetNames: ['Шевченка', 'Соборна'],
        settlements: ['Чернігів', 'Ніжин'],
      }),
    ]);
    expect(merged[0]!.streetNames).toEqual(['Шевченка', 'Соборна']);
    expect(merged[0]!.settlements).toEqual(['Чернігів', 'Ніжин']);
  });
});

describe('groupOutagesByReason', () => {
  it('склеивает смежные получасовки в одно окно', () => {
    const buckets = groupOutagesByReason(
      [
        outage({ id: '1', kind: 'group', reason: 'ГПВ', startsAt: '2026-10-28T10:00:00Z', endsAt: '2026-10-28T10:30:00Z' }),
        outage({ id: '2', kind: 'group', reason: 'ГПВ', startsAt: '2026-10-28T10:30:00Z', endsAt: '2026-10-28T11:00:00Z' }),
      ],
      '2026-10-28',
    );
    expect(buckets).toHaveLength(1);
    expect(buckets[0]!.windows).toEqual([{ startMin: 720, endMin: 780 }]);
    expect(buckets[0]!.date).toBe('2026-10-28');
  });

  it('разные причины и виды — разные корзины, больше окон первым', () => {
    const buckets = groupOutagesByReason(
      [
        outage({ id: '1', kind: 'repair', reason: 'Аварія' }),
        outage({ id: '2', kind: 'group', reason: 'ГПВ' }),
        outage({ id: '3', kind: 'group', reason: 'ГПВ', startsAt: '2026-10-28T13:00:00Z', endsAt: '2026-10-28T14:00:00Z' }),
      ],
      '2026-10-28',
    );
    expect(buckets).toHaveLength(2);
    expect(buckets[0]!.reason).toBe('ГПВ');
    expect(buckets[0]!.windows).toHaveLength(2);
  });
});

describe('groupOutagesByPlace', () => {
  it('группирует по первой улице, без улицы — по населённому пункту', () => {
    const places = groupOutagesByPlace(
      [
        outage({ id: '1', streets: ['Шевченка'], startsAt: '2026-10-28T12:00:00Z' }),
        outage({ id: '2', streets: ['Шевченка'], startsAt: '2026-10-28T13:00:00Z' }),
        outage({ id: '3', streets: [], areaName: 'Ніжин' }),
      ],
      'невідомо',
    );
    expect(places.map((place) => place.label)).toEqual(['Ніжин', 'Шевченка']);
    expect(places.find((place) => place.label === 'Шевченка')!.items).toHaveLength(2);
  });

  it('сортирует по времени начала, а не по количеству', () => {
    const places = groupOutagesByPlace(
      [
        outage({ id: 'late', streets: ['Пізня'], startsAt: '2026-10-28T15:00:00Z' }),
        outage({ id: 'early', streets: ['Рання'], startsAt: '2026-10-28T08:00:00Z' }),
      ],
      'невідомо',
    );
    expect(places.map((place) => place.label)).toEqual(['Рання', 'Пізня']);
  });

  it('пустой список — пустой результат', () => {
    expect(groupOutagesByPlace([], 'невідомо')).toEqual([]);
  });
});

describe('formatDayHeading', () => {
  const now = new Date('2026-10-28T09:00:00Z');

  it('сегодня, завтра и обычная дата', () => {
    expect(formatDayHeading('2026-10-28', now)).toBe('Сьогодні, 28 жовтня');
    expect(formatDayHeading('2026-10-29', now)).toBe('Завтра, 29 жовтня');
    expect(formatDayHeading('2026-11-05', now)).toBe('5 листопада');
  });
});

describe('buildOutageEvents', () => {
  const now = new Date('2026-10-28T10:15:00Z'); // 12:15 за Києвом
  const schedule = [
    group('2/2', [
      ['2026-10-28T08:00:00Z', '2026-10-28T09:00:00Z'], // прошло
      ['2026-10-28T10:00:00Z', '2026-10-28T10:30:00Z'], // идёт
      ['2026-10-28T10:45:00Z', '2026-10-28T11:15:00Z'], // скоро (30 мин)
      ['2026-10-28T15:00:00Z', '2026-10-28T16:00:00Z'], // запланировано
    ]),
    group('1/1', [['2026-10-29T10:00:00Z', '2026-10-29T11:00:00Z']], '2026-10-29'),
  ];

  it('пропускает прошедшие окна и чужие даты', () => {
    const events = buildOutageEvents(schedule, [], { date: '2026-10-28', now });
    expect(events.map((event) => event.kind)).toEqual(['active', 'soon', 'scheduled']);
  });

  it('подписывает окна локальным временем оператора', () => {
    const [active] = buildOutageEvents(schedule, [], { date: '2026-10-28', now });
    expect(active!.timeFrom).toBe('12:00');
    expect(active!.timeTo).toBe('12:30');
    expect(active!.queue).toBe('2/2');
  });

  it('добавляет ремонты и сортирует: активные, скорые, ремонты, плановые', () => {
    const events = buildOutageEvents(
      schedule,
      [outage({ id: 'r1', kind: 'repair', reason: 'Аварія', areaName: 'Ніжин' })],
      { date: '2026-10-28', now },
    );
    expect(events.map((event) => event.kind)).toEqual(['active', 'soon', 'repair', 'scheduled']);
    expect(events[2]!.areaName).toBe('Ніжин');
    expect(events[2]!.reason).toBe('Аварія');
  });

  it('без названия населённого пункта берёт регион', () => {
    const events = buildOutageEvents(schedule, [outage({ areaName: '' })], {
      date: '2026-10-28',
      now,
      regionName: 'Чернігівська',
    });
    expect(events.find((event) => event.kind === 'repair')!.areaName).toBe('Чернігівська');
  });
});

describe('buildWidgetSnapshot', () => {
  const schedule = (times: Array<[string, string]>) => ({
    intervals: times.map(([from, to]) => interval(from, to)),
    lastImportedAt: '2026-10-28T12:00:00.000Z',
  });

  it('без обраної черги — null', () => {
    expect(
      buildWidgetSnapshot({
        queue: null,
        todayKey: '2026-10-28',
        now: new Date('2026-10-28T12:00:00Z'),
        upcoming: [],
        selectedDayOffset: 0,
        isOff: false,
        hasIntervals: false,
        allClear: false,
      }),
    ).toBeNull();
  });

  it('поточне відключення: isOff, повернення світла в nextChangeTime', () => {
    const snapshot = buildWidgetSnapshot({
      queue: '5/1',
      todayKey: '2026-10-28',
      now: new Date('2026-10-28T11:00:00Z'),
      upcoming: [group('5/1', [['2026-10-28T10:00:00Z', '2026-10-28T12:00:00Z']])],
      schedule: schedule([['2026-10-28T10:00:00Z', '2026-10-28T12:00:00Z']]),
      selectedDayOffset: 0,
      isOff: true,
      hasIntervals: true,
      allClear: false,
    });
    expect(snapshot).not.toBeNull();
    expect(snapshot!.isOff).toBe(true);
    expect(snapshot!.nextChangeKind).toBe('on');
    expect(snapshot!.nextChangeTime).toBe('2026-10-28T12:00:00Z');
    expect(snapshot!.upcomingIntervals).toEqual([
      { startEpochMs: Date.parse('2026-10-28T11:00:00Z'), endEpochMs: Date.parse('2026-10-28T12:00:00Z') },
    ]);
    expect(snapshot!.todayOutageHours).toBe(2);
    expect(snapshot!.updatedAt).toBe('2026-10-28T12:00:00.000Z');
  });

  it('майбутнє відключення: nextChangeKind=off, старт не раніше за «зараз»', () => {
    const snapshot = buildWidgetSnapshot({
      queue: '5/1',
      todayKey: '2026-10-28',
      now: new Date('2026-10-28T09:00:00Z'),
      upcoming: [group('5/1', [['2026-10-28T10:00:00Z', '2026-10-28T12:00:00Z']])],
      selectedDayOffset: 0,
      isOff: false,
      hasIntervals: true,
      allClear: false,
    })!;
    expect(snapshot.isOff).toBe(false);
    expect(snapshot.nextChangeKind).toBe('off');
    expect(snapshot.nextChangeTime).toBe('2026-10-28T10:00:00Z');
    expect(snapshot.upcomingIntervals[0]!.startEpochMs).toBe(Date.parse('2026-10-28T10:00:00Z'));
    expect(snapshot.updatedAt).toBe('2026-10-28T09:00:00.000Z');
  });

  it('без подій: hasData=false, nextChangeKind=none, 0 годин', () => {
    const snapshot = buildWidgetSnapshot({
      queue: '5/1',
      todayKey: '2026-10-28',
      now: new Date('2026-10-28T09:00:00Z'),
      upcoming: [],
      selectedDayOffset: 0,
      isOff: false,
      hasIntervals: false,
      allClear: false,
    })!;
    expect(snapshot.hasData).toBe(false);
    expect(snapshot.nextChangeKind).toBe('none');
    expect(snapshot.nextChangeTime).toBeNull();
    expect(snapshot.todayOutageHours).toBe(0);
    expect(snapshot.todayIntervals).toEqual([]);
  });

  it('allClear — дані є, але відключень немає', () => {
    const snapshot = buildWidgetSnapshot({
      queue: '5/1',
      todayKey: '2026-10-28',
      now: new Date('2026-10-28T09:00:00Z'),
      upcoming: [],
      selectedDayOffset: 0,
      isOff: false,
      hasIntervals: false,
      allClear: true,
    })!;
    expect(snapshot.hasData).toBe(true);
    expect(snapshot.isOff).toBe(false);
  });

  it('ігнорує інші черги та невалідні дати, дни пише окремо', () => {
    const invalid = { ...interval('не дата', '2026-10-28T12:00:00Z') };
    const snapshot = buildWidgetSnapshot({
      queue: '5/1',
      todayKey: '2026-10-28',
      now: new Date('2026-10-28T09:00:00Z'),
      upcoming: [
        group('1/1', [['2026-10-28T10:00:00Z', '2026-10-28T11:00:00Z']]),
        { ...group('5/1', [['2026-10-29T10:00:00Z', '2026-10-29T11:00:00Z']]), date: '2026-10-29' },
        { ...group('5/1', []), date: '2026-10-28', intervals: [invalid] },
      ],
      selectedDayOffset: 1,
      isOff: false,
      hasIntervals: true,
      allClear: false,
    })!;
    expect(snapshot.todayIntervals).toEqual([]);
    expect(snapshot.upcomingIntervals).toHaveLength(1);
    expect(snapshot.todayOutageHours).toBe(0);
  });

  it('вибрана інша доба не робить виджет «вимкненим» через isOff', () => {
    const snapshot = buildWidgetSnapshot({
      queue: '5/1',
      todayKey: '2026-10-28',
      now: new Date('2026-10-28T09:00:00Z'),
      upcoming: [],
      selectedDayOffset: 1,
      isOff: true,
      hasIntervals: true,
      allClear: false,
    })!;
    expect(snapshot.isOff).toBe(false);
  });
});

describe('groupOutageEventsByQueue', () => {
  const event = (
    queue: string,
    from: string,
    to: string,
    kind: 'active' | 'soon' | 'scheduled' = 'scheduled',
  ) => ({
    id: `plan-${queue}-${from}`,
    kind,
    queue,
    startsAt: from,
    endsAt: to,
    timeFrom: from.slice(11, 16),
    timeTo: to.slice(11, 16),
    reason: null,
    areaName: null,
  });

  it('собирает все окна одной очереди в одну карточку', () => {
    const cards = groupOutageEventsByQueue(
      [
        event('2/2', '2026-10-28T06:00:00Z', '2026-10-28T08:00:00Z'),
        event('2/2', '2026-10-28T17:00:00Z', '2026-10-28T21:00:00Z'),
        event('1/1', '2026-10-28T09:00:00Z', '2026-10-28T10:00:00Z'),
      ],
      { now: new Date('2026-10-28T05:00:00Z') },
    );

    expect(cards).toHaveLength(2);
    const byQueue = new Map(cards.map((card) => [card.queue, card]));
    expect(byQueue.get('2/2')?.windows).toHaveLength(2);
    // 2 часа + 4 часа = 360 минут без света за день.
    expect(byQueue.get('2/2')?.offMinutes).toBe(360);
    expect(byQueue.get('1/1')?.offMinutes).toBe(60);
  });

  it('ставит мою очередь первой и помечает её', () => {
    const cards = groupOutageEventsByQueue(
      [
        event('10/1', '2026-10-28T06:00:00Z', '2026-10-28T07:00:00Z'),
        event('3/1', '2026-10-28T06:00:00Z', '2026-10-28T07:00:00Z'),
        event('1/1', '2026-10-28T06:00:00Z', '2026-10-28T07:00:00Z'),
      ],
      { now: new Date('2026-10-28T05:00:00Z'), mine: ['10/1'] },
    );

    expect(cards[0]?.queue).toBe('10/1');
    expect(cards[0]?.isMine).toBe(true);
    // Остальные — по порядку групп, а не по алфавиту: 1/1 раньше 3/1.
    expect(cards.slice(1).map((card) => card.queue)).toEqual(['1/1', '3/1']);
  });

  it('узнаёт мою очередь в плоском и подгрупповом написании (Киев)', () => {
    const cards = groupOutageEventsByQueue(
      [event('3/1', '2026-10-28T06:00:00Z', '2026-10-28T07:00:00Z')],
      { now: new Date('2026-10-28T05:00:00Z'), mine: ['3'], regionCpu: 'kyiv-city' },
    );
    expect(cards[0]?.isMine).toBe(true);
  });

  it('отмечает активное окно и ближайшее будущее', () => {
    const cards = groupOutageEventsByQueue(
      [
        event('1/1', '2026-10-28T10:00:00Z', '2026-10-28T12:00:00Z'),
        event('1/1', '2026-10-28T17:00:00Z', '2026-10-28T19:00:00Z', 'soon'),
      ],
      { now: new Date('2026-10-28T11:00:00Z') },
    );

    expect(cards[0]?.isActiveNow).toBe(true);
    expect(cards[0]?.windows[0]?.state).toBe('active');
    expect(cards[0]?.nextStartsAt).toBe('2026-10-28T17:00:00Z');
  });

  it('не смешивает ремонты с графиком', () => {
    const events = buildOutageEvents(
      [group('1/1', [['2026-10-28T20:00:00Z', '2026-10-28T22:00:00Z']])],
      [outage({ kind: 'repair', reason: 'Роботи' })],
      { date: '2026-10-28', now: new Date('2026-10-28T05:00:00Z') },
    );

    const cards = groupOutageEventsByQueue(events, { now: new Date('2026-10-28T05:00:00Z') });
    expect(cards.map((card) => card.queue)).toEqual(['1/1']);
    expect(repairEvents(events)).toHaveLength(1);
  });

  it('пустая лента не даёт карточек', () => {
    expect(groupOutageEventsByQueue([], { now: new Date() })).toEqual([]);
  });

  it('зливає перекриваючі інтервали (баг 7+7=14 годин)', () => {
    const cards = groupOutageEventsByQueue(
      [
        // ГПВ: 16:30–23:30 Київ (14:30Z–21:30Z)
        event('1/1', '2026-11-05T14:30:00Z', '2026-11-05T21:30:00Z'),
        // Одночасні заходи обмеження: 16:30–23:30 Київ
        event('1/1', '2026-11-05T14:30:00Z', '2026-11-05T21:30:00Z'),
        // Вкладений інтервал: 18:00–20:00 Київ (16:00Z–18:00Z)
        event('1/1', '2026-11-05T16:00:00Z', '2026-11-05T18:00:00Z'),
      ],
      { now: new Date('2026-11-05T12:00:00Z'), date: '2026-11-05' },
    );

    expect(cards).toHaveLength(1);
    expect(cards[0]?.windows).toHaveLength(2); // Дедупліковано дублікат 14:30–21:30
    // Сума рівно 7 годин = 420 хвилин (а не 14 чи 16 годин)
    expect(cards[0]?.offMinutes).toBe(420);
    expect(cards[0]?.todayOffMinutes).toBe(420);
  });

  it('не склеює години сьогодні і завтра в 22 години без світла', () => {
    const cards = groupOutageEventsByQueue(
      [
        // Сьогодні (05.11): 16:30–23:30 (420 хв = 7 год)
        event('1/1', '2026-11-05T14:30:00Z', '2026-11-05T21:30:00Z'),
        // Завтра (06.11): 02:30–09:30 (420 хв = 7 год) та 13:00–20:00 (420 хв = 7 год)
        event('1/1', '2026-11-06T00:30:00Z', '2026-11-06T07:30:00Z'),
        event('1/1', '2026-11-06T11:00:00Z', '2026-11-06T18:00:00Z'),
      ],
      { now: new Date('2026-11-05T12:00:00Z'), date: '2026-11-05' },
    );

    expect(cards).toHaveLength(1);
    // Для сьогодні: суворо 7 годин (420 хв), ніяких 21–22 годин
    expect(cards[0]?.offMinutes).toBe(420);
    expect(cards[0]?.todayOffMinutes).toBe(420);
    // Для завтра: окремий лічильник 14 годин (840 хв)
    expect(cards[0]?.tomorrowOffMinutes).toBe(840);
  });
});
