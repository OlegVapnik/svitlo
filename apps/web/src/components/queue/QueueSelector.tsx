import React from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, Layers } from 'lucide-react';
import { cn } from '../../lib/cn.js';

interface QueueSelectorProps {
  queues: string[];
  selectedQueue: string | null;
  onSelect: (queue: string) => void;
  className?: string;
  disabled?: boolean;
}

export const QueueSelector: React.FC<QueueSelectorProps> = ({
  queues,
  selectedQueue,
  onSelect,
  className,
  disabled = false,
}) => {
  const { t } = useTranslation();

  if (queues.length === 0) {
    return (
      <div className={cn('inline-flex items-center gap-2 rounded-xl border border-dashed border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground', className)}>
        <Layers className="h-3.5 w-3.5" aria-hidden />
        {t('queues.noQueuesForRegion')}
      </div>
    );
  }

  // Якщо черг небагато (до 12, як у більшості областей), показуємо швидкі чипи,
  // а для 60 черг (як у Києві) — компактний селект зі збереженням швидкості та без захаращення екрана
  const isLargeList = queues.length > 12;

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <Layers className="h-3.5 w-3.5" aria-hidden />
        {t('queues.queueLabel')}:
      </span>

      {isLargeList ? (
        <div className="relative inline-flex items-center">
          <select
            value={selectedQueue ?? queues[0]}
            onChange={(e) => onSelect(e.target.value)}
            disabled={disabled}
            aria-label={t('queues.selectQueue')}
            className="min-h-11 appearance-none rounded-2xl border border-outline-variant/70 bg-surface-container py-1.5 pl-3 pr-8 text-xs font-bold text-on-surface transition-colors hover:bg-surface-container-high focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            {queues.map((q) => (
              <option key={q} value={q}>
                {t('home.heroQueue', { queue: q })}
              </option>
            ))}
          </select>
          <ChevronDown
            className="pointer-events-none absolute right-2.5 h-3.5 w-3.5 text-muted-foreground"
            aria-hidden
          />
        </div>
      ) : (
        <div
          role="radiogroup"
          aria-label={t('queues.queueLabel')}
          className="flex flex-wrap gap-1.5"
        >
          {queues.map((q) => {
            const isSelected = selectedQueue === q;
            return (
              <button
                key={q}
                type="button"
                role="radio"
                aria-checked={isSelected}
                disabled={disabled}
                onClick={() => onSelect(q)}
                className={cn(
                  // Морфинг формы M3 Expressive: в покое — пухлый сквиркл (22px), при нажатии
                  // форма сжимается почти до квадрата, у выбранной группы — капсула с отскоком.
                  // Форма сообщает выбор раньше, чем человек прочитал номер черги.
                  'inline-flex min-h-11 min-w-11 items-center justify-center gap-1 px-3 py-1 text-xs font-bold tabular',
                  'transition-[border-radius,background-color,color,transform,box-shadow] duration-200 ease-[var(--ease-m3-expressive-fast)]',
                  'active:scale-[0.92] active:rounded-[10px]',
                  'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                  isSelected
                    ? 'rounded-full bg-primary text-on-primary shadow-lg'
                    : 'rounded-[22px] border border-outline-variant/70 bg-surface-container text-on-surface hover:bg-surface-container-high',
                )}
              >
                {isSelected && <Check className="h-3.5 w-3.5" strokeWidth={2.8} aria-hidden />}
                {q}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
