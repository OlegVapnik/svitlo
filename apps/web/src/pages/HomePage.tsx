import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ArrowRight, CalendarDays, RefreshCw, TriangleAlert, Zap, ZapOff } from 'lucide-react';
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
import { useIncidents, useOutages, useReliability, useStatus } from '../api/queries.js';
import { useRegion } from '../hooks/useRegion.js';
import type { Outage } from '@svitlo/shared';


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
  const { data: outagesData, isLoading: outagesLoading } = useOutages({ limit: 5 });
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
        ) : outages.length === 0 ? (
          <div className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-card/50 px-6 py-8 text-sm text-muted-foreground">
            <ZapOff className="h-4 w-4" aria-hidden />
            {t('outages.noOutages')}
          </div>
        ) : (
          <div className="space-y-2.5">
            {outages.map((outage) => (
              <OutageCard key={outage.id} outage={outage} />
            ))}
          </div>
        )}
      </section>

      <ReliabilityCard report={reliabilityData?.data} isLoading={reliabilityLoading} />
    </div>
  );
};
