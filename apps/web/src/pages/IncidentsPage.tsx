import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  Clock,
  CheckCircle2,
  CalendarClock,
  MapPin,
  Tag,
  ExternalLink,
  Search,
  Radio,
} from 'lucide-react';
import { Card, CardContent } from '../components/ui/Card.js';
import { Badge } from '../components/ui/Badge.js';
import { Skeleton } from '../components/ui/Skeleton.js';
import { EmptyState } from '../components/common/EmptyState.js';
import { formatDateTime } from '../lib/date.js';
import { useIncidents } from '../api/queries.js';
import type { Incident } from '@energy-monitor/shared';

const SEVERITY_LABELS: Record<string, string> = {
  critical: 'Критична',
  high: 'Висока',
  medium: 'Середня',
  low: 'Низька',
};

const getSeverityBadgeVariant = (severity: string) => {
  switch (severity) {
    case 'critical':
      return 'destructive' as const;
    case 'high':
      return 'warning' as const;
    case 'medium':
      return 'default' as const;
    case 'low':
      return 'secondary' as const;
    default:
      return 'outline' as const;
  }
};

export const IncidentsPage: React.FC = () => {
  const { t } = useTranslation();
  const { data: incidentsResponse, isLoading } = useIncidents();
  const [filter, setFilter] = useState<'all' | 'active' | 'scheduled' | 'resolved'>('all');
  const [query, setQuery] = useState('');

  const incidents = incidentsResponse?.data || [];
  const activeCount = incidents.filter((incident) => incident.status === 'active').length;
  const scheduledCount = incidents.filter((incident) => incident.status === 'scheduled').length;
  const resolvedCount = incidents.filter((incident) => incident.status !== 'active' && incident.status !== 'scheduled').length;

  const filteredIncidents = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('uk-UA');
    return incidents.filter((incident) => {
      if (filter === 'active' && incident.status !== 'active') return false;
      if (filter === 'scheduled' && incident.status !== 'scheduled') return false;
      if (filter === 'resolved' && incident.status !== 'resolved') return false;
      if (!needle) return true;
      const haystack = [incident.title, incident.description, incident.areaName, incident.reason]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase('uk-UA');
      return haystack.includes(needle);
    });
  }, [incidents, filter, query]);

  return (
    <div className="space-y-4 max-w-4xl mx-auto pb-16 md:pb-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
          {t('incidents.title', 'Аварії та ремонтні роботи')}
        </h1>
        <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
          Де саме й чому зникло світло: аварійні та ремонтні відключення з даних оператора та повідомлень
          по Чернігівській і Сумській областях.
        </p>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2">
        <button
          onClick={() => setFilter('all')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            filter === 'all'
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground hover:bg-muted/80'
          }`}
        >
          Всі ({incidents.length})
        </button>
        <button
          onClick={() => setFilter('active')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            filter === 'active'
              ? 'bg-red-500 text-white'
              : 'bg-muted text-muted-foreground hover:bg-muted/80'
          }`}
        >
          Тривають ({activeCount})
        </button>
        <button
          onClick={() => setFilter('scheduled')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            filter === 'scheduled'
              ? 'bg-amber-500 text-white'
              : 'bg-muted text-muted-foreground hover:bg-muted/80'
          }`}
        >
          Заплановані ({scheduledCount})
        </button>
        <button
          onClick={() => setFilter('resolved')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            filter === 'resolved'
              ? 'bg-emerald-600 text-white'
              : 'bg-muted text-muted-foreground hover:bg-muted/80'
          }`}
        >
          Усунені ({resolvedCount})
        </button>
      </div>

      {/* Пошук за місцем / причиною / текстом */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Пошук за місцем, причиною або текстом…"
          className="h-9 w-full pl-9 pr-3 rounded-lg border border-border bg-card text-xs text-foreground focus:ring-1 focus:ring-primary"
        />
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      ) : filteredIncidents.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title={t('incidents.noIncidents', 'Активних аварій немає')}
          description="Немає збережених у системі повідомлень про аварії чи ремонтні роботи. Це не є підтвердженням штатної роботи всіх ліній."
        />
      ) : (
        <div className="space-y-3">
          {filteredIncidents.map((incident) => (
            <IncidentCard key={incident.id} incident={incident} />
          ))}
        </div>
      )}
    </div>
  );
};

const STATUS_META: Record<string, { label: string; variant: 'destructive' | 'warning' | 'secondary' | 'outline' }> = {
  active: { label: 'Триває', variant: 'destructive' },
  scheduled: { label: 'Заплановано', variant: 'warning' },
  resolved: { label: 'Усунено', variant: 'secondary' },
};

/** Картка події: показує ДЕ (місце), ЧОМУ (причина) і КОЛИ (початок/відновлення). */
const IncidentCard: React.FC<{ incident: Incident }> = ({ incident }) => {
  const isActive = incident.status === 'active';
  const isOutageData = incident.kind === 'outage';
  const statusMeta = STATUS_META[incident.status] ?? { label: incident.status, variant: 'outline' as const };

  return (
    <Card
      className={`transition-all ${
        isActive
          ? 'border-red-500/40 bg-red-500/5'
          : incident.status === 'scheduled'
            ? 'border-amber-500/30 bg-amber-500/5'
            : 'border-border bg-card'
      }`}
    >
      <CardContent className="p-4 sm:p-5 space-y-2.5">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant={getSeverityBadgeVariant(incident.severity)}>
              {SEVERITY_LABELS[incident.severity] ?? incident.severity.toUpperCase()}
            </Badge>
            <Badge variant={statusMeta.variant}>
              {statusMeta.label}
            </Badge>
            <Badge variant="outline" className="flex items-center gap-1">
              <Radio className="w-3 h-3" />
              {isOutageData ? 'Дані оператора' : 'Повідомлення'}
            </Badge>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="w-3.5 h-3.5" />
            <span>Початок: {formatDateTime(incident.startedAt)}</span>
          </div>
        </div>

        <h3 className="font-semibold text-sm sm:text-base text-foreground">{incident.title}</h3>

        <div className="grid gap-1.5 sm:grid-cols-2">
          <div className="flex items-start gap-1.5 text-xs">
            <MapPin className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
            <span className="text-muted-foreground">Місце:</span>
            <span className="font-medium text-foreground">{incident.areaName || 'не вказано'}</span>
          </div>
          <div className="flex items-start gap-1.5 text-xs">
            <Tag className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
            <span className="text-muted-foreground">Причина:</span>
            <span className="font-medium text-foreground">{incident.reason || 'не вказана'}</span>
          </div>
        </div>

        <p className="text-xs sm:text-sm text-foreground/80 leading-relaxed">{incident.description}</p>

        {incident.etaAt && (
          <div className="flex items-center gap-2 pt-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
            <CalendarClock className="w-3.5 h-3.5" />
            <span>
              {incident.status === 'active'
                ? 'Орієнтовне відновлення'
                : incident.status === 'scheduled'
                  ? 'Заплановано до'
                  : 'Завершено'}
              : {formatDateTime(incident.etaAt)}
            </span>
          </div>
        )}

        {incident.sourceUrl && (
          <a
            href={incident.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <span>Першоджерело</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </CardContent>
    </Card>
  );
};