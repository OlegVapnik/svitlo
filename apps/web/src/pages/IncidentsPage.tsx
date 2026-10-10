import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, CheckCircle2, CalendarClock, MapPin, Tag, ExternalLink, Search, Radio } from 'lucide-react';
import { Card, CardContent } from '../components/ui/Card.js';
import { Badge } from '../components/ui/Badge.js';
import { Skeleton } from '../components/ui/Skeleton.js';
import { EmptyState } from '../components/common/EmptyState.js';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/Tabs.js';
import { formatDateTime } from '../lib/date.js';
import { useIncidents } from '../api/queries.js';
import type { Incident } from '@svitlo/shared';

type FilterKey = 'all' | 'active' | 'scheduled' | 'resolved';

const SEVERITY_KEY: Record<string, string> = {
  critical: 'incidents.sevCritical',
  high: 'incidents.sevHigh',
  medium: 'incidents.sevMedium',
  low: 'incidents.sevLow',
};

const SEVERITY_VARIANT: Record<string, 'destructive' | 'warning' | 'info' | 'muted'> = {
  critical: 'destructive',
  high: 'warning',
  medium: 'info',
  low: 'muted',
};

const STATUS_META: Record<string, { key: string; variant: 'destructive' | 'warning' | 'success' }> = {
  active: { key: 'incidents.active', variant: 'destructive' },
  scheduled: { key: 'incidents.scheduled', variant: 'warning' },
  resolved: { key: 'incidents.resolved', variant: 'success' },
};

/**
 * «Аварії та ремонтні роботи». Фільтр — ui/Tabs (ARIA tabs, стрелки влево/вправо) вместо
 * самодельных кнопок с bg-red-500/bg-amber-500: те цвета были жёсткими и ломали тёмную тему.
 */
export const IncidentsPage: React.FC = () => {
  const { t } = useTranslation();
  const { data: incidentsResponse, isLoading } = useIncidents();
  const [filter, setFilter] = useState<FilterKey>('all');
  const [query, setQuery] = useState('');

  const incidents = incidentsResponse?.data || [];

  const counts = useMemo(
    () => ({
      all: incidents.length,
      active: incidents.filter((incident) => incident.status === 'active').length,
      scheduled: incidents.filter((incident) => incident.status === 'scheduled').length,
      resolved: incidents.filter((incident) => incident.status === 'resolved').length,
    }),
    [incidents],
  );

  const filteredIncidents = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('uk-UA');
    return incidents.filter((incident) => {
      if (filter !== 'all' && incident.status !== filter) return false;
      if (!needle) return true;
      const haystack = [incident.title, incident.description, incident.areaName, incident.reason]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase('uk-UA');
      return haystack.includes(needle);
    });
  }, [incidents, filter, query]);

  return (
    <div className="mx-auto max-w-4xl space-y-4 pb-16 md:pb-6">
      <header className="space-y-0.5">
        <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">{t('incidents.title')}</h1>
        <p className="text-xs text-muted-foreground sm:text-sm">{t('incidents.subtitle')}</p>
      </header>

      <Tabs value={filter} onValueChange={(value) => setFilter(value as FilterKey)}>
        <TabsList aria-label={t('incidents.title')}>
          <TabsTrigger value="all">{t('incidents.filterAll')} · {counts.all}</TabsTrigger>
          <TabsTrigger value="active">{t('incidents.active')} · {counts.active}</TabsTrigger>
          <TabsTrigger value="scheduled">{t('incidents.scheduled')} · {counts.scheduled}</TabsTrigger>
          <TabsTrigger value="resolved">{t('incidents.resolved')} · {counts.resolved}</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label={t('outages.search')}
          placeholder={t('incidents.searchPlaceholder')}
          className="h-11 w-full rounded-xl border border-input bg-card pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((index) => <Skeleton key={index} className="h-28 w-full rounded-2xl" />)}
        </div>
      ) : filteredIncidents.length === 0 ? (
        <EmptyState icon={CheckCircle2} title={t('incidents.noIncidents')} description={t('incidents.emptyDesc')} />
      ) : (
        <div className="space-y-3">
          <p className="tabular text-xs text-muted-foreground">{t('incidents.foundCount')}: {filteredIncidents.length}</p>
          {filteredIncidents.map((incident) => <IncidentCard key={incident.id} incident={incident} />)}
        </div>
      )}
    </div>
  );
};

/** Картка події: показує ДЕ (місце), ЧОМУ (причина) і КОЛИ (початок/відновлення). */
const IncidentCard: React.FC<{ incident: Incident }> = ({ incident }) => {
  const { t } = useTranslation();
  const isActive = incident.status === 'active';
  const isScheduled = incident.status === 'scheduled';
  const status = STATUS_META[incident.status];
  const severityKey = SEVERITY_KEY[incident.severity];

  return (
    <Card className={isActive ? 'border-destructive/40 bg-destructive/5' : isScheduled ? 'border-warning/40 bg-warning/5' : undefined}>
      <CardContent className="space-y-2.5 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={SEVERITY_VARIANT[incident.severity] ?? 'muted'}>
              {severityKey ? t(severityKey) : incident.severity.toUpperCase()}
            </Badge>
            {status && <Badge variant={status.variant}>{t(status.key)}</Badge>}
            <Badge variant="outline" className="gap-1">
              <Radio className="h-3 w-3" aria-hidden />
              {incident.kind === 'outage' ? t('incidents.kindOutage') : t('incidents.kindReport')}
            </Badge>
          </div>
          <span className="tabular flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" aria-hidden />
            {t('incidents.startedAt')}: {formatDateTime(incident.startedAt)}
          </span>
        </div>

        <h2 className="text-sm font-semibold text-foreground sm:text-base">{incident.title}</h2>

        <dl className="grid gap-1.5 text-xs sm:grid-cols-2">
          <div className="flex items-start gap-1.5">
            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
            <dt className="text-muted-foreground">{t('incidents.place')}:</dt>
            <dd className="font-medium text-foreground">{incident.areaName || t('incidents.placeUnknown')}</dd>
          </div>
          <div className="flex items-start gap-1.5">
            <Tag className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
            <dt className="text-muted-foreground">{t('incidents.cause')}:</dt>
            <dd className="font-medium text-foreground">{incident.reason || t('incidents.reasonUnknown')}</dd>
          </div>
        </dl>

        <p className="text-xs leading-relaxed text-foreground/80 sm:text-sm">{incident.description}</p>

        {incident.etaAt && (
          <p className="flex items-center gap-2 text-xs font-medium text-warning">
            <CalendarClock className="h-3.5 w-3.5" aria-hidden />
            {isActive ? t('incidents.etaActive') : isScheduled ? t('incidents.etaScheduled') : t('incidents.etaResolved')}:
            <span className="tabular">{formatDateTime(incident.etaAt)}</span>
          </p>
        )}

        {incident.sourceUrl && (
          <a
            href={incident.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-primary hover:underline"
          >
            {t('incidents.source')}
            <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        )}
      </CardContent>
    </Card>
  );
};
