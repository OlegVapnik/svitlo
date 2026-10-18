import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock } from 'lucide-react';
import { StatusPill } from '../ui/StatusPill.js';
import { StatusDot, type NetworkState } from '../ui/StatusDot.js';
import { WavyProgressBar, type WaveTone } from '../ui/WavyProgressBar.js';
import { HeroContextTip } from './HeroContextTip.js';
import { formatMinutesUk, slotProgress } from '../../lib/scheduleWindow.js';
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

/*
 * Цвет статуса в этой карточке не задаётся локально: атрибут `data-power-state` на самой секции
 * переключает токены --md-status*, из которых берут цвет бейдж, таймер, линия прогресса и
 * свечение. Одна точка правки вместо четырёх синхронных карт состояний в разметке.
 */

export interface HeroStatusProps {
  intervals: ScheduleIntervalUtc[];
  /** Киевская дата YYYY-MM-DD, на которую запрошен график: по ней считаются минуты суток. */
  date: string;
  /**
   * Тикающее «зараз» из `useMinuteTicker` — тот же момент, по которому считает таймер на
   * главной. Без него `slotProgress` брал время рендера, и подпись под змейкой замирала:
   * таймер показывал «через 10 хв», а полоса — «Залишилось 18 хв» с момента загрузки данных.
   */
  now: Date;
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
  now,
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

  // Прогресс текущего слота считает lib/scheduleWindow — та же математика и тот же тикающий
  // `now`, что у таймера и полосы суток. Дублировать расчёт здесь нельзя, иначе герой и
  // таймлайн разойдутся в цифрах, а подпись под змейкой замрёт между тиками.
  const slot = useMemo(
    () => (hasData ? slotProgress(intervals, date, now) : null),
    [hasData, intervals, date, now],
  );
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
      // data-power-state ставим на саму секцию, а не только на <html>: Hero может показывать
      // график на завтра, и тогда его состояние отличается от страничного. От этого же атрибута
      // берут цвет бейдж, таймер, полоса прогресса и свечение — разойтись они не могут.
      data-power-state={state}
      className="status-glow relative isolate overflow-hidden rounded-3xl border border-border bg-card p-5 sm:p-6"
    >
      <div className="relative z-10 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Пилл статуса: точка + векторная иконка + текст. Иконка — второй (не-цветовой)
              сигнал состояния, поэтому статус читается и на солнце, и при дальтонизме. */}
          <StatusPill state={state} label={title} pulse={state !== 'unknown'} className="sm:text-sm" />

          <div className="flex items-center gap-2">
            {fromCache && (
              <span className="rounded-full border border-hairline bg-surface-container-high px-3 py-1 text-[11px] font-semibold text-on-surface-variant">
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
                  {/* Таймер: ровные табличные цифры, статичное двоеточие. Мигание убрано —
                      на телефоне оно читается как дефект рендера, а не как признак живых данных. */}
                  <p
                    className="font-timer flex items-baseline text-4xl font-bold leading-none tracking-tight text-on-surface sm:text-6xl"
                    aria-label={`${clock.hours}:${clock.minutes} ${caption}`}
                  >
                    <span>{clock.hours}</span>
                    <span className="mx-1 text-on-surface-variant/70 sm:mx-2" aria-hidden>
                      :
                    </span>
                    <span>{clock.minutes}</span>
                  </p>
                  <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-status-text sm:text-xs">
                    {caption}
                  </p>
                </div>

                {nextBoundaryAt && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface-container-high px-3 py-1.5 text-xs text-on-surface-variant">
                    <Clock className="h-3.5 w-3.5 text-status-text" strokeWidth={2.2} aria-hidden />
                    {t('home.heroBoundary', { time: formatTime(nextBoundaryAt) })}
                  </span>
                )}
              </div>
            ) : (
              <p className="font-display text-3xl font-bold tracking-tight text-on-surface sm:text-4xl">
                {t('home.heroNoNextBig')}
              </p>
            )}

            {/* Деликатная линия вместо волнистого разделителя: 1px и 6% белого. */}
            <div className="border-t border-hairline" aria-hidden />

            {/* Волнистая змейка прогресса слота: сколько уже прошло и сколько осталось.
                Процент завершення не дублюємо підписом: «пройдено 42%» нічого не додає до
                «Пройшло 2 год · Залишилось 3 год», а на маленькому екрані забирав місце.
                Для скрін-рідера відсоток лишається в aria-valuenow самої смуги. */}
            {slot && (
              <WavyProgressBar
                progress={slot.percent}
                tone={tone}
                elapsedLabel={t('home.waveElapsed', { time: formatMinutesUk(slot.elapsedMinutes) })}
                remainingLabel={t('home.waveRemaining', { time: formatMinutesUk(slot.remainingMinutes) })}
                aria-label={t('home.heroProgress', { percent: slot.percent })}
              />
            )}
          </>
        )}

        {/* Контекстна підказка: при відключенні — до якого часу, перед ним — що встигнути,
            при світлі — що зарядити. Текст залежить від стану, а не один на всі випадки. */}
        <HeroContextTip
          state={state}
          backInMinutes={backInMinutes}
          nextBoundaryAt={nextBoundaryAt}
        />
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
