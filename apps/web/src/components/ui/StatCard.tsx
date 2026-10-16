import * as React from 'react';
import { Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

export type StatTone = 'neutral' | 'danger' | 'warning' | 'success' | 'info';

const TONE_TILE: Record<StatTone, string> = {
  neutral: 'bg-muted text-muted-foreground',
  danger: 'bg-destructive/10 text-destructive',
  warning: 'bg-warning/10 text-warning',
  success: 'bg-success/10 text-success',
  info: 'bg-info/10 text-info',
};

const TONE_VALUE: Record<StatTone, string> = {
  neutral: 'text-foreground',
  danger: 'text-destructive',
  warning: 'text-warning',
  success: 'text-success',
  info: 'text-info',
};

export interface StatCardProps {
  label: string;
  value: React.ReactNode;
  icon: LucideIcon;
  tone?: StatTone;
  hint?: string;
  /** Если задан — карточка становится ссылкой (всё, что выглядит кликабельным, должно быть ссылкой). */
  to?: string;
  isLoading?: boolean;
}

/**
 * Метрика-плитка: иконка-тон + крупное число + подпись. Используется на главной,
 * чтобы активные/запланированные/аварии читались одним взглядом при слабом свете.
 */
export function StatCard({ label, value, icon: Icon, tone = 'neutral', hint, to, isLoading }: StatCardProps) {
  const body = (
    <>
      <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', TONE_TILE[tone])}>
        <Icon className="h-5 w-5" aria-hidden />
      </div>
      <div className="min-w-0">
        <div className={cn('tabular text-2xl font-bold leading-none', TONE_VALUE[tone])}>
          {isLoading ? <span className="inline-block h-6 w-10 animate-pulse rounded-md bg-muted" /> : value}
        </div>
        <div className="mt-1 truncate text-xs font-medium text-muted-foreground">{label}</div>
        {hint && <div className="mt-0.5 truncate text-[11px] text-muted-foreground/80">{hint}</div>}
      </div>
    </>
  );

  const className = cn(
    // Плитка-метрика: собраный радиус 16px, тонкая грань и верхний блик вместо тени.
    'flex items-center gap-3 rounded-2xl border border-border bg-card p-4 transition-colors duration-200',
    to && 'hover:border-primary/40 hover:bg-surface-container-high active:scale-[0.99]',
  );

  if (to) {
    return (
      <Link to={to} className={className}>
        {body}
      </Link>
    );
  }
  return <div className={className}>{body}</div>;
}
