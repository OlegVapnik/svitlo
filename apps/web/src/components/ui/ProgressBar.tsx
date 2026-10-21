import React from 'react';
import { cn } from '../../lib/cn.js';

/**
 * Полоса прогресса со скруглением — используется для «сколько прошло текущего
 * отключения». Значение приходит сверху (никакого состояния внутри), чтобы один и тот же
 * компонент рисовался и на главной, и в шторке.
 */
export interface ProgressBarProps {
  /** 0…100. Значения вне диапазона обрезаются: полоса не должна «уезжать» за края. */
  value: number;
  /** Цвет заполнения — токен статуса, а не literal. */
  tone?: 'success' | 'warning' | 'destructive' | 'unknown' | 'primary';
  className?: string;
  'aria-label'?: string;
}

const TONE: Record<NonNullable<ProgressBarProps['tone']>, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  destructive: 'bg-destructive',
  unknown: 'bg-unknown',
  primary: 'bg-primary',
};

export const ProgressBar: React.FC<ProgressBarProps> = ({
  value,
  tone = 'primary',
  className,
  ...rest
}) => {
  const clamped = Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));

  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn('h-2 w-full overflow-hidden rounded-full bg-muted', className)}
      {...rest}
    >
      <div
        className={cn('h-full rounded-full transition-[width] duration-500 ease-out', TONE[tone])}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
};
