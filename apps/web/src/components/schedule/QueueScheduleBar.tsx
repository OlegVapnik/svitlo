import React, { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock } from 'lucide-react';
import type { ScheduleIntervalUtc } from '@svitlo/shared';
import { OFF_STATE_CODE, formatMinutesUk, minutesOfDay, minutesToHm, scheduleWindow } from '../../lib/scheduleWindow.js';
import { cn } from '../../lib/cn.js';

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
 * Цвет сегмента суток — по состоянию, а не по цвету из ответа оператора.
 *
 * ПОЧЕМУ ПАЛИТРА, А НЕ stateColor ИЗ API. Источник отдаёт «світло» разными оттенками зелёного
 * (порой почти болотного), а отключение — кирпичным: на графитовом фоне это выглядело грязно и
 * рядом с бейджами читалось как третий, чужой язык цвета. Теперь свет — спокойный изумруд,
 * отключение — контрастный рубин, «можливо вимкнуть» — янтарь: те же три роли, что и у
 * остальных индикаторов. Название состояния по-прежнему берём у оператора (stateName) и
 * показываем в легенде — смысл не подменяем, подменяем только краску.
 */
function segmentTone(stateCode: number): string {
  if (stateCode === OFF_STATE_CODE) return 'border-rose-500/40 bg-rose-500/25';
  // Код 2 у оператора — «світло вимкнули»: показываем янтарём как предупреждение.
  if (stateCode === 2) return 'border-amber-500/30 bg-amber-500/20';
  if (stateCode === 1) return 'border-emerald-500/30 bg-emerald-500/20';
  return 'border-hairline bg-surface-container-high';
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
      <div className="rounded-2xl border border-hairline bg-surface-container-high/50 p-6 text-center text-sm text-on-surface-variant">
        {emptyLabel ?? t('schedule.notImported')}
      </div>
    );
  }

  const { nowMinutes, current, nextInMinutes, offMinutes } = scheduleWindow(intervals, date, now);

  // В легенде — уникальные состояния. В сутках их два-три, а интервалов бывает пять и больше:
  // раньше легенда повторяла «Світло є» трижды и занимала пол-экрана на телефоне.
  // Цвет легенды считаем тем же правилом, что и сегменты: иначе легенда описывала бы не шкалу.
  const legend = intervals.reduce<Array<{ name: string; code: number }>>((acc, interval) => {
    if (!acc.some((item) => item.name === interval.stateName && item.code === interval.stateCode)) {
      acc.push({ name: interval.stateName, code: interval.stateCode });
    }
    return acc;
  }, []);

  return (
    <div className="space-y-2.5">
      {/* Полоса суток: строгий трек с сегментами-часами. Трек — самый тёмный тон палитры, поэтому
          сегменты читаются как «зажжённые» участки, а не как наклейки. Часы отключения получают
          векторную штриховку — их видно и на цветном экране при дальтонизме, и в чёрно-белой
          печати. */}
      <div className="relative h-9 w-full overflow-hidden rounded-xl border border-hairline bg-surface-container-low p-1">
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
              style={{ left: `${(from / 1440) * 100}%`, width: `${((to - from) / 1440) * 100}%` }}
              className={cn('absolute inset-y-1 overflow-hidden rounded-md border', segmentTone(interval.stateCode))}
            >
              {interval.stateCode === OFF_STATE_CODE && (
                <svg className="absolute inset-0 h-full w-full text-rose-100/25" aria-hidden focusable="false">
                  <rect width="100%" height="100%" fill={`url(#${hatchId})`} />
                </svg>
              )}
            </div>
          );
        })}

        {/* Линия «зараз» — только линия: раньше на ней же висела белая плашка с временем и
            закрывала сегменты графика. Время переехало текстом в строку легенды под полосой. */}
        {nowMinutes != null && nowMinutes >= 0 && nowMinutes <= 1440 && (
          <span
            className="pointer-events-none absolute inset-y-0 z-10 w-[2px] -translate-x-1/2 rounded-full bg-white/85"
            style={{ left: `${(nowMinutes / 1440) * 100}%` }}
            aria-hidden
          />
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

      <div className="flex flex-wrap items-center gap-2">
        {legend.map((item) => (
          <span
            key={`${item.name}-${item.code}`}
            className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface-container-high px-2.5 py-1 text-xs text-on-surface-variant"
          >
            <span className={cn('h-2.5 w-2.5 rounded-full border', segmentTone(item.code))} />
            {item.name}
          </span>
        ))}

        {/* Время «зараз» — текстом рядом с легендой, а не белой плашкой на полосе: плашка
            закрывала сегменты графика, хотя точку «сейчас» и так отмечает белая риска. */}
        {nowMinutes != null && nowMinutes >= 0 && nowMinutes <= 1440 && (
          <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] font-semibold text-on-surface">
            <span className="h-3.5 w-[2px] rounded-full bg-white/85" aria-hidden />
            <Clock className="h-3 w-3" strokeWidth={2.4} aria-hidden />
            {t('schedule.now')} {minutesToHm(nowMinutes)}
          </span>
        )}
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
