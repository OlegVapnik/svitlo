import { describe, expect, it } from 'vitest';
import type {
  ReliabilityBucket,
  ReliabilityGroup,
  ReliabilityReport,
} from '@svitlo/shared';

import {
  buildReliabilityReport,
  isStaleRegionDate,
  poweredPctOf,
  regionNameMapOf,
  regionPillsFor,
  reliabilityGroupRows,
  reliabilityRegionRows,
  selectPastDays,
  selectPeriodBuckets,
  selectableRegionOptions,
  statusRegionSummaryOf,
  summarizeReliability,
  DEFAULT_VISIBLE_DAYS,
  KEY_REGION_CPUS,
} from '../src/lib/reliability.ts';
import type { RegionOption, RegionSummary } from '../src/lib/region.ts';

const bucket = (overrides: Partial<ReliabilityBucket> = {}): ReliabilityBucket => ({
  key: 'day:2026-10-27',
  label: '27 жовт.',
  start: '2026-10-27T00:00:00.000Z',
  end: '2026-10-27T23:59:59.999Z',
  windowMinutes: 1440,
  outageMinutes: 120,
  poweredMinutes: 1320,
  reliabilityPct: 91.7,
  outageCount: 2,
  hasData: true,
  ...overrides,
});

const region = (overrides: Partial<RegionSummary> = {}): RegionSummary => ({
  cpu: 'chernihivska-oblast',
  nameUa: 'Чернігівська область',
  nameEn: null,
  queues: ['1/1', '2/2'],
  slots: 48,
  lastDate: '2026-10-28',
  covered: true,
  ...overrides,
});

const option = (regionData: RegionSummary, isGroup = false, depth: 0 | 1 = 0): RegionOption => ({
  region: regionData,
  depth,
  isGroup,
});

describe('poweredPctOf', () => {
  it('считает долю и зажимает 0..100', () => {
    expect(poweredPctOf({ poweredMinutes: 720, windowMinutes: 1440 })).toBe(50);
    expect(poweredPctOf({ poweredMinutes: 0, windowMinutes: 0 })).toBe(100);
    expect(poweredPctOf({ poweredMinutes: 2000, windowMinutes: 1440 })).toBe(100);
    expect(poweredPctOf({ poweredMinutes: -5, windowMinutes: 1440 })).toBe(0);
  });
});

describe('selectPastDays', () => {
  const today = '2026-10-28';
  const days = [
    bucket({ key: 'day:2026-10-26', start: '2026-10-26T00:00:00.000Z' }),
    bucket({ key: 'day:2026-10-28', start: '2026-10-28T00:00:00.000Z' }),
    bucket({ key: 'day:2026-10-29', start: '2026-10-29T00:00:00.000Z', isForecast: true }),
    bucket({ key: 'day:2026-10-25', hasData: false }),
    bucket({ key: 'day:2026-10-24', windowMinutes: 0 }),
    bucket({ key: 'day:2026-10-27', start: '2026-10-27T00:00:00.000Z' }),
  ];

  it('оставляет только прошедшие дни с данными, новые сверху', () => {
    expect(selectPastDays(days, today).map((day) => day.key)).toEqual([
      'day:2026-10-28',
      'day:2026-10-27',
      'day:2026-10-26',
    ]);
  });

  it('пустой отчёт — пустой список', () => {
    expect(selectPastDays(undefined, today)).toEqual([]);
  });
});

describe('summarizeReliability', () => {
  it('считает сегодня, неделю и период', () => {
    const days = [
      bucket({ key: 'day:2026-10-28', outageMinutes: 60, windowMinutes: 600 }),
      bucket({ key: 'day:2026-10-27', outageMinutes: 120, windowMinutes: 1440 }),
      bucket({ key: 'day:2026-10-26', outageMinutes: 60, windowMinutes: 600 }),
    ];
    const totals = summarizeReliability(days, '2026-10-28');
    expect(totals.todayBucket?.outageMinutes).toBe(60);
    expect(totals.weekOutage).toBe(240);
    expect(totals.windowMinutes).toBe(2640);
    expect(totals.overallPct).toBeCloseTo((1 - 240 / 2640) * 100, 5);
    expect(summarizeReliability([], '2026-10-28').overallPct).toBeNull();
  });

  it('неделя — первые семь дней после сортировки', () => {
    const days = Array.from({ length: 9 }, (_, index) =>
      bucket({
        key: `day:2026-10-${String(28 - index).padStart(2, '0')}`,
        start: `2026-10-${String(28 - index).padStart(2, '0')}T00:00:00.000Z`,
        outageMinutes: 10,
      }),
    );
    expect(summarizeReliability(days, '2026-10-28').weekOutage).toBe(70);
  });
});

describe('selectPeriodBuckets', () => {
  it('только данные без прогноза, новые сверху', () => {
    const buckets = [
      bucket({ key: 'week:1', start: '2026-10-05T00:00:00.000Z' }),
      bucket({ key: 'week:2', start: '2026-10-12T00:00:00.000Z' }),
      bucket({ key: 'week:3', hasData: false }),
      bucket({ key: 'week:4', isForecast: true }),
    ];
    expect(selectPeriodBuckets(buckets).map((item) => item.key)).toEqual(['week:2', 'week:1']);
    expect(selectPeriodBuckets(null)).toEqual([]);
  });
});

describe('reliabilityGroupRows', () => {
  const group: ReliabilityGroup = {
    queue: '5/1',
    windowMinutes: 1440,
    outageMinutes: 120,
    poweredMinutes: 1320,
    reliabilityPct: 91.7,
    hasData: true,
  };
  const report = { groups: [group], queue: group } as ReliabilityReport;

  it('в режиме области — все группы, в режиме очереди — одна', () => {
    expect(reliabilityGroupRows(report, 'region')).toEqual([group]);
    expect(reliabilityGroupRows(report, 'queue')).toEqual([group]);
    expect(reliabilityGroupRows({ ...report, queue: undefined } as unknown as ReliabilityReport, 'queue')).toEqual([]);
    expect(reliabilityGroupRows(undefined, 'queue')).toEqual([]);
  });
});

describe('карточки и списки областей', () => {
  const options = [
    option(region({ cpu: 'kyiv-city', nameUa: 'Київ (місто)' })),
    option(region({ cpu: 'dnipro', nameUa: 'Дніпропетровська', covered: false, todaySlots: 0, slots: 0, lastDate: null })),
    option(region({ cpu: 'lvivska-oblast', nameUa: 'Львівська' })),
  ];

  it('regionNameMapOf нормализует cpu', () => {
    const map = regionNameMapOf(options);
    expect(map.get('kyiv-city')).toBe('Київ (місто)');
    expect(map.get('dnipro')).toBe('Дніпропетровська');
  });

  it('regionPillsFor: выбранная первой, дубли схлопнуты, подпись из каталога', () => {
    const names = regionNameMapOf(options);
    const pills = regionPillsFor('kyiv-city', names, {
      cpu: 'kyiv-city',
      label: 'Моє місто',
    });
    expect(pills[0]).toEqual({ cpu: 'kyiv-city', label: 'Київ (місто)' });
    expect(pills.filter((pill) => pill.cpu === 'kyiv-city')).toHaveLength(1);
    // Из ключевых областей в каталоге есть только Львівська — остальные без подписи не выдумываем.
    expect(pills.map((pill) => pill.cpu)).toEqual(['kyiv-city', 'lvivska-oblast']);
  });

  it('regionPillsFor: без каталожной подписи использует fallback', () => {
    const pills = regionPillsFor('unknown-cpu', new Map(), {
      cpu: 'unknown-cpu',
      label: 'Поточна область',
    });
    expect(pills[0]).toEqual({ cpu: 'unknown-cpu', label: 'Поточна область' });
  });

  it('selectableRegionOptions пропускает группы и дубли', () => {
    expect(selectableRegionOptions(options).map((item) => item.cpu)).toEqual([
      'kyiv-city',
      'dnipro',
      'lvivska-oblast',
    ]);
  });

  it('reliabilityRegionRows: своя первой, худшие из имеющих данные — выше', () => {
    const report = {
      byRegionSummary: [
        { region: 'lvivska-oblast', nameUa: 'Львівська', hasData: true, reliabilityPct: 95 },
        { region: 'kyiv-city', nameUa: 'Київ (місто)', hasData: true, reliabilityPct: 80 },
      ],
    } as unknown as ReliabilityReport;
    const rows = reliabilityRegionRows(options, report, 'lvivska-oblast');
    expect(rows.map((row) => row.cpu)).toEqual(['lvivska-oblast', 'kyiv-city', 'dnipro']);
    expect(rows[0]?.summary?.reliabilityPct).toBe(95);
  });

  it('isStaleRegionDate: только прошлое', () => {
    expect(isStaleRegionDate('2026-10-01', '2026-10-28')).toBe(true);
    expect(isStaleRegionDate('2026-10-28', '2026-10-28')).toBe(false);
    expect(isStaleRegionDate(null, '2026-10-28')).toBe(false);
  });

  it('DEFAULT_VISIBLE_DAYS — компактный список', () => {
    expect(DEFAULT_VISIBLE_DAYS).toBe(8);
  });
});

describe('statusRegionSummaryOf', () => {
  it('null без данных, иначе строка отчёта', () => {
    expect(statusRegionSummaryOf(null, 'kyiv-city', 'Київ')).toBeNull();
    expect(
      statusRegionSummaryOf(
        { hasData: false, windowLabel: '—', windowMinutes: 0, outageMinutes: 0, poweredMinutes: 0, reliabilityPct: 100, outageCount: 0 },
        'kyiv-city',
        'Київ',
      ),
    ).toBeNull();
    expect(
      statusRegionSummaryOf(
        { hasData: true, windowLabel: '10 год', windowMinutes: 600, outageMinutes: 60, poweredMinutes: 540, reliabilityPct: 90, outageCount: 1 },
        'kyiv-city',
        'Київ',
      ),
    ).toMatchObject({ region: 'kyiv-city', nameUa: 'Київ', reliabilityPct: 90, daysKnown: 1 });
  });
});

describe('buildReliabilityReport', () => {
  const today = '2026-10-28';
  const interval = {
    startsAt: '2026-10-28T10:00:00.000Z',
    endsAt: '2026-10-28T12:00:00.000Z',
    stateCode: 3 as const,
    stateName: 'Відключення',
    stateColor: '#f00',
    localTimeFrom: '12:00',
    localTimeTo: '14:00',
  };
  const upcoming = [
    {
      queue: '5/1',
      date: today,
      source: 'mirror',
      intervals: [interval],
      settlements: [],
      streetNames: [],
      isActiveNow: false,
      nextStartsAt: null,
    },
    {
      queue: '2/2',
      date: today,
      source: 'mirror',
      intervals: [interval],
      settlements: [],
      streetNames: [],
      isActiveNow: false,
      nextStartsAt: null,
    },
  ];

  it('готовый live-отчёт с днями побеждает расчёт', () => {
    const live = { days: [bucket()], byRegionSummary: [] } as unknown as ReliabilityReport;
    expect(buildReliabilityReport({ live, activeRegion: 'kyiv-city', scope: 'region', todayKey: today, upcoming: [] })).toBe(live);
  });

  it('live без активного региона дополняется сводкой /status', () => {
    const live = { days: [bucket()], byRegionSummary: [] } as unknown as ReliabilityReport;
    const result = buildReliabilityReport({
      live,
      activeRegion: 'kyiv-city',
      regionName: 'Київ',
      scope: 'region',
      todayKey: today,
      upcoming: [],
      statusSummary: { hasData: true, windowLabel: '10 год', windowMinutes: 600, outageMinutes: 60, poweredMinutes: 540, reliabilityPct: 90, outageCount: 1 },
    });
    expect(result.byRegionSummary).toHaveLength(1);
    expect(result.byRegionSummary?.[0]?.region).toBe('kyiv-city');
  });

  it('считает дни и группы по интервалам upcoming', () => {
    const result = buildReliabilityReport({ activeRegion: 'chernihivska-oblast', scope: 'region', todayKey: today, upcoming });
    expect(result.days).toHaveLength(1);
    expect(result.days?.[0]?.outageMinutes).toBe(240);
    expect(result.days?.[0]?.windowMinutes).toBe(1440);
    expect(result.groups.map((group) => group.queue).sort()).toEqual(['2/2', '5/1']);
    expect(result.groups[0]?.outageMinutes).toBe(120);
  });

  it('режим очереди фильтрует группы и берёт расписание на сегодня', () => {
    const result = buildReliabilityReport({
      activeRegion: 'chernihivska-oblast',
      scope: 'queue',
      selectedQueue: '5/1',
      todayKey: today,
      upcoming,
      todaySchedule: { intervals: [interval] },
    });
    expect(result.days?.[0]?.outageMinutes).toBe(120);
    expect(result.groups.map((group) => group.queue)).toEqual(['5/1']);
  });

  it('без расписания берёт сводку /status только в режиме области', () => {
    const statusSummary = { hasData: true, windowLabel: '10 год', windowMinutes: 600, outageMinutes: 60, poweredMinutes: 540, reliabilityPct: 90, outageCount: 1 };
    const region = buildReliabilityReport({ activeRegion: 'kyiv-city', scope: 'region', todayKey: today, upcoming: [], statusSummary });
    expect(region.days?.[0]).toMatchObject({ outageMinutes: 60, windowMinutes: 600 });
    const queue = buildReliabilityReport({ activeRegion: 'kyiv-city', scope: 'queue', selectedQueue: '1/1', todayKey: today, upcoming: [], statusSummary });
    expect(queue.days?.[0]).toMatchObject({ outageMinutes: 0, windowMinutes: 1440 });
  });
});
