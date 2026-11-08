/**
 * Добові інтервали відключень: хвилини від київської півночі й склеювання.
 *
 * Джерела віддають графік получасовими слотами (18:00–18:30, 18:30–19:00, …). Показувати їх
 * людині як є — це 30 плашок замість одного вікна, тож суміжні сегменти склеюються. Правило
 * склеювання одне для клієнта (шкала доби, картка «світло зараз») і для воркера (парсери
 * прямых джерел), тому воно живе тут, а не в кожному споживачі окремо.
 *
 * Шкала завжди показує рівно 24 години (0…1440 хвилин), тому інтервал, що переходить через
 * північ, розбивається на два денних вікна.
 */
import { kyivOffsetMinutesAt } from './kyiv-time.ts';

/** Інтервал у місцевому часі: хвилини від півночі. */
export interface MinuteInterval {
  startMin: number;
  endMin: number;
}

/** Інтервал як його віддає API: ISO-мітки в UTC. */
export interface IsoInterval {
  startsAt: string;
  endsAt: string;
}

/** Хвилини від київської півночі для ISO-мітки (`null`, якщо дата не розібралася). */
export function kyivMinuteOfDay(iso: string): number | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const wallMs = ms + kyivOffsetMinutesAt(ms) * 60_000;
  const minutes = Math.floor(wallMs / 60_000) % (24 * 60);
  return minutes < 0 ? minutes + 24 * 60 : minutes;
}

/**
 * Склеює суміжні (`18:00–18:30` + `18:30–19:00`) і перекривні інтервали.
 *
 * Порожні вікна (`end <= start`) викидаються: нульова довжина — це завжди дефект джерела
 * (не було кінця слота), і на шкалі вона виглядає як помилка, а не як відключення.
 */
export function mergeMinuteRanges(ranges: MinuteInterval[]): MinuteInterval[] {
  const sorted = ranges
    .filter(
      (range) =>
        Number.isFinite(range.startMin) && Number.isFinite(range.endMin) && range.endMin > range.startMin,
    )
    .sort((left, right) => left.startMin - right.startMin);

  const merged: MinuteInterval[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.startMin <= last.endMin) {
      last.endMin = Math.max(last.endMin, range.endMin);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

export type IntervalInput =
  | IsoInterval
  | { startMin: number; endMin: number }
  | { start: number; end: number };

/**
 * Склеєні інтервали з ISO-міток або хвилин доби [0..1440].
 * 1D-злиття суміжних та перекриваючих інтервалів.
 */
export function mergeIntervals(intervals: readonly IntervalInput[]): any[] {
  const windows: MinuteInterval[] = [];
  const isStartEndFormat =
    intervals.length > 0 &&
    typeof intervals[0] === 'object' &&
    intervals[0] !== null &&
    'start' in intervals[0] &&
    !('startMin' in intervals[0]);

  for (const interval of intervals) {
    if (!interval) continue;

    let from: number | null = null;
    let to: number | null = null;

    if ('startsAt' in interval && 'endsAt' in interval) {
      from = kyivMinuteOfDay(interval.startsAt);
      to = kyivMinuteOfDay(interval.endsAt);
    } else if ('startMin' in interval && 'endMin' in interval) {
      from = interval.startMin;
      to = interval.endMin;
    } else if ('start' in interval && 'end' in interval) {
      from = interval.start;
      to = interval.end;
    }

    if (from === null || to === null || !Number.isFinite(from) || !Number.isFinite(to)) continue;

    if (to > from) {
      windows.push({ startMin: from, endMin: to });
    } else if (to === from) {
      continue;
    } else {
      // Over midnight
      windows.push({ startMin: from, endMin: 24 * 60 });
      if (to > 0) windows.push({ startMin: 0, endMin: to });
    }
  }

  const merged = mergeMinuteRanges(windows);
  if (isStartEndFormat) {
    return merged.map((m) => ({ start: m.startMin, end: m.endMin }));
  }
  return merged;
}
