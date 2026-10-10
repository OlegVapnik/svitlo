import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ArrowRight, Building2, CalendarDays, MapPin, PhoneCall, TriangleAlert, Zap, ZapOff } from 'lucide-react';
import { StatusIndicator } from '../components/status/StatusIndicator.js';
import { SourceHealthBanner } from '../components/status/SourceHealthBanner.js';
import { LastUpdated } from '../components/status/LastUpdated.js';
import { PowerSummaryCard } from '../components/status/PowerSummaryCard.js';
import { ReliabilityCard } from '../components/status/ReliabilityCard.js';
import { IncidentBanner } from '../components/incidents/IncidentBanner.js';
import { OutageCard } from '../components/outages/OutageCard.js';
import { Card, CardContent } from '../components/ui/Card.js';
import { Skeleton } from '../components/ui/Skeleton.js';
import { StatCard } from '../components/ui/StatCard.js';
import { QueueScheduleBar } from '../components/schedule/QueueScheduleBar.js';
import { useIncidents, useOutages, useQueueSchedule, useReliability, useStatus } from '../api/queries.js';
import { useMyQueues } from '../hooks/useMyQueues.js';
import type { Outage } from '@svitlo/shared';

/** Сегодняшняя дата по Киеву в формате YYYY-MM-DD — API расписаний работает в этой зоне. */
function kyivToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/**
 * Главная отвечает на вопрос «что с электричеством сейчас». Порядок блоков — по важности:
 * 1) есть ли авария; 2) состояние сети; 3) цифры; 4) жив ли источник данных;
 * 5) быстрые ссылки и мой график; 6) ближайшие отключения; 7) статистика.
 */
export const HomePage: React.FC = () => {
  const { t } = useTranslation();
  const today = kyivToday();

  const { data: statusData, isLoading: statusLoading } = useStatus();
  const { data: reliabilityData, isLoading: reliabilityLoading } = useReliability();
  const { data: outagesData, isLoading: outagesLoading } = useOutages({ limit: 5 });
  const { data: incidentsData } = useIncidents();
  const { queues } = useMyQueues();
  const selectedQueue = queues[0];
  const { data: scheduleData, isLoading: scheduleLoading, isError: scheduleError } = useQueueSchedule(selectedQueue, today);

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

  const schedule = scheduleData?.data;

  return (
    <div className="mx-auto max-w-4xl space-y-5 pb-8">
      {activeIncidents.length > 0 && <IncidentBanner incident={activeIncidents[0]!} />}

      <section className="space-y-4 rounded-2xl border border-border bg-card p-4 shadow-card sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">{t('home.title')}</h1>
            <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">{t('home.subtitle')}</p>
          </div>
          {status?.lastUpdatedAt && <LastUpdated timestamp={status.lastUpdatedAt} />}
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
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t('home.quickLinks')}</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <QuickLink to="/my-address" icon={MapPin} label={t('nav.myAddress')} hint={t('home.myAddressHint')} />
          <QuickLink to="/queues" icon={CalendarDays} label={t('nav.queues')} hint={t('home.mySchedule')} />
          <QuickLink to="/streets" icon={Building2} label={t('nav.streets')} hint={t('home.streetsHint')} />
          <QuickLink to="/contacts" icon={PhoneCall} label={t('home.hotline')} hint={t('home.hotlineNumber')} />
        </div>
      </section>

      {selectedQueue ? (
        <Card>
          <CardContent className="space-y-3 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-foreground">
                {t('home.mySchedule')} · {selectedQueue}
              </h2>
              <Link to="/queues" className="text-xs font-semibold text-primary hover:underline">
                {t('nav.queues')}
              </Link>
            </div>

            {schedule?.demo && <p className="text-xs font-semibold text-warning">{t('home.demoSchedule')}</p>}

            {scheduleLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : scheduleError ? (
              <p className="text-sm text-muted-foreground">{t('home.myScheduleError')}</p>
            ) : schedule && schedule.intervals.length > 0 ? (
              <QueueScheduleBar intervals={schedule.intervals} date={today} />
            ) : (
              <p className="text-sm text-muted-foreground">{t('home.myScheduleEmpty')}</p>
            )}
          </CardContent>
        </Card>
      ) : null}

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

interface QuickLinkProps {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  hint: string;
}

/** Быстрая ссылка с иконкой-плиткой: один и тот же вид для адреса, очередей, улиц и телефона. */
function QuickLink({ to, icon: Icon, label, hint }: QuickLinkProps) {
  return (
    <Link
      to={to}
      className="group flex items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4 shadow-card transition-colors hover:border-primary/40 hover:bg-accent/40"
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-foreground">{label}</span>
          <span className="block truncate text-xs text-muted-foreground">{hint}</span>
        </span>
      </span>
      <ArrowRight
        className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
        aria-hidden
      />
    </Link>
  );
}

