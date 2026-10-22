import { useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { useQueueSchedule, useRegions, useReliability, useStatus, useUpcomingGroupOutages } from '@svitlo/core/api/queries';
import { kyivDateOffsetKey } from '@svitlo/core/lib/outage-dates';
import { normalizeRegionCpu, regionOptions } from '@svitlo/core/lib/region';
import { formatMinutesUk } from '@svitlo/core/lib/scheduleWindow';
import type {
  ReliabilityBucket,
  ReliabilityGroup,
  ReliabilityRegionSummary,
  ReliabilityReport,
} from '@svitlo/shared';

// demo-reliability removed: realtime local slot calculations used instead
import { useTheme } from '@/theme/ThemeProvider';

type Granularity = 'days' | 'weeks' | 'months' | 'groups' | 'regions';
type Scope = 'region' | 'queue';

interface UpcomingOutagesProps {
  regionCpu: string;
  selectedQueue: string | null;
}

interface RegionRow {
  cpu: string;
  name: string;
  depth: 0 | 1;
  queues: number;
  slots: number;
  allClear: boolean;
  lastDate: string | null;
  summary?: ReliabilityRegionSummary;
}

const DEFAULT_VISIBLE_DAYS = 7;

const KEY_REGION_CPUS = [
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

const TABS: Array<{ id: Granularity; label: string }> = [
  { id: 'days', label: 'По днях' },
  { id: 'weeks', label: 'По тижнях' },
  { id: 'months', label: 'По місяцях' },
  { id: 'groups', label: 'По групах' },
  { id: 'regions', label: 'Області' },
];

const DAY_FORMAT = new Intl.DateTimeFormat('uk-UA', {
  timeZone: 'Europe/Kyiv',
  day: 'numeric',
  month: 'short',
});
const WEEKDAY_FORMAT = new Intl.DateTimeFormat('uk-UA', {
  timeZone: 'Europe/Kyiv',
  weekday: 'short',
});
const LAST_SEEN_FORMAT = new Intl.DateTimeFormat('uk-UA', {
  timeZone: 'Europe/Kyiv',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

function shortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return DAY_FORMAT.format(date).replace(/\.$/, '');
}

function shortWeekday(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const value = WEEKDAY_FORMAT.format(date);
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function lastSeenDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  return LAST_SEEN_FORMAT.format(date);
}

function poweredPct(bucket: { poweredMinutes: number; windowMinutes: number }): number {
  if (bucket.windowMinutes <= 0) return 100;
  return Math.min(100, Math.max(0, (bucket.poweredMinutes / bucket.windowMinutes) * 100));
}

export function UpcomingOutages({ regionCpu, selectedQueue }: UpcomingOutagesProps) {
  const { palette } = useTheme();
  const [pickedRegion, setPickedRegion] = useState<string | null>(null);
  const activeRegion = pickedRegion ?? normalizeRegionCpu(regionCpu);

  const [scope, setScope] = useState<Scope>('region');
  const [granularity, setGranularity] = useState<Granularity>('days');
  const [showAllDays, setShowAllDays] = useState(false);
  const [allRegionsModalOpen, setAllRegionsModalOpen] = useState(false);

  const { data: regionsData } = useRegions();
  const options = useMemo(() => regionOptions(regionsData?.data ?? []), [regionsData]);

  const regionNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const option of options) {
      map.set(normalizeRegionCpu(option.region.cpu), option.region.nameUa);
    }
    return map;
  }, [options]);

  const queueForReport = scope === 'queue' ? selectedQueue ?? undefined : undefined;
  const { data: liveData, isLoading } = useReliability(activeRegion, queueForReport);
  // `/status` живёт на зеркале и отдаёт сегодняшнюю сводку даже когда D1 исчерпал квоту.
  // Это последний честный источник для «Областей», когда `/reliability` отвечает 500.
  const { data: statusData } = useStatus(activeRegion);
  const statusSummary = statusData?.data?.powerSummary?.today ?? null;
  const statusRegionSummary = useMemo<ReliabilityRegionSummary | null>(() => {
    if (!statusSummary?.hasData) return null;
    return {
      region: activeRegion,
      nameUa: regionNameMap.get(activeRegion) ?? activeRegion,
      windowMinutes: statusSummary.windowMinutes,
      outageMinutes: statusSummary.outageMinutes,
      poweredMinutes: statusSummary.poweredMinutes,
      reliabilityPct: statusSummary.reliabilityPct,
      outageCount: statusSummary.outageCount,
      hasData: true,
      daysKnown: 1,
    };
  }, [activeRegion, regionNameMap, statusSummary]);

  // Подтягиваем реальные интервалы групп выбранного региона на ближайшие дни
  const { data: upcomingData } = useUpcomingGroupOutages(activeRegion, 7);
  const upcomingGroups = upcomingData?.data ?? [];

  // Подтягиваем расписание текущей группы на сегодня
  const todayKey = useMemo(() => kyivDateOffsetKey(0), []);
  const todayScheduleQuery = useQueueSchedule(selectedQueue ?? undefined, todayKey, activeRegion);
  const rawSchedule = todayScheduleQuery.data;
  const todaySchedule = rawSchedule && 'intervals' in rawSchedule ? rawSchedule : (rawSchedule as { data?: any })?.data;

  /**
   * Честный расчёт отчёта:
   * 1. Если бэкенд отдал готовый report с днями — берём его.
   * 2. Иначе рассчитываем метрики на клиенте из реальных слотов/интервалов.
   */
  const report: ReliabilityReport = useMemo(() => {
    const live = liveData?.data;
    if (live && Array.isArray(live.days) && live.days.some((d) => d.hasData)) {
      const summaries = live.byRegionSummary ?? [];
      const hasActiveRegion = summaries.some(
        (summary) => normalizeRegionCpu(summary.region) === activeRegion,
      );
      if (statusRegionSummary && !hasActiveRegion) {
        return { ...live, byRegionSummary: [...summaries, statusRegionSummary] };
      }
      return live;
    }

    // Собираем данные по дням из реальных интервалов upcomingGroups или todaySchedule
    const dayMap = new Map<string, { outageMinutes: number; windowMinutes: number; count: number }>();

    // 1) Из upcomingGroups (содержит интервалы для групп региона)
    for (const group of upcomingGroups) {
      if (scope === 'queue' && selectedQueue && group.queue !== selectedQueue) continue;
      const dateKey = group.date;
      const entry = dayMap.get(dateKey) ?? { outageMinutes: 0, windowMinutes: 1440, count: 0 };
      for (const interval of group.intervals ?? []) {
        if (interval.stateCode === 3) {
          const s = Date.parse(interval.startsAt);
          const e = Date.parse(interval.endsAt);
          if (!isNaN(s) && !isNaN(e) && e > s) {
            entry.outageMinutes += Math.round((e - s) / 60000);
            entry.count += 1;
          }
        }
      }
      dayMap.set(dateKey, entry);
    }

    // 2) Из todaySchedule если для сегодняшнего дня ещё нет записи
    if (!dayMap.has(todayKey) && todaySchedule?.intervals) {
      let outage = 0;
      let count = 0;
      for (const interval of todaySchedule.intervals) {
        if (interval.stateCode === 3) {
          const s = Date.parse(interval.startsAt);
          const e = Date.parse(interval.endsAt);
          if (!isNaN(s) && !isNaN(e) && e > s) {
            outage += Math.round((e - s) / 60000);
            count += 1;
          }
        }
      }
      dayMap.set(todayKey, { outageMinutes: outage, windowMinutes: 1440, count });
    }

    // Если расписания на сегодня нет, берём сводку `/status`: она не зависит от D1-квоты.
    if (!dayMap.has(todayKey)) {
      const fallbackOutage = scope === 'region' && statusSummary?.hasData
        ? statusSummary.outageMinutes
        : 0;
      const fallbackWindow = scope === 'region' && statusSummary?.hasData
        ? statusSummary.windowMinutes
        : 1440;
      dayMap.set(todayKey, {
        outageMinutes: fallbackOutage,
        windowMinutes: fallbackWindow,
        count: scope === 'region' && statusSummary?.hasData ? statusSummary.outageCount : 0,
      });
    }

    const days: ReliabilityBucket[] = Array.from(dayMap.entries()).map(([dateStr, stats]) => {
      const windowMin = stats.windowMinutes;
      const outMin = Math.min(windowMin, stats.outageMinutes);
      const powMin = Math.max(0, windowMin - outMin);
      const relPct = windowMin > 0 ? (powMin / windowMin) * 100 : 100;
      return {
        key: `day:${dateStr}`,
        label: dateStr,
        start: `${dateStr}T00:00:00.000Z`,
        end: `${dateStr}T23:59:59.999Z`,
        windowMinutes: windowMin,
        outageMinutes: outMin,
        poweredMinutes: powMin,
        reliabilityPct: relPct,
        hasData: true,
        outageCount: stats.count,
      };
    });

    // Расчёт по группам региона из реальных интервалов
    const groupStatsMap = new Map<string, { outageMinutes: number; totalMinutes: number }>();
    for (const group of upcomingGroups) {
      const current = groupStatsMap.get(group.queue) ?? { outageMinutes: 0, totalMinutes: 1440 };
      for (const interval of group.intervals ?? []) {
        if (interval.stateCode === 3) {
          const s = Date.parse(interval.startsAt);
          const e = Date.parse(interval.endsAt);
          if (!isNaN(s) && !isNaN(e) && e > s) {
            current.outageMinutes += Math.round((e - s) / 60000);
          }
        }
      }
      groupStatsMap.set(group.queue, current);
    }

    const groups: ReliabilityGroup[] = Array.from(groupStatsMap.entries()).map(([q, g]) => ({
      queue: q,
      windowMinutes: g.totalMinutes,
      outageMinutes: g.outageMinutes,
      poweredMinutes: Math.max(0, g.totalMinutes - g.outageMinutes),
      reliabilityPct: g.totalMinutes > 0 ? ((g.totalMinutes - g.outageMinutes) / g.totalMinutes) * 100 : 100,
      hasData: true,
    }));

    return {
      generatedAt: new Date().toISOString(),
      from: todayKey,
      to: todayKey,
      days,
      weeks: [],
      months: [],
      groups,
      byRegionSummary: statusRegionSummary ? [statusRegionSummary] : [],
      queue: null,
    };
  }, [
    liveData,
    upcomingGroups,
    todaySchedule,
    scope,
    selectedQueue,
    todayKey,
    statusSummary,
    statusRegionSummary,
  ]);

  
  const daysWithData = useMemo(() => {
    const todayStart = Date.parse(`${todayKey}T00:00:00.000Z`);
    return [...(report?.days ?? [])]
      .filter((bucket) => {
        if (bucket.isForecast || !bucket.hasData || bucket.windowMinutes <= 0) return false;
        const start = Date.parse(bucket.start);
        return Number.isNaN(start) ? true : start <= todayStart;
      })
      .sort((a, b) => Date.parse(b.start) - Date.parse(a.start));
  }, [report, todayKey]);

  const todayBucket = daysWithData.find((bucket) => bucket.key === `day:${todayKey}`);
  const weekBuckets = daysWithData.slice(0, 7);
  const weekOutage = weekBuckets.reduce((sum, bucket) => sum + bucket.outageMinutes, 0);
  const periodWindow = daysWithData.reduce((sum, bucket) => sum + bucket.windowMinutes, 0);
  const periodOutage = daysWithData.reduce((sum, bucket) => sum + bucket.outageMinutes, 0);
  const overallPct = periodWindow > 0 ? (1 - periodOutage / periodWindow) * 100 : null;

  const weeks = useMemo(
    () => [...(report?.weeks ?? [])].filter((b) => b.hasData && !b.isForecast).reverse(),
    [report],
  );
  const months = useMemo(
    () => [...(report?.months ?? [])].filter((b) => b.hasData && !b.isForecast).reverse(),
    [report],
  );

  const groupRows = useMemo<ReliabilityGroup[]>(() => {
    if (scope === 'queue') return report?.queue ? [report.queue] : [];
    return report?.groups ?? [];
  }, [scope, report]);

  const regionPills = useMemo(() => {
    const seen = new Set<string>();
    const result: Array<{ cpu: string; label: string }> = [];
    const push = (rawCpu: string) => {
      const cpu = normalizeRegionCpu(rawCpu);
      if (seen.has(cpu)) return;
      const label = regionNameMap.get(cpu) ?? (cpu === normalizeRegionCpu(regionCpu) ? 'Поточна область' : null);
      if (!label) return;
      seen.add(cpu);
      result.push({ cpu, label });
    };
    push(activeRegion);
    for (const cpu of KEY_REGION_CPUS) push(cpu);
    return result;
  }, [activeRegion, regionNameMap, regionCpu]);

  const allRegionSelectableOptions = useMemo(() => {
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
  }, [options]);

  const regionRows = useMemo<RegionRow[]>(() => {
    const summaries = new Map<string, ReliabilityRegionSummary>(
      (report?.byRegionSummary ?? []).map((summary: ReliabilityRegionSummary) => [
        normalizeRegionCpu(summary.region),
        summary,
      ]),
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
      if (a.cpu === activeRegion) return -1;
      if (b.cpu === activeRegion) return 1;
      const aHas = a.summary?.hasData ? 1 : 0;
      const bHas = b.summary?.hasData ? 1 : 0;
      if (aHas !== bHas) return bHas - aHas;
      if (aHas && bHas) return (a.summary?.reliabilityPct ?? 0) - (b.summary?.reliabilityPct ?? 0);
      return b.slots - a.slots || a.name.localeCompare(b.name, 'uk');
    });
  }, [options, report, activeRegion]);

  const visibleDays = showAllDays ? daysWithData : daysWithData.slice(0, DEFAULT_VISIBLE_DAYS);

  const renderContent = () => {
    if (isLoading && daysWithData.length === 0) {
      return <ActivityIndicator color={palette.mutedForeground} className="py-4" />;
    }

    if (granularity === 'regions') {
      if (regionRows.length === 0) {
        return <Text className="py-2 text-xs text-muted-foreground">Немає даних по областях.</Text>;
      }
      return (
        <View className="gap-2">
          {regionRows.map((row) => {
            const isSelected = row.cpu === activeRegion;
            return (
              <Pressable
                key={row.cpu}
                onPress={() => setPickedRegion(row.cpu)}
                style={{
                  backgroundColor: isSelected ? 'rgba(56, 189, 248, 0.08)' : 'transparent',
                  borderColor: isSelected ? palette.primary : 'transparent',
                }}
                className="flex-row items-center gap-2 rounded-xl border p-1.5 active:opacity-70"
              >
                <View className="flex-1">
                  <Text
                    style={{
                      color: isSelected ? palette.primary : palette.foreground,
                      fontWeight: isSelected ? '600' : '500',
                    }}
                    className="text-xs"
                    numberOfLines={1}
                  >
                    {row.name}
                  </Text>
                  <Text className="text-[10px] text-muted-foreground">
                    {row.queues} груп · {row.slots} слотів
                  </Text>
                </View>

                {row.summary?.hasData ? (
                  <View className="flex-row items-center gap-2">
                    <View
                      style={{ backgroundColor: palette.status.off.soft }}
                      className="rounded-md px-1.5 py-0.5"
                    >
                      <Text className="text-[10px] font-semibold tabular-nums text-destructive">
                        −{formatMinutesUk(row.summary.outageMinutes)}
                      </Text>
                    </View>
                    <Text className="w-12 text-right text-xs font-semibold tabular-nums text-foreground">
                      {row.summary.reliabilityPct.toFixed(1)}%
                    </Text>
                  </View>
                ) : (
                  <Text className="text-[10px] text-muted-foreground">
                    {row.allClear
                      ? 'Без відключень'
                      : row.lastDate && row.lastDate < todayKey
                      ? `Ост. ${lastSeenDate(row.lastDate)}`
                      : 'Немає даних'}
                  </Text>
                )}
              </Pressable>
            );
          })}
        </View>
      );
    }

    if (granularity === 'groups') {
      if (groupRows.length === 0) {
        return <Text className="py-2 text-xs text-muted-foreground">Немає даних по групах.</Text>;
      }
      return (
        <View className="gap-2">
          {groupRows.map((group) => {
            const pct = poweredPct(group);
            return (
              <View key={group.queue} className="flex-row items-center gap-2">
                <View className="w-20">
                  <Text className="text-xs font-semibold text-foreground" numberOfLines={1}>
                    Черга {group.queue}
                  </Text>
                </View>

                <View
                  style={{ backgroundColor: 'rgba(244, 63, 94, 0.2)' }}
                  className="h-2 flex-1 overflow-hidden rounded-full"
                >
                  <View
                    style={{
                      width: `${pct}%`,
                      backgroundColor: palette.status.on.color,
                    }}
                    className="h-full rounded-full"
                  />
                </View>

                <View
                  style={{ backgroundColor: palette.status.off.soft }}
                  className="w-18 items-end rounded-md px-1.5 py-0.5"
                >
                  <Text className="text-[11px] font-semibold tabular-nums text-destructive">
                    {group.outageMinutes > 0 ? `−${formatMinutesUk(group.outageMinutes)}` : '0 хв'}
                  </Text>
                </View>

                <Text className="w-12 text-right text-xs font-semibold tabular-nums text-foreground">
                  {group.reliabilityPct.toFixed(1)}%
                </Text>
              </View>
            );
          })}
        </View>
      );
    }

    if (granularity === 'weeks') {
      if (weeks.length === 0) {
        return <Text className="py-2 text-xs text-muted-foreground">Немає даних по тижнях.</Text>;
      }
      return (
        <View className="gap-2.5">
          {weeks.map((bucket) => {
            const pct = poweredPct(bucket);
            return (
              <View key={bucket.key} className="flex-row items-center gap-2">
                <View className="w-28">
                  <Text className="text-xs font-semibold text-foreground" numberOfLines={1}>
                    {bucket.label}
                  </Text>
                </View>

                <View
                  style={{ backgroundColor: 'rgba(244, 63, 94, 0.2)' }}
                  className="h-2 flex-1 overflow-hidden rounded-full"
                >
                  <View
                    style={{
                      width: `${pct}%`,
                      backgroundColor: palette.status.on.color,
                    }}
                    className="h-full rounded-full"
                  />
                </View>

                <View
                  style={{ backgroundColor: palette.status.off.soft }}
                  className="w-18 items-end rounded-md px-1.5 py-0.5"
                >
                  <Text className="text-[11px] font-semibold tabular-nums text-destructive">
                    {bucket.outageMinutes > 0 ? `−${formatMinutesUk(bucket.outageMinutes)}` : '0 хв'}
                  </Text>
                </View>

                <Text className="w-12 text-right text-xs font-semibold tabular-nums text-foreground">
                  {bucket.reliabilityPct.toFixed(1)}%
                </Text>
              </View>
            );
          })}
        </View>
      );
    }

    if (granularity === 'months') {
      if (months.length === 0) {
        return <Text className="py-2 text-xs text-muted-foreground">Немає даних по місяцях.</Text>;
      }
      return (
        <View className="gap-2.5">
          {months.map((bucket) => {
            const pct = poweredPct(bucket);
            return (
              <View key={bucket.key} className="flex-row items-center gap-2">
                <View className="w-28">
                  <Text className="text-xs font-semibold text-foreground" numberOfLines={1}>
                    {bucket.label}
                  </Text>
                </View>

                <View
                  style={{ backgroundColor: 'rgba(244, 63, 94, 0.2)' }}
                  className="h-2 flex-1 overflow-hidden rounded-full"
                >
                  <View
                    style={{
                      width: `${pct}%`,
                      backgroundColor: palette.status.on.color,
                    }}
                    className="h-full rounded-full"
                  />
                </View>

                <View
                  style={{ backgroundColor: palette.status.off.soft }}
                  className="w-18 items-end rounded-md px-1.5 py-0.5"
                >
                  <Text className="text-[11px] font-semibold tabular-nums text-destructive">
                    {bucket.outageMinutes > 0 ? `−${formatMinutesUk(bucket.outageMinutes)}` : '0 хв'}
                  </Text>
                </View>

                <Text className="w-12 text-right text-xs font-semibold tabular-nums text-foreground">
                  {bucket.reliabilityPct.toFixed(1)}%
                </Text>
              </View>
            );
          })}
        </View>
      );
    }

    // По днях
    if (daysWithData.length === 0) {
      return (
        <Text className="py-2 text-xs text-muted-foreground">
          Немає збережених минулих днів із графіком для цієї області.
        </Text>
      );
    }

    return (
      <View className="gap-2.5">
        {visibleDays.map((bucket) => {
          const isToday = bucket.key === `day:${todayKey}`;
          const label = isToday
            ? `Сьогодні, ${shortDate(bucket.start)}`
            : `${shortWeekday(bucket.start)}, ${shortDate(bucket.start)}`;
          const pct = poweredPct(bucket);
          const outageMinutes = bucket.outageMinutes;

          return (
            <View key={bucket.key} className="flex-row items-center gap-2">
              <View className="w-28">
                <Text className="text-xs font-semibold text-foreground" numberOfLines={1}>
                  {label}
                </Text>
              </View>

              {/* Двухцветная полоса надежности (зеленый / красный) */}
              <View
                style={{ backgroundColor: 'rgba(244, 63, 94, 0.2)' }}
                className="h-2 flex-1 overflow-hidden rounded-full"
              >
                <View
                  style={{
                    width: `${pct}%`,
                    backgroundColor: palette.status.on.color,
                  }}
                  className="h-full rounded-full"
                />
              </View>

              {/* Часы без света */}
              <View
                style={{ backgroundColor: palette.status.off.soft }}
                className="w-18 items-end rounded-md px-1.5 py-0.5"
              >
                <Text className="text-[11px] font-semibold tabular-nums text-destructive">
                  {outageMinutes > 0 ? `−${formatMinutesUk(outageMinutes)}` : '0 хв'}
                </Text>
              </View>

              {/* Процент со светом */}
              <Text className="w-12 text-right text-xs font-semibold tabular-nums text-foreground">
                {bucket.reliabilityPct.toFixed(1)}%
              </Text>
            </View>
          );
        })}

        {daysWithData.length > DEFAULT_VISIBLE_DAYS ? (
          <Pressable
            onPress={() => setShowAllDays((v) => !v)}
            className="mt-1 items-center self-center rounded-full border border-border px-3 py-1 active:opacity-70"
          >
            <Text className="text-[11px] font-semibold text-primary">
              {showAllDays ? 'Згорнути' : `Показати всі ${daysWithData.length} днів`}
            </Text>
          </Pressable>
        ) : null}
      </View>
    );
  };

  return (
    <View
      style={{
        backgroundColor: palette.card,
        borderColor: palette.hairline,
      }}
      className="gap-3.5 rounded-3xl border p-4"
    >
      {/* Заголовок */}
      <View className="flex-row items-center gap-2.5">
        <View
          style={{ backgroundColor: palette.primaryContainer }}
          className="h-8 w-8 items-center justify-center rounded-xl"
        >
          <Ionicons name="bar-chart-outline" size={17} color={palette.primary} />
        </View>
        <View className="flex-1">
          <Text className="text-sm font-semibold text-foreground">Статистика електропостачання</Text>
          <Text className="text-xs text-muted-foreground">Минулі дні з опублікованим графіком</Text>
        </View>
      </View>

      {/* Горизонтальная лента чипов областей */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 6 }}
        className="-mx-1 px-1"
      >
        {regionPills.map((pill) => {
          const isActive = pill.cpu === activeRegion;
          return (
            <Pressable
              key={pill.cpu}
              onPress={() => setPickedRegion(pill.cpu)}
              style={{
                backgroundColor: isActive ? 'rgba(56, 189, 248, 0.15)' : palette.surfaceContainerHigh,
                borderColor: isActive ? palette.primary : palette.hairline,
              }}
              className="rounded-full border px-3 py-1.5 active:opacity-70"
            >
              <Text
                style={{
                  color: isActive ? palette.primary : palette.mutedForeground,
                  fontWeight: isActive ? '600' : '500',
                }}
                className="text-xs"
              >
                {pill.label}
              </Text>
            </Pressable>
          );
        })}

        <Pressable
          onPress={() => setAllRegionsModalOpen(true)}
          style={{
            backgroundColor: palette.surfaceContainerHigh,
            borderColor: palette.hairline,
          }}
          className="flex-row items-center gap-1 rounded-full border px-3 py-1.5 active:opacity-70"
        >
          <Text className="text-xs font-semibold text-muted-foreground">Всі області</Text>
          <Ionicons name="chevron-down" size={12} color={palette.mutedForeground} />
        </Pressable>
      </ScrollView>

      {/* 3 карточки метрик: Сьогодні / За тиждень / Надійність */}
      <View className="flex-row gap-2">
        <View
          style={{
            backgroundColor: palette.surfaceContainerHigh,
            borderColor: palette.hairline,
          }}
          className="flex-1 rounded-2xl border p-2.5"
        >
          <Text className="text-[10px] text-muted-foreground" numberOfLines={1}>
            Сьогодні без світла
          </Text>
          <Text className="mt-0.5 text-xs font-bold tabular-nums text-foreground">
            {todayBucket ? (todayBucket.outageMinutes > 0 ? formatMinutesUk(todayBucket.outageMinutes) : '0 хв') : '—'}
          </Text>
        </View>

        <View
          style={{
            backgroundColor: palette.surfaceContainerHigh,
            borderColor: palette.hairline,
          }}
          className="flex-1 rounded-2xl border p-2.5"
        >
          <Text className="text-[10px] text-muted-foreground" numberOfLines={1}>
            За 7 днів без світла
          </Text>
          <Text className="mt-0.5 text-xs font-bold tabular-nums text-foreground">
            {weekBuckets.length > 0 ? (weekOutage > 0 ? formatMinutesUk(weekOutage) : '0 хв') : '—'}
          </Text>
        </View>

        <View
          style={{
            backgroundColor: palette.surfaceContainerHigh,
            borderColor: palette.hairline,
          }}
          className="flex-1 rounded-2xl border p-2.5"
        >
          <Text className="text-[10px] text-muted-foreground" numberOfLines={1}>
            {scope === 'queue' ? 'Черга' : 'Область'}
          </Text>
          <Text className="mt-0.5 text-xs font-bold tabular-nums text-foreground">
            {overallPct != null ? `${overallPct.toFixed(1)}%` : '—'}
          </Text>
        </View>
      </View>

      {/* Переключатель: Середнє по області / Моя черга */}
      <View
        style={{ backgroundColor: palette.surfaceContainerHigh }}
        className="flex-row rounded-xl p-1"
      >
        <Pressable
          onPress={() => setScope('region')}
          style={{
            backgroundColor: scope === 'region' ? palette.card : 'transparent',
          }}
          className="flex-1 items-center rounded-lg py-1.5"
        >
          <Text
            style={{
              color: scope === 'region' ? palette.foreground : palette.mutedForeground,
              fontWeight: scope === 'region' ? '600' : '500',
            }}
            className="text-xs"
          >
            Середнє по області
          </Text>
        </Pressable>

        <Pressable
          onPress={() => selectedQueue && setScope('queue')}
          disabled={!selectedQueue}
          style={{
            backgroundColor: scope === 'queue' ? palette.card : 'transparent',
            opacity: selectedQueue ? 1 : 0.5,
          }}
          className="flex-1 items-center rounded-lg py-1.5"
        >
          <Text
            style={{
              color: scope === 'queue' ? palette.foreground : palette.mutedForeground,
              fontWeight: scope === 'queue' ? '600' : '500',
            }}
            className="text-xs"
          >
            {selectedQueue ? `Черга ${selectedQueue}` : 'Оберіть чергу'}
          </Text>
        </Pressable>
      </View>

      {/* Вкладки гранулярности: По днях / По тижнях / По місяцях / По групах / Області */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 4 }}
        style={{ backgroundColor: palette.surfaceContainerHigh }}
        className="-mx-1 rounded-xl p-1 px-1"
      >
        {TABS.map((tab) => {
          const isActive = granularity === tab.id;
          return (
            <Pressable
              key={tab.id}
              onPress={() => setGranularity(tab.id)}
              style={{
                backgroundColor: isActive ? palette.card : 'transparent',
              }}
              className="rounded-lg px-2.5 py-1.5 active:opacity-70"
            >
              <Text
                style={{
                  color: isActive ? palette.foreground : palette.mutedForeground,
                  fontWeight: isActive ? '600' : '500',
                }}
                className="text-xs"
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Контент активной вкладки */}
      {renderContent()}

      {/* Модальное окно полного выбора области */}
      <Modal
        visible={allRegionsModalOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setAllRegionsModalOpen(false)}
      >
        <View className="flex-1 justify-end bg-black/60">
          <View
            style={{
              backgroundColor: palette.card,
              borderColor: palette.hairline,
            }}
            className="max-h-[75%] rounded-t-3xl border-t p-4"
          >
            <View className="flex-row items-center justify-between pb-3">
              <Text className="text-base font-bold text-foreground">Оберіть область</Text>
              <Pressable
                onPress={() => setAllRegionsModalOpen(false)}
                className="rounded-full p-1 active:opacity-70"
              >
                <Ionicons name="close" size={22} color={palette.foreground} />
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} className="divide-y divide-hairline">
              {allRegionSelectableOptions.map((opt) => {
                const isSelected = opt.cpu === activeRegion;
                return (
                  <Pressable
                    key={opt.cpu}
                    onPress={() => {
                      setPickedRegion(opt.cpu);
                      setAllRegionsModalOpen(false);
                    }}
                    style={{
                      paddingLeft: opt.depth === 1 ? 24 : 12,
                      backgroundColor: isSelected ? 'rgba(56, 189, 248, 0.12)' : 'transparent',
                    }}
                    className="flex-row items-center justify-between rounded-xl py-3 pr-3 active:opacity-70"
                  >
                    <Text
                      style={{
                        color: isSelected ? palette.primary : palette.foreground,
                        fontWeight: isSelected ? '600' : '400',
                      }}
                      className="text-sm"
                    >
                      {opt.label}
                    </Text>
                    {isSelected ? (
                      <Ionicons name="checkmark" size={18} color={palette.primary} />
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}
