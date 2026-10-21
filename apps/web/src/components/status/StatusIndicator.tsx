import React from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, AlertTriangle, AlertOctagon, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

interface StatusIndicatorProps {
  level?: 'stable' | 'warning' | 'emergency';
  message?: string;
}

interface LevelStyle {
  wrap: string;
  icon: string;
  dot: string;
  Icon: LucideIcon;
  titleKey: string;
  messageKey: string;
}

/**
 * Большой индикатор состояния сети. Цвета — только из токенов (success/warning/destructive),
 * поэтому и светлая, и тёмная тема читаются одинаково; иконка и текст дублируют цвет.
 */
const LEVELS: Record<'stable' | 'warning' | 'emergency', LevelStyle> = {
  stable: {
    wrap: 'border-success/30 bg-success/5',
    icon: 'text-success',
    dot: 'bg-success',
    Icon: CheckCircle2,
    titleKey: 'status.titleStable',
    messageKey: 'status.messageStable',
  },
  warning: {
    wrap: 'border-warning/40 bg-warning/5',
    icon: 'text-warning',
    dot: 'bg-warning',
    Icon: AlertTriangle,
    titleKey: 'status.titleWarning',
    messageKey: 'status.messageWarning',
  },
  emergency: {
    wrap: 'border-destructive/40 bg-destructive/5',
    icon: 'text-destructive',
    dot: 'bg-destructive',
    Icon: AlertOctagon,
    titleKey: 'status.titleEmergency',
    messageKey: 'status.messageEmergency',
  },
};

export const StatusIndicator: React.FC<StatusIndicatorProps> = ({ level = 'stable', message }) => {
  const { t } = useTranslation();
  const current = LEVELS[level] ?? LEVELS.stable;
  const { Icon } = current;

  return (
    <section className={cn('rounded-2xl border p-4 sm:p-5', current.wrap)}>
      <div className="flex items-start gap-3.5">
        <span className="relative mt-1 flex h-3.5 w-3.5 shrink-0">
          <span className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-70', current.dot)} />
          <span className={cn('relative inline-flex h-3.5 w-3.5 rounded-full', current.dot)} />
        </span>

        <div className="min-w-0 flex-1 space-y-1">
          <h2 className={cn('flex items-center gap-2 text-base font-bold sm:text-lg', current.icon)}>
            <Icon className="h-5 w-5 shrink-0" aria-hidden />
            {t(current.titleKey)}
          </h2>
          {/* message приходит от оператора и не переводится — это первоисточник (см. skill, i18n). */}
          <p className="text-xs leading-relaxed text-foreground/80 sm:text-sm">
            {message || t(current.messageKey)}
          </p>
        </div>
      </div>
    </section>
  );
};
