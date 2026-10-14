import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../lib/cn.js';
import { Link } from 'react-router-dom';
import { List, Calendar as CalendarIcon, BarChart2, MapPin } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/Tabs.js';
import { SearchBar } from '../components/search/SearchBar.js';
import { FilterPanel } from '../components/search/FilterPanel.js';
import { OutageList } from '../components/outages/OutageList.js';
import { Skeleton } from '../components/ui/Skeleton.js';

/**
 * Тяжёлые вкладки (календарь, таймлайн, теплокарта, график, карта) — ленивые чанки: первый экран
 * (список) не должен тянуть chart/geo-библиотеки. Бюджет первого экрана — 250 kB gzip.
 */
const OutageCalendar = React.lazy(() =>
  import('../components/outages/OutageCalendar.js').then((module) => ({ default: module.OutageCalendar })),
);
const OutageTimeline = React.lazy(() =>
  import('../components/outages/OutageTimeline.js').then((module) => ({ default: module.OutageTimeline })),
);
const OutageHeatmap = React.lazy(() =>
  import('../components/outages/OutageHeatmap.js').then((module) => ({ default: module.OutageHeatmap })),
);
const OutageBarChart = React.lazy(() =>
  import('../components/outages/OutageBarChart.js').then((module) => ({ default: module.OutageBarChart })),
);
const OutageMap = React.lazy(() =>
  import('../components/outages/OutageMap.js').then((module) => ({ default: module.OutageMap })),
);

/** Заглушка на время загрузки ленивого чанка: те же пропорции, что у контента вкладки. */
const TabFallback = () => (
  <div className="space-y-3">
    <Skeleton className="h-56 w-full rounded-2xl" />
    <Skeleton className="h-40 w-full rounded-2xl" />
  </div>
);
import { useOutages, useOutageStats } from '../api/queries.js';
import type { Outage, OutageStatus } from '@svitlo/shared';
import { useRegion } from '../hooks/useRegion.js';
import { outageCategory, resolveOutageMapPoint } from '../lib/outage-location.js';
import { kyivDayStart, outageOverlapsKyivDay } from '../lib/outage-dates.js';

/** Чи перетинається відключення з вибраною (київською) добою. */
const startsOnSelectedKyivDay = (outage: Pick<Outage, 'startsAt' | 'endsAt'>, day: Date): boolean =>
  outageOverlapsKyivDay(outage.startsAt, outage.endsAt, day);

type TabView = 'list' | 'calendar' | 'chart' | 'map';

/**
 * Список отключений.
 *
 * `embedded` — когда страница вложена сегментом в «Моніторинг». Тогда исчезают её
 * собственный заголовок и ограничение ширины: заголовок уже нарисован родителем, а вложенный
 * второй заголовок под ним читается как ошибка вёрстки.
 */
export const OutagesPage: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<TabView>('list');
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState<{
    status?: OutageStatus;
    queue?: number;
    area?: string;
    datePreset?: 'all' | 'today' | 'tomorrow' | 'week';
  }>({ datePreset: 'all' });
  const [calendarSelectedDate, setCalendarSelectedDate] = useState<Date | null>(null);

  // Compute date filters
  const dateParams = useMemo(() => {
    const now = new Date();
    if (calendarSelectedDate) {
      const start = kyivDayStart(calendarSelectedDate);
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 1);
      end.setUTCMilliseconds(-1);
      return { dateFrom: start.toISOString(), dateTo: end.toISOString() };
    }

    if (filters.datePreset === 'today') {
      const start = kyivDayStart(now);
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 1);
      end.setUTCMilliseconds(-1);
      return { dateFrom: start.toISOString(), dateTo: end.toISOString() };
    }

    if (filters.datePreset === 'tomorrow') {
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const start = kyivDayStart(tomorrow);
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 1);
      end.setUTCMilliseconds(-1);
      return { dateFrom: start.toISOString(), dateTo: end.toISOString() };
    }

    if (filters.datePreset === 'week') {
      const start = kyivDayStart(now);
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 7);
      end.setUTCMilliseconds(-1);
      return { dateFrom: start.toISOString(), dateTo: end.toISOString() };
    }

    return {};
  }, [filters.datePreset, calendarSelectedDate]);

  // Fetch outages with filters
  const { currentRegionData } = useRegion();
  const { data: outagesResponse, isLoading, isError, refetch } = useOutages({
    query: searchQuery || undefined,
    status: filters.status,
    queue: filters.queue,
    area: filters.area,
    region: currentRegionData.cpu,
    ...dateParams,
  });

  // Статистика для графиков — по той же области И тому же периоду, что и сам список.
  // Раньше сюда уходила только область, из-за чего график не соответствовал выбранным датам.
  const { data: statsResponse } = useOutageStats({
    region: currentRegionData.cpu,
    // Именно dateParams (а не filters.dateFrom): он уже переводит пресеты «сьогодні/завтра/
    // тиждень» у конкретні дати, інакше статистика рахувала б не за вибраний період.
    ...(dateParams.dateFrom ? { dateFrom: dateParams.dateFrom } : {}),
    ...(dateParams.dateTo ? { dateTo: dateParams.dateTo } : {}),
  });

  const outages = (outagesResponse?.data || []).map((item) => ({
    ...item,
    addressesRaw: item.addressesRaw,
    addressesNormalized: item.addressesNormalized,
    sourceId: '',
    contentHash: '',
    firstSeenAt: item.startsAt,
    updatedAt: item.startsAt,
  })) as Outage[];
  const stats = statsResponse?.data;
  const displayOutages = outages.map((outage) => {
    const point = resolveOutageMapPoint(outage.areaName, outage.addressesRaw);
    const isResolvedArea = outage.areaName === 'Чернігівська область' && point.label !== 'Чернігівська область (точне місце не визначено)';
    return isResolvedArea ? { ...outage, areaName: point.label.replace(/^с\\.\s*/u, '') } : outage;
  });
  // На цій сторінці — лише планові роботи. Аварійні та ремонтні відключення
  // (з місцем і причиною) перенесено на сторінку «Аварії».
  const plannedOutages = displayOutages.filter((outage) => outageCategory(outage.reason) !== 'incident');

  // Unique area names for dropdown
  const uniqueAreas = useMemo(() => {
    const set = new Set<string>();
    outages.forEach((o: Outage) => set.add(o.areaName));
    return Array.from(set).sort();
  }, [outages]);

  return (
    <div className={cn('space-y-4', embedded ? '' : 'max-w-5xl mx-auto pb-16 md:pb-6')}>
      <header className="space-y-0.5">
        <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
          {embedded ? t('nav.monitorOutages') : t('outages.plannedSection')}
        </h1>
        <p className="text-xs text-muted-foreground sm:text-sm">
          {t('outages.incidentsHint')}{' '}
          <Link to="/monitor?tab=incidents" className="font-semibold text-primary hover:underline">
            {t('outages.incidentsLink')}
          </Link>
        </p>
      </header>

      {/* Search and Filters */}
      <div className="space-y-2">
        <SearchBar value={searchQuery} onChange={setSearchQuery} />
        <FilterPanel filters={filters} onChange={setFilters} areas={uniqueAreas} />
      </div>

      {/* Переключатель вида — ui/Tabs: роли ARIA, стрелки влево/вправо, aria-selected */}
      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as TabView)}>
        <TabsList aria-label={t('outages.title')}>
          <TabsTrigger value="list">
            <List className="h-4 w-4" aria-hidden />
            <span>
              {t('outages.list')} · {plannedOutages.length}
            </span>
          </TabsTrigger>
          <TabsTrigger value="calendar">
            <CalendarIcon className="h-4 w-4" aria-hidden />
            <span>{t('outages.calendar')}</span>
          </TabsTrigger>
          <TabsTrigger value="chart">
            <BarChart2 className="h-4 w-4" aria-hidden />
            <span>{t('outages.chart')}</span>
          </TabsTrigger>
          <TabsTrigger value="map">
            <MapPin className="h-4 w-4" aria-hidden />
            <span>{t('outages.map')}</span>
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Content depending on active tab */}
      {activeTab === 'list' && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">
            {t('outages.plannedSection')} ({plannedOutages.length})
          </h2>
          <OutageList outages={plannedOutages} isLoading={isLoading} isError={isError} onRetry={() => refetch()} />
        </div>
      )}

      {activeTab === 'calendar' && (
        <React.Suspense fallback={<TabFallback />}>
          <div className="space-y-4">
            <OutageCalendar
              outages={outages}
              selectedDate={calendarSelectedDate}
              onSelectDate={setCalendarSelectedDate}
            />
            <div className="pt-2">
              <h4 className="mb-2 text-xs font-semibold text-muted-foreground">
                {calendarSelectedDate
                  ? `${t('outages.selectedDay')} ${calendarSelectedDate.toLocaleDateString()}`
                  : t('outages.allDays')}
              </h4>
              <div className="space-y-3">
                {plannedOutages.filter((outage) => !calendarSelectedDate || startsOnSelectedKyivDay(outage, calendarSelectedDate)).length > 0 ? <OutageList outages={plannedOutages.filter((outage) => !calendarSelectedDate || startsOnSelectedKyivDay(outage, calendarSelectedDate))} isLoading={isLoading} isError={isError} onRetry={() => refetch()} /> : <p className="text-sm text-muted-foreground">{t('outages.noneForPeriod')}</p>}
              </div>
            </div>
          </div>
        </React.Suspense>
      )}

      {activeTab === 'chart' && (
        <React.Suspense fallback={<TabFallback />}>
          <div className="space-y-4">
            {/* Заголовок графіка — «відключень ТА РЕМОНТІВ», тому показуємо всі події
                (ремонтні роботи + планові/аварійні обмеження), а не лише «планові». */}
            {displayOutages.length > 0 && <OutageTimeline outages={displayOutages} />}
            {stats && (
              <>
                <OutageBarChart byArea={stats.byArea} byDay={stats.byDay} />
                <OutageHeatmap data={stats.heatmap} />
              </>
            )}
            {!isLoading && outages.length === 0 && (
              <p className="rounded-2xl border border-warning/40 bg-warning/5 p-4 text-sm text-muted-foreground">
                {t('outages.noRecordsForPeriod')}
              </p>
            )}
          </div>
        </React.Suspense>
      )}

      {activeTab === 'map' && (
        <React.Suspense fallback={<TabFallback />}>
          <OutageMap outages={outages} />
        </React.Suspense>
      )}
    </div>
  );
};