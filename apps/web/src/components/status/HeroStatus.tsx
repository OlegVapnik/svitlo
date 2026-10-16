import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { BatteryCharging, Clock } from 'lucide-react';
import { ExpressiveShapeBadge, ShapeOutline, type ExpressiveShape } from '../ui/ExpressiveShapeBadge.js';
import { StatusDot, type NetworkState } from '../ui/StatusDot.js';
import { WavyDivider, WavyProgressBar, type WaveTone } from '../ui/WavyProgressBar.js';
import { formatMinutesUk, slotProgress } from '../../lib/scheduleWindow.js';
import { cn } from '../../lib/cn.js';
import type { ScheduleIntervalUtc } from '@svitlo/shared';

/**
 * Hero главного экрана: один ответ на главный вопрос — «свет сейчас есть?».
 *
 * Три состояния и никаких четвёртых:
 *   on       — есть интервалы, отключения сейчас нет;
 *   soon     — свет есть, но скоро выключат (предупреждение, а не тревога);
 *   off      — света нет;
 *   unknown  — ГРАФИКА НЕТ. Не «свет есть», а «мы не знаем».
 *
 * Последнее — главное правило этого компонента. Зелёное «Світло є» при пустом графике
 * означало бы, что оператор подтвердил отсутствие отключений. На деле у нас просто нет
 * данных, и человек принял бы пустоту за хорошую новость. Поэтому пустой график даёт
 * нейтральный серый и отдельный текст.
 */

/** Токен свечения под Hero для каждого состояния. */
const GLOW: Record<NetworkState, string> = {
  on: 'var(--glow-success)',
  soon: 'var(--glow-warning)',
  off: 'var(--glow-destructive)',
  unknown: 'var(--glow-unknown)',
};

/** Фирменная M3-фигура статуса: силуэт читается даже там, где цвет выгорел. */
const SHAPE: Record<NetworkState, ExpressiveShape> = {
  on: 'scallop',
  soon: 'clover',
  off: 'polygon',
  unknown: 'scallop',
};

export interface HeroStatusProps {
  intervals: ScheduleIntervalUtc[];
  /** Киевская дата YYYY-MM-DD, на которую запрошен график: по ней считаются минуты суток. */
  date: string;
  /** true, если сейчас идёт отключение. */
  isOff: boolean;
  /** Минут до следующего отключения (свет есть). */
  nextInMinutes: number | null;
  /** Минут до возврата света (отключение идёт). */
  backInMinutes: number | null;
  /** Начало следующего отключения/конца текущего — ISO, для точного времени «о 22:00». */
  nextBoundaryAt: string | null;
  /** График показан из офлайн-снимка: подписываем это честно. */
  fromCache?: boolean;
  /** Время сохранения офлайн-снимка для бейджа «дані з кешу». */
  cachedAt?: string | null;
  /** График загружается — рисуем скелетоны, а не «світло є». */
  loading?: boolean;
}

export const HeroStatus: React.FC<HeroStatusProps> = ({
  intervals,
  date,
  isOff,
  nextInMinutes,
  backInMinutes,
  nextBoundaryAt,
  fromCache,
  cachedAt,
  loading,
}) => {
  const { t } = useTranslation();

  const hasData = intervals.length > 0 && !loading;
  // «Скоро вимкнуть» — это отдельное состояние, а не просто «свет есть»: человек, у которого
  // отключение через 20 минут, должен увидеть это ДО темноты, а не когда уже темно.
  const SOON_MINUTES = 60;
  const isSoon = !isOff && nextInMinutes != null && nextInMinutes <= SOON_MINUTES;
  const state: NetworkState = !hasData ? 'unknown' : isOff ? 'off' : isSoon ? 'soon' : 'on';
  /** Тон волны повторяет статус: форма полосы — часть ответа, а не украшение. */
  const tone: WaveTone = state === 'off' ? 'off' : state === 'soon' ? 'warning' : state === 'on' ? 'on' : 'unknown';

  // Прогресс текущего слота считает lib/scheduleWindow — та же математика, что у полосы суток:
  // дублировать её здесь нельзя, иначе герой и таймлайн разойдутся в цифрах.
  const slot = useMemo(() => (hasData ? slotProgress(intervals, date) : null), [hasData, intervals, date]);
  const clock = splitClock(isOff ? backInMinutes : nextInMinutes);

  const title =
    state === 'unknown'
      ? t('home.heroUnknown')
      : state === 'off'
        ? t('home.heroTitleOff')
        : state === 'soon'
          ? t('home.heroTitleSoon')
          : t('home.heroTitleOn');
  const caption = isOff ? t('home.countdownToOn') : t('home.countdownToOff');

  return (
    <section
      className="status-glow relative isolate overflow-hidden rounded-[40px] border border-outline-variant/70 bg-surface-container-low p-5 sm:p-7"
      style={{ ['--glow-color' as string]: GLOW[state] }}
    >
      {/* Гигантский контур M3-фигуры: декоративная подложка, а не информация — поэтому почти
          прозрачна и не мешает читать цифры. */}
      <ShapeOutline
        kind={SHAPE[state]}
        className={cn(
          'pointer-events-none absolute -right-20 -top-24 h-80 w-80 text-primary opacity-[0.06]',
          state !== 'unknown' && 'animate-shape-spin',
        )}
      />

      <div className="relative z-10 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Капсула статуса: фигура + текст. Цвет и силуэт работают вместе — статус не держится
              на одном лишь цвете (доступность на солнце и при дальтонизме). */}
          <span className="inline-flex min-h-12 items-center gap-2.5 rounded-full bg-surface-container-high/70 py-1.5 pl-1.5 pr-4">
            <ExpressiveShapeBadge state={state} size="sm" />
            <span className="text-sm font-bold text-on-surface sm:text-base">{title}</span>
          </span>

          <div className="flex items-center gap-2">
            {fromCache && (
              <span className="rounded-full bg-surface-container-high px-3 py-1 text-[11px] font-semibold text-on-surface-variant">
                {t('home.heroFromCache', {
                  time: cachedAt ? new Date(cachedAt).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }) : '',
                })}
              </span>
            )}
            <StatusDot state={state} size="lg" />
          </div>
        </div>

        {state === 'unknown' ? (
          <p className="text-sm leading-relaxed text-on-surface-variant">{t('home.heroUnknownDesc')}</p>
        ) : (
          <>
            {/* Обратный отсчёт: крупные цифры с мигающим векторным разделителем. Двоеточие
                пульсирует, потому что это единственный «живой» элемент на экране — так видно,
                что данные обновляются, а не застыли. */}
            {clock ? (
              <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
                <div className="min-w-0">
                  <p
                    className="font-timer flex items-baseline text-5xl font-black leading-none tracking-tight tabular-nums text-on-surface sm:text-7xl"
                    aria-label={`${clock.hours}:${clock.minutes} ${caption}`}
                  >
                    <span>{clock.hours}</span>
                    <span className="mx-1 animate-pulse-soft text-primary sm:mx-2" aria-hidden>
                      :
                    </span>
                    <span>{clock.minutes}</span>
                  </p>
                  <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant sm:text-xs">
                    {caption}
                  </p>
                </div>

                {nextBoundaryAt && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-container-high/60 px-3 py-1.5 text-xs text-on-surface-variant">
                    <Clock className="h-3.5 w-3.5 text-primary" strokeWidth={2.2} aria-hidden />
                    {t('home.heroBoundary', { time: formatTime(nextBoundaryAt) })}
                  </span>
                )}
              </div>
            ) : (
              <p className="font-display text-3xl font-bold tracking-tight text-on-surface sm:text-4xl">
                {t('home.heroNoNextBig')}
              </p>
            )}

            <WavyDivider />

            {/* Волнистая змейка прогресса слота: сколько уже прошло и сколько осталось. */}
            {slot && (
              <WavyProgressBar
                progress={slot.percent}
                tone={tone}
                elapsedLabel={t('home.waveElapsed', { time: formatMinutesUk(slot.elapsedMinutes) })}
                remainingLabel={t('home.waveRemaining', { time: formatMinutesUk(slot.remainingMinutes) })}
                percentLabel={t('home.wavePercent', { percent: slot.percent })}
                aria-label={t('home.heroProgress', { percent: slot.percent })}
              />
            )}
          </>
        )}

        {/* Бытовой совет: человек открывает приложение во время отключения и думает,
            что делать дальше, а не когда выключат. */}
        {isOff && (
          <div className="flex items-start gap-2.5 rounded-[22px] bg-surface-container-high/60 p-3">
            <BatteryCharging className="mt-0.5 h-4 w-4 shrink-0 text-primary" strokeWidth={2.2} aria-hidden />
            <p className="text-xs leading-relaxed text-on-surface-variant">{t('home.heroTipOff')}</p>
          </div>
        )}
      </div>
    </section>
  );
};

/** Минуты → «02» и «14» для крупного отсчёта. null — отсчитывать нечего. */
function splitClock(minutes: number | null): { hours: string; minutes: string } | null {
  if (minutes == null || !Number.isFinite(minutes) || minutes < 0) return null;
  const total = Math.round(minutes);
  return {
    hours: String(Math.floor(total / 60)).padStart(2, '0'),
    minutes: String(total % 60).padStart(2, '0'),
  };
}

/** Время интервала в киевской зоне — так же, как показывает оператор. */
function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('uk-UA', {
    timeZone: 'Europe/Kyiv',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
