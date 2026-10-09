import { describe, expect, test } from 'vitest';
import { buildReliabilityReport, kyivMonthStart, mondayKeyOf } from '../../src/services/reliability.js';

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
});
