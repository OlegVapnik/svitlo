import type {
  ReliabilityBucket,
  ReliabilityGroup,
  ReliabilityRegionSummary,
  ReliabilityReport,
} from '@svitlo/shared';
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

/**
 * Межі звітного місяця: від 00:00 першого числа до кінця поточної доби (київської).
 *
 * Кінець — не «зараз», а кінець доби: слот графіка на 20:00 сьогодні вже відомий, і обрізати
 * його по поточній годині означало б рахувати сьогоднішній графік неповним.
 */
function monthWindowBounds(now: Date): { start: Date; end: Date; daysInMonth: number } {
  const start = kyivMonthStart(now);
  const [year, month] = kyivDateKey(start).split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(year!, month!, 0)).getUTCDate();
  const end = kyivDayStart(new Date(now.getTime() + 24 * 3_600_000));
  return { start, end, daysInMonth };
}

/**
 * Знаменник вікна для зведень: тільки ті добі, за які дані ЄСТЬ.
 *
 * Місячне вікно в 31 день із трьома днями даних дало б «99% надійності» — цифру про 28 днів, про
 * які ми нічого не знаємо. Це саме той випадок, де «немає даних» не має виглядати як «майже
 * ідеально». Правило те саме, що у воркері (cf-worker/src/index.ts), щоб цифри з обох бекендів
 * сходились.
 */
function coverageWindowMinutes(daysKnown: number, daysInMonth: number): number {
  const monthMinutes = daysInMonth * 24 * 60;
  return Math.max(24 * 60, Math.min(monthMinutes, Math.max(1, daysKnown) * 24 * 60));
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

/**
 * Рядок статистики для окна.
 *
 * `byQueue` — интервалы, сгруппированные по группам. Когда он передан, считается СРЕДНЕЕ по
 * группам, а не сумма: группы отключаются по очереди и их окна разнесены по часам, поэтому сумма
 * дала бы «20 часов без света из 24», хотя в каждый момент света нет лишь у части людей.
 * Среднее отвечает на вопрос конкретного человека: сколько часов без света у его группы.
 */
function bucket(
  key: string,
  label: string,
  start: Date,
  end: Date,
  rows: OutageRow[],
  byQueue?: Map<string, OutageRow[]>,
  isForecast = false,
): ReliabilityBucket {
  const forecast = isForecast ? { isForecast: true } : {};
  if (byQueue) {
    const perQueue: number[] = [];
    for (const queueRows of byQueue.values()) {
      const overlapping = queueRows.filter(
        (row) => row.startsAt.getTime() <= end.getTime() && row.endsAt.getTime() >= start.getTime(),
      );
      if (overlapping.length === 0) continue;
      const summary = computeWindowSummary(label, start, end, overlapping);
      if (summary.outageMinutes > 0) perQueue.push(summary.outageMinutes);
    }
    const windowMinutes = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000));
    if (perQueue.length === 0) {
      return {
        key,
        label,
        start: start.toISOString(),
        end: end.toISOString(),
        windowMinutes,
        outageMinutes: 0,
        poweredMinutes: windowMinutes,
        reliabilityPct: 100,
        outageCount: 0,
        hasData: false,
        ...forecast,
      };
    }
    const outageMinutes = Math.round(perQueue.reduce((sum, value) => sum + value, 0) / perQueue.length);
    const poweredMinutes = Math.max(0, windowMinutes - outageMinutes);
    return {
      key,
      label,
      start: start.toISOString(),
      end: end.toISOString(),
      windowMinutes,
      outageMinutes,
      poweredMinutes,
      reliabilityPct: windowMinutes > 0 ? Math.round((poweredMinutes / windowMinutes) * 1000) / 10 : 100,
      outageCount: perQueue.length,
      hasData: true,
      ...forecast,
    };
  }

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
    ...forecast,
  };
}


/**
 * Зведення по кожній групі за весь звітний період.
 *
 * Окремо від днів/тижнів/місяців: людина найчастіше хочеть знати «а скільки в МОЄЙ групі», а не
 * загальну цифру по области. Рахується по тих самих інтервалах графіку, що й решта звіту, тож
 * числа узгоджені між собою.
 */
export function buildGroupSummary(
  now: Date,
  byQueue: Map<string, OutageRow[]>,
): ReliabilityGroup[] {
  const { start, end, daysInMonth } = monthWindowBounds(now);
  const groups: ReliabilityGroup[] = [];
  for (const [queue, rows] of byQueue) {
    const overlapping = rows.filter(
      (row) => row.startsAt.getTime() <= end.getTime() && row.endsAt.getTime() >= start.getTime(),
    );
    if (overlapping.length === 0) continue;
    // Знаменник — добі, за які по ЦІЙ групі є графік, а не все вікно звіту: інакше група з одним
    // днем даних отримувала б «99%» за тридцять днів, про які ми нічого не знаємо. Те саме
    // правило застосоване у воркері-дзеркалі (`reliabilityByQueue`), щоб цифри сходилися
    // незалежно від того, з яким бекендом розмовляє фронтенд.
    const daysWithData = new Set(rows.map((row) => kyivDateKey(row.startsAt))).size;
    const windowMinutes = coverageWindowMinutes(daysWithData, daysInMonth);
    const summary = computeWindowSummary(queue, start, end, overlapping);
    if (!summary.hasData) continue;
    const outageMinutes = Math.min(windowMinutes, summary.outageMinutes);
    const poweredMinutes = Math.max(0, windowMinutes - outageMinutes);
    groups.push({
      queue,
      windowMinutes,
      outageMinutes,
      poweredMinutes,
      reliabilityPct: windowMinutes > 0 ? Math.round((poweredMinutes / windowMinutes) * 1000) / 10 : 0,
      hasData: true,
    });
  }
  // Найбільші збої — першими: це те, що люди намагаються побачити.
  groups.sort((a, b) => a.reliabilityPct - b.reliabilityPct || b.outageMinutes - a.outageMinutes);
  return groups;
}

/**
 * Одне відключення групи, виписане зі слота ГПВ, — рахується на кожен слот
 * (02:00–04:00 і 16:00–18:00 — це два інтервали однієї групи).
 */
export interface RegionReliabilityInput {
  /** Київські дати (YYYY-MM-DD), за які по області є хоч якийсь графік — з відключеннями чи без. */
  dates: Set<string>;
  /** Інтервали відключень за групами: код черги → проміжки. */
  byQueue: Map<string, OutageRow[]>;
}

/**
 * Зведення надійності по областях — «як у мене і як поруч».
 *
 * Області без графіків у список не потрапляють: порожній рядок «0%» читався б як «там узагалі
 * немає світла», хоча насправді ми просто не маємо даних. Порядок — від найгіршої надійності,
 * бо людина шукає свою область і те, що поряд, а не абетку.
 *
 * Назву беремо з довідника областей: код `dnipropetrovska-oblast` у підписі виглядає як помилка.
 */
export function buildRegionSummaries(
  now: Date,
  byRegion: Map<string, RegionReliabilityInput>,
  names: Map<string, string>,
): ReliabilityRegionSummary[] {
  const { start, end, daysInMonth } = monthWindowBounds(now);
  const summaries: ReliabilityRegionSummary[] = [];

  for (const [region, input] of byRegion) {
    const windowMinutes = coverageWindowMinutes(input.dates.size, daysInMonth);
    const perQueue: number[] = [];
    let outageCount = 0;
    for (const rows of input.byQueue.values()) {
      const overlapping = rows.filter(
        (row) => row.startsAt.getTime() <= end.getTime() && row.endsAt.getTime() >= start.getTime(),
      );
      if (overlapping.length === 0) continue;
      outageCount += overlapping.length;
      const summary = computeWindowSummary(region, start, end, overlapping);
      if (summary.outageMinutes > 0) perQueue.push(summary.outageMinutes);
    }
    const average = perQueue.length > 0
      ? Math.round(perQueue.reduce((sum, value) => sum + value, 0) / perQueue.length)
      : 0;
    const outageMinutes = Math.min(windowMinutes, average);
    const poweredMinutes = Math.max(0, windowMinutes - outageMinutes);
    summaries.push({
      region,
      nameUa: names.get(region) ?? region,
      windowMinutes,
      outageMinutes,
      poweredMinutes,
      reliabilityPct: windowMinutes > 0 ? Math.round((poweredMinutes / windowMinutes) * 1000) / 10 : 0,
      outageCount,
      hasData: outageCount > 0,
      daysKnown: input.dates.size,
    });
  }

  summaries.sort((a, b) => a.reliabilityPct - b.reliabilityPct || a.region.localeCompare(b.region));
  return summaries;
}

/**
 * Надійність однієї конкретної групи за звітний період (`?queue=2/2`).
 *
 * Окремо від середнього по області: людина з чергою 2/2 не хоче знати середнє по всіх групах,
 * вона хоче знати, скільки не було світла саме в неї. Знаменник — дні, за які є графік, а не все
 * місячне вікно: інакше група без жодного відключення отримала б «100%» за дні, про які ми
 * нічого не знаємо.
 */
export function buildQueueSummary(
  queue: string,
  rows: OutageRow[],
  dates: Set<string>,
  now: Date,
): ReliabilityGroup {
  const { start, end, daysInMonth } = monthWindowBounds(now);
  const windowMinutes = coverageWindowMinutes(dates.size, daysInMonth);
  const summary = computeWindowSummary(queue, start, end, rows);
  const outageMinutes = Math.min(windowMinutes, summary.outageMinutes);
  return {
    queue,
    windowMinutes,
    outageMinutes,
    poweredMinutes: Math.max(0, windowMinutes - outageMinutes),
    reliabilityPct: windowMinutes > 0 ? Math.round(((windowMinutes - outageMinutes) / windowMinutes) * 1000) / 10 : 0,
    hasData: summary.hasData,
  };
}

/**
 * Графік на завтра: слоти ще не відбулись, тому день іде окремим бакетом із міткою `isForecast`.
 * Передається, тільки якщо на завтра справді є опублікований графік — порожній прогноз був би
 * знову «добою без світла», лише підписаною завтрашнім числом.
 */
export interface ReliabilityForecast {
  /** Київська дата завтрашнього дня (YYYY-MM-DD). */
  date: string;
  rows: OutageRow[];
  byQueue: Map<string, OutageRow[]>;
}

/**
 * Надійність електропостачання по днях / тижнях / місяцях з початку поточного
 * місяця (київського). Рахуємо лише фактичні, вже минулі інтервали — у майбутнє
 * не заглядаємо (для цього є графіки відключень).
 *
 * Виняток — завтрашня доба: графік на неї оператор уже публікує, і без неї «Надійність»
 * відставала б від розкладу на добу. Такий бакет позначений `isForecast`.
 */
export function buildReliabilityReport(
  now: Date,
  rows: OutageRow[],
  byQueue?: Map<string, OutageRow[]>,
  forecast?: ReliabilityForecast,
): ReliabilityReport {
  const monthStart = kyivMonthStart(now);
  const dayStarts = kyivDayStarts(monthStart, now);

  const days: ReliabilityBucket[] = dayStarts.map((start, index) => {
    const nextStart = index + 1 < dayStarts.length
      ? dayStarts[index + 1]!
      : kyivDayStart(new Date(start.getTime() + 24 * 3_600_000));
    const end = new Date(Math.min(nextStart.getTime(), now.getTime()));
    return bucket(`day:${dayKeyFormatter.format(start)}`, labelDay(start), start, end, rows, byQueue);
  });

  if (forecast) {
    const start = kyivDayStart(new Date(`${forecast.date}T12:00:00Z`));
    const end = kyivDayStart(new Date(start.getTime() + 24 * 3_600_000));
    days.push(
      bucket(`day:${forecast.date}`, labelDay(start), start, end, forecast.rows, forecast.byQueue, true),
    );
  }

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
    bucket(`week:${weekKey}`, `${labelDay(range.start)} – ${labelDay(range.end)}`, range.start, range.end, rows, byQueue),
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
    bucket(`month:${monthKey}`, monthFormatter.format(range.start), range.start, range.end, rows, byQueue),
  );

  return {
    from: monthStart.toISOString(),
    to: now.toISOString(),
    generatedAt: now.toISOString(),
    days,
    weeks,
    months,
    groups: byQueue ? buildGroupSummary(now, byQueue) : [],
  };
}
