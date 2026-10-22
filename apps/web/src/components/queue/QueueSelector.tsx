import React from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Layers } from 'lucide-react';
import { cn } from '../../lib/cn.js';
import { hapticTick } from '../../lib/haptics.js';
import { queueOptionsForGrid } from '../../lib/queue.js';

interface QueueSelectorProps {
  queues: string[];
  selectedQueue: string | null;
  onSelect: (queue: string) => void;
  className?: string;
  disabled?: boolean;
  /** Опціональна дія або елемент у заголовку */
  headerAction?: React.ReactNode;
  /** Приховати заголовок із підписом "Черга:" */
  hideHeader?: boolean;
}

export const QueueSelector: React.FC<QueueSelectorProps> = ({
  queues,
  selectedQueue,
  onSelect,
  className,
  disabled = false,
  headerAction,
  hideHeader = false,
}) => {
  const { t } = useTranslation();

  // Пустой список от API (холодный кеш, старый офлайн-пакет, ошибка сети) НЕ должен оставлять экран
  // без кнопок групп: сетку «1/1…6/2» показываем всегда, а сервер подставляет свой список, когда он
  // есть. Раньше здесь возвращалась надпись «черг немає», и человек не мог выбрать свою группу.
  const options = queueOptionsForGrid(queues);
  const showsFallback = options.length > (queues?.length ?? 0);

  // Якщо черг небагато (до 12, як у більшості областей), показуємо швидкі чипи,
  // а для 60 черг (як у Києві) — компактний селект зі збереженням швидкості та без захаращення екрана
  const isLargeList = options.length > 12;

  return (
    <div className={cn('space-y-2', className)}>
      {!hideHeader && (
        <div className="flex min-h-9 items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-on-surface-variant">
            <Layers className="h-3.5 w-3.5" aria-hidden />
            {t('queues.queueLabel')}:
          </span>
          {headerAction}
        </div>
      )}

      {isLargeList ? (
        <div className="relative inline-flex items-center">
          <select
            value={selectedQueue ?? options[0]}
            onChange={(e) => {
              hapticTick('select');
              onSelect(e.target.value);
            }}
            disabled={disabled}
            aria-label={t('queues.selectQueue')}
            className="min-h-11 appearance-none rounded-xl border border-hairline bg-surface-container-high py-1.5 pl-3 pr-8 text-xs font-semibold text-on-surface transition-colors hover:bg-surface-container-highest focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            {options.map((q) => (
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
          // Строгая сетка 6×2 с ячейками одной ширины и высоты: выбор читается цветом, а не
          // деформацией формы. Морфинг «пузырей» (сквирклы, сжатие при нажатии) убран совсем —
          // от него интерфейс выглядел игрушечным, а границы ячеек «плыли» при каждом тапе.
          // w-full, а не фиксированные w-78: рядом с кнопкой «У закладки» сетка сжималась
          // до ширины иконки, и 12 групп превращались в нечитаемую кашу «1/1 2/1 3/1…».
          // min-w-11 держит палец: ячейка не может стать уже цели нажатия.
          className="grid w-full min-w-0 grid-cols-6 gap-1.5"
        >
          {options.map((q) => {
            const isSelected = selectedQueue === q;
            return (
              <button
                key={q}
                type="button"
                role="radio"
                aria-checked={isSelected}
                disabled={disabled}
                onClick={() => {
                  hapticTick('select');
                  onSelect(q);
                }}
                className={cn(
                  'h-11 min-w-11 whitespace-nowrap rounded-xl border px-1 text-xs font-semibold tabular transition-colors duration-150',
                  'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
                  isSelected
                    ? 'border-transparent bg-foreground font-bold text-background shadow-sm'
                    : 'border-hairline bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface',
                  disabled && 'cursor-not-allowed opacity-50',
                )}
              >
                {q}
              </button>
            );
          })}
        </div>
      )}

      {showsFallback ? (
        // Стандартная сетка вместо списка с сервера — это не «данные региона», а шаблон ГПВ, поэтому
        // подписываем его честно: человек видит, что групп нет в ответе, но выбрать свою может.
        <p className="text-[11px] leading-tight text-muted-foreground">{t('queues.gridFallbackHint')}</p>
      ) : null}
    </div>
  );
};
