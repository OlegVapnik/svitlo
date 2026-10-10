import React from 'react';
import { useTranslation } from 'react-i18next';
import type { ScheduleIntervalUtc } from '@svitlo/shared';
import { OFF_STATE_CODE, formatMinutesUk, minutesOfDay, minutesToHm, scheduleWindow } from '../../lib/scheduleWindow.js';

type Props = {
  intervals: ScheduleIntervalUtc[];
  date: string;
  now?: Date;
  /** Переопределить текст пустой полосы (по умолчанию — t('schedule.notImported')). */
  emptyLabel?: string;
  /** Показывать строку-итог под полосой. Герой главной выводит её сам, поэтому передаёт false. */
  showSummary?: boolean;
};

/** Время «до» по Киеву — границы интервалов приходят в UTC. */
function kyivHm(iso: string): string {
  return new Intl.DateTimeFormat('uk-UA', { timeZone: 'Europe/Kyiv', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

/**
 * Полоса суток 00:00–24:00 по графику очереди. Расчёт окна (что сейчас, когда следующее, сколько
 * без света за день) живёт в lib/scheduleWindow.ts: тот же расчёт использует герой главной,
 * поэтому цифры в двух блоках не могут разойтись.
 *
 * Тексты — через i18n (раньше были захардкожены по-украински и не переводились вместе с интерфейсом).
 */
export const QueueScheduleBar: React.FC<Props> = ({ intervals, date, now = new Date(), emptyLabel, showSummary = true }) => {
  const { t } = useTranslation();

  if (!intervals.length) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card/60 p-6 text-center text-sm text-muted-foreground">
        {emptyLabel ?? t('schedule.notImported')}
      </div>
    );
  }

  const { nowMinutes, current, nextInMinutes, offMinutes } = scheduleWindow(intervals, date, now);

  // В легенде — уникальные состояния. В сутках их два-три, а интервалов бывает пять и больше:
  // раньше легенда повторяла «Світло є» трижды и занимала пол-экрана на телефоне.
  const legend = intervals.reduce<Array<{ name: string; color: string }>>((acc, interval) => {
    if (!acc.some((item) => item.name === interval.stateName && item.color === interval.stateColor)) {
      acc.push({ name: interval.stateName, color: interval.stateColor });
    }
    return acc;
  }, []);

  return (
    <div className="space-y-3">
      {/* Форма полосы — как в grok: «пилюля» (rounded-full) на мягкой подложке, без рамки.
          Цвета внутри — по-прежнему из ответа оператора (interval.stateColor): подменять их
          палитрой нельзя, иначе полоса перестанет совпадать с легендой источника. */}
      <div className="relative h-10 w-full overflow-hidden rounded-full bg-muted">
        {intervals.map((interval, index) => {
          const from = minutesOfDay(interval.startsAt, date);
          const to = minutesOfDay(interval.endsAt, date);
          return (
            <div
              key={index}
              title={`${interval.stateName} ${minutesToHm(from)}–${minutesToHm(to)}`}
              style={{ left: `${(from / 1440) * 100}%`, width: `${((to - from) / 1440) * 100}%`, backgroundColor: interval.stateColor }}
              className="absolute inset-y-0"
            />
          );
        })}
        {nowMinutes != null && nowMinutes >= 0 && nowMinutes <= 1440 && (
          <div className="absolute inset-y-0 w-0.5 bg-foreground" style={{ left: `${(nowMinutes / 1440) * 100}%` }} aria-label={t('schedule.now')} />
        )}
      </div>

      {/* Разметка часов, как в grok: 00/06/12/18/24 — по ним видно, где именно на сутках окно. */}
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>24</span>
      </div>

      <div className="flex flex-wrap gap-2">
        {legend.map((item) => (
          <span key={`${item.name}-${item.color}`} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
            {item.name}
          </span>
        ))}
      </div>

      {showSummary && (
        <div className="flex flex-wrap gap-3 text-sm">
          {current?.stateCode === OFF_STATE_CODE && (
            <span className="font-medium text-destructive">{t('schedule.nowOff', { time: kyivHm(current.endsAt) })}</span>
          )}
          {nextInMinutes != null && (
            <span className="font-medium text-foreground">{t('schedule.nextOff', { time: formatMinutesUk(nextInMinutes) })}</span>
          )}
          <span className="text-muted-foreground">{t('schedule.offPerDay', { time: formatMinutesUk(offMinutes) })}</span>
        </div>
      )}
    </div>
  );
};
