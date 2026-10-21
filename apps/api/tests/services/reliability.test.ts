import { describe, expect, test } from 'vitest';
import {
  buildGroupSummary,
  buildQueueSummary,
  buildRegionSummaries,
  buildReliabilityReport,
  kyivMonthStart,
  mondayKeyOf,
  type RegionReliabilityInput,
} from '../../src/services/reliability.js';

const outage = (startIso: string, endIso: string) => ({ startsAt: new Date(startIso), endsAt: new Date(endIso) });

describe('статистика надійності по днях/тижнях/місяцях', () => {
  const now = new Date('2026-10-09T10:00:00.000Z');
  const rows = [
    outage('2026-10-07T14:30:00.000Z', '2026-10-07T18:00:00.000Z'), // 210 хв, 7 жовтня
    outage('2026-10-16T05:00:00.000Z', '2026-10-16T14:00:00.000Z'), // майбутнє — не враховуємо
  ];

  test('місяць починається з 1-го числа київського часу', () => {
    // 00:00 1 жовтня за Києвом (літній час, UTC+3) = 30 вересня 21:00Z
    expect(kyivMonthStart(now).toISOString()).toBe('2026-09-30T21:00:00.000Z');
  });

  test('будує добові бакети від початку місяця до сьогодні', () => {
    const report = buildReliabilityReport(now, rows);
    expect(report.days).toHaveLength(9); // 1..9 жовтня
    const day7 = report.days.find((day) => day.key === 'day:2026-10-07')!;
    expect(day7.outageMinutes).toBe(210);
    expect(day7.windowMinutes).toBe(1440);
    expect(day7.poweredMinutes).toBe(1230);
    expect(day7.reliabilityPct).toBe(85.4);
    expect(day7.hasData).toBe(true);
    // Минулі дні без відключень не мають даних (не 100%).
    const day1 = report.days.find((day) => day.key === 'day:2026-10-01')!;
    expect(day1.hasData).toBe(false);
  });

  test('майбутні відключення не потрапляють у статистику', () => {
    const report = buildReliabilityReport(now, rows);
    expect(report.days.some((day) => day.key === 'day:2026-10-16')).toBe(false);
    expect(report.days.reduce((sum, day) => sum + day.outageMinutes, 0)).toBe(210);
  });

  test('згортає дні у тиждень і місяць', () => {
    const report = buildReliabilityReport(now, rows);
    expect(report.weeks).toHaveLength(2); // 28 вер. – 4 жовт. та 5–11 жовт.
    const week = report.weeks.find((item) => item.key === 'week:2026-10-05')!;
    expect(week.outageMinutes).toBe(210);
    expect(report.months).toHaveLength(1);
    expect(report.months[0]!.outageMinutes).toBe(210);
  });

  test('понеділок тижня обчислюється від київської дати', () => {
    expect(mondayKeyOf('2026-10-09')).toBe('2026-10-05'); // п’ятниця -> понеділок
    expect(mondayKeyOf('2026-10-05')).toBe('2026-10-05');
  });

  test('прогноз на завтра потрапляє в добові бакети з позначкою isForecast', () => {
    const report = buildReliabilityReport(now, rows, undefined, {
      date: '2026-10-10',
      rows: [outage('2026-10-10T05:00:00.000Z', '2026-10-10T08:00:00.000Z')],
      byQueue: new Map([['1/1', [outage('2026-10-10T05:00:00.000Z', '2026-10-10T08:00:00.000Z')]]]),
    });
    const forecastDay = report.days.find((day) => day.key === 'day:2026-10-10')!;
    expect(forecastDay.isForecast).toBe(true);
    expect(forecastDay.hasData).toBe(true);
    expect(forecastDay.outageMinutes).toBe(180);
    // Минулі дні позначки не отримують: інакше «прогноз» стояв би і там, де вже все сталося.
    expect(report.days[0]!.isForecast).toBeUndefined();
    // Без прогнозу добових бакетів на одну менше — це та сама межа «у майбутнє не заглядаємо».
    expect(buildReliabilityReport(now, rows).days).toHaveLength(report.days.length - 1);
  });
});

describe('зведення по групах і областях', () => {
  const now = new Date('2026-10-09T10:00:00.000Z');
  const oneDay = outage('2026-10-07T14:30:00.000Z', '2026-10-07T18:00:00.000Z'); // 210 хв
  const twoDays = [oneDay, outage('2026-10-08T05:00:00.000Z', '2026-10-08T06:00:00.000Z')];

  test('знаменник групи — дні, за які є графік, а не весь місяць', () => {
    // Один день даних не має давати «99% за місяць»: це була б цифра про 30 днів, яких ми не знаємо.
    const [group] = buildGroupSummary(now, new Map([['1/1', [oneDay]]]));
    expect(group!.windowMinutes).toBe(1440);
    expect(group!.outageMinutes).toBe(210);
    expect(group!.reliabilityPct).toBe(85.4);

    const [twoDayGroup] = buildGroupSummary(now, new Map([['2/2', twoDays]]));
    expect(twoDayGroup!.windowMinutes).toBe(2880);
    expect(twoDayGroup!.outageMinutes).toBe(270);
  });

  test('групи сортуються від найгіршої надійності', () => {
    const groups = buildGroupSummary(now, new Map([
      ['2/2', twoDays], // 270 з 2880 -> 90,6%
      ['1/1', [oneDay]], // 210 з 1440 -> 85,4%
    ]));
    expect(groups.map((group) => group.queue)).toEqual(['1/1', '2/2']);
  });

  test('надійність однієї групи рахується по днях із графіком', () => {
    const summary = buildQueueSummary('1/1', [oneDay], new Set(['2026-10-07']), now);
    expect(summary.windowMinutes).toBe(1440);
    expect(summary.outageMinutes).toBe(210);
    expect(summary.reliabilityPct).toBe(85.4);
    expect(summary.hasData).toBe(true);

    // Графік на добу опубліковано, відключень у ньому немає: це «немає відключень», а не 0%.
    const clear = buildQueueSummary('1/1', [], new Set(['2026-10-07']), now);
    expect(clear.hasData).toBe(false);
    expect(clear.outageMinutes).toBe(0);
    expect(clear.windowMinutes).toBe(1440);
  });

  test('області порівнюються тим самим правилом і без вигаданих назв', () => {
    const regionInput = (dates: string[], byQueue: Map<string, ReturnType<typeof outage>[]>): RegionReliabilityInput => ({
      dates: new Set(dates),
      byQueue,
    });
    const byRegion = new Map<string, RegionReliabilityInput>([
      ['chernihivska-oblast', regionInput(['2026-10-07'], new Map([['1/1', [oneDay]]]))],
      ['odeska-oblast', regionInput(['2026-10-07', '2026-10-08'], new Map())],
    ]);
    const summaries = buildRegionSummaries(
      now,
      byRegion,
      new Map([['chernihivska-oblast', 'Чернігівська область']]),
    );

    // Найгірша — перша, а область без відключень не отримує вигаданого «100% у рядку».
    expect(summaries.map((item) => item.region)).toEqual(['chernihivska-oblast', 'odeska-oblast']);
    const chernihiv = summaries[0]!;
    expect(chernihiv.nameUa).toBe('Чернігівська область');
    expect(chernihiv.windowMinutes).toBe(1440);
    expect(chernihiv.outageMinutes).toBe(210);
    expect(chernihiv.daysKnown).toBe(1);

    const odesa = summaries[1]!;
    expect(odesa.hasData).toBe(false);
    expect(odesa.outageMinutes).toBe(0);
    // Назви немає в довіднику — підписуємо кодом, а не вигаданою назвою.
    expect(odesa.nameUa).toBe('odeska-oblast');
    expect(odesa.daysKnown).toBe(2);
    expect(odesa.windowMinutes).toBe(2880);
  });
});
