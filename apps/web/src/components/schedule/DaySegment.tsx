import React from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/cn.js';
import { hapticTick } from '../../lib/haptics.js';

/**
 * Переключатель «Сьогодні / Завтра» над шкалой 24 часа.
 *
 * Почему не радиокнопки и не табы, а две крупные кнопки: это самый частый переход на
 * главной (спросить «а завтра?»), и он должен стоять одно касание от шкалы. Радиокнопки
 * визуально мельчат, а полноценный tablist с ролями здесь избыточен — это не навигация
 * по разделам, а выбор одного из двух наборов данных, поэтому роль группы честнее.
 *
 * Высота 44px: палец, а не курсор.
 */
export interface DaySegmentProps {
  /** Ключ выбранного дня: YYYY-MM-DD. */
  value: string;
  /** Подписи дней для активного и соседнего. */
  today: string;
  tomorrow: string;
  onChange: (date: string) => void;
  className?: string;
}

export const DaySegment: React.FC<DaySegmentProps> = ({ value, today, tomorrow, onChange, className }) => {
  const { t } = useTranslation();

  return (
    <div
      role="group"
      aria-label={t('timeline.daySegmentLabel')}
      className={cn('inline-flex rounded-full border border-border bg-card p-0.5', className)}
    >
      <button
        type="button"
        aria-pressed={value === 'today'}
        onClick={() => {
          hapticTick('select');
          onChange('today');
        }}
        className={cn(
          'min-h-11 rounded-full px-4 text-sm font-semibold transition-colors',
          value === 'today'
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:bg-muted',
        )}
      >
        {today}
      </button>
      <button
        type="button"
        aria-pressed={value === 'tomorrow'}
        onClick={() => {
          hapticTick('select');
          onChange('tomorrow');
        }}
        className={cn(
          'min-h-11 rounded-full px-4 text-sm font-semibold transition-colors',
          value === 'tomorrow'
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:bg-muted',
        )}
      >
        {tomorrow}
      </button>
    </div>
  );
};
