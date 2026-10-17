import React, { useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, Info } from 'lucide-react';
import type { ScheduleIntervalUtc } from '@svitlo/shared';
import {
  clampHour,
  formatHour,
  generateTimelineSlots,
  getCurrentTimeMarker,
  getHourSummary,
} from '../../lib/timeline.js';
import { cn } from '../../lib/cn.js';

interface Timeline24hProps {
  intervals: ScheduleIntervalUtc[];
  date: string;
  now?: Date;
  className?: string;
  onHourSelect?: (hour: number) => void;
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
  onHourSelect,
}) => {
  const { t } = useTranslation();
  const timelineId = useId();
  const liveRegionId = useId();
  // Идентификатор SVG-паттерна штриховки: url(#…) не принимает символы «:» из useId().
  const hatchId = `hatch-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  // 48 півгодинних слотів доби
  const slots = useMemo(
    () => generateTimelineSlots(intervals, date, now),
    [intervals, date, now],
  );

  // Маркер поточного часу (тільки для сьогодні)
  const timeMarker = useMemo(
    () => getCurrentTimeMarker(date, now),
    [date, now],
  );

  // Поточна сфокусована або наведена година (0..23)
  const currentHourOfNow = timeMarker ? Math.floor(timeMarker.nowMinutes / 60) : 12;
  const [selectedHour, setSelectedHour] = useState<number>(currentHourOfNow);
  const [liveAnnouncement, setLiveAnnouncement] = useState<string>('');

  const hourButtonsRef = useRef<(HTMLButtonElement | null)[]>([]);

  const hourSummary = useMemo(
    () => getHourSummary(slots, selectedHour, t),
    [slots, selectedHour, t],
  );

  const handleHourFocus = (hour: number) => {
    const clamped = clampHour(hour);
    setSelectedHour(clamped);
    const summary = getHourSummary(slots, clamped, t);
    setLiveAnnouncement(summary.ariaAnnouncement);
    onHourSelect?.(clamped);
  };

  const handleKeyDown = (e: React.KeyboardEvent, currentH: number) => {
    let nextH = currentH;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      nextH = clampHour(currentH + 1);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      nextH = clampHour(currentH - 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      nextH = 0;
    } else if (e.key === 'End') {
      e.preventDefault();
      nextH = 23;
    } else {
      return;
    }

    handleHourFocus(nextH);
    hourButtonsRef.current[nextH]?.focus();
  };

  // Позначки годин для шкали часу
  const hourTicks = [0, 4, 8, 12, 16, 20, 24];

  return (
    <div className={cn('w-full max-w-full space-y-3', className)}>
      {/* Прихований aria-live регіон для екранних читачів */}
      <div
        id={liveRegionId}
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {liveAnnouncement}
      </div>

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
                  slot.isCurrent && 'ring-1 ring-inset ring-white/40',
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
          {timeMarker && (
            <span
              className="pointer-events-none absolute inset-y-0 z-10 w-0.5 -translate-x-1/2 rounded-full bg-white/85"
              style={{ left: `${timeMarker.percent}%` }}
              aria-hidden
            />
          )}
        </div>

        {/* Шар інтерактивних 24 годинних кнопок для клавіатурної та тач-навігації */}
        <div
          role="group"
          aria-label={t('timeline.hoursGroupLabel')}
          className="absolute inset-0 grid grid-cols-24"
        >
          {Array.from({ length: 24 }, (_, h) => {
            const isSelected = selectedHour === h;
            return (
              <button
                key={h}
                ref={(el) => {
                  hourButtonsRef.current[h] = el;
                }}
                type="button"
                tabIndex={isSelected ? 0 : -1}
                aria-label={t('timeline.hourAriaLabel', { hour: formatHour(h) })}
                onClick={() => handleHourFocus(h)}
                onFocus={() => handleHourFocus(h)}
                onMouseEnter={() => handleHourFocus(h)}
                onKeyDown={(e) => handleKeyDown(e, h)}
                className={cn(
                  'relative h-full w-full rounded-xl transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                  isSelected && 'bg-primary/5 ring-1 ring-inset ring-primary/40',
                )}
              />
            );
          })}
        </div>

        {/* Маркер поточного часу «Зараз» переехал внутрь шкалы (см. выше): снаружи он
            выходил за полосу и перекрывал подписи часов. */}
      </div>

      {/* Інформаційна картка обраної години */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-hairline bg-surface-container-high/50 px-3.5 py-2.5 text-xs">
        <div className="flex items-center gap-2">
          <Clock className="h-3.5 w-3.5 text-primary" strokeWidth={2.3} aria-hidden />
          <span className="font-bold text-on-surface">
            {hourSummary.label}
          </span>
          {hourSummary.isCurrent && (
            <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-on-primary">
              {t('schedule.now')} ({timeMarker?.timeFormatted})
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {hourSummary.allOff ? (
            <span className="font-semibold text-destructive">
              {t('timeline.fullOff')}
            </span>
          ) : hourSummary.hasOff ? (
            <span className="font-semibold text-destructive">
              {hourSummary.slots[0].stateCode === 3 ? hourSummary.slots[0].timeLabel : hourSummary.slots[1].timeLabel} — {t('timeline.partialOff')}
            </span>
          ) : hourSummary.slots[0].stateCode === 1 ? (
            <span className="font-semibold text-success">
              {t('timeline.fullOn')}
            </span>
          ) : (
            <span className="text-muted-foreground">
              {t('common.noData')}
            </span>
          )}
        </div>
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

        {timeMarker && (
          <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-on-surface">
              <span className="h-3.5 w-0.5 rounded-full bg-white/85" aria-hidden />
              <Clock className="h-3 w-3" strokeWidth={2.4} aria-hidden />
              {t('schedule.now')} {timeMarker.timeFormatted}
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] text-on-surface-variant">
              <Info className="h-3 w-3" strokeWidth={2.3} aria-hidden />
              {t('timeline.useArrowsHint')}
            </span>
          </span>
        )}
      </div>
    </div>
  );
};
