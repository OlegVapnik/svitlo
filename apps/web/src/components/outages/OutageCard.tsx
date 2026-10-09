import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp, Clock, MapPin, AlertCircle, Users } from 'lucide-react';
import { Card, CardContent } from '../ui/Card.js';
import { Badge } from '../ui/Badge.js';
import { formatDateTime, formatTimeRange, isActive } from '../../lib/date.js';
import { outageCategory } from '../../lib/outage-location.js';
import type { Outage } from '@energy-monitor/shared';

interface OutageCardProps {
  outage: Outage;
}

export const OutageCard: React.FC<OutageCardProps> = ({ outage }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const currentlyActive = isActive(outage.startsAt, outage.endsAt);
  const isIncidentWork = outageCategory(outage.reason) === 'incident';

  const getStatusBadgeVariant = () => {
    if (currentlyActive || isIncidentWork) return 'destructive';
    switch (outage.status) {
      case 'active':
        return 'destructive';
      case 'scheduled':
        return 'warning';
      case 'finished':
        return 'secondary';
      case 'cancelled':
        return 'outline';
      default:
        return 'default';
    }
  };

  const getStatusLabel = () => {
    if (isIncidentWork) return 'Аварійні / ремонтні роботи';
    if (currentlyActive) return t('outages.active');
    return t(`outages.${outage.status}`, outage.status);
  };

  return (
    <Card className={`transition-all ${currentlyActive || isIncidentWork ? 'border-red-500/50 bg-red-500/5 shadow-md shadow-red-500/10' : 'hover:border-primary/50'}`}>
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant={getStatusBadgeVariant()} className="font-semibold">
              {getStatusLabel()}
            </Badge>
            {outage.queue && (
              <Badge variant="outline" className="flex items-center gap-1 font-mono">
                <Users className="w-3 h-3" />
                {t('outages.queue')} {outage.queue}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground whitespace-nowrap">
            <Clock className="w-3.5 h-3.5" />
            <span>{formatTimeRange(outage.startsAt, outage.endsAt)}</span>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-start gap-2">
            <MapPin className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <div className="flex-1">
              <span className="font-semibold text-foreground text-sm sm:text-base">
                {outage.areaName}
              </span>
              <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
                {formatDateTime(outage.startsAt)}
              </p>
            </div>
          </div>

          {outage.reason && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded-md p-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>{outage.reason}</span>
            </div>
          )}

          <div>
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center justify-between w-full pt-2 text-xs font-medium text-primary hover:underline cursor-pointer"
              aria-expanded={expanded}
            >
              <span>{t('outages.addresses')}</span>
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {expanded && (
              <div className="mt-2 p-2.5 bg-muted/30 rounded-md text-xs text-foreground/80 leading-relaxed max-h-40 overflow-y-auto">
                {outage.addressesNormalized || outage.addressesRaw}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};