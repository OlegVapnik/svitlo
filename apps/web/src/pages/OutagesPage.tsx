import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { List, Calendar as CalendarIcon, BarChart2, MapPin } from 'lucide-react';
import { SearchBar } from '../components/search/SearchBar.js';
import { FilterPanel } from '../components/search/FilterPanel.js';
import { OutageList } from '../components/outages/OutageList.js';
import { OutageCalendar } from '../components/outages/OutageCalendar.js';
import { OutageTimeline } from '../components/outages/OutageTimeline.js';
import { OutageHeatmap } from '../components/outages/OutageHeatmap.js';
import { OutageBarChart } from '../components/outages/OutageBarChart.js';
import { OutageMap } from '../components/outages/OutageMap.js';
import { useOutages, useOutageStats } from '../api/queries.js';
import type { Outage, OutageStatus } from '@energy-monitor/shared';
import { outageCategory, resolveOutageMapPoint } from '../lib/outage-location.js';
import { kyivDayStart, outageOverlapsKyivDay } from '../lib/outage-dates.js';

/** Чи перетинається відключення з вибраною (київською) добою. */
const startsOnSelectedKyivDay = (outage: Pick<Outage, 'startsAt' | 'endsAt'>, day: Date): boolean =>
  outageOverlapsKyivDay(outage.startsAt, outage.endsAt, day);

type TabView = 'list' | 'calendar' | 'chart' | 'map';

export const OutagesPage: React.FC = () => {
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
  const { data: outagesResponse, isLoading, isError, refetch } = useOutages({
    query: searchQuery || undefined,
    status: filters.status,
    queue: filters.queue,
    area: filters.area,
    ...dateParams,
  });

  // Fetch outage stats for charts
  const { data: statsResponse } = useOutageStats();

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
    <div className="space-y-4 max-w-5xl mx-auto pb-16 md:pb-6">
      {/* Title */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
          {t('outages.title', 'Планові відключення')}
        </h1>
        <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
          Планові перерви в електропостачанні населених пунктів Чернігівської області. Аварійні та ремонтні роботи — на сторінці «Аварії».
        </p>
      </div>

      {/* Search and Filters */}
      <div className="space-y-2">
        <SearchBar value={searchQuery} onChange={setSearchQuery} />
        <FilterPanel filters={filters} onChange={setFilters} areas={uniqueAreas} />
      </div>

      {/* View Switcher Tabs */}
      <div className="flex rounded-xl border border-border p-1 bg-muted/40 gap-1">
        <button
          onClick={() => setActiveTab('list')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-semibold transition-all ${
            activeTab === 'list'
              ? 'bg-card text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <List className="w-4 h-4" />
          <span>{t('outages.list', 'Список')} · {plannedOutages.length}</span>
        </button>

        <button
          onClick={() => setActiveTab('calendar')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-semibold transition-all ${
            activeTab === 'calendar'
              ? 'bg-card text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <CalendarIcon className="w-4 h-4" />
          <span>{t('outages.calendar', 'Календар')}</span>
        </button>

        <button
          onClick={() => setActiveTab('chart')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-semibold transition-all ${
            activeTab === 'chart'
              ? 'bg-card text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <BarChart2 className="w-4 h-4" />
          <span>{t('outages.chart', 'Графіки')}</span>
        </button>

        <button
          onClick={() => setActiveTab('map')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-semibold transition-all ${
            activeTab === 'map'
              ? 'bg-card text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <MapPin className="w-4 h-4" />
          <span>{t('outages.map', 'Карта')}</span>
        </button>
      </div>

      {/* Content depending on active tab */}
      {activeTab === 'list' && (
        <div className="space-y-5">
          <section className="space-y-2"><h2 className="font-semibold text-sm text-foreground">Планові відключення ({plannedOutages.length})</h2>{plannedOutages.length > 0 ? <OutageList outages={plannedOutages} isLoading={isLoading} isError={isError} onRetry={() => refetch()} /> : <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">На вибраний період планових відключень немає.</p>}</section>
          <p className="text-xs text-muted-foreground">
            Аварійні та ремонтні роботи з місцем і причиною — на сторінці{' '}
            <Link to="/incidents" className="text-primary underline">Аварії</Link>.
          </p>
        </div>
      )}

      {activeTab === 'calendar' && (
        <div className="space-y-4">
          <OutageCalendar
            outages={outages}
            selectedDate={calendarSelectedDate}
            onSelectDate={setCalendarSelectedDate}
          />
          <div className="pt-2">
            <h4 className="text-xs font-semibold text-muted-foreground mb-2">
              {calendarSelectedDate
                ? `Відключення на ${calendarSelectedDate.toLocaleDateString()}`
                : 'Всі відключення'}
            </h4>
            <div className="space-y-3">
              {plannedOutages.filter((outage) => !calendarSelectedDate || startsOnSelectedKyivDay(outage, calendarSelectedDate)).length > 0 ? <OutageList outages={plannedOutages.filter((outage) => !calendarSelectedDate || startsOnSelectedKyivDay(outage, calendarSelectedDate))} isLoading={isLoading} isError={isError} onRetry={() => refetch()} /> : <p className="text-sm text-muted-foreground">На цю дату планових відключень немає.</p>}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'chart' && (
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
          {!isLoading && outages.length === 0 && <p className="rounded-xl border-amber-500/30 bg-amber-500/5 p-4 text-sm text-muted-foreground">За вибраний період записів немає. Для перегляду історичної статистики скиньте фільтр дат.</p>}
        </div>
      )}

      {activeTab === 'map' && <OutageMap outages={outages} />}
    </div>
  );
};