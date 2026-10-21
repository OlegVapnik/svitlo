import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../lib/cn.js';
import { Link } from 'react-router-dom';
import { List, Calendar as CalendarIcon, BarChart2, MapPin } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/Tabs.js';
import { SearchBar } from '../components/search/SearchBar.js';
import { FilterPanel, type OutageFiltersState } from '../components/search/FilterPanel.js';
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
import { useOutages, useOutageStats, useQueues, useUpcomingGroupOutages } from '../api/queries.js';
import type { Outage } from '@svitlo/shared';
import { useRegion } from '../hooks/useRegion.js';
import { useBookmarks } from '../hooks/useBookmarks.js';
import { outageCategory, resolveOutageMapPoint } from '../lib/outage-location.js';
import { kyivDateOffsetKey, kyivDayStart, outageOverlapsKyivDay } from '../lib/outage-dates.js';
import { mergeGroupOutages, synthesizeGroupOutages } from '../lib/group-outages.js';
import { queueNumber } from '../lib/queue-label.js';

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
  const [filters, setFilters] = useState<OutageFiltersState>({ datePreset: 'all' });
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
  const { primaryBookmark } = useBookmarks();
  const { data: queuesResponse } = useQueues(currentRegionData.cpu);
  const { data: outagesResponse, isLoading, isError, refetch } = useOutages({
    query: searchQuery || undefined,
    status: filters.status,
    // Сервер тримає номер групи числом; точний код («2/2») добираємо на клієнті нижче.
    queue: queueNumber(filters.queueCode),
    // Район не передаємо: на сервері цей фільтр звужує лише точкові ремонти й викидав би
    // планові вікна груп, через що список ставав порожнім. Фільтруємо об'єднаний результат.
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

  /**
   * Плановые окна из графика очередей области.
   *
   * `/api/v1/outages` — это события ОСР (аварии, ремонты). Когда оператор опубликовал только
   * ГПВ, список «Планові відключення» оставался пустым, хотя график живой. Синтез берёт окна
   * строго за сегодня/завтра: архивные июльские/апрельские слоты в зеркалах не должны выглядеть
   * как текущий график.
   */
  const { data: upcomingData } = useUpcomingGroupOutages(currentRegionData.cpu, 2);
  const todayKey = kyivDateOffsetKey(0);
  const tomorrowKey = kyivDateOffsetKey(1);
  const synthesized = useMemo(
    () =>
      synthesizeGroupOutages(upcomingData?.data, {
        regionCpu: currentRegionData.cpu,
        areaName: currentRegionData.nameUa,
        todayKey,
        tomorrowKey,
      }),
    [upcomingData, currentRegionData.cpu, currentRegionData.nameUa, todayKey, tomorrowKey],
  );
  // Дубли по «група + час» убираем: одно окно может прийти и событием ОСР, и слотом расписания.
  const combinedOutages = useMemo(
    () => mergeGroupOutages(outages, synthesized),
    [outages, synthesized],
  );
  // Есть ли на сегодня хоть один опубликованный слот (любой очереди). Без него пустой список —
  // это честное «оператор ще не опублікував графік», а не «відключень немає».
  const hasScheduleToday = (upcomingData?.data ?? []).some((bucket) => bucket.date === todayKey);

  const stats = statsResponse?.data;
  const displayOutages = combinedOutages.map((outage) => {
    const point = resolveOutageMapPoint(outage.areaName, outage.addressesRaw);
    const isResolvedArea = outage.areaName === 'Чернігівська область' && point.label !== 'Чернігівська область (точне місце не визначено)';
    return isResolvedArea ? { ...outage, areaName: point.label.replace(/^с\\.\s*/u, '') } : outage;
  });

  // Точні фільтри «черга» і «район» — по вже об'єднаному списку (планові вікна груп + ремонти).
  // Код групи порівнюємо повністю: «2/1» і «2/2» — різні черги, і зливати їх не можна.
  const scopedOutages = displayOutages.filter((outage) => {
    const matchesQueue = !filters.queueCode || outage.group === filters.queueCode;
    const matchesArea = !filters.area || outage.areaName === filters.area;
    return matchesQueue && matchesArea;
  });

  // На цій сторінці — лише планові роботи. Аварійні та ремонтні відключення
  // (з місцем і причиною) перенесено на сторінку «Аварії».
  const plannedOutages = scopedOutages.filter((outage) => outageCategory(outage.reason) !== 'incident');

  // Unique area names for dropdown
  const uniqueAreas = useMemo(() => {
    const set = new Set<string>();
    combinedOutages.forEach((o: Outage) => set.add(o.areaName));
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'uk'));
  }, [combinedOutages]);

  /** Реальні коди груп області: саме вони бувають у графіку, а не «Черга 1…6». */
  const queueCodes = useMemo(() => {
    const set = new Set<string>();
    (queuesResponse?.data ?? []).forEach((item) => {
      const code = String(item.queue ?? '').trim();
      if (code) set.add(code);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'uk', { numeric: true }));
  }, [queuesResponse]);

  // Пігулка «Моя черга» має сенс лише для місця з цієї ж області.
  const myQueue =
    primaryBookmark && primaryBookmark.regionCpu === currentRegionData.cpu ? primaryBookmark.queue : null;

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
        <FilterPanel
          filters={filters}
          onChange={setFilters}
          areas={uniqueAreas}
          queueCodes={queueCodes}
          regionCpu={currentRegionData.cpu}
          myQueue={myQueue}
        />
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
          <OutageList
            outages={plannedOutages}
            isLoading={isLoading}
            isError={isError}
            onRetry={() => refetch()}
            emptyTitle={hasScheduleToday ? undefined : t('outages.scheduleNotPublished')}
            emptyDescription={hasScheduleToday ? undefined : t('outages.scheduleNotPublishedDesc')}
          />
        </div>
      )}

      {activeTab === 'calendar' && (
        <React.Suspense fallback={<TabFallback />}>
          <div className="space-y-4">
            <OutageCalendar
              outages={scopedOutages}
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
            {scopedOutages.length > 0 && <OutageTimeline outages={scopedOutages} />}
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
          <OutageMap outages={scopedOutages} />
        </React.Suspense>
      )}
    </div>
  );
};