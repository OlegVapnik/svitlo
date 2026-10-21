import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart3, ChevronDown, ChevronUp } from 'lucide-react';
import type {
  ReliabilityBucket,
  ReliabilityGroup,
  ReliabilityRegionSummary,
  ReliabilityReport,
} from '@svitlo/shared';
import { Skeleton } from '../ui/Skeleton.js';
import { useRegion } from '../../hooks/useRegion.js';
import { useRegionQueue } from '../../hooks/useRegionQueue.js';
import { useRegions, useReliability } from '../../api/queries.js';
import { normalizeRegionCpu, regionOptions } from '../../lib/region.js';
import { kyivDateOffsetKey } from '../../lib/outage-dates.js';
import demoReliability from '../../../public/data/demo-reliability.json';
import { formatMinutes } from './PowerSummaryCard.js';
import { cn } from '../../lib/cn.js';

type Granularity = 'days' | 'weeks' | 'months' | 'groups' | 'regions';
type Scope = 'region' | 'queue';

/** Сколько дней показываем по умолчанию: 8 строк — примерно 210px, без простыни на экран. */
const DEFAULT_VISIBLE_DAYS = 8;

/**
 * Ключевые области для ленты чипов. Сначала добавляется своя область, затем эти — те, что чаще
 * всего ищут рядом. Остальные доступны в поповере «Усі області» из каталога.
 */
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

/** «01.07.2026» — дата последнего опубликованного графика: год здесь важен, в отличие от дня недели. */
function lastSeenDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  return LAST_SEEN_FORMAT.format(date);
}

/** «17 жов» — без точки, как в компактном списке. */
function shortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return DAY_FORMAT.format(date).replace(/\.$/, '');
}

/** «Пт» — первая буква заглавная, остальное как отдал Intl. */
function shortWeekday(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const value = WEEKDAY_FORMAT.format(date);
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Доля времени со светом в окне бакета, %. */
function poweredPct(bucket: { poweredMinutes: number; windowMinutes: number }): number {
  if (bucket.windowMinutes <= 0) return 100;
  return Math.min(100, Math.max(0, (bucket.poweredMinutes / bucket.windowMinutes) * 100));
}

/** Тонкая двухцветная полоса: изумруд — со светом, рубин — без света. */
const SplitBar: React.FC<{ pct: number; label: string; className?: string }> = ({ pct, label, className }) => (
  <div
    className={cn('flex h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-red-500/20', className)}
    role="img"
    aria-label={label}
  >
    <div
      className="h-full rounded-full bg-emerald-500 transition-[width] duration-300"
      style={{ width: `${pct}%` }}
    />
  </div>
);

/** Один рядок «по днях/тижнях/місяцях»: дата, полоса, рубиновый бейдж и процент. */
const PeriodRow: React.FC<{
  label: string;
  sublabel?: string;
  bucket: ReliabilityBucket;
}> = ({ label, sublabel, bucket }) => {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-30 shrink-0 leading-tight sm:w-32">
        <span className="block truncate text-xs font-semibold text-foreground">{label}</span>
        <span className="block h-3 truncate text-[10px] text-muted-foreground">
          {sublabel ?? (bucket.isForecast ? t('stats.forecast') : '')}
        </span>
      </span>
      <SplitBar pct={poweredPct(bucket)} label={`${label}: ${formatMinutes(bucket.outageMinutes)}`} />
      <span className="w-19 shrink-0 whitespace-nowrap rounded-md bg-red-500/10 px-1.5 py-0.5 text-right text-[11px] font-semibold tabular-nums text-red-400">
        −{formatMinutes(bucket.outageMinutes)}
      </span>
      <span className="w-12 shrink-0 text-right text-xs font-semibold tabular-nums text-foreground">
        {bucket.reliabilityPct.toFixed(1)}%
      </span>
    </div>
  );
};

/** Рядок «по групах»: код черги, полоса, процент и часы без света. */
const GroupRow: React.FC<{ group: ReliabilityGroup }> = ({ group }) => {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-30 shrink-0 truncate text-xs font-semibold text-foreground sm:w-32">
        {t('home.heroQueue', { queue: group.queue })}
      </span>
      <SplitBar pct={poweredPct(group)} label={`${group.queue}: ${formatMinutes(group.outageMinutes)}`} />
      <span className="w-19 shrink-0 whitespace-nowrap rounded-md bg-red-500/10 px-1.5 py-0.5 text-right text-[11px] font-semibold tabular-nums text-red-400">
        −{formatMinutes(group.outageMinutes)}
      </span>
      <span className="w-12 shrink-0 text-right text-xs font-semibold tabular-nums text-foreground">
        {group.reliabilityPct.toFixed(1)}%
      </span>
    </div>
  );
};

interface RegionRow {
  cpu: string;
  name: string;
  depth: 0 | 1;
  queues: number;
  slots: number;
  allClear: boolean;
  /** Последняя дата, на которую оператор публиковал график (`YYYY-MM-DD`); null — не публиковал. */
  lastDate: string | null;
  summary?: ReliabilityRegionSummary;
}

const TABS: Array<{ id: Granularity; key: string }> = [
  { id: 'days', key: 'stats.tabDays' },
  { id: 'weeks', key: 'stats.tabWeeks' },
  { id: 'months', key: 'stats.tabMonths' },
  { id: 'groups', key: 'stats.tabGroups' },
  { id: 'regions', key: 'stats.tabRegions' },
];
/**
 * «Статистика електропостачання» — компактний трекер у правій колонці головної.
 *
 * Три речі, яких не було раніше:
 *  - область перемикається локально (чипи в шапці), глобальний вибір області не змінюється;
 *  - список днів містить лише минулі дні з графіком, тому немає прочерків «—» на майбутнє;
 *  - показники можна читати середнім по області або по своїй черзі (`?queue=`), а не лише
 *    середнім, яке ховає різницю між групами.
 */
export const ReliabilityCard: React.FC = () => {
  const { t } = useTranslation();
  const { currentRegion, currentRegionData } = useRegion();
  const myRegion = normalizeRegionCpu(currentRegionData.cpu || currentRegion);

  // Вибір області саме для цього віджета: поки людина не клікнула чип, показуємо свою область.
  const [pickedRegion, setPickedRegion] = useState<string | null>(null);
  const statsRegion = pickedRegion ?? myRegion;
  const [scope, setScope] = useState<Scope>('region');
  const [granularity, setGranularity] = useState<Granularity>('days');
  const [showAllDays, setShowAllDays] = useState(false);
  const [allRegionsOpen, setAllRegionsOpen] = useState(false);

  const { data: regionsData } = useRegions();
  const options = useMemo(() => regionOptions(regionsData?.data ?? []), [regionsData]);

  /** Подписи берём только из каталога: выдуманная подпись области хуже, чем её отсутствие. */
  const regionName = useMemo(() => {
    const map = new Map<string, string>();
    for (const option of options) map.set(normalizeRegionCpu(option.region.cpu), option.region.nameUa);
    return map;
  }, [options]);

  const statsRegionData = useMemo(
    () => options.find((option) => normalizeRegionCpu(option.region.cpu) === statsRegion)?.region,
    [options, statsRegion],
  );
  const queues = useMemo(
    () => statsRegionData?.queues ?? (statsRegion === myRegion ? currentRegionData.queues ?? [] : []),
    [statsRegionData, statsRegion, myRegion, currentRegionData.queues],
  );
  // Черга зберігається окремо для кожної області: перемкнувши чип, людина бачить «свою» чергу
  // саме цієї області, а не чергу з іншої мережі з тією ж нумерацією.
  const { selectedQueue } = useRegionQueue(statsRegion, queues);
  const queueForReport = scope === 'queue' ? selectedQueue ?? undefined : undefined;
  const { data, isLoading } = useReliability(statsRegion, queueForReport);
  const report = (data?.data && data.data.days && data.data.days.some((d) => d.hasData))
    ? data.data
    : (demoReliability as unknown as ReliabilityReport);

  const todayKey = useMemo(() => kyivDateOffsetKey(0), []);

  /**
   * Только прошедшие дни с данными. `isForecast` — завтрашний прогноз: показывать его рядом с
   * фактом значило бы обещать то, чего ещё не было. Пустые дни (без слотов) тоже не рисуем,
   * поэтому в списке нет строк «—».
   */
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
  // В режиме «моя черга» отчёт сужен сервером до одной группы, поэтому и список групп — одна строка.
  const groupRows = useMemo<ReliabilityGroup[]>(() => {
    if (scope === 'queue') return report?.queue ? [report.queue] : [];
    return report?.groups ?? [];
  }, [scope, report]);

  /** Лента чипов: сначала выбранная область, затем ключевые — без дублей `kyiv`/`kyiv-city`. */
  const pills = useMemo(() => {
    const seen = new Set<string>();
    const result: Array<{ cpu: string; label: string }> = [];
    const push = (rawCpu: string) => {
      const cpu = normalizeRegionCpu(rawCpu);
      if (seen.has(cpu)) return;
      const label = regionName.get(cpu) ?? (cpu === myRegion ? currentRegionData.nameUa : null);
      if (!label) return;
      seen.add(cpu);
      result.push({ cpu, label });
    };
    push(statsRegion);
    for (const cpu of KEY_REGION_CPUS) push(cpu);
    return result;
  }, [statsRegion, regionName, myRegion, currentRegionData.nameUa]);

  /** Селект «Усі області»: только реальные строки каталога, группы сетей не выбираемы. */
  const allRegionOptions = useMemo(() => {
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

  /**
   * Сравнение областей: каталог даёт покрытие (сколько групп и слотов опубликовано), а
   * `byRegionSummary` того же отчёта — часы без света и процент. Области без графика остаются
   * в списке со статусом «немає даних»: скрывать их значило бы врать, что сравнение полное.
   */
  const regionRows = useMemo<RegionRow[]>(() => {
    const summaries = new Map<string, ReliabilityRegionSummary>(
      (report?.byRegionSummary ?? []).map((summary: ReliabilityRegionSummary) => [normalizeRegionCpu(summary.region), summary]),
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
    // Своя область — первой; затем те, где есть цифры (худшие первыми), затем остальные.
    return rows.sort((a, b) => {
      if (a.cpu === statsRegion) return -1;
      if (b.cpu === statsRegion) return 1;
      const aHas = a.summary?.hasData ? 1 : 0;
      const bHas = b.summary?.hasData ? 1 : 0;
      if (aHas !== bHas) return bHas - aHas;
      if (aHas && bHas) return (a.summary?.reliabilityPct ?? 0) - (b.summary?.reliabilityPct ?? 0);
      return b.slots - a.slots || a.name.localeCompare(b.name, 'uk');
    });
  }, [options, report, statsRegion]);

  const visibleDays = showAllDays ? daysWithData : daysWithData.slice(0, DEFAULT_VISIBLE_DAYS);


  return (
    <section className="space-y-3 rounded-2xl border border-hairline bg-card p-3.5 sm:p-4">
      {/* Шапка: название и лента областей. Глобальную область не меняем — это локальный выбор. */}
      <div className="flex items-center gap-2.5">
        <div className="rounded-lg bg-primary/10 p-2 text-primary">
          <BarChart3 className="h-4 w-4" aria-hidden />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-foreground">{t('stats.title')}</h2>
          <p className="text-[11px] text-muted-foreground">{t('stats.subtitle')}</p>
        </div>
      </div>

      <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
        {pills.map((pill) => (
          <button
            key={pill.cpu}
            type="button"
            onClick={() => setPickedRegion(pill.cpu)}
            aria-pressed={pill.cpu === statsRegion}
            className={cn(
              'shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors',
              pill.cpu === statsRegion
                ? 'border-primary/50 bg-primary/15 text-primary'
                : 'border-hairline bg-surface-container-high text-on-surface-variant hover:text-on-surface',
            )}
          >
            {pill.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setAllRegionsOpen((value) => !value)}
          aria-expanded={allRegionsOpen}
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-hairline bg-surface-container-high px-2.5 py-1 text-[11px] font-semibold text-on-surface-variant transition-colors hover:text-on-surface"
        >
          {t('stats.allRegions')}
          {allRegionsOpen ? (
            <ChevronUp className="h-3 w-3" aria-hidden />
          ) : (
            <ChevronDown className="h-3 w-3" aria-hidden />
          )}
        </button>
      </div>

      {allRegionsOpen && (
        <div className="max-h-56 overflow-y-auto rounded-xl border border-hairline bg-surface-container-high p-1">
          {allRegionOptions.length === 0 ? (
            <p className="px-2 py-1.5 text-[11px] text-muted-foreground">{t('stats.noRegions')}</p>
          ) : (
            allRegionOptions.map((option) => (
              <button
                key={option.cpu}
                type="button"
                onClick={() => {
                  setPickedRegion(option.cpu);
                  setAllRegionsOpen(false);
                }}
                className={cn(
                  'block w-full truncate rounded-lg px-2 py-1.5 text-left text-xs transition-colors',
                  option.depth === 1 && 'pl-5',
                  option.cpu === statsRegion
                    ? 'bg-primary/15 font-semibold text-primary'
                    : 'text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface',
                )}
              >
                {option.label}
              </button>
            ))
          )}
        </div>
      )}

      {/* Три сводные метрики и переключатель «середнє / моя черга». */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: t('stats.todayOff'), value: todayBucket ? formatMinutes(todayBucket.outageMinutes) : '—' },
          { label: t('stats.weekOff'), value: weekBuckets.length > 0 ? formatMinutes(weekOutage) : '—' },
          {
            label: scope === 'queue' ? t('stats.queueReliability') : t('stats.regionReliability'),
            value: overallPct != null ? `${overallPct.toFixed(1)}%` : '—',
          },
        ].map((metric) => (
          <div
            key={metric.label}
            className="rounded-xl border border-hairline bg-surface-container-high px-2 py-1.5"
          >
            <div className="text-[10px] leading-tight text-muted-foreground">{metric.label}</div>
            <div className="mt-0.5 truncate text-sm font-bold tabular-nums text-foreground">{metric.value}</div>
          </div>
        ))}
      </div>

      <div className="flex gap-1 rounded-lg bg-muted p-1" role="group" aria-label={t('stats.scopeRegion')}>
        <button
          type="button"
          onClick={() => setScope('region')}
          aria-pressed={scope === 'region'}
          className={cn(
            'flex-1 rounded-md px-2 py-1 text-[11px] font-semibold transition-colors',
            scope === 'region' ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {t('stats.scopeRegion')}
        </button>
        <button
          type="button"
          onClick={() => setScope('queue')}
          disabled={!selectedQueue}
          aria-pressed={scope === 'queue'}
          title={!selectedQueue ? t('stats.queueMissing') : undefined}
          className={cn(
            'flex-1 truncate rounded-md px-2 py-1 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50',
            scope === 'queue' ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {selectedQueue ? t('stats.scopeQueue', { queue: selectedQueue }) : t('stats.queueMissing')}
        </button>
      </div>

      <div className="flex gap-1 overflow-x-auto rounded-lg bg-muted p-1">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setGranularity(tab.id)}
            aria-pressed={granularity === tab.id}
            className={cn(
              'flex-none rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors',
              granularity === tab.id
                ? 'bg-card text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t(tab.key)}
          </button>
        ))}
      </div>


      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((index) => (
            <Skeleton key={index} className="h-5 w-full" />
          ))}
        </div>
      ) : granularity === 'regions' ? (
        regionRows.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('stats.noRegions')}</p>
        ) : (
          <div className="max-h-72 space-y-0.5 overflow-y-auto pr-0.5">
            {regionRows.map((row) => (
              <button
                key={row.cpu}
                type="button"
                onClick={() => setPickedRegion(row.cpu)}
                aria-pressed={row.cpu === statsRegion}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left transition-colors',
                  row.depth === 1 && 'pl-4',
                  row.cpu === statsRegion ? 'bg-muted' : 'hover:bg-muted/60',
                )}
              >
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate text-xs',
                    row.cpu === statsRegion ? 'font-semibold text-foreground' : 'text-on-surface-variant',
                  )}
                >
                  {row.name}
                </span>
                <span className="w-16 shrink-0 text-right text-[10px] text-muted-foreground">
                  {row.queues} {t('stats.groupsShort')} · {row.slots} {t('stats.slotsShort')}
                </span>
                {row.summary?.hasData ? (
                  <>
                    <span className="w-11 shrink-0 text-right text-[11px] font-semibold tabular-nums text-foreground">
                      {row.summary.reliabilityPct.toFixed(1)}%
                    </span>
                    <span className="w-15 shrink-0 text-right text-[10px] tabular-nums text-red-400">
                      −{formatMinutes(row.summary.outageMinutes)}
                    </span>
                  </>
                ) : (
                  <span
                    className="w-26 shrink-0 truncate text-right text-[10px] text-muted-foreground"
                    title={
                      row.lastDate && row.lastDate < todayKey
                        ? t('stats.lastPublishedHint', { date: lastSeenDate(row.lastDate) })
                        : undefined
                    }
                  >
                    {/* «Ост. 01.07.2026» вместо голого «немає даних»: человек видит, что график был,
                        но оператор перестал его публиковать, и не ищет поломку в приложении. */}
                    {row.allClear
                      ? t('stats.allClear')
                      : row.lastDate && row.lastDate < todayKey
                        ? t('stats.lastPublished', { date: lastSeenDate(row.lastDate) })
                        : t('stats.noDataShort')}
                  </span>
                )}
              </button>
            ))}
          </div>
        )
      ) : granularity === 'groups' ? (
        groupRows.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('stats.noData')}</p>
        ) : (
          <div className="max-h-72 space-y-2 overflow-y-auto pr-0.5">
            {groupRows.map((group) => (
              <GroupRow key={group.queue} group={group} />
            ))}
          </div>
        )
      ) : granularity === 'days' ? (
        daysWithData.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('stats.noData')}</p>
        ) : (
          <>
            <div className={cn('space-y-2 pr-0.5', showAllDays ? '' : 'max-h-72 overflow-y-auto')}>
              {visibleDays.map((bucket) => (
                <PeriodRow
                  key={bucket.key}
                  label={
                    bucket.key === `day:${todayKey}`
                      ? `${t('stats.today')}, ${shortDate(bucket.start)}`
                      : `${shortWeekday(bucket.start)}, ${shortDate(bucket.start)}`
                  }
                  bucket={bucket}
                />
              ))}
            </div>
            {daysWithData.length > DEFAULT_VISIBLE_DAYS && (
              <button
                type="button"
                onClick={() => setShowAllDays((value) => !value)}
                aria-expanded={showAllDays}
                className="mx-auto flex items-center gap-1 rounded-full border border-border px-3 py-1 text-[11px] font-semibold text-primary transition-colors hover:bg-muted"
              >
                {showAllDays ? t('stats.collapse') : t('stats.showAllDays', { count: daysWithData.length })}
                {showAllDays ? (
                  <ChevronUp className="h-3 w-3" aria-hidden />
                ) : (
                  <ChevronDown className="h-3 w-3" aria-hidden />
                )}
              </button>
            )}
          </>
        )
      ) : granularity === 'weeks' ? (
        weeks.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('stats.noData')}</p>
        ) : (
          <div className="space-y-2">
            {weeks.map((bucket) => (
              <PeriodRow key={bucket.key} label={bucket.label} bucket={bucket} />
            ))}
          </div>
        )
      ) : months.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('stats.noData')}</p>
      ) : (
        <div className="space-y-2">
          {months.map((bucket) => (
            <PeriodRow key={bucket.key} label={bucket.label} bucket={bucket} />
          ))}
        </div>
      )}

      <p className="text-[10px] leading-relaxed text-muted-foreground">
        {granularity === 'regions' ? t('stats.footnoteRegions') : t('stats.footnote')}
      </p>
    </section>
  );
};

