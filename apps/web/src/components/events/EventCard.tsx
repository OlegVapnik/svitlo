import React, { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Clock,
  ExternalLink,
  MapPin,
  type LucideIcon,
} from 'lucide-react';
import { Card, CardContent } from '../ui/Card.js';
import { WavyProgressBar } from '../ui/WavyProgressBar.js';
import { cn } from '../../lib/cn.js';
import { formatMinutesUk } from '../../lib/scheduleWindow.js';
import { useWindowProgress } from '../../hooks/useWindowProgress.js';

export interface EventCardDetail {
  icon: LucideIcon;
  label: string;
  value: string;
}

export interface EventCardProps {
  /** Подсветка карточки: активное окно — красная, запланированное — янтарная. */
  tone?: 'active' | 'scheduled' | 'none';
  /** Статусные бейджи события: статус, тип, очередь. */
  badges: ReactNode;
  /** Время в правом верхнем углу: диапазон окна или «Початок: …». */
  timeLabel: string;
  title?: string | null;
  place: { name: string; secondary?: string };
  /** Активное окно для прогресса «минуло / залишилось». */
  window?: { startsAt: string; endsAt: string; active: boolean } | null;
  description?: string | null;
  reason?: string | null;
  /** Метаданные события (місце, причина и т.п.) — без дублирования вёрстки на страницах. */
  details?: EventCardDetail[];
  /** Адреса: раскрываются, только если источник их реально отдал. */
  addresses?: string | null;
  sourceUrl?: string | null;
  footer?: ReactNode;
}

/**
 * Единая карточка события для «Відключень» и «Аварій».
 *
 * ЗАЧЕМ ОБЩИЙ КОМПОНЕНТ. Раньше `OutageCard` и карточка `IncidentsPage` рисовали статус, время,
 * место и причину каждый по-своему: одинаковые по смыслу события выглядели как два разных
 * приложения. Здесь одна иерархия чтения — статус → когда → где → причина → адреса, одни и те
 * же бейджи и один прогресс-бар.
 *
 * ЦВЕТ НЕ ЕДИНСТВЕННЫЙ СИГНАЛ: состояние всегда продублировано текстом в бейдже (a11y).
 */
export const EventCard: React.FC<EventCardProps> = ({
  tone = 'none',
  badges,
  timeLabel,
  title,
  place,
  window,
  description,
  reason,
  details,
  addresses,
  sourceUrl,
  footer,
}) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const progress = useWindowProgress(
    window?.startsAt ?? '',
    window?.endsAt ?? '',
    Boolean(window?.active),
  );

  return (
    <Card
      className={cn(
        'overflow-hidden transition-colors',
        tone === 'active'
          ? 'border-destructive/40 bg-destructive/5'
          : tone === 'scheduled'
            ? 'border-warning/40 bg-warning/5'
            : 'hover:border-primary/40',
      )}
    >
      <CardContent className="space-y-2.5 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">{badges}</div>
          <div className="tabular flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" aria-hidden />
            <span>{timeLabel}</span>
          </div>
        </div>

        {title ? <h2 className="text-sm font-semibold text-foreground sm:text-base">{title}</h2> : null}

        <div className="flex items-start gap-2">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-foreground sm:text-base">{place.name}</div>
            {place.secondary ? (
              <div className="tabular text-xs text-muted-foreground">{place.secondary}</div>
            ) : null}
          </div>
        </div>

        {progress && window ? (
          <WavyProgressBar
            progress={progress.progress}
            tone="off"
            elapsedLabel={t('home.waveElapsed', { time: formatMinutesUk(progress.elapsedMinutes) })}
            remainingLabel={t('home.waveRemaining', { time: formatMinutesUk(progress.remainingMinutes) })}
            aria-label={t('outages.active')}
          />
        ) : null}

        {details && details.length > 0 ? (
          <dl className="grid gap-1.5 text-xs sm:grid-cols-2">
            {details.map(({ icon: Icon, label, value }) => (
              <div key={label} className="flex items-start gap-1.5">
                <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                <dt className="text-muted-foreground">{label}:</dt>
                <dd className="font-medium text-foreground">{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        {description ? (
          <p className="text-xs leading-relaxed text-foreground/80 sm:text-sm">{description}</p>
        ) : null}

        {reason ? (
          <div className="flex items-start gap-2 rounded-lg bg-muted/50 px-2.5 py-2 text-xs text-muted-foreground">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="leading-relaxed">{reason}</span>
          </div>
        ) : null}

        {footer}

        {addresses ? (
          <div>
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              aria-expanded={expanded}
              className="flex min-h-11 w-full items-center justify-between gap-2 text-xs font-semibold text-primary hover:underline"
            >
              <span>{t('outages.addresses')}</span>
              {expanded ? (
                <ChevronUp className="h-4 w-4" aria-hidden />
              ) : (
                <ChevronDown className="h-4 w-4" aria-hidden />
              )}
            </button>

            {expanded ? (
              <div className="max-h-40 overflow-y-auto rounded-lg bg-muted/30 p-2.5 text-xs leading-relaxed text-foreground/80">
                {addresses}
              </div>
            ) : null}
          </div>
        ) : null}

        {sourceUrl ? (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-primary hover:underline"
          >
            {t('incidents.source')}
            <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        ) : null}
      </CardContent>
    </Card>
  );
};
