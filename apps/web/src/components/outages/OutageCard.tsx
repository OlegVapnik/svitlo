import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp, Clock, MapPin, AlertCircle, Users } from 'lucide-react';
import { Card, CardContent } from '../ui/Card.js';
import { Badge } from '../ui/Badge.js';
import { cn } from '../../lib/cn.js';
import { formatDateTime, formatTimeRange, isActive } from '../../lib/date.js';
import { outageCategory } from '../../lib/outage-location.js';
import type { Outage } from '@energy-monitor/shared';

interface OutageCardProps {
  outage: Outage;
}

/**
 * Карточка отключения. Иерархия чтения: статус → когда → где → причина → адреса (свёрнуты).
 * Аварийные и ремонтные работы выделены красным фоном-подсветкой, но статус дублируется текстом
 * в бейдже — цвет не единственный сигнал (skills/frontend-ui-change, accessibility).
 */
export const OutageCard: React.FC<OutageCardProps> = ({ outage }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const currentlyActive = isActive(outage.startsAt, outage.endsAt);
  const isIncidentWork = outageCategory(outage.reason) === 'incident';
  const highlight = currentlyActive || isIncidentWork;

  const badgeVariant = (() => {
    if (highlight) return 'destructive' as const;
    switch (outage.status) {
      case 'active':
        return 'destructive' as const;
      case 'scheduled':
        return 'warning' as const;
      case 'finished':
        return 'muted' as const;
      case 'cancelled':
        return 'outline' as const;
      default:
        return 'default' as const;
    }
  })();

  const statusLabel = isIncidentWork
    ? t('incidents.kindOutage')
    : currentlyActive
      ? t('outages.active')
      : t(`outages.${outage.status}`, outage.status);

  return (
    <Card className={cn('overflow-hidden transition-colors', highlight ? 'border-destructive/40 bg-destructive/5' : 'hover:border-primary/40')}>
      <CardContent className="space-y-2.5 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant={badgeVariant}>{statusLabel}</Badge>
            {outage.queue != null && (
              <Badge variant="outline" className="font-mono tabular">
                <Users className="h-3 w-3" aria-hidden />
                {t('outages.queue')} {outage.queue}
              </Badge>
            )}
          </div>
          <div className="tabular flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" aria-hidden />
            <span>{formatTimeRange(outage.startsAt, outage.endsAt)}</span>
          </div>
        </div>

        <div className="flex items-start gap-2">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-foreground sm:text-base">{outage.areaName}</div>
            <div className="tabular text-xs text-muted-foreground">{formatDateTime(outage.startsAt)}</div>
          </div>
        </div>

        {outage.reason && (
          <div className="flex items-start gap-2 rounded-lg bg-muted/50 px-2.5 py-2 text-xs text-muted-foreground">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="leading-relaxed">{outage.reason}</span>
          </div>
        )}

        <div>
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            className="flex min-h-[44px] w-full items-center justify-between gap-2 text-xs font-semibold text-primary hover:underline"
          >
            <span>{t('outages.addresses')}</span>
            {expanded ? <ChevronUp className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />}
          </button>

          {expanded && (
            <div className="max-h-40 overflow-y-auto rounded-lg bg-muted/30 p-2.5 text-xs leading-relaxed text-foreground/80">
              {outage.addressesNormalized || outage.addressesRaw}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
