import React, { useId, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { ScheduleIntervalUtc } from '@svitlo/shared';
import {
  generateTimelineSlots,
} from '../../lib/timeline.js';
import { cn } from '../../lib/cn.js';

interface Timeline24hProps {
  intervals: ScheduleIntervalUtc[];
  date: string;
  now?: Date;
  className?: string;
  action?: ReactNode;
}

/**
 * Часы ночи для мягкой подсветки зон.
 *
 * Почему именно эти: ночью отключение длится дольше всего, и именно ночью человек чаще
 * всего открывает приложение. Подсветка помогает глазу сразу найти «середину» шкалы, где
 * сосредоточены красные участки, не заставляя вчитываться в подписи часов.
 */
const NIGHT_HOURS: Array<[number, number]> = [
  [23, 5],
  [0, 5],
];

const isNightHour = (hour: number): boolean => NIGHT_HOURS.some(([from, to]) => (from > to ? hour >= from || hour < to : hour >= from && hour < to));

export const Timeline24h: React.FC<Timeline24hProps> = ({
  intervals,
  date,
  now = new Date(),
  className,
  action,
}) => {
  const { t } = useTranslation();
  // Идентификатор SVG-паттерна штриховки: url(#…) не принимает символы «:» из useId().
  const hatchId = `hatch-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  // 48 півгодинних слотів доби
  const slots = useMemo(
    () => generateTimelineSlots(intervals, date, now),
    [intervals, date, now],
  );

  // Позначки годин для шкали часу
  const hourTicks = [0, 4, 8, 12, 16, 20, 24];

  return (
    <div className={cn('w-full max-w-full space-y-3', className)}>
      {/* Верхня шкала часу з мітками */}
      <div
        className="relative flex justify-between px-0.5 text-[11px] font-semibold text-muted-foreground tabular"
        aria-hidden
      >
        {hourTicks.map((h) => (
          <span key={h} className="relative select-none">
            {String(h).padStart(2, '0')}:00
          </span>
        ))}
      </div>

      {/* Головна 24-годинна горизонтальна смуга з 48 слотами */}
      <div className="relative w-full max-w-full">
        {/* Контейнер півгодинних комірок: компактний flex/grid, жодного горизонтального скролу на 360 px */}
        {/* Мягкая подложка ночных зон: четыре полосы, чтобы сетка слотов не гасила их.
            Это слой под слотами, а не поверх — иначе он перекрыл бы половины наведения. */}
        <div aria-hidden className="absolute inset-0 overflow-hidden rounded-xl">
          {Array.from({ length: 24 }, (_, hour) => (
            <span
              key={hour}
              className={cn(
                'absolute top-0 h-full',
                isNightHour(hour) ? 'bg-on-surface/[0.03]' : 'bg-transparent',
              )}
              style={{ left: `${(hour / 24) * 100}%`, width: `${100 / 24}%` }}
            />
          ))}
        </div>

        {/* Штриховка часов отключения. Векторный <pattern>, а не картинка: линии остаются
            резкими на любом DPI и берут цвет у родителя через currentColor. */}
        <svg className="absolute h-0 w-0" aria-hidden focusable="false">
          <defs>
            <pattern id={hatchId} width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1={0} y1={0} x2={0} y2={6} stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
            </pattern>
          </defs>
        </svg>

        {/* 24-часовая шкала: 48 получасовых сегментов в строгом треке. Сегменты одной высоты с
            гранью 1px и небольшим радиусом: раньше это были «капсулы»-пилюли, и на телефоне
            шкала выглядела как нитка бисера, а не как прибор. */}
        <div
          role="region"
          aria-label={t('timeline.barAriaLabel', { date })}
          className="relative grid h-9 w-full grid-cols-48 items-stretch gap-0.75 rounded-xl border border-hairline bg-surface-container-low p-1"
        >
          {slots.map((slot) => {
            // Тон сегмента: свет — спокойный изумруд, отключение — контрастный рубин со
            // штриховкой, «можливо вимкнути» — янтарь, нет графика — глухой цинк.
            const capsuleTone =
              slot.stateCode === 3
                ? 'border-rose-500/40 bg-rose-500/25'
                : slot.stateCode === 2
                  ? 'border-amber-500/30 bg-amber-500/20'
                  : slot.stateCode === 1
                    ? 'border-emerald-500/30 bg-emerald-500/20'
                    : 'border-hairline bg-surface-container-high';

            return (
              <div
                key={slot.index}
                className={cn(
                  'relative h-full overflow-hidden rounded-sm border transition-opacity duration-200',
                  capsuleTone,
                  slot.isPast && 'opacity-55',
                )}
                title={`${slot.rangeLabel}: ${slot.stateName}`}
              >
                {slot.stateCode === 3 && (
                  <svg className="absolute inset-0 h-full w-full text-rose-100/25" aria-hidden focusable="false">
                    <rect width="100%" height="100%" fill={`url(#${hatchId})`} />
                  </svg>
                )}
              </div>
            );
          })}

          {/* Линия «зараз» — только линия. Подпись «Зараз HH:MM» раньше висела белой плашкой
              ровно на шкале и закрывала сегменты: на телефоне это выглядело как дыра в графике.
              Теперь время стоит текстом в строке легенды под шкалой, а на самой шкале остаётся
              тонкая белая риска — видно, где сейчас, и ничего не перекрыто. */}
        </div>

        {/* Маркер поточного часу «Зараз» переехал внутрь шкалы (см. выше): снаружи он
            выходил за полосу и перекрывал подписи часов. */}
      </div>

      {/* Легенда станів: у відключення — та сама штриховка, що в шкалі, щоб не вигадувати
          окремий значок для того самого стану. */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5 text-xs">
        <div className="flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface-container-high px-2.5 py-1 text-[11px] font-medium text-on-surface-variant">
            <span className="h-2.5 w-2.5 rounded-full border border-emerald-500/40 bg-emerald-500/25" />
            {t('home.heroOn')}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface-container-high px-2.5 py-1 text-[11px] font-medium text-on-surface-variant">
            <svg className="h-3 w-3 text-rose-100/40" viewBox="0 0 12 12" aria-hidden focusable="false">
              <rect width="12" height="12" rx="2" fill="rgb(244 63 94 / 0.25)" stroke="rgb(244 63 94 / 0.4)" />
              <rect width="12" height="12" rx="2" fill={`url(#${hatchId})`} />
            </svg>
            {t('home.heroOff')}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface-container-high px-2.5 py-1 text-[11px] font-medium text-on-surface-variant">
            <span className="h-2.5 w-2.5 rounded-full border border-hairline bg-surface-container-high" />
            {t('timeline.noScheduleShort')}
          </span>
        </div>
        {action}
      </div>
    </div>
  );
};
