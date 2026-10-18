import React from 'react';
import { useTranslation } from 'react-i18next';
import { Users } from 'lucide-react';
import { Badge } from '../ui/Badge.js';
import { EventCard } from '../events/EventCard.js';
import { formatDateTime, formatTimeRange, isActive } from '../../lib/date.js';
import { outageCategory } from '../../lib/outage-location.js';
import { formatQueueLabel } from '../../lib/queue-label.js';
import { useRegion } from '../../hooks/useRegion.js';
import type { Outage } from '@svitlo/shared';

interface OutageCardProps {
  outage: Outage;
}

/**
 * Карточка отключения. Иерархия чтения: статус → когда → где → причина → адреса (свёрнуты).
 *
 * Вёрстка живёт в общем `EventCard` — том же, что рисует события на «Аваріях». Так одинаковые
 * по смыслу вещи (статус, время, прогресс активного окна) выглядят одинаково на обоих экранах,
 * а не двумя разными наборами бейджей.
 *
 * Аварийные и ремонтные работы выделены красным фоном-подсветкой, но статус дублируется текстом
 * в бейдже — цвет не единственный сигнал (skills/frontend-ui-change, accessibility).
 */
export const OutageCard: React.FC<OutageCardProps> = ({ outage }) => {
  const { t } = useTranslation();
  const { currentRegionData } = useRegion();

  const currentlyActive = isActive(outage.startsAt, outage.endsAt);
  const isIncidentWork = outageCategory(outage.reason) === 'incident';
  const highlight = currentlyActive || isIncidentWork;

  const statusLabel = isIncidentWork
    ? t('incidents.kindOutage')
    : currentlyActive
      ? t('outages.active')
      : t(`outages.${outage.status}`, outage.status);

  const badgeVariant = isIncidentWork || currentlyActive
    ? ('destructive' as const)
    : outage.status === 'scheduled'
      ? ('warning' as const)
      : outage.status === 'finished'
        ? ('muted' as const)
        : outage.status === 'cancelled'
          ? ('outline' as const)
          : ('default' as const);

  const addresses = outage.addressesNormalized || outage.addressesRaw || null;

  return (
    <EventCard
      tone={highlight ? 'active' : outage.status === 'scheduled' ? 'scheduled' : 'none'}
      badges={
        <>
          {outage.kind === 'group' ? <Badge variant="info">{t('outages.bySchedule')}</Badge> : null}
          <Badge variant={badgeVariant}>{statusLabel}</Badge>
          {outage.group ? (
            <Badge variant="outline" className="tabular">
              <Users className="h-3 w-3" aria-hidden />
              {formatQueueLabel(outage.group, currentRegionData.cpu)}
            </Badge>
          ) : outage.queue != null ? (
            <Badge variant="outline" className="font-mono tabular">
              <Users className="h-3 w-3" aria-hidden />
              {t('outages.queue')} {outage.queue}
            </Badge>
          ) : null}
        </>
      }
      timeLabel={formatTimeRange(outage.startsAt, outage.endsAt)}
      place={{ name: outage.areaName, secondary: formatDateTime(outage.startsAt) }}
      window={{ startsAt: outage.startsAt, endsAt: outage.endsAt, active: currentlyActive }}
      reason={outage.reason}
      addresses={addresses}
    />
  );
};
