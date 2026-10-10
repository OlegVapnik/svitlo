import type { ReliabilityBucket, ReliabilityReport } from '@svitlo/shared';
import { computeWindowSummary, kyivDayStart, type OutageRow } from './power-summary.js';

const KYIV_TZ = 'Europe/Kyiv';

function kyivDateKey(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: KYIV_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

/** Початок поточної місцевої (Europe/Kyiv) доби місяця о 00:00. */
export function kyivMonthStart(at: Date): Date {
  const key = kyivDateKey(at);
  return kyivDayStart(new Date(`${key.slice(0, 7)}-01T12:00:00Z`));
}

/** Понеділок тижня, до якого належить київська дата YYYY-MM-DD. */
export function mondayKeyOf(dateKey: string): string {
  const day = new Date(`${dateKey}T00:00:00Z`);
  const offset = (day.getUTCDay() + 6) % 7; // 0 = понеділок
  day.setUTCDate(day.getUTCDate() - offset);
  return day.toISOString().slice(0, 10);
}

/** Усі київські «початки доби» від from (включно) до to (включно). */
function kyivDayStarts(from: Date, to: Date): Date[] {
  const starts: Date[] = [];
  let cursor = from;
  let guard = 0;
  while (cursor.getTime() <= to.getTime() && guard < 1200) {
    starts.push(cursor);
    cursor = kyivDayStart(new Date(cursor.getTime() + 24 * 3_600_000));
    guard += 1;
  }
  return starts;
}

const dayFormatter = new Intl.DateTimeFormat('uk-UA', { timeZone: KYIV_TZ, day: 'numeric', month: 'short' });
const monthFormatter = new Intl.DateTimeFormat('uk-UA', { timeZone: KYIV_TZ, month: 'long', year: 'numeric' });
const dayKeyFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: KYIV_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

function labelDay(at: Date): string {
  return dayFormatter.format(at);
}

function bucket(key: string, label: string, start: Date, end: Date, rows: OutageRow[]): ReliabilityBucket {
  const overlapping = rows.filter((row) => row.startsAt.getTime() <= end.getTime() && row.endsAt.getTime() >= start.getTime());
  const summary = computeWindowSummary(label, start, end, overlapping);
  return {
    key,
    label,
    start: start.toISOString(),
    end: end.toISOString(),
    windowMinutes: summary.windowMinutes,
    outageMinutes: summary.outageMinutes,
    poweredMinutes: summary.poweredMinutes,
    reliabilityPct: summary.reliabilityPct,
    outageCount: summary.outageCount,
    hasData: summary.hasData,
  };
}

/**
 * Надійність електропостачання по днях / тижнях / місяцях з початку поточного
 * місяця (київського). Рахуємо лише фактичні, вже минулі інтервали — у майбутнє
 * не заглядаємо (для цього є графіки відключень).
 */
export function buildReliabilityReport(now: Date, rows: OutageRow[]): ReliabilityReport {
  const monthStart = kyivMonthStart(now);
  const dayStarts = kyivDayStarts(monthStart, now);

  const days: ReliabilityBucket[] = dayStarts.map((start, index) => {
    const nextStart = index + 1 < dayStarts.length
      ? dayStarts[index + 1]!
      : kyivDayStart(new Date(start.getTime() + 24 * 3_600_000));
    const end = new Date(Math.min(nextStart.getTime(), now.getTime()));
    return bucket(`day:${dayKeyFormatter.format(start)}`, labelDay(start), start, end, rows);
  });

  const weekRanges = new Map<string, { start: Date; end: Date }>();
  for (const day of days) {
    const dateKey = day.key.slice(4);
    const weekKey = mondayKeyOf(dateKey);
    const dayStart = new Date(day.start);
    const dayEnd = new Date(day.end);
    const range = weekRanges.get(weekKey);
    if (!range) {
      weekRanges.set(weekKey, { start: dayStart, end: dayEnd });
    } else {
      range.start = new Date(Math.min(range.start.getTime(), dayStart.getTime()));
      range.end = new Date(Math.max(range.end.getTime(), dayEnd.getTime()));
    }
  }
  const weeks: ReliabilityBucket[] = Array.from(weekRanges.entries()).map(([weekKey, range]) =>
    bucket(`week:${weekKey}`, `${labelDay(range.start)} – ${labelDay(range.end)}`, range.start, range.end, rows),
  );

  const monthRanges = new Map<string, { start: Date; end: Date }>();
  for (const day of days) {
    const monthKey = day.key.slice(4, 11);
    const dayStart = new Date(day.start);
    const dayEnd = new Date(day.end);
    const range = monthRanges.get(monthKey);
    if (!range) {
      monthRanges.set(monthKey, { start: dayStart, end: dayEnd });
    } else {
      range.start = new Date(Math.min(range.start.getTime(), dayStart.getTime()));
      range.end = new Date(Math.max(range.end.getTime(), dayEnd.getTime()));
    }
  }
  const months: ReliabilityBucket[] = Array.from(monthRanges.entries()).map(([monthKey, range]) =>
    bucket(`month:${monthKey}`, monthFormatter.format(range.start), range.start, range.end, rows),
  );

  return {
    from: monthStart.toISOString(),
    to: now.toISOString(),
    generatedAt: now.toISOString(),
    days,
    weeks,
    months,
  };
}
