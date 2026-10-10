import type { PowerWindowSummary } from '@svitlo/shared';

export interface Interval {
  /** Початок у мілісекундах (UTC). */
  start: number;
  /** Кінець у мілісекундах (UTC). */
  end: number;
}

/** Рядок відключення, потрібний для підрахунку (мінімум полів). */
export interface OutageRow {
  startsAt: Date;
  endsAt: Date;
}

/**
 * Об'єднує перетинні інтервали, щоб одна й та сама хвилина без світла
 * не враховувалась двічі (напр., кілька адрес у зоні одного відключення).
 */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = intervals
    .filter((interval) => interval.end > interval.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Interval[] = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last && interval.start <= last.end) {
      last.end = Math.max(last.end, interval.end);
    } else {
      merged.push({ start: interval.start, end: interval.end });
    }
  }
  return merged;
}

/** Сумарна тривалість об'єднаних інтервалів у хвилинах (з урахуванням перетинів). */
export function totalMinutes(intervals: Interval[]): number {
  return Math.round(mergeIntervals(intervals).reduce((sum, interval) => sum + (interval.end - interval.start), 0) / 60_000);
}

/** Зсув Europe/Kyiv відносно UTC у хвилинах для конкретного моменту. */
export function kyivOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Kyiv',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
    .formatToParts(at)
    .reduce<Record<string, string>>((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});
  const hour = parts['hour'] === '24' ? '00' : (parts['hour'] ?? '00');
  const asUtc = Date.UTC(
    Number(parts['year']),
    Number(parts['month']) - 1,
    Number(parts['day']),
    Number(hour),
    Number(parts['minute']),
    Number(parts['second']),
  );
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** Початок поточної місцевої (Europe/Kyiv) доби як момент UTC. */
export function kyivDayStart(at: Date): Date {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  const utcMidnight = new Date(`${ymd}T00:00:00Z`);
  // Беремо зсув на місцевий полудень доби, щоб не втрапити в перехід на літній/зимовий час.
  const offset = kyivOffsetMinutes(new Date(utcMidnight.getTime() + 12 * 3_600_000));
  return new Date(utcMidnight.getTime() - offset * 60_000);
}

/**
 * Чиста математика підсумку по вікну (без звернень до БД) — щоб легко тестувати:
 * скільки хвилин без світла, скільки зі світлом і яка «надійність».
 */
export function computeWindowSummary(label: string, start: Date, end: Date, rows: OutageRow[]): PowerWindowSummary {
  const windowMinutes = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000));
  const intervals: Interval[] = rows.map((row) => ({
    start: Math.max(start.getTime(), row.startsAt.getTime()),
    end: Math.min(end.getTime(), row.endsAt.getTime()),
  }));
  const outageMinutes = Math.min(windowMinutes, totalMinutes(intervals));
  const poweredMinutes = Math.max(0, windowMinutes - outageMinutes);
  const reliabilityPct = windowMinutes > 0 ? Math.round((poweredMinutes / windowMinutes) * 1000) / 10 : 100;

  return {
    windowLabel: label,
    windowMinutes,
    outageMinutes,
    poweredMinutes,
    reliabilityPct,
    outageCount: rows.length,
    hasData: rows.length > 0,
  };
}
