import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  CalendarDays,
  FileQuestion,
  PhoneCall,
  RefreshCw,
  Zap,
  ZapOff,
} from 'lucide-react';
import { RegionPicker } from '../region/RegionPicker.js';
import { QueueSelector } from '../queue/QueueSelector.js';
import { Timeline24h } from '../schedule/Timeline24h.js';
import { Skeleton } from '../ui/Skeleton.js';
import { Button } from '../ui/Button.js';
import { useRegion } from '../../hooks/useRegion.js';
import { useRegionQueue } from '../../hooks/useRegionQueue.js';
import { useQueueSchedule } from '../../api/queries.js';
import { useMyAddress } from '../../hooks/useMyAddress.js';
import { kyivDateOffsetKey } from '../../lib/outage-dates.js';
import { formatMinutesUk, scheduleWindow } from '../../lib/scheduleWindow.js';
import { cn } from '../../lib/cn.js';

/** Час у форматі HH:MM за Києвом для підписів. */
function formatKyivTime(iso: string): string {
  return new Intl.DateTimeFormat('uk-UA', {
    timeZone: 'Europe/Kyiv',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

export const HomeHeroSection: React.FC = () => {
  const { t } = useTranslation();
  const { currentRegion, currentRegionData, isLoading: regionLoading } = useRegion();
  const { address } = useMyAddress();

  // Вибір дати: сьогодні (0) або завтра (1) у київському часі
  const [selectedDayOffset, setSelectedDayOffset] = useState<0 | 1>(0);
  const selectedDate = useMemo(() => kyivDateOffsetKey(selectedDayOffset), [selectedDayOffset]);

  // Черга, збережена окремо для кожної області
  const availableQueues = currentRegionData.queues ?? [];
  const { selectedQueue, selectQueue } = useRegionQueue(currentRegion, availableQueues);

  // Запит графіка для обраної черги, дати й області через єдиний клієнт
  const {
    data: scheduleResponse,
    isLoading: scheduleLoading,
    isError: scheduleError,
    refetch: refetchSchedule,
  } = useQueueSchedule(selectedQueue ?? undefined, selectedDate, currentRegion);

  const schedule = scheduleResponse?.data;
  const intervals = schedule?.intervals ?? [];
  const hasIntervals = intervals.length > 0;

  // Розрахунок вікна графіка на вибрану добу (що зараз, коли наступне, скільки без світла)
  const windowSummary = useMemo(() => {
    return hasIntervals ? scheduleWindow(intervals, selectedDate) : null;
  }, [hasIntervals, intervals, selectedDate]);

  const isOff = Boolean(windowSummary?.isOff);
  const hasRegionData = currentRegionData.slots > 0 || hasIntervals;

  // Формування підсумкового рядка-відліку
  const statusHeadline = useMemo(() => {
    if (!windowSummary || !hasIntervals) return '';
    if (isOff && windowSummary.offEndsAt) {
      const nowOff = t('home.heroOffNow', { time: formatKyivTime(windowSummary.offEndsAt) });
      return windowSummary.backInMinutes != null
        ? `${nowOff} · ${t('home.heroBackIn', { time: formatMinutesUk(windowSummary.backInMinutes) })}`
        : nowOff;
    }
    if (windowSummary.nextInMinutes != null) {
      return t('home.heroNextOff', { time: formatMinutesUk(windowSummary.nextInMinutes) });
    }
    return t('home.heroNoNext');
  }, [windowSummary, hasIntervals, isOff, t]);

  return (
    <section className="space-y-4 rounded-2xl border border-border bg-card p-4 shadow-card sm:p-6">
      {/* 1. Першокласний селектор області (Searchable Dropdown / Command Palette) */}
      <div className="space-y-2">
        <RegionPicker variant="prominent" />
      </div>

      {/* 2. Панель керування: перемикач дати та вибір черги області */}
      <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between">
        {/* Вибір черги (запам'ятовується для кожної області) */}
        <QueueSelector
          queues={availableQueues}
          selectedQueue={selectedQueue}
          onSelect={selectQueue}
          disabled={scheduleLoading}
        />

        {/* Перемикач дати: Сьогодні / Завтра */}
        <div
          role="tablist"
          aria-label={t('outages.filterDate')}
          className="inline-flex self-start rounded-xl border border-border bg-muted/50 p-1 text-xs font-semibold"
        >
          <button
            type="button"
            role="tab"
            aria-selected={selectedDayOffset === 0}
            onClick={() => setSelectedDayOffset(0)}
            className={cn(
              'rounded-lg px-3 py-1.5 transition-all duration-150',
              selectedDayOffset === 0
                ? 'bg-card text-foreground shadow-xs font-bold'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t('outages.today')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={selectedDayOffset === 1}
            onClick={() => setSelectedDayOffset(1)}
            className={cn(
              'rounded-lg px-3 py-1.5 transition-all duration-150',
              selectedDayOffset === 1
                ? 'bg-card text-foreground shadow-xs font-bold'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t('outages.tomorrow')}
          </button>
        </div>
      </div>

      {/* 3. Головний стан героя та таймлайн */}
      {regionLoading || (scheduleLoading && !schedule) ? (
        /* Скелетон стану завантаження */
        <div className="space-y-4 py-2">
          <Skeleton className="h-12 w-64 max-w-full rounded-xl" />
          <Skeleton className="h-5 w-80 max-w-full rounded-lg" />
          <Skeleton className="h-12 w-full rounded-xl" />
        </div>
      ) : scheduleError ? (
        /* Стан помилки з можливістю повторити */
        <div className="flex flex-col items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-4 sm:p-5">
          <p className="text-sm font-semibold text-destructive">{t('home.myScheduleError')}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetchSchedule()}
            className="gap-2"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            {t('common.retry')}
          </Button>
        </div>
      ) : !hasRegionData || availableQueues.length === 0 ? (
        /* Чесний порожній стан для області без даних (Ніколи не вигадуємо демо-дані) */
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-muted/20 px-4 py-8 text-center sm:py-10">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
            <FileQuestion className="h-6 w-6" aria-hidden />
          </div>
          <h3 className="mt-3 text-base font-bold text-foreground">
            {t('regions.noDataForRegionTitle')}
          </h3>
          <p className="mt-1 max-w-md text-xs text-muted-foreground sm:text-sm">
            {t('regions.noDataForRegionDesc')}
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Link
              to="/schedule-import"
              className="inline-flex min-h-[40px] items-center rounded-full bg-primary px-4 text-xs font-semibold text-primary-foreground shadow-xs transition-colors hover:bg-primary/90"
            >
              {t('nav.scheduleImport')}
            </Link>
            <a
              href="tel:0800210310"
              className="inline-flex min-h-[40px] items-center gap-2 rounded-full border border-border bg-card px-4 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
            >
              <PhoneCall className="h-3.5 w-3.5" aria-hidden />
              {t('home.hotline')}
            </a>
          </div>
        </div>
      ) : !hasIntervals ? (
        /* Графік для цієї черги на обрану дату ще не опублікований */
        <div className="space-y-4 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t('home.heroBySchedule')}
              </p>
              <h2 className="font-display text-3xl font-bold tracking-tight text-muted-foreground sm:text-4xl">
                {t('home.heroNoData')}
              </h2>
            </div>
            {address && (
              <span className="truncate text-xs font-medium text-muted-foreground">
                {address}
              </span>
            )}
          </div>
          <div className="rounded-xl border border-dashed border-border bg-card/60 p-6 text-center text-sm text-muted-foreground">
            {t('schedule.notImported')}
          </div>
        </div>
      ) : (
        /* Головний відомий стан черги з 24-годинним таймлайном */
        <div className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('home.heroBySchedule')}
                </span>
                {selectedQueue && (
                  <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-bold text-foreground">
                    {t('home.heroQueue', { queue: selectedQueue })}
                  </span>
                )}
              </div>

              {/* Великий заголовок "Світло є" / "Зараз без світла" */}
              <h2
                className={cn(
                  'font-display mt-1 text-4xl font-bold tracking-tight sm:text-5xl',
                  isOff ? 'text-destructive' : 'text-success',
                )}
              >
                {isOff ? t('home.heroOff') : t('home.heroOn')}
              </h2>

              {statusHeadline && (
                <p className="mt-1 text-sm font-semibold text-foreground sm:text-base">
                  {statusHeadline}
                </p>
              )}
            </div>

            {/* Статистичний бейдж загального часу без світла */}
            {windowSummary && (
              <div className="rounded-xl border border-border bg-card p-3 text-right shadow-xs">
                <span className="block text-[11px] font-semibold text-muted-foreground">
                  {t('home.offTodayLabel')}
                </span>
                <span className="block text-base font-bold text-foreground tabular">
                  {formatMinutesUk(windowSummary.offMinutes)}
                </span>
              </div>
            )}
          </div>

          {/* 24-годинний горизонтальний таймлайн із півгодинними комірками */}
          <div className="pt-1">
            <Timeline24h
              intervals={intervals}
              date={selectedDate}
            />
          </div>

          {/* Швидкі дії */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3">
            <div className="flex flex-wrap gap-2">
              <Link
                to="/my-address"
                className="inline-flex min-h-[40px] items-center rounded-full border border-border bg-card px-4 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
              >
                {t('nav.myAddress')}
              </Link>
              <a
                href="tel:0800210310"
                className="inline-flex min-h-[40px] items-center gap-2 rounded-full border border-border bg-card px-4 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
              >
                <PhoneCall className="h-3.5 w-3.5" aria-hidden />
                {t('home.hotlineNumber')}
              </a>
            </div>

            {schedule?.lastImportedAt && (
              <span className="text-[11px] text-muted-foreground">
                {t('common.updatedAt')} {formatKyivTime(schedule.lastImportedAt)}
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
};
