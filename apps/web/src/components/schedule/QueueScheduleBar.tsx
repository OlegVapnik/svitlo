import React, { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock } from 'lucide-react';
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
  // Идентификатор SVG-паттерна: url(#…) не принимает «:» из useId().
  const hatchId = `queue-hatch-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  if (!intervals.length) {
    return (
      <div className="rounded-[22px] bg-surface-container-high/60 p-6 text-center text-sm text-on-surface-variant">
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
    <div className="space-y-2.5">
      {/* Полоса суток: капсулы внутри тонального трека. Цвета сегментов — по-прежнему из ответа
          оператора (interval.stateColor): подменять их палитрой нельзя, иначе полоса перестанет
          совпадать с легендой источника. Часы отключения получают векторную штриховку — их видно
          и на цветном экране при дальтонизме, и в чёрно-белой печати. */}
      <div className="relative h-11 w-full overflow-hidden rounded-[22px] bg-surface-container p-1">
        <svg className="absolute h-0 w-0" aria-hidden focusable="false">
          <defs>
            <pattern id={hatchId} width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1={0} y1={0} x2={0} y2={6} stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
            </pattern>
          </defs>
        </svg>

        {intervals.map((interval, index) => {
          const from = minutesOfDay(interval.startsAt, date);
          const to = minutesOfDay(interval.endsAt, date);
          return (
            <div
              key={index}
              title={`${interval.stateName} ${minutesToHm(from)}–${minutesToHm(to)}`}
              style={{ left: `${(from / 1440) * 100}%`, width: `${((to - from) / 1440) * 100}%`, backgroundColor: interval.stateColor }}
              className="absolute inset-y-1 overflow-hidden rounded-lg"
            >
              {interval.stateCode === OFF_STATE_CODE && (
                <svg className="absolute inset-0 h-full w-full text-on-surface/45" aria-hidden focusable="false">
                  <rect width="100%" height="100%" fill={`url(#${hatchId})`} />
                </svg>
              )}
            </div>
          );
        })}

        {/* Пин «Зараз HH:MM»: единственная подвижная точка полосы, поэтому у него есть подпись
            и иконка часов — искать бегунок глазами не приходится. */}
        {nowMinutes != null && nowMinutes >= 0 && nowMinutes <= 1440 && (
          <>
            <span
              className="pointer-events-none absolute inset-y-0 z-10 w-0.5 -translate-x-1/2 rounded-full bg-primary shadow-[0_0_8px_currentColor]"
              style={{ left: `${(nowMinutes / 1440) * 100}%` }}
              aria-hidden
            />
            <span
              className="pointer-events-none absolute top-1/2 z-20 inline-flex -translate-x-1/2 -translate-y-1/2 animate-pin-in items-center gap-1 rounded-full bg-primary px-2 py-1 text-[10px] font-bold leading-none text-on-primary shadow-lg"
              style={{ left: `${(nowMinutes / 1440) * 100}%` }}
              aria-label={t('schedule.now')}
            >
              <Clock className="h-3 w-3" strokeWidth={2.6} aria-hidden />
              {t('schedule.now')} {minutesToHm(nowMinutes)}
            </span>
          </>
        )}
      </div>

      {/* Разметка часов: 00/06/12/18/24 — по ним видно, где именно на сутках окно. */}
      <div className="flex justify-between px-1 text-[11px] font-semibold text-on-surface-variant tabular">
        <span>00:00</span>
        <span>06:00</span>
        <span>12:00</span>
        <span>18:00</span>
        <span>24:00</span>
      </div>

      <div className="flex flex-wrap gap-2">
        {legend.map((item) => (
          <span
            key={`${item.name}-${item.color}`}
            className="inline-flex items-center gap-1.5 rounded-full bg-surface-container-high/60 px-2.5 py-1 text-xs"
          >
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
            <span className="font-medium text-on-surface">{t('schedule.nextOff', { time: formatMinutesUk(nextInMinutes) })}</span>
          )}
          <span className="text-on-surface-variant">{t('schedule.offPerDay', { time: formatMinutesUk(offMinutes) })}</span>
        </div>
      )}
    </div>
  );
};
