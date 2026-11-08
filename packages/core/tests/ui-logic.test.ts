import { describe, expect, it } from 'vitest';

import { waveToneOf, isSoonMinutes, heroNotice, SOON_MINUTES, isSchedulePublished } from '../src/lib/day-status.ts';
import { splitClockMinutes, formatDayMonth } from '../src/lib/date.ts';
import { isNightHour, minuteFromTrackX } from '../src/lib/timeline.ts';
import { regionFreshnessSection, type RegionSummary } from '../src/lib/region.ts';
import {
  availableQueueCodes,
  collapsedQueueOptions,
  compareQueueCodes,
  queueCellState,
} from '../src/lib/queue.ts';
import { uniqueIntervalStates } from '../src/lib/scheduleWindow.ts';
import { scheduleWithFallback } from '../src/lib/schedule-payload.ts';
import { activeAccidents, splitFuturePast } from '../src/lib/outages.ts';

const region = (overrides: Partial<RegionSummary> = {}): RegionSummary => ({
  cpu: 'kyiv-city',
  nameUa: 'Київ',
  nameEn: null,
  queues: [],
  slots: 0,
  lastDate: null,
  ...overrides,
});

describe('waveToneOf', () => {
  it('зводить стани обох платформ до одного тону', () => {
    expect(waveToneOf('on')).toBe('on');
    expect(waveToneOf('allClear')).toBe('on');
    expect(waveToneOf('soon')).toBe('warning');
    expect(waveToneOf('warning')).toBe('warning');
    expect(waveToneOf('off')).toBe('off');
    expect(waveToneOf('unknown')).toBe('unknown');
    expect(waveToneOf('')).toBe('unknown');
  });
});

describe('isSoonMinutes', () => {
  it('межа включна, від’ємні та null — не «скоро»', () => {
    expect(isSoonMinutes(0)).toBe(true);
    expect(isSoonMinutes(SOON_MINUTES)).toBe(true);
    expect(isSoonMinutes(SOON_MINUTES + 1)).toBe(false);
    expect(isSoonMinutes(null)).toBe(false);
    expect(isSoonMinutes(-1)).toBe(false);
    expect(isSoonMinutes(Number.NaN)).toBe(false);
  });

  it('власний поріг перекриває доменну константу', () => {
    expect(isSoonMinutes(40, 30)).toBe(false);
    expect(isSoonMinutes(30, 30)).toBe(true);
  });
});

describe('splitClockMinutes', () => {
  it('округляє хвилини й добиває нулі', () => {
    expect(splitClockMinutes(0)).toEqual({ hours: '00', minutes: '00' });
    expect(splitClockMinutes(59.6)).toEqual({ hours: '01', minutes: '00' });
    expect(splitClockMinutes(134)).toEqual({ hours: '02', minutes: '14' });
  });

  it('null і від’ємні — відлічувати нічого', () => {
    expect(splitClockMinutes(null)).toBeNull();
    expect(splitClockMinutes(-5)).toBeNull();
    expect(splitClockMinutes(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('formatDayMonth', () => {
  it('YYYY-MM-DD → ДД.ММ без парсингу в Date', () => {
    expect(formatDayMonth('2026-10-17')).toBe('17.10');
    expect(formatDayMonth('2026-01-02T10:00:00Z')).toBe('02.01');
  });

  it('порожнє та сміття → порожній рядок', () => {
    expect(formatDayMonth(null)).toBe('');
    expect(formatDayMonth('17.10')).toBe('');
  });
});

describe('isNightHour', () => {
  it('ніч — 23:00–04:59', () => {
    expect(isNightHour(23)).toBe(true);
    expect(isNightHour(0)).toBe(true);
    expect(isNightHour(4)).toBe(true);
    expect(isNightHour(5)).toBe(false);
    expect(isNightHour(22)).toBe(false);
  });
});

describe('minuteFromTrackX', () => {
  it('вирівнює до півгодини й обрізає краї', () => {
    expect(minuteFromTrackX(0, 480)).toEqual({ minute: 0, slotIndex: 0 });
    expect(minuteFromTrackX(479, 480)).toEqual({ minute: 1440, slotIndex: 47 });
    expect(minuteFromTrackX(-50, 480)).toEqual({ minute: 0, slotIndex: 0 });
    expect(minuteFromTrackX(240, 480)).toEqual({ minute: 720, slotIndex: 24 });
  });

  it('без виміряної ширини — null', () => {
    expect(minuteFromTrackX(10, 0)).toBeNull();
    expect(minuteFromTrackX(Number.NaN, 100)).toBeNull();
  });
});

describe('regionFreshnessSection', () => {
  it('covered → live, історія без сьогодні → stale, порожньо → none', () => {
    expect(regionFreshnessSection(region({ covered: true }))).toBe('live');
    expect(regionFreshnessSection(region({ lastDate: '2026-10-01' }))).toBe('stale');
    expect(regionFreshnessSection(region({ allClear: true }))).toBe('stale');
    expect(regionFreshnessSection(region())).toBe('none');
  });
});

describe('compareQueueCodes', () => {
  it('порівнює числа, а не рядки', () => {
    const sorted = ['10/1', '2/1', '1/2', '1/10', '1/1'].sort(compareQueueCodes);
    expect(sorted).toEqual(['1/1', '1/2', '1/10', '2/1', '10/1']);
  });

  it('однакові коди — 0', () => {
    expect(compareQueueCodes('2/2', ' 2/2 ')).toBe(0);
  });
});

describe('availableQueueCodes', () => {
  it('бере перший непорожній валідний список', () => {
    expect(availableQueueCodes([], ['1/1', '2/2'])).toEqual(['1/1', '2/2']);
    expect(availableQueueCodes(['3/1'], ['1/1'])).toEqual(['3/1']);
    expect(availableQueueCodes([], undefined, null)).toEqual([]);
  });

  it('викидає сміття та дублі', () => {
    expect(availableQueueCodes(['1/1', '1/1', 'черга', '', '2/2'])).toEqual(['1/1', '2/2']);
  });
});

describe('collapsedQueueOptions', () => {
  const options = Array.from({ length: 14 }, (_, index) => `${index + 1}/1`);

  it('вибрана група поза межами лишається видимою', () => {
    const visible = collapsedQueueOptions(options, 13, 12);
    expect(visible).toHaveLength(12);
    expect(visible).toContain('14/1');
    expect(visible).not.toContain('12/1');
  });

  it('вибрана всередині — звичайний зріз', () => {
    expect(collapsedQueueOptions(options, 2, 12)).toEqual(options.slice(0, 12));
    expect(collapsedQueueOptions(options, -1, 12)).toEqual(options.slice(0, 12));
  });
});

describe('queueCellState', () => {
  it('пріоритет: off → soon → on → unknown', () => {
    expect(queueCellState({ isOff: true, isSoon: true, covered: true })).toBe('off');
    expect(queueCellState({ isOff: false, isSoon: true, covered: true })).toBe('soon');
    expect(queueCellState({ isOff: false, isSoon: false, covered: true })).toBe('on');
    expect(queueCellState({ isOff: false, isSoon: false, covered: false })).toBe('unknown');
  });
});

describe('uniqueIntervalStates', () => {
  it('легенда без повторів, порядок першої появи', () => {
    expect(
      uniqueIntervalStates([
        { stateName: 'Світло є', stateCode: 1 },
        { stateName: 'Відключення', stateCode: 3 },
        { stateName: 'Світло є', stateCode: 1 },
      ]),
    ).toEqual([
      { name: 'Світло є', code: 1 },
      { name: 'Відключення', code: 3 },
    ]);
  });
});

describe('scheduleWithFallback', () => {
  const interval = {
    startsAt: '2026-10-28T03:00:00Z',
    endsAt: '2026-10-28T06:00:00Z',
    stateCode: 3 as const,
    stateName: 'Відключення',
    stateColor: '#f00',
  };
  const upcoming = [
    { date: '2026-10-28', queue: '2/2', intervals: [interval], source: 'mirror' },
  ];

  it('непустий прямий графік перемагає', () => {
    const direct = {
      queue: '2/2',
      date: '2026-10-28',
      intervals: [interval],
      source: 'manual',
      lastImportedAt: null,
    };
    expect(scheduleWithFallback(direct, upcoming, { queue: '2/2', date: '2026-10-28' })).toBe(direct);
  });

  it('порожній прямий графік замінюється графіком з upcoming', () => {
    const result = scheduleWithFallback(undefined, upcoming, {
      regionCpu: 'chernihivska-oblast',
      queue: '2/2',
      date: '2026-10-28',
      now: new Date('2026-10-28T07:00:00Z'),
    });
    expect(result?.intervals).toEqual([interval]);
    expect(result?.source).toBe('mirror');
    expect(result?.lastImportedAt).toBe('2026-10-28T07:00:00.000Z');
    expect(result?.allClear).toBe(false);
  });

  it('інша черга/дата або без вибору — лишається прямий (навіть undefined)', () => {
    expect(
      scheduleWithFallback(undefined, upcoming, { queue: '1/1', date: '2026-10-28' }),
    ).toBeUndefined();
    expect(
      scheduleWithFallback(undefined, upcoming, { queue: '2/2', date: '2026-10-29' }),
    ).toBeUndefined();
    expect(scheduleWithFallback(undefined, upcoming, { queue: null, date: '2026-10-28' })).toBeUndefined();
  });
});

describe('outages', () => {
  it('activeAccidents: лише активний ремонт', () => {
    const items = [
      { id: '1', kind: 'repair', status: 'active' },
      { id: '2', kind: 'repair', status: 'scheduled' },
      { id: '3', kind: 'group', status: 'active' },
    ];
    expect(activeAccidents(items).map((item) => item.id)).toEqual(['1']);
  });

  it('splitFuturePast ділить за endsAt', () => {
    const now = Date.parse('2026-10-28T10:00:00Z');
    const { future, past } = splitFuturePast(
      [
        { id: 'past', endsAt: '2026-10-28T09:59:00Z' },
        { id: 'future', endsAt: '2026-10-28T10:01:00Z' },
        { id: 'broken', endsAt: 'не дата' },
      ],
      now,
    );
    expect(future.map((item) => item.id)).toEqual(['future']);
    expect(past.map((item) => item.id)).toEqual(['past', 'broken']);
  });
});

describe('isSchedulePublished / heroNotice (прод-кейс 5/1)', () => {
  const pastIntervals = [
    {
      startsAt: '2026-10-28T09:00:00Z',
      endsAt: '2026-10-28T11:00:00Z',
      stateCode: 3 as const,
      stateName: 'Відключення',
      stateColor: '#f00',
    },
  ];
  const pastSummary = {
    isOff: false,
    nextStartsAt: null,
  };

  it('слоты в прошлом — график опубликован, подпись не «не опубликовано»', () => {
    expect(isSchedulePublished({ intervals: pastIntervals, covered: false })).toBe(true);
    expect(
      heroNotice({ state: 'on', hasIntervals: true, summary: pastSummary }),
    ).toBe('finishedToday');
  });

  it('нет слотов и нет covered — «не опубликовано»', () => {
    expect(isSchedulePublished({ intervals: [], covered: false })).toBe(false);
    expect(heroNotice({ state: 'unknown', hasIntervals: false, summary: null })).toBe('unpublished');
  });

  it('идёт отключение и есть будущее — разные виды', () => {
    expect(heroNotice({ state: 'off', hasIntervals: true, summary: { isOff: true } })).toBe('off');
    expect(
      heroNotice({
        state: 'on',
        hasIntervals: true,
        summary: { isOff: false, nextStartsAt: '2026-10-28T18:00:00Z' },
      }),
    ).toBe('upcoming');
  });

  it('allClear и loading/error имеют приоритет', () => {
    expect(heroNotice({ state: 'allClear', hasIntervals: false })).toBe('allClear');
    expect(heroNotice({ loading: true, state: 'on', hasIntervals: true })).toBe('loading');
    expect(heroNotice({ error: true, state: 'on', hasIntervals: true })).toBe('error');
  });
});
