import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pin, Radar } from 'lucide-react';
import { StatusDot, type NetworkState } from '../ui/StatusDot.js';
import { cn } from '../../lib/cn.js';
import { hapticTick } from '../../lib/haptics.js';
import { useMinuteTicker } from '../../hooks/useVisibilityTicker.js';
import { kyivDateOffsetKey } from '../../lib/outage-dates.js';
import {
  formatMinutesUk,
  minutesOfDay,
  minutesToHm,
  OFF_STATE_CODE,
} from '../../lib/scheduleWindow.js';
import type { GroupOutageSummary } from '@svitlo/shared';

/**
 * «Матриця 24 год» — радар всех очередей области на текущие сутки.
 *
 * Зачем ещё один вид после плиток. Плитка отвечает «где света нет сейчас», но не показывает
 * ритм суток: человек не видит, что его черга выключается в 08:00 и 20:00, а соседняя — в
 * 06:00 и 18:00. Матрица кладёт 24 часа в 48 получасовых слотов и одну строку на очередь:
 * красное — отключение, зелёное — свет по графику, нейтральное — данных нет.
 *
 * Почему не SVG-график. Строк до 60 (у Киева), и каждая должна быть кликабельной. 60 кнопок
 * с CSS-сеткой дешевле 60 SVG-путей и не ломают фокус с клавиатуры: строка — это button,
 * а не раскрашенный rect.
 *
 * Время берётся из `useMinuteTicker` — того же тика, что у таймера на главной. Иначе линия
 * «зараз» стояла бы на моменте рендера и к вечеру показывала утро.
 */

const SLOT_MINUTES = 30;
const SLOTS_PER_DAY = (24 * 60) / SLOT_MINUTES;
const HOUR_TICKS = [0, 6, 12, 18, 24] as const;
/** Ширины колонок обязаны совпадать у шапки и строк: шапка и строки — соседние grid-дети. */
const GRID_COLUMNS = '3rem minmax(18rem,1fr) 5rem';
const CELL_STYLES = Array.from({ length: SLOTS_PER_DAY }, (_, index) => index);

export interface Queues24hMatrixProps {
  queues: Array<{ queue: string; slots?: number; lastDate?: string | null }>;
  outages: GroupOutageSummary[];
  selectedQueue: string | null;
  onSelectQueue: (queue: string) => void;
  className?: string;
}

interface MatrixRow {
  queue: string;
  /** Интервалы отключений в минутах суток: [начало, конец]. */
  offSpans: Array<{ from: number; to: number }>;
  /** Есть ли на эти сутки вообще какой-нибудь опубликованный интервал. */
  hasData: boolean;
  isOff: boolean;
  offMinutes: number;
}

export const Queues24hMatrix: React.FC<Queues24hMatrixProps> = ({
  queues,
  outages,
  selectedQueue,
  onSelectQueue,
  className,
}) => {
  const { t } = useTranslation();
  const now = useMinuteTicker();
  const date = kyivDateOffsetKey(0);
  const nowMinutes = minutesOfDay(now.toISOString(), date);
  const nowPercent = (nowMinutes / (24 * 60)) * 100;
  // Бейдж не должен вылезать за край трека: сама линия стоит точно, а подпись чуть сдвигаем.
  const badgePercent = Math.min(96, Math.max(4, nowPercent));
  // У краёв центр бейджа с -translate-x-1/2 уходит за overflow-hidden карточки и подпись
  // обрезается («раз 01:52» вместо «Зараз 01:52»). У самого левого/правого процента бейдж
  // прижимается к краю целиком, в середине — центрируется по линии.
  const badgeShift = badgePercent <= 10 ? '0%' : badgePercent >= 90 ? '-100%' : '-50%';

  const rows = useMemo<MatrixRow[]>(() => {
    return queues.map(({ queue }) => {
      const intervals = outages
        .filter((item) => item.queue === queue && item.date === date)
        .flatMap((item) => item.intervals);

      const offSpans = intervals
        .filter((interval) => interval.stateCode === OFF_STATE_CODE)
        .map((interval) => ({
          from: minutesOfDay(interval.startsAt, date),
          to: minutesOfDay(interval.endsAt, date),
        }))
        .filter((span) => span.to > span.from);

      const isOff = offSpans.some((span) => span.from <= nowMinutes && nowMinutes < span.to);
      const offMinutes = offSpans.reduce((sum, span) => sum + (span.to - span.from), 0);

      return { queue, offSpans, hasData: intervals.length > 0, isOff, offMinutes };
    });
  }, [queues, outages, date, nowMinutes]);

  if (queues.length === 0) return null;

  return (
    <section
      className={cn('overflow-hidden rounded-2xl border border-hairline bg-card', className)}
      aria-label={t('monitor.matrixTitle')}
    >
      <header className="flex items-start justify-between gap-3 border-b border-hairline px-3 py-2.5 sm:px-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-on-surface">
            <Radar className="h-4 w-4 shrink-0 text-primary" aria-hidden />
            {t('monitor.matrixTitle')}
          </h2>
          <p className="mt-0.5 text-[11px] text-on-surface-variant">{t('monitor.matrixSubtitle')}</p>
        </div>
        {selectedQueue && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-1 text-[11px] font-bold text-primary">
            <Pin className="h-3 w-3" aria-hidden />
            {t('home.heroQueue', { queue: selectedQueue })}
          </span>
        )}
      </header>

      <div className="overflow-x-auto">
        <div className="min-w-116 px-3 pb-3 pt-8 sm:px-4">
          <div
            className="grid gap-x-2 text-[10px] font-semibold text-on-surface-variant"
            style={{ gridTemplateColumns: GRID_COLUMNS }}
          >
            {/* Шапка: подпись колонки, шкала часов и сумма часов без света.
                У каждой ячейки явная колонка: .sr-only абсолютен и сам grid-ячейку НЕ занимает —
                без явных col-start шкала часов падала в узкую первую колонку (3rem) и все
                подписи часов слипались в левом краю, а «Без світла» уезжала в центр. */}
            <span className="sr-only col-start-1 row-start-1">{t('queues.queueLabel')}</span>
            <div className="relative col-start-2 row-start-1 h-4">
              {HOUR_TICKS.map((hour) => {
                const left = (hour / 24) * 100;
                return (
                  <span
                    key={hour}
                    className={cn(
                      'absolute top-0 tabular',
                      hour === 0 ? 'left-0' : hour === 24 ? 'right-0' : '-translate-x-1/2',
                    )}
                    style={hour === 0 || hour === 24 ? undefined : { left: `${left}%` }}
                  >
                    {minutesToHm(hour * 60)}
                  </span>
                );
              })}

              {/* Живой бейдж текущего времени — над линией, сквозь все строки. */}
              <span
                className="absolute -top-7 z-20 whitespace-nowrap rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-primary-foreground shadow-md"
                style={{ left: `${badgePercent}%`, transform: `translateX(${badgeShift})` }}
              >
                {t('monitor.matrixNow', { time: minutesToHm(nowMinutes) })}
              </span>
            </div>
            <span className="col-start-3 row-start-1 text-right leading-tight">{t('monitor.matrixOffTotal')}</span>

            {/* Строки очередей. Каждая — одна кнопка на три колонки: тап по любому месту
                строки делает очередь активной, как плитка, но без перехода на другой экран. */}
            {rows.map((row) => {
              const active = row.queue === selectedQueue;
              const state: NetworkState = row.isOff ? 'off' : row.hasData ? 'on' : 'unknown';
              return (
                <button
                  key={row.queue}
                  type="button"
                  onClick={() => {
                    hapticTick('select');
                    onSelectQueue(row.queue);
                  }}
                  aria-pressed={active}
                  aria-label={`${t('home.heroQueue', { queue: row.queue })}: ${t(
                    !row.hasData
                      ? 'monitor.matrixLegendUnknown'
                      : row.isOff
                        ? 'monitor.matrixLegendOff'
                        : 'monitor.matrixLegendOn',
                  )}, ${formatMinutesUk(row.offMinutes)}`}
                  className={cn(
                    'col-span-3 grid items-center gap-x-2 rounded-lg border-b border-hairline/30 text-left transition-colors duration-150 last:border-b-0',
                    'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
                    active ? 'bg-primary/5 ring-1 ring-primary/50' : 'hover:bg-muted/40',
                  )}
                  style={{ gridTemplateColumns: GRID_COLUMNS }}
                >
                  <span
                    className={cn(
                      'flex min-w-0 items-center gap-1 font-timer text-sm font-bold tabular',
                      active ? 'text-primary' : row.isOff ? 'text-destructive' : 'text-on-surface',
                    )}
                  >
                    {active && <Pin className="h-3 w-3 shrink-0" aria-hidden />}
                    <span className="truncate">{row.queue}</span>
                  </span>


                  <span className="relative block h-8 overflow-hidden border border-hairline/70 bg-surface-container-lowest">
                    <span
                      className="grid h-full gap-px"
                      style={{ gridTemplateColumns: `repeat(${SLOTS_PER_DAY}, minmax(0, 1fr))` }}
                      aria-hidden
                    >
                      {CELL_STYLES.map((slot) => {
                        const from = slot * SLOT_MINUTES;
                        const to = from + SLOT_MINUTES;
                        const off = row.offSpans.some((span) => span.from < to && span.to > from);
                        return (
                          <span
                            key={slot}
                            title={`${minutesToHm(from)}–${minutesToHm(to)}: ${
                              !row.hasData
                                ? t('monitor.matrixLegendUnknown')
                                : off
                                  ? t('monitor.matrixLegendOff')
                                  : t('monitor.matrixLegendOn')
                            }`}
                            className={cn(
                              'block h-full',
                              off
                                ? 'bg-destructive/80'
                                : row.hasData
                                  ? 'bg-success/45'
                                  : 'bg-surface-container-high/50',
                            )}
                          />
                        );
                      })}
                    </span>

                    {/* Живая линия «зараз»: по сегменту в каждой строке; строки без зазора,
                        поэтому сегменты складываются в одну линию сквозь всю таблицу. */}
                    <span
                      className="pointer-events-none absolute inset-y-0 z-10 w-px bg-primary shadow-[0_0_6px_var(--color-primary)]"
                      style={{ left: `${nowPercent}%` }}
                      aria-hidden
                    />
                  </span>

                  <span className="flex items-center justify-end gap-1.5 whitespace-nowrap text-[10px] font-semibold tabular-nums text-on-surface-variant">
                    <span className={cn(row.offMinutes > 0 ? 'text-destructive' : '')}>
                      {row.offMinutes > 0 ? `−${formatMinutesUk(row.offMinutes)}` : '0 хв'}
                    </span>
                    <StatusDot state={state} />
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-on-surface-variant">
            <LegendDot className="bg-destructive/80" label={t('monitor.matrixLegendOff')} />
            <LegendDot className="bg-success/45" label={t('monitor.matrixLegendOn')} />
            <LegendDot className="bg-surface-container-high" label={t('monitor.matrixLegendUnknown')} />
            <span className="ml-auto">{t('monitor.matrixRowHint')}</span>
          </div>
        </div>
      </div>
    </section>
  );
};

const LegendDot: React.FC<{ className: string; label: string }> = ({ className, label }) => (
  <span className="inline-flex items-center gap-1.5">
    <span className={cn('h-2 w-2 rounded-xs', className)} aria-hidden />
    {label}
  </span>
);

