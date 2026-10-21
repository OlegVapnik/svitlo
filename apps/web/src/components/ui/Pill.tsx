import React from 'react';
import { cn } from '../../lib/cn.js';
import { StatusDot, type NetworkState } from './StatusDot.js';

/**
 * «Пилюля» — компактная прокручиваемая карточка: закладка группы, чип области, выбор в шторке.
 *
 * Одна форма на все случаи, потому что в дизайне они должны выглядеть одинаково: круглая
 * поверхность, тонкая рамка, точка статуса слева. Высота 44px — минимум для пальца,
 * ниже нельзя (см. правило доступности в AGENTS.md и skills/frontend-ui-change).
 */
export interface PillProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Точка статуса. Если не задана — просто чип без индикатора. */
  state?: NetworkState;
  /** Мелкая подпись под названием (область, адрес). */
  subtitle?: string;
}

export const Pill: React.FC<PillProps> = ({
  state,
  subtitle,
  className,
  children,
  ...rest
}) => (
  <button
    type="button"
    className={cn(
      'inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border border-border',
      'bg-card px-3.5 py-1.5 text-left transition-colors hover:bg-card-raised',
      'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
      className,
    )}
    {...rest}
  >
    {state && <StatusDot state={state} size="sm" />}
    <span className="flex min-w-0 flex-col">
      <span className="truncate text-sm font-semibold text-foreground">{children}</span>
      {subtitle && <span className="truncate text-[11px] text-muted-foreground">{subtitle}</span>}
    </span>
  </button>
);
