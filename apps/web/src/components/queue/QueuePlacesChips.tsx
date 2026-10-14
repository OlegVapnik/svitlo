import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { MapPin } from 'lucide-react';
import { cn } from '../../lib/cn.js';

export interface QueuePlacesChipsProps {
  settlements: string[];
  streetNames: string[];
  /** Сколько улиц показывать до ссылки «ещё N» (остальные — на странице /streets). */
  maxStreets?: number;
  className?: string;
}

/**
 * Чипы «что входит в эту группу» — населённые пункты и улицы выбранной области.
 *
 * Данные приходят из `settlement_queues`/`street_queues` через GET /api/v1/queues. Если источник
 * географию не отдал (сейчас так у всех областей: зеркало ГПВ отдаёт номера групп, но не районы),
 * блок не рисуется вовсе. Молчаливую догадку «наверное, это соседние районы» не показываем —
 * человек должен видеть, что привязки нет, а не выдуманную.
 */
export const QueuePlacesChips: React.FC<QueuePlacesChipsProps> = ({
  settlements,
  streetNames,
  maxStreets = 8,
  className,
}) => {
  const { t } = useTranslation();
  if (settlements.length === 0 && streetNames.length === 0) return null;

  const visibleStreets = streetNames.slice(0, maxStreets);
  const restStreets = streetNames.length - visibleStreets.length;

  return (
    <div className={cn('space-y-1.5', className)}>
      {settlements.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <MapPin className="h-3 w-3 shrink-0" aria-hidden />
            {t('queues.settlementsInGroup')}
          </span>
          {settlements.map((name) => (
            <span
              key={name}
              className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-foreground"
            >
              {name}
            </span>
          ))}
        </div>
      )}

      {streetNames.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <MapPin className="h-3 w-3 shrink-0" aria-hidden />
            {t('queues.streetsInGroup')}
          </span>
          {visibleStreets.map((name) => (
            <span
              key={name}
              className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-foreground"
            >
              {name}
            </span>
          ))}
          {restStreets > 0 && (
            <Link to="/streets" className="text-xs font-semibold text-primary hover:underline">
              {t('home.moreInStreets', { n: restStreets })}
            </Link>
          )}
        </div>
      )}
    </div>
  );
};