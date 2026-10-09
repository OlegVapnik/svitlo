import React from 'react';
import type { ScheduleIntervalUtc } from '@energy-monitor/shared';

type Props = {
  intervals: ScheduleIntervalUtc[];
  date: string;
  now?: Date;
  emptyLabel?: string;
};

function kyivOffset(date: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Kyiv', timeZoneName: 'shortOffset' });
  const part = formatter.formatToParts(new Date(`${date}T12:00:00Z`)).find((item) => item.type === 'timeZoneName')?.value ?? 'GMT+2';
  return part.endsWith('+3') ? 180 : 120;
}

function minutesOfDay(iso: string, date: string): number {
  const offsetMin = kyivOffset(date);
  const value = (Date.parse(iso) - Date.parse(`${date}T00:00:00Z`) + offsetMin * 60_000) / 60_000;
  return Math.max(0, Math.min(24 * 60, Math.round(value)));
}

export const QueueScheduleBar: React.FC<Props> = ({ intervals, date, now = new Date(), emptyLabel = 'Графік не імпортовано' }) => {
  if (!intervals.length) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card/60 p-6 text-center text-sm text-muted-foreground">
        {emptyLabel}
      </div>
    );
  }

  const dayStartUtcMs = Date.parse(`${date}T00:00:00Z`) - kyivOffset(date) * 60_000;
  const nowMinutes = now.getTime() >= dayStartUtcMs && now.getTime() < dayStartUtcMs + 24 * 60 * 60_000
    ? (now.getTime() - dayStartUtcMs) / 60_000
    : null;
  const totalOff = intervals
    .filter((interval) => interval.stateCode === 3)
    .reduce((sum, interval) => sum + minutesOfDay(interval.endsAt, date) - minutesOfDay(interval.startsAt, date), 0);

  const nextOutage = intervals.find((interval) => interval.stateCode === 3 && minutesOfDay(interval.startsAt, date) > (nowMinutes ?? -1));
  const nextInRaw = nextOutage && nowMinutes != null ? minutesOfDay(nextOutage.startsAt, date) - nowMinutes : null;
  // Округлюємо до цілих хвилин — інакше в UI потрапляє «через 4 год 30.13751666666667 хв».
  const nextIn = nextInRaw != null ? Math.max(0, Math.round(nextInRaw)) : null;

  const current = intervals.find((interval) => nowMinutes != null && minutesOfDay(interval.startsAt, date) <= nowMinutes && nowMinutes < minutesOfDay(interval.endsAt, date));

  return (
    <div className="space-y-3">
      <div className="relative h-12 w-full overflow-hidden rounded-lg border border-border bg-muted/40">
        {intervals.map((interval, index) => {
          const from = minutesOfDay(interval.startsAt, date);
          const to = minutesOfDay(interval.endsAt, date);
          return (
            <div
              key={index}
              title={`${interval.stateName} ${String(Math.floor(from / 60)).padStart(2, '0')}:${String(from % 60).padStart(2, '0')}–${String(Math.floor(to / 60)).padStart(2, '0')}:${String(to % 60).padStart(2, '0')}`}
              style={{ left: `${(from / 1440) * 100}%`, width: `${((to - from) / 1440) * 100}%`, backgroundColor: interval.stateColor }}
              className="absolute inset-y-0"
            />
          );
        })}
        {nowMinutes != null && nowMinutes >= 0 && nowMinutes <= 1440 && (
          <div className="absolute inset-y-0 w-0.5 bg-foreground" style={{ left: `${(nowMinutes / 1440) * 100}%` }} aria-label="Зараз" />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>00:00</span>
        <span className="ml-auto">24:00</span>
      </div>

      <div className="flex flex-wrap gap-2">
        {intervals.map((interval, index) => (
          <span key={index} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: interval.stateColor }} />
            {interval.stateName}
          </span>
        ))}
      </div>

      <div className="flex flex-wrap gap-3 text-sm">
        {current?.stateCode === 3 && (
          <span className="font-medium text-red-600 dark:text-red-400">Зараз відключення — до {new Intl.DateTimeFormat('uk-UA', { timeZone: 'Europe/Kyiv', hour: '2-digit', minute: '2-digit' }).format(new Date(current.endsAt))}</span>
        )}
        {nextIn != null && nextIn >= 0 && (
          <span className="font-medium text-foreground">
            Наступне відключення через {nextIn >= 60 ? `${Math.floor(nextIn / 60)} год ${nextIn % 60} хв` : `${nextIn} хв`}
          </span>
        )}
        <span className="text-muted-foreground">Без світла за день: {Math.floor(totalOff / 60)} год {totalOff % 60} хв</span>
      </div>
    </div>
  );
};
