import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { PhoneCall, Zap, ZapOff } from 'lucide-react';
import { QueueScheduleBar } from '../schedule/QueueScheduleBar.js';
import { Skeleton } from '../ui/Skeleton.js';
import { formatMinutesUk, scheduleWindow } from '../../lib/scheduleWindow.js';
import { cn } from '@/lib/cn';
import type { QueueScheduleData } from '@svitlo/shared';

type Props = {
  /** Моя очередь из настроек (пока одна, см. hooks/useMyQueues.ts). */
  queue?: string;
  /** Сохранённый адрес: вторая строка героя, как «вулиця · черга» в макете grok. */
  address?: string;
  /** Киевская дата YYYY-MM-DD, на которую запрошен график. */
  date: string;
  schedule?: QueueScheduleData;
  isLoading: boolean;
  isError: boolean;
};

/** Время «до» по Киеву (полоса суток считает границы в этой зоне). */
function kyivTime(iso: string): string {
  return new Intl.DateTimeFormat('uk-UA', { timeZone: 'Europe/Kyiv', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

/**
 * Герой главной: крупный ответ «є світло чи ні» по моей очереди и когда свет вернётся или выключится.
 * Порт идеи grok-workspace (routes/index.tsx: светофорная надпись text-4xl/5xl + отсчёт + полоса суток),
 * но данные реальные — из GET /api/v1/schedules/:queue, а не из синтетики макета.
 * Когда очередь не выбрана, блок не прячется: он объясняет, что делать (в макете так же).
 */
export const MyQueueHero: React.FC<Props> = ({ queue, address, date, schedule, isLoading, isError }) => {
  const { t } = useTranslation();
  const sched = schedule ? scheduleWindow(schedule.intervals, date) : null;
  const hasIntervals = (schedule?.intervals.length ?? 0) > 0;
  const isOff = hasIntervals && (sched?.isOff ?? false);
  /**
   * Что показывать крупно. Когда графика нет, нельзя утверждать ни «світло є», ни «світла немає»:
   * это выдумка о реальном отключении, поэтому третье состояние — «даних немає» (нейтральный цвет).
   */
  const state: 'on' | 'off' | 'unknown' = !hasIntervals ? 'unknown' : isOff ? 'off' : 'on';

  /** Строка-отсчёт: отключение сейчас, когда следующее, либо «на добу нічого». */
  function headline(): string {
    if (!sched || !hasIntervals) return '';
    if (isOff && sched.offEndsAt) {
      const nowOff = t('home.heroOffNow', { time: kyivTime(sched.offEndsAt) });
      return sched.backInMinutes != null ? `${nowOff} · ${t('home.heroBackIn', { time: formatMinutesUk(sched.backInMinutes) })}` : nowOff;
    }
    if (sched.nextInMinutes != null) return t('home.heroNextOff', { time: formatMinutesUk(sched.nextInMinutes) });
    return t('home.heroNoNext');
  }

  const text = headline();

  return (
    <section className="space-y-1 rounded-2xl border border-border bg-card p-4 shadow-card sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">
          {queue ? <Zap className="h-3.5 w-3.5" aria-hidden /> : <ZapOff className="h-3.5 w-3.5" aria-hidden />}
          {queue ? t('home.heroQueue', { queue }) : t('home.heroQueueMissing')}
        </span>
        {address && <span className="min-w-0 truncate text-xs text-muted-foreground">{address}</span>}
      </div>

      {!queue ? (
        <>
          <p className="pt-3 text-sm text-muted-foreground">{t('home.myScheduleEmpty')}</p>
          <div className="pt-2">
            <Link
              to="/queues"
              className="inline-flex min-h-11 items-center rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground"
            >
              {t('home.myScheduleSetup')}
            </Link>
          </div>
        </>
      ) : (
        <>
          <p className="pt-3 text-sm text-muted-foreground">{t('home.heroBySchedule')}</p>

          {isLoading && !schedule ? (
            <Skeleton className="mt-1 h-11 w-56 max-w-full" />
          ) : (
            <h2
              className={cn(
                'font-display text-4xl font-bold tracking-tight sm:text-5xl',
                state === 'unknown' ? 'text-muted-foreground' : isOff ? 'text-destructive' : 'text-success',
              )}
            >
              {state === 'unknown' ? t('home.heroNoData') : isOff ? t('home.heroOff') : t('home.heroOn')}
            </h2>
          )}

          {text && <p className="pt-1 text-base font-semibold text-foreground">{text}</p>}

          <div className="pt-3">
            {isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : isError ? (
              <p className="text-sm text-muted-foreground">{t('home.myScheduleError')}</p>
            ) : hasIntervals ? (
              <>
                {/* Сводку под полосой герой показывает сам (выше), поэтому в полосе она выключена. */}
                <QueueScheduleBar intervals={schedule!.intervals} date={date} showSummary={false} />
                {sched && (
                  <p className="pt-2 text-xs text-muted-foreground">{t('home.offToday', { time: formatMinutesUk(sched.offMinutes) })}</p>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{t('home.myScheduleEmpty')}</p>
            )}
          </div>

          <div className="flex flex-wrap gap-2 pt-3">
            {state === 'unknown' && (
              <Link
                to="/schedule-import"
                className="inline-flex min-h-11 items-center rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground"
              >
                {t('nav.scheduleImport')}
              </Link>
            )}
            <Link
              to="/my-address"
              className="inline-flex min-h-11 items-center rounded-full border border-border px-4 text-sm font-semibold text-foreground"
            >
              {t('nav.myAddress')}
            </Link>
            <a
              href="tel:0800210310"
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-4 text-sm font-semibold text-foreground"
            >
              <PhoneCall className="h-4 w-4" aria-hidden />
              {t('home.hotlineNumber')}
            </a>
          </div>
        </>
      )}
    </section>
  );
};
