import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { BatteryCharging, PlugZap, SunDim, Zap, ZapOff } from 'lucide-react';
import { ProgressBar } from '../ui/ProgressBar.js';
import { StatusDot, type NetworkState } from '../ui/StatusDot.js';
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

export interface HeroStatusProps {
  intervals: ScheduleIntervalUtc[];
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

  // Прогресс текущего слота: сколько отключения уже прошло. Считаем из интервалов,
  // новый API для этого не нужен.
  const progress = useMemo(() => {
    const current = intervals.find((item) => {
      const from = Date.parse(item.startsAt);
      const to = Date.parse(item.endsAt);
      return from <= Date.now() && Date.now() < to;
    });
    if (!current) return null;
    const from = Date.parse(current.startsAt);
    const to = Date.parse(current.endsAt);
    if (to <= from) return null;
    return Math.round(((Date.now() - from) / (to - from)) * 100);
  }, [intervals]);

  const Icon = state === 'off' ? ZapOff : state === 'on' ? PlugZap : SunDim;

  return (
    <section
      className="status-glow relative isolate overflow-hidden rounded-3xl border border-border bg-card p-5 sm:p-7"
      style={{ ['--glow-color' as string]: GLOW[state] }}
    >
      <div className="relative z-10 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            {/* Иконка дублирует цвет: статус не держится на одном лишь цвете. */}
            <Icon
              className={cn(
                'h-6 w-6',
                state === 'off' ? 'text-destructive' : state === 'unknown' ? 'text-unknown' : 'text-success',
              )}
              aria-hidden
            />
            <h2 className="font-display text-lg font-bold text-foreground sm:text-xl">
              {state === 'unknown'
                ? t('home.heroUnknown')
                : state === 'off'
                  ? t('home.heroTitleOff')
                  : t('home.heroTitleOn')}
            </h2>
          </div>

          <div className="flex flex-col items-end gap-1.5">
            <StatusDot state={state} size="lg" />
            {fromCache && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                {t('home.heroFromCache', {
                  time: cachedAt ? new Date(cachedAt).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }) : '',
                })}
              </span>
            )}
          </div>
        </div>

        {state === 'unknown' ? (
          <p className="text-sm text-muted-foreground">{t('home.heroUnknownDesc')}</p>
        ) : (
          <>
            {/* Обратный отсчёт крупным моноширинным: цифры не прыгают по ширине благодаря
                tabular-nums, установленному глобально. */}
            <p className="font-timer text-4xl font-bold leading-none text-foreground sm:text-5xl">
              {state === 'off' && backInMinutes != null
                ? t('home.heroBackBig', { time: formatDuration(backInMinutes) })
                : nextInMinutes != null
                  ? t('home.heroNextBig', { time: formatDuration(nextInMinutes) })
                  : t('home.heroNoNextBig')}
            </p>

            {nextBoundaryAt && (
              <p className="text-xs text-muted-foreground">
                {t('home.heroBoundary', { time: formatTime(nextBoundaryAt) })}
              </p>
            )}

            {progress !== null && (
              <div className="space-y-1.5">
                <ProgressBar value={progress} tone="destructive" />
                <p className="text-xs text-muted-foreground">
                  {t('home.heroProgress', { percent: progress })}
                </p>
              </div>
            )}
          </>
        )}

        {/* Бытовой совет: человек открывает приложение во время отключения и думает,
            что делать дальше, а не когда выключат. */}
        {isOff && (
          <div className="flex items-start gap-2 rounded-2xl border border-border bg-card-raised p-3">
            <BatteryCharging className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
            <p className="text-xs text-muted-foreground">{t('home.heroTipOff')}</p>
          </div>
        )}
      </div>
    </section>
  );
};

/** Минуты → «2 год 14 хв». Компактно: длинные формы не влезают в одну строку Hero. */
function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return '—';
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  if (hours === 0) return `${rest} хв`;
  if (rest === 0) return `${hours} год`;
  return `${hours} год ${rest} хв`;
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
