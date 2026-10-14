import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ArrowRight, CalendarDays, MapPin, RefreshCw, TriangleAlert, Zap, ZapOff } from 'lucide-react';
import { StatusIndicator } from '../components/status/StatusIndicator.js';
import { SourceHealthBanner } from '../components/status/SourceHealthBanner.js';
import { LastUpdated } from '../components/status/LastUpdated.js';
import { PowerSummaryCard } from '../components/status/PowerSummaryCard.js';
import { ReliabilityCard } from '../components/status/ReliabilityCard.js';
import { HomeHeroSection } from '../components/status/HomeHeroSection.js';
import { IncidentBanner } from '../components/incidents/IncidentBanner.js';
import { OutageCard } from '../components/outages/OutageCard.js';
import { Skeleton } from '../components/ui/Skeleton.js';
import { Button } from '../components/ui/Button.js';
import { cn } from '../lib/cn.js';
import { StatCard } from '../components/ui/StatCard.js';
import { useIncidents, useOutages, useReliability, useStatus, useUpcomingGroupOutages } from '../api/queries.js';
import { useRegion } from '../hooks/useRegion.js';
import type { GroupOutageSummary, Outage } from '@svitlo/shared';

/**
 * Карточка ближайшего отключения одной группы: код черги, интервалы «10:00–11:00», статус
 * (идёт сейчас / запланировано) и — если источник её отдал — привязанные к группе населённые
 * пункты и улицы. Пустые списки НЕ заполняем вымышленными районами: зеркало ГПВ номера групп
 * с районами не связывает, и догадка здесь опаснее пустоты (AGENTS.md).
 */
const GroupOutageCard: React.FC<{ item: GroupOutageSummary }> = ({ item }) => {
  const { t } = useTranslation();
  return (
    <article className="rounded-2xl border border-border bg-card p-4 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-xs font-bold',
              item.isActiveNow ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary',
            )}
          >
            {item.isActiveNow ? <ZapOff className="h-3.5 w-3.5" aria-hidden /> : <Zap className="h-3.5 w-3.5" aria-hidden />}
            {t('home.queueGroup', { queue: item.queue })}
          </span>
          <span className="text-xs font-semibold text-muted-foreground">
            {item.isActiveNow ? t('home.groupOutageActive') : t('home.groupOutagePlanned')}
          </span>
        </div>
        <span className="text-xs font-semibold text-muted-foreground">{item.date}</span>
      </div>

      <ul className="mt-3 flex flex-wrap gap-2">
        {item.intervals.map((interval, index) => (
          <li
            key={`${interval.startsAt}-${index}`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-muted/60 px-2.5 py-1 text-xs font-semibold tabular text-foreground"
          >
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: interval.stateColor }} aria-hidden />
            {interval.localTimeFrom}–{interval.localTimeTo}
          </li>
        ))}
      </ul>

      {(item.settlements.length > 0 || item.streetNames.length > 0) && (
        <div className="mt-3 border-t border-border/60 pt-3">
          {item.settlements.length > 0 && (
            <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {item.settlements.map((name) => (
                <span key={name} className="rounded-md bg-muted px-1.5 py-0.5 font-medium text-foreground">
                  {name}
                </span>
              ))}
            </p>
          )}
          {item.streetNames.length > 0 && (
            <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {item.streetNames.slice(0, 8).map((name) => (
                <span key={name} className="rounded-md bg-muted px-1.5 py-0.5 font-medium text-foreground">
                  {name}
                </span>
              ))}
              {item.streetNames.length > 8 && (
                <Link to="/streets" className="font-semibold text-primary hover:underline">
                  {t('home.moreInStreets', { n: item.streetNames.length - 8 })}
                </Link>
              )}
            </p>
          )}
        </div>
      )}
    </article>
  );
};


/**
 * Главная отвечает на вопрос «что с электричеством сейчас». Порядок блоков — по важности:
 * 1) есть ли авария; 2) состояние сети; 3) цифры; 4) жив ли источник данных;
 * 5) быстрые ссылки и мой график; 6) ближайшие отключения; 7) статистика.
 */
export const HomePage: React.FC = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const { currentRegionData } = useRegion();

  const { data: statusData, isLoading: statusLoading } = useStatus();
  const { data: reliabilityData, isLoading: reliabilityLoading } = useReliability();
  const { data: outagesData, isLoading: outagesLoading } = useOutages({ limit: 5, region: currentRegionData.cpu });
  // Планові відключення по групах — з schedule_slots оператора (не з outage_events, де лише
  // точкові ремонтні записи одного села). Без них блок «Найближчі відключення» не відповідав би
  // на запитання «які саме групи гасять сьогодні».
  const { data: groupOutagesData, isLoading: groupOutagesLoading } = useUpcomingGroupOutages(currentRegionData.cpu, 2);
  const groupOutages = groupOutagesData?.data ?? [];
  const { data: incidentsData } = useIncidents();

  const status = statusData?.data;
  const activeIncidents = (incidentsData?.data ?? []).filter((incident) => incident.status === 'active');

  // Карточка отключения на главной показывает нормализованный адрес.
  const outages = (outagesData?.data ?? []).map((item) => ({
    ...item,
    addressesRaw: item.addressesNormalized,
    sourceId: '',
    contentHash: '',
    firstSeenAt: item.startsAt,
    updatedAt: item.startsAt,
  })) as Outage[];

  /**
   * Ручное обновление без перезагрузки страницы: инвалидирует всё, что видно на экране
   * (отключения, статус, инциденты, график) и дожидается повторных запросов.
   * Данные берутся из базы, куда планировщик пишет снимки оператора.
   */
  const refresh = async () => {
    setRefreshing(true);
    try {
      await queryClient.invalidateQueries();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5 pb-8">
      {activeIncidents.length > 0 && <IncidentBanner incident={activeIncidents[0]!} />}

      {/* Оновлений головний блок: першокласний селектор області, вибір черги для області,
          24-годинний горизонтальний таймлайн із півгодинними комірками та поточним станом */}
      <HomeHeroSection />


      <section className="space-y-4 rounded-2xl border border-border bg-card p-4 shadow-card sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">{t('home.title')}</h1>
            <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">{currentRegionData.nameUa || t('home.subtitle')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {status?.lastUpdatedAt && <LastUpdated timestamp={status.lastUpdatedAt} />}
            <Button
              variant="outline"
              size="sm"
              onClick={refresh}
              disabled={refreshing}
              aria-label={t('common.refresh')}
              className="gap-1.5"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} aria-hidden />
              {refreshing ? t('common.refreshing') : t('common.refresh')}
            </Button>
          </div>
        </div>

        <StatusIndicator level={status?.grid.level ?? 'stable'} message={status?.grid.message} />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard to="/outages" icon={Zap} tone="danger" label={t('home.statActive')} value={status?.activeOutages ?? 0} isLoading={statusLoading} />
          <StatCard to="/outages" icon={CalendarDays} tone="info" label={t('home.statScheduled')} value={status?.scheduledOutages ?? 0} isLoading={statusLoading} />
          <StatCard to="/incidents" icon={TriangleAlert} tone="warning" label={t('home.statIncidents')} value={status?.totalIncidents ?? 0} isLoading={statusLoading} hint={`${t('incidents.active')}: ${status?.activeIncidents ?? 0}`} />
        </div>

        <PowerSummaryCard summary={status?.powerSummary} isLoading={statusLoading} />
      </section>

      <SourceHealthBanner />

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-foreground">{t('home.upcoming')}</h2>
          <Link to="/outages" className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
            {t('home.allOutages')}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>

        {outagesLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} className="h-24 w-full rounded-2xl" />
            ))}
          </div>
        ) : (
          <div className="space-y-2.5">
            {/* Групи без відключень на найближчі дні — не показуємо: блок про відключення, а не про график. */}
            {groupOutagesLoading ? (
              <Skeleton className="h-28 w-full rounded-2xl" />
            ) : groupOutages.length === 0 ? (
              outages.length === 0 ? (
                <div className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-card/50 px-6 py-8 text-sm text-muted-foreground">
                  <ZapOff className="h-4 w-4" aria-hidden />
                  {t('outages.noOutages')}
                </div>
              ) : null
            ) : (
              <>
                {groupOutages.slice(0, 6).map((item) => (
                  <GroupOutageCard key={`${item.date}-${item.queue}`} item={item} />
                ))}
                {groupOutages.length > 6 && (
                  <p className="pt-1 text-center text-xs text-muted-foreground">
                    {t('home.moreGroups', { n: groupOutages.length - 6 })}
                  </p>
                )}
              </>
            )}

            {/* Точкові ремонтні/аварійні відключення — окремим підрозділом: їх у outage_events
                одиниці, і раніше вони займали весь блок, тоді як планових відключень по групах
                не було видно взагалі. */}
            {outages.length > 0 && (
              <div className="space-y-2 pt-1">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('home.pointOutages')}
                </p>
                {outages.map((outage) => (
                  <OutageCard key={outage.id} outage={outage} />
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      <ReliabilityCard report={reliabilityData?.data} isLoading={reliabilityLoading} />
    </div>
  );
};
