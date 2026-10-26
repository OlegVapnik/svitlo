import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight, TriangleAlert, X } from 'lucide-react';
import type { Incident } from '@svitlo/shared';

interface IncidentBannerProps {
  incident: Incident;
}

/**
 * Баннер активной аварии. Токен destructive вместо жёсткого bg-red-500 (в тёмной теме он слепил),
 * и своя анимация вместо классов tailwindcss-animate, которого в проекте нет (они ничего не рисовали).
 */
export const IncidentBanner: React.FC<IncidentBannerProps> = ({ incident }) => {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <div
      role="alert"
      className="flex animate-rise items-start justify-between gap-3 rounded-2xl bg-destructive p-3.5 text-destructive-foreground shadow-pop sm:items-center"
    >
      <div className="flex items-start gap-3 sm:items-center">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-background/20 sm:mt-0">
          <TriangleAlert className="h-5 w-5" aria-hidden />
        </span>
        <div className="space-y-0.5">
          <div className="text-xs font-bold uppercase tracking-wide sm:text-sm">{incident.title}</div>
          <div className="line-clamp-2 text-xs text-destructive-foreground/90 sm:line-clamp-none">
            {incident.description}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <Link
          to="/monitor"
          className="flex min-h-11 items-center gap-1 whitespace-nowrap text-xs font-bold underline underline-offset-2"
        >
          <span>{t('common.details')}</span>
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label={t('common.dismiss')}
          className="flex h-11 w-11 items-center justify-center rounded-xl transition-colors hover:bg-background/20"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
};
