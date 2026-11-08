import { OFF_STATE_CODE } from '@svitlo/domain';
import type {
  GroupOutageSummary,
  PowerWindowSummary,
  QueueScheduleData,
  ReliabilityBucket,
  ReliabilityGroup,
  ReliabilityRegionSummary,
  ReliabilityReport,
  ScheduleIntervalUtc,
} from '@svitlo/shared';

import { normalizeRegionCpu, type RegionOption } from './region';

/**
 * Правила экрана «Статистика електропостачання».
 *
 * Раньше весь этот слой жил в двух компонентах: web `ReliabilityCard` (599 строк) и mobile
 * `UpcomingOutages` (931 строка). Списки дней, проценты, чипы областей и сортировка строк
 * областей были переписаны дважды, и любая правка делалась в двух местах. Здесь — только
 * расчёты; разметка осталась в компонентах.
 */

/** Области для ленты чипов: сначала своя, затем те, что чаще ищут рядом. */
export const KEY_REGION_CPUS: readonly string[] = [
  'chernihivska-oblast',
  'kyiv-city',
  'kyivska-oblast',
  'dnipro-dnem',
  'dnipro-cek',
  'lvivska-oblast',
  'poltavska-oblast',
  'kharkivska-oblast',
  'cherkaska-oblast',
  'zhytomyrska-oblast',
];

/** Сколько дней показываем по умолчанию (8 строк — примерно 210px, без простыни). */
export const DEFAULT_VISIBLE_DAYS = 8;

/** Доля времени со светом в окне бакета, %. Пустое окно считаем полностью светлым. */
export function poweredPctOf(bucket: { poweredMinutes: number; windowMinutes: number }): number {
  if (bucket.windowMinutes <= 0) return 100;
  return Math.min(100, Math.max(0, (bucket.poweredMinutes / bucket.windowMinutes) * 100));
}

/** Дата последней публикации в прошлом — область «застаріла», а не «немає даних». */
export function isStaleRegionDate(
  lastDate: string | null | undefined,
  todayKey: string,
): boolean {
  return lastDate != null && lastDate < todayKey;
}

/**
 * Только прошедшие дни с данными, новые сверху.
 *
 * `isForecast` — завтрашний прогноз: показывать его рядом с фактом значило бы обещать то, чего
 * ещё не было. Пустые дни (без слотов) тоже не рисуем, поэтому в списке нет строк «—».
 */
export function selectPastDays(
  days: readonly ReliabilityBucket[] | null | undefined,
  todayKey: string,
): ReliabilityBucket[] {
  const todayStart = Date.parse(`${todayKey}T00:00:00.000Z`);
  return [...(days ?? [])]
    .filter((bucket) => {
      if (bucket.isForecast || !bucket.hasData || bucket.windowMinutes <= 0) return false;
      const start = Date.parse(bucket.start);
      return Number.isNaN(start) ? true : start <= todayStart;
    })
    .sort((a, b) => Date.parse(b.start) - Date.parse(a.start));
}

export interface ReliabilityTotals {
  todayBucket: ReliabilityBucket | null;
  weekOutage: number;
  windowMinutes: number;
  outageMinutes: number;
  overallPct: number | null;
}

/** Итоги по уже отобранным прошедшим дням: сегодня, неделя, весь период. */
export function summarizeReliability(
  days: readonly ReliabilityBucket[],
  todayKey: string,
): ReliabilityTotals {
  const todayBucket = days.find((bucket) => bucket.key === `day:${todayKey}`) ?? null;
  const weekOutage = days.slice(0, 7).reduce((sum, bucket) => sum + bucket.outageMinutes, 0);
  const windowMinutes = days.reduce((sum, bucket) => sum + bucket.windowMinutes, 0);
  const outageMinutes = days.reduce((sum, bucket) => sum + bucket.outageMinutes, 0);
  return {
    todayBucket,
    weekOutage,
    windowMinutes,
    outageMinutes,
    overallPct: windowMinutes > 0 ? (1 - outageMinutes / windowMinutes) * 100 : null,
  };
}

/** Недели/месяцы отчёта: только с данными, без прогноза, новые сверху. */
export function selectPeriodBuckets(
  buckets: readonly ReliabilityBucket[] | null | undefined,
): ReliabilityBucket[] {
  return [...(buckets ?? [])].filter((bucket) => bucket.hasData && !bucket.isForecast).reverse();
}

/**
 * Строки «по групах». В режиме «моя черга» отчёт уже сужен сервером до одной группы.
 */
export function reliabilityGroupRows(
  report: ReliabilityReport | null | undefined,
  scope: 'region' | 'queue',
): ReliabilityGroup[] {
  if (scope === 'queue') return report?.queue ? [report.queue] : [];
  return report?.groups ?? [];
}

/** `cpu → nameUa` из каталога: выдуманная подпись области хуже, чем её отсутствие. */
export function regionNameMapOf(options: readonly RegionOption[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const option of options) map.set(normalizeRegionCpu(option.region.cpu), option.region.nameUa);
  return map;
}

/**
 * Чипы областей: выбранная первой, затем ключевые, без дублей `kyiv`/`kyiv-city`.
 * Подпись берётся только из каталога; `fallbackLabel` — подпись своей области до загрузки.
 */
export function regionPillsFor(
  activeCpu: string,
  names: Map<string, string>,
  fallback?: { cpu: string; label: string } | null,
  keyCpus: readonly string[] = KEY_REGION_CPUS,
): Array<{ cpu: string; label: string }> {
  const seen = new Set<string>();
  const result: Array<{ cpu: string; label: string }> = [];
  const push = (rawCpu: string) => {
    const cpu = normalizeRegionCpu(rawCpu);
    if (seen.has(cpu)) return;
    const fallbackLabel =
      fallback && normalizeRegionCpu(fallback.cpu) === cpu ? fallback.label : null;
    const label = names.get(cpu) ?? fallbackLabel;
    if (!label) return;
    seen.add(cpu);
    result.push({ cpu, label });
  };
  push(activeCpu);
  for (const cpu of keyCpus) push(cpu);
  return result;
}

/**
 * Селект «Усі області»: только реальные строки каталога, группы сетей не выбираемы.
 */
export function selectableRegionOptions(
  options: readonly RegionOption[],
): Array<{ cpu: string; label: string; depth: 0 | 1 }> {
  const seen = new Set<string>();
  const result: Array<{ cpu: string; label: string; depth: 0 | 1 }> = [];
  for (const option of options) {
    if (option.isGroup) continue;
    const cpu = normalizeRegionCpu(option.region.cpu);
    if (seen.has(cpu)) continue;
    seen.add(cpu);
    result.push({ cpu, label: option.region.nameUa, depth: option.depth });
  }
  return result;
}

export interface RegionRow {
  cpu: string;
  name: string;
  depth: 0 | 1;
  queues: number;
  slots: number;
  allClear: boolean;
  /** Последняя дата, на которую оператор публиковал график; null — не публиковал. */
  lastDate: string | null;
  summary?: ReliabilityRegionSummary;
}

/**
 * Сравнение областей: каталог даёт покрытие, `byRegionSummary` — часы без света и процент.
 * Своя область — первой, затем те, где есть цифры (худшие первыми), затем остальные.
 * Области без графика остаются в списке со статусом «немає даних»: скрывать их — значит
 * врать, что сравнение полное.
 */
export function reliabilityRegionRows(
  options: readonly RegionOption[],
  report: ReliabilityReport | null | undefined,
  activeCpu: string,
): RegionRow[] {
  const summaries = new Map<string, ReliabilityRegionSummary>(
    (report?.byRegionSummary ?? []).map((summary) => [normalizeRegionCpu(summary.region), summary]),
  );
  const rows: RegionRow[] = options
    .filter((option) => !option.isGroup)
    .map((option) => {
      const cpu = normalizeRegionCpu(option.region.cpu);
      return {
        cpu,
        name: option.region.nameUa,
        depth: option.depth,
        queues: option.region.queues?.length ?? 0,
        slots: option.region.todaySlots ?? option.region.slots ?? 0,
        allClear: option.region.allClear === true,
        lastDate: option.region.lastDate ?? null,
        summary: summaries.get(cpu),
      };
    });
  return rows.sort((a, b) => {
    if (a.cpu === activeCpu) return -1;
    if (b.cpu === activeCpu) return 1;
    const aHas = a.summary?.hasData ? 1 : 0;
    const bHas = b.summary?.hasData ? 1 : 0;
    if (aHas !== bHas) return bHas - aHas;
    if (aHas && bHas) return (a.summary?.reliabilityPct ?? 0) - (b.summary?.reliabilityPct ?? 0);
    return b.slots - a.slots || a.name.localeCompare(b.name, 'uk');
  });
}

/** Сводка `/status` как строка отчёта: последний честный источник, когда `/reliability` недоступен. */
export function statusRegionSummaryOf(
  summary: PowerWindowSummary | null | undefined,
  regionCpu: string,
  nameUa: string,
): ReliabilityRegionSummary | null {
  if (!summary?.hasData) return null;
  return {
    region: regionCpu,
    nameUa,
    windowMinutes: summary.windowMinutes,
    outageMinutes: summary.outageMinutes,
    poweredMinutes: summary.poweredMinutes,
    reliabilityPct: summary.reliabilityPct,
    outageCount: summary.outageCount,
    hasData: true,
    daysKnown: 1,
  };
}

/** Минуты отключений (stateCode 3) в списке интервалов. */
function outageMinutesOf(intervals: readonly ScheduleIntervalUtc[] | undefined): {
  outageMinutes: number;
  count: number;
} {
  let outageMinutes = 0;
  let count = 0;
  for (const interval of intervals ?? []) {
    if (interval.stateCode !== OFF_STATE_CODE) continue;
    const start = Date.parse(interval.startsAt);
    const end = Date.parse(interval.endsAt);
    if (Number.isNaN(start) || Number.isNaN(end) || end <= start) continue;
    outageMinutes += Math.round((end - start) / 60_000);
    count += 1;
  }
  return { outageMinutes, count };
}

export interface BuildReliabilityInput {
  /** Ответ `/reliability`, если он содержит хоть один день с данными. */
  live?: ReliabilityReport | null;
  activeRegion: string;
  regionName?: string | null;
  scope: 'region' | 'queue';
  selectedQueue?: string | null;
  todayKey: string;
  upcoming: readonly GroupOutageSummary[];
  todaySchedule?: Pick<QueueScheduleData, 'intervals'> | null;
  statusSummary?: PowerWindowSummary | null;
  now?: Date;
}

/**
 * Отчёт о надёжности «на клиенте», когда бэкенд не дал дни с данными.
 *
 * Так застосунок поступает при исчерпанной квоте D1: он считает дни по реальным интервалам
 * `/schedules/upcoming` и `/schedules`, а сегодняшнюю сводку при необходимости берёт из
 * `/status`. Правило целиком жило в `UpcomingOutages` и было невидимо тестам — теперь это
 * обычная функция.
 */
export function buildReliabilityReport(input: BuildReliabilityInput): ReliabilityReport {
  const live = input.live;
  const statusRegionSummary = statusRegionSummaryOf(
    input.statusSummary,
    input.activeRegion,
    input.regionName ?? input.activeRegion,
  );

  if (live && Array.isArray(live.days) && live.days.some((day) => day.hasData)) {
    const summaries = live.byRegionSummary ?? [];
    const hasActiveRegion = summaries.some(
      (summary) => normalizeRegionCpu(summary.region) === normalizeRegionCpu(input.activeRegion),
    );
    if (statusRegionSummary && !hasActiveRegion) {
      return { ...live, byRegionSummary: [...summaries, statusRegionSummary] };
    }
    return live;
  }

  const dayMap = new Map<
    string,
    { outageMinutes: number; windowMinutes: number; count: number }
  >();

  for (const group of input.upcoming) {
    if (input.scope === 'queue' && input.selectedQueue && group.queue !== input.selectedQueue) {
      continue;
    }
    const entry = dayMap.get(group.date) ?? { outageMinutes: 0, windowMinutes: 1440, count: 0 };
    const { outageMinutes, count } = outageMinutesOf(group.intervals);
    entry.outageMinutes += outageMinutes;
    entry.count += count;
    dayMap.set(group.date, entry);
  }

  if (!dayMap.has(input.todayKey) && input.todaySchedule?.intervals) {
    const { outageMinutes, count } = outageMinutesOf(input.todaySchedule.intervals);
    dayMap.set(input.todayKey, { outageMinutes, windowMinutes: 1440, count });
  }

  // Если расписания на сегодня нет, берём сводку `/status`: она не зависит от D1-квоты.
  if (!dayMap.has(input.todayKey)) {
    const usable = input.scope === 'region' && input.statusSummary?.hasData;
    dayMap.set(input.todayKey, {
      outageMinutes: usable ? input.statusSummary!.outageMinutes : 0,
      windowMinutes: usable ? input.statusSummary!.windowMinutes : 1440,
      count: usable ? input.statusSummary!.outageCount : 0,
    });
  }

  const days: ReliabilityBucket[] = Array.from(dayMap.entries()).map(([date, stats]) => {
    const windowMin = stats.windowMinutes;
    const outMin = Math.min(windowMin, stats.outageMinutes);
    const powMin = Math.max(0, windowMin - outMin);
    const relPct = windowMin > 0 ? (powMin / windowMin) * 100 : 100;
    return {
      key: `day:${date}`,
      label: date,
      start: `${date}T00:00:00.000Z`,
      end: `${date}T23:59:59.999Z`,
      windowMinutes: windowMin,
      outageMinutes: outMin,
      poweredMinutes: powMin,
      reliabilityPct: relPct,
      hasData: true,
      outageCount: stats.count,
    };
  });

  const groupStatsMap = new Map<string, { outageMinutes: number; totalMinutes: number }>();
  for (const group of input.upcoming) {
    // В режиме «моя черга» список групп — одна строка, как и в серверном отчёте.
    if (input.scope === 'queue' && input.selectedQueue && group.queue !== input.selectedQueue) {
      continue;
    }
    const current = groupStatsMap.get(group.queue) ?? { outageMinutes: 0, totalMinutes: 1440 };
    current.outageMinutes += outageMinutesOf(group.intervals).outageMinutes;
    groupStatsMap.set(group.queue, current);
  }

  const groups: ReliabilityGroup[] = Array.from(groupStatsMap.entries()).map(([queue, stats]) => ({
    queue,
    windowMinutes: stats.totalMinutes,
    outageMinutes: stats.outageMinutes,
    poweredMinutes: Math.max(0, stats.totalMinutes - stats.outageMinutes),
    reliabilityPct:
      stats.totalMinutes > 0
        ? ((stats.totalMinutes - stats.outageMinutes) / stats.totalMinutes) * 100
        : 100,
    hasData: true,
  }));

  return {
    generatedAt: (input.now ?? new Date()).toISOString(),
    from: input.todayKey,
    to: input.todayKey,
    days,
    weeks: [],
    months: [],
    groups,
    byRegionSummary: statusRegionSummary ? [statusRegionSummary] : [],
    queue: null,
  };
}
