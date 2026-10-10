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
        <div
          role="region"
          aria-label={t('timeline.barAriaLabel', { date })}
          className="relative grid h-10 w-full grid-cols-[repeat(48,minmax(0,1fr))] gap-px overflow-hidden rounded-xl bg-border p-0.5 shadow-xs sm:h-12"
        >
          {slots.map((slot) => {
            let bgClass = 'bg-muted';
            if (slot.stateCode === 3) {
              bgClass = 'bg-destructive';
            } else if (slot.stateCode === 2) {
              bgClass = 'bg-warning';
            } else if (slot.stateCode === 1) {
              bgClass = 'bg-success';
            }

            return (
              <div
                key={slot.index}
                className={cn(
                  'h-full transition-opacity duration-150',
                  bgClass,
                  slot.isPast && 'opacity-65',
                  slot.isCurrent && 'ring-1 ring-inset ring-foreground',
                )}
                title={`${slot.rangeLabel}: ${slot.stateName}`}
              />
            );
          })}
        </div>

        {/* Шар інтерактивних 24 годинних кнопок для клавіатурної та тач-навігації */}
        <div
          role="group"
          aria-label={t('timeline.hoursGroupLabel')}
          className="absolute inset-0 grid grid-cols-[repeat(24,minmax(0,1fr))]"
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
                  'relative h-full w-full rounded-xs transition-all focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                  isSelected && 'ring-2 ring-primary ring-offset-1',
                )}
              />
            );
          })}
        </div>

        {/* Маркер поточного часу "Зараз" */}
        {timeMarker && (
          <div
            className="pointer-events-none absolute -bottom-1 -top-1 z-20 flex flex-col items-center"
            style={{ left: `${timeMarker.percent}%` }}
            aria-hidden
          >
            {/* Верхня стрілка/крапка */}
            <div className="-mt-1.5 flex items-center justify-center">
              <span className="h-3 w-3 rounded-full border-2 border-card bg-foreground shadow-xs" />
            </div>
            {/* Вертикальна лінія */}
            <div className="w-0.5 flex-1 bg-foreground shadow-xs" />
          </div>
        )}
      </div>

      {/* Інформаційна картка обраної години */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card/70 px-3 py-2 text-xs">
        <div className="flex items-center gap-2">
          <Clock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          <span className="font-bold text-foreground">
            {hourSummary.label}
          </span>
          {hourSummary.isCurrent && (
            <span className="rounded-full bg-foreground px-2 py-0.5 text-[10px] font-bold text-background">
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

      {/* Легенда станів */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5 text-xs">
        <div className="flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-foreground">
            <span className="h-2.5 w-2.5 rounded-full bg-success" />
            {t('home.heroOn')}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-foreground">
            <span className="h-2.5 w-2.5 rounded-full bg-destructive" />
            {t('home.heroOff')}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-foreground">
            <span className="h-2.5 w-2.5 rounded-full bg-muted" />
            {t('timeline.noScheduleShort')}
          </span>
        </div>

        {timeMarker && (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <Info className="h-3 w-3" aria-hidden />
            {t('timeline.useArrowsHint')}
          </span>
        )}
      </div>
    </div>
  );
};
