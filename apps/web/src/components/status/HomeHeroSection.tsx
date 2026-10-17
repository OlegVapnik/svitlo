import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  Briefcase,
  CalendarDays,
  Check,
  FileQuestion,
  Heart,
  Home,
  MapPin,
  PhoneCall,
  RefreshCw,
  Sparkles,
  Star,
  X,
  Zap,
  ZapOff,
  type LucideIcon,
} from 'lucide-react';
import { QueueSelector } from '../queue/QueueSelector.js';
import { Timeline24h } from '../schedule/Timeline24h.js';
import { ShareSchedule } from '../schedule/ShareSchedule.js';
import { Skeleton } from '../ui/Skeleton.js';
import { Button } from '../ui/Button.js';
import { useRegion } from '../../hooks/useRegion.js';
import { useRegionQueue } from '../../hooks/useRegionQueue.js';
import { useBookmarks } from '../../hooks/useBookmarks.js';
import { useQueues, useQueueSchedule, useUpcomingGroupOutages } from '../../api/queries.js';
import { HeroStatus } from './HeroStatus.js';
import { DaySegment } from '../schedule/DaySegment.js';
import { useMinuteTicker } from '../../hooks/useVisibilityTicker.js';
import { useDynamicChrome } from '../../hooks/useDynamicChrome.js';
import { useTheme } from '../../hooks/useTheme.js';
import { QueuePlacesChips } from '../queue/QueuePlacesChips.js';
import { useMyAddress } from '../../hooks/useMyAddress.js';
import { kyivDateOffsetKey } from '../../lib/outage-dates.js';
import { formatMinutesUk, scheduleWindow } from '../../lib/scheduleWindow.js';
import type { QueueScheduleData } from '@svitlo/shared';
import { cn } from '../../lib/cn.js';

/** Час у форматі HH:MM за Києвом для підписів. */
function formatKyivTime(iso: string): string {
  return new Intl.DateTimeFormat('uk-UA', {
    timeZone: 'Europe/Kyiv',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

/**
 * Иконка закладки по её названию. Раньше роль значка играли текстовые эмодзи («Дім»,
 * «Робота»), но эмодзи разъезжаются по шрифтам и выглядят по-разному на Android, iOS и
 * Windows. Подпись как была, а значок — векторный: дім, робота, батьки, село/місто.
 */
function bookmarkIcon(label: string): LucideIcon {
  const value = label.toLowerCase();
  if (/дім|дом|home|квартир/.test(value)) return Home;
  if (/робот|work|офіс/.test(value)) return Briefcase;
  if (/батьк|мам[аи]|тато|родин/.test(value)) return Heart;
  if (/село|місто|вул\.|смт/.test(value)) return MapPin;
  return Sparkles;
}

export const HomeHeroSection: React.FC = () => {
  const { t } = useTranslation();
  const { currentRegion, currentRegionData, setRegion, isLoading: regionLoading } = useRegion();
  const { address } = useMyAddress();
  const { bookmarks, primaryBookmark, addBookmark, removeBookmark, setPrimaryBookmark } =
    useBookmarks();

  // Вибір дати: сьогодні (0) або завтра (1) у київському часі
  const [selectedDayOffset, setSelectedDayOffset] = useState<0 | 1>(0);
  const selectedDate = useMemo(() => kyivDateOffsetKey(selectedDayOffset), [selectedDayOffset]);

  // Черга, збережена окремо для кожної області.
  //
  // Список групп берём из строки каталога, а если она пуста — из `/queues` (тот же список, но
  // посчитанный по данным на сегодня). Это важно для областей, где оператор опубликовал день БЕЗ
  // отключений: слотов в БД нет, и каталог мог отдать пустой список — тогда человек не видел ни
  // одной кнопки группы. Если и `/queues` пуст, селектор покажет стандартные 12 подгрупп.
  const { data: queuesResponse } = useQueues(currentRegion);
  const queuesFromApi = useMemo(
    () => (queuesResponse?.data ?? []).map((item) => item.queue),
    [queuesResponse],
  );
  const availableQueues = useMemo(() => {
    const fromCatalog = currentRegionData.queues ?? [];
    if (fromCatalog.length > 0) return fromCatalog;
    return queuesFromApi;
  }, [currentRegionData.queues, queuesFromApi]);
  const { selectedQueue, selectQueue } = useRegionQueue(currentRegion, availableQueues);

  /** Перемикання на збережену закладку: зміна області + вибір її черги в один клік. */
  const applyBookmark = (b: { regionCpu: string; queue: string }) => {
    setRegion(b.regionCpu);
    selectQueue(b.queue);
  };

  /** Додати поточну область+чергу в закладки (або оновити головну). */
  const saveCurrentAsBookmark = () => {
    if (!selectedQueue || !currentRegionData.nameUa) return;
    const label = currentRegionData.nameUa;
    addBookmark({ label, regionCpu: currentRegion, queue: selectedQueue });
  };

  // Запит графіка для обраної черги, дати й області через єдиний клієнт
  const {
    data: scheduleResponse,
    isLoading: scheduleLoading,
    isError: scheduleError,
    refetch: refetchSchedule,
    isFallback: scheduleFromSnapshot,
  } = useQueueSchedule(selectedQueue ?? undefined, selectedDate, currentRegion);

  // Завантажуємо зріз по ВСІМ групах області: з нього береться офлайн-снимок, завдяки якому в
  // офлайні працюють усі кнопки груп, а не лише та, що її натиснули востаннє. Запит один на
  // область, тому окремо для кожної кнопки додаткових запитів не робимо.
  useUpcomingGroupOutages(currentRegion, 2);

  // Список групп области: он же несёт привязку «населённые пункты / улицы → группа» (тот же
  // `queuesResponse`, что и выше, — запрос один, кеш TanStack Query общий).
  const selectedQueuePlaces = (queuesResponse?.data ?? []).find((item) => item.queue === selectedQueue);

  // API отдаёт конверт { data: { queue, date, intervals, source, lastImportedAt } }, а fetcher()
  // (api/client.ts) возвращает res.json() целиком — поэтому график лежит в .data.
  // Раньше здесь было `scheduleResponse` без .data: intervals/source становились undefined,
  // hasRegionData — false, и главная показывала «Даних графіка немає» при непустом API-ответе.
  const schedule: QueueScheduleData | undefined =
    Array.isArray((scheduleResponse as { intervals?: unknown } | undefined)?.intervals)
      ? (scheduleResponse as unknown as QueueScheduleData)
      : scheduleResponse?.data;
  const intervals = schedule?.intervals ?? [];
  const hasSchedule = schedule?.source != null; // регион синхронизирован, дата есть в БД
  const hasIntervals = intervals.length > 0;
  // Показываем hasRegionData true, если регион синхронизирован (даже если для этой очереди интервалов нет)
  // или если по выбранной очереди реально пришли интервалы: пустой блок «Даних графіка немає»
  // не должен показываться, когда API уже вернул график.
  const hasRegionData = (currentRegionData.todaySlots ?? currentRegionData.slots) > 0 || hasSchedule || hasIntervals;

  // Секундний тик для обратного отсчёта. Зупиняється, коли вкладка не видна: иначе таймер
  // будил бы CPU телефона каждую секунду, пока приложение лежит в кармане.
  const now = useMinuteTicker();
  const { theme } = useTheme();

  // Розрахунок вікна графіка на вибрану добу (що зараз, коли наступне, скільки без світла)
  const windowSummary = useMemo(() => {
    return hasIntervals ? scheduleWindow(intervals, selectedDate, now) : null;
  }, [hasIntervals, intervals, selectedDate, now]);

  const isOff = Boolean(windowSummary?.isOff);

  // Цвет строки состояния телефона и заголовок вкладки следуют за статусом сети.
  // Минуты в заголовок идут отдельным ключом, а не собираются из предложения Hero:
  // склеивать переводы через replace значит сломать заголовок при любой правке текста.
  const chromeMinutes =
    isOff && windowSummary?.backInMinutes != null
      ? formatMinutesUk(windowSummary.backInMinutes)
      : !isOff && windowSummary?.nextInMinutes != null
        ? formatMinutesUk(windowSummary.nextInMinutes)
        : null;

  useDynamicChrome({
    status: !hasIntervals ? 'unknown' : isOff ? 'off' : 'on',
    theme,
    statusLabel: !hasIntervals
      ? t('home.heroUnknown')
      : isOff
        ? t('home.heroTitleOff')
        : t('home.heroTitleOn'),
    minutesLabel: chromeMinutes ? t('home.chromeMinutes', { time: chromeMinutes }) : null,
  });
  // (deleted_duplicate)
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
    <section className="space-y-4">
      {/* Hero — первый экран и главный ответ приложения. Отдельным компонентом: в нём
          четыре состояния и правило «пустой график ≠ свет есть», и это правило не должно
          размываться среди разметки страницы. */}
      <HeroStatus
        intervals={intervals}
        date={selectedDate}
        isOff={isOff}
        nextInMinutes={windowSummary?.nextInMinutes ?? null}
        backInMinutes={windowSummary?.backInMinutes ?? null}
        nextBoundaryAt={windowSummary?.offEndsAt ?? windowSummary?.nextStartsAt ?? null}
        fromCache={scheduleFromSnapshot}
        cachedAt={schedule?.lastImportedAt ?? null}
        loading={scheduleLoading && !schedule}
      />

      <div className="space-y-4 rounded-3xl border border-border bg-card p-4 sm:p-6">
      {/* Вибір області тепер один — у шапці, з пошуком (дизайн звідси й перенесено).
          Дубль на головній лише плутав: два способи обрати ту саму область. */}

      {/* 1.5. Швидкі закладки: збережені області+черги з РІЗНИХ областей України.
          Горизонтальний рядок со снапом, а не сетка-перенос: закладки — это быстрый
          переключатель, и перенос делал бы прыжок высоты при каждом добавлении. */}
      {bookmarks.length > 0 && (
        <div
          role="group"
          aria-label={t('home.bookmarks')}
          className="-mx-1 flex snap-x snap-mandatory items-center gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {bookmarks.map((bm) => {
            const isActive = bm.regionCpu === currentRegion && bm.queue === selectedQueue;
            const BookmarkIcon = bookmarkIcon(bm.label);
            return (
              <div
                key={bm.id}
                className={cn(
                  // M3 Filter Chip: форма-капсула, тон поверхности вместо рамки у активного чипа.
                  'inline-flex snap-start items-center gap-0.5 rounded-full py-1 pl-1 pr-1.5 transition-colors duration-200 ease-[var(--ease-m3-expressive-fast)]',
                  isActive
                    ? 'bg-primary-container text-on-primary-container shadow-xs'
                    : 'border border-outline-variant/70 bg-surface-container text-on-surface',
                )}
              >
                <button
                  type="button"
                  onClick={() => {
                    setPrimaryBookmark(bm.id);
                    applyBookmark(bm);
                  }}
                  aria-current={isActive ? 'true' : undefined}
                  className="inline-flex min-h-10 items-center gap-1.5 rounded-full px-2 text-xs font-bold transition-transform duration-200 ease-[var(--ease-m3-expressive-fast)] active:scale-[0.96]"
                >
                  {isActive ? (
                    <Check className="h-4 w-4" strokeWidth={2.5} aria-hidden />
                  ) : (
                    <BookmarkIcon className="h-4 w-4" strokeWidth={2.2} aria-hidden />
                  )}
                  <span className="max-w-40 truncate">{bm.label}</span>
                  <span className="rounded-full bg-surface-container-highest px-2 py-0.5 text-[11px] font-bold text-on-surface-variant tabular">
                    {bm.queue}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => removeBookmark(bm.id)}
                  aria-label={`${t('common.delete')} ${bm.label}`}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-destructive"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* 2. Панель керування: перемикач дати та вибір черги області */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Вибір черги (запам'ятовується для кожної області) */}
        <QueueSelector
          queues={availableQueues}
          selectedQueue={selectedQueue}
          onSelect={selectQueue}
          disabled={scheduleLoading}
        />

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={!selectedQueue}
            onClick={saveCurrentAsBookmark}
            aria-label={t('home.addToBookmarks')}
          >
            <Star className="h-3.5 w-3.5" aria-hidden />
            {t('home.addToBookmarks')}
          </Button>

          {/* Перемикач дати: Сьогодні / Завтра. Прежний был 28px высотой и ролью tablist
              без реальных панелей — мелкая цель для пальца и роли враньё. Новый — 44px. */}
          <DaySegment
            value={selectedDayOffset === 0 ? 'today' : 'tomorrow'}
            today={t('outages.today')}
            tomorrow={t('outages.tomorrow')}
            onChange={(next) => setSelectedDayOffset(next === 'tomorrow' ? 1 : 0)}
            className="self-start"
          />
        </div>
      </div>

      {/* Деликатная линия вместо волнистого разделителя: 1px и 6% белого — секция «управление»
          отделена от графика без декоративного шума. */}
      <div className="border-t border-hairline" aria-hidden />

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
          <Button variant="outline" size="sm" onClick={() => refetchSchedule()} className="gap-2">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            {t('common.retry')}
          </Button>
        </div>
      ) : currentRegionData.allClear === true && selectedDayOffset === 0 ? (
        /* «Оператор опублікував ГПВ на сьогодні, годин відключень у ньому немає» — це НЕ «даних
           немає»: у такої області в БД нуль слотів (зберігати нічого), і раніше тут показувався
           порожній стан. Тільки для «сьогодні»: на «завтра» фід міг нічого не опублікувати, і
           обіцяти «світло за графіком» на завтра ми не маємо права. */
        <div className="flex flex-col items-center justify-center rounded-2xl border border-success/30 bg-success/5 px-4 py-8 text-center sm:py-10">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-success/10 text-success">
            <Zap className="h-6 w-6" aria-hidden />
          </div>
          <h3 className="mt-3 text-base font-bold text-foreground">
            {t('regions.allClearTitle')}
          </h3>
          <p className="mt-1 max-w-md text-xs text-muted-foreground sm:text-sm">
            {t('regions.allClearDesc')}
          </p>
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
        </div>
      ) : !hasIntervals ? (
        /* Нет отключений для этой очереди на выбранную дату */
        <div className="space-y-4 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t('home.heroBySchedule')}
              </p>
              {hasSchedule ? (
                /* У региона есть данные — значит для очереди просто нет отключений */
                <h2 className="font-display text-3xl font-bold tracking-tight text-success sm:text-4xl">
                  {t('home.heroNoOutages')}
                </h2>
              ) : (
                /* Нет данных региона на эту дату — честно говорим что нет расписания */
                <h2 className="font-display text-3xl font-bold tracking-tight text-muted-foreground sm:text-4xl">
                  {t('home.heroNoData')}
                </h2>
              )}
            </div>
            {address && (
              <span className="truncate text-xs font-medium text-muted-foreground">{address}</span>
            )}
          </div>
          {!hasSchedule && (
            <div className="rounded-xl border border-dashed border-border bg-card/60 p-6 text-center text-sm text-muted-foreground">
              {t('schedule.notPublished')}
            </div>
          )}
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

              {/* Що входить у цю групу: населені пункти та вулиці, які джерело прив'язало до черги.
                  Якщо прив'язки немає — блок не показується (QueuePlacesChips повертає null). */}
              {selectedQueuePlaces && (
                <QueuePlacesChips
                  settlements={selectedQueuePlaces.settlements ?? []}
                  streetNames={selectedQueuePlaces.streetNames ?? []}
                  className="mt-2"
                />
              )}

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
            <Timeline24h intervals={intervals} date={selectedDate} />

            {/* Поделиться графиком. Текстом, а не картинкой: системное меню «Поделиться»
                с текстом поддерживают все платформы, а с файлами — единицы, и рисовать
                canvas ради простой задачи пришлось бы зря. */}
            {selectedQueue && (
              <div className="flex justify-end">
                <ShareSchedule
                  queue={selectedQueue}
                  regionName={currentRegionData.nameUa ?? currentRegion}
                  date={selectedDate}
                  intervals={intervals}
                  summaryLine={statusHeadline || t('home.heroUnknown')}
                />
              </div>
            )}
          </div>

          {/* Графік узято з офлайн-снимка, а не зі свіжої відповіді оператора. Кажемо про це
              явно: без підписки людина прийняла б вчорашні дані за сьогоднішні. */}
          {scheduleFromSnapshot && (
            <p className="text-[11px] text-muted-foreground/80">{t('home.scheduleFromSnapshot')}</p>
          )}

          {/* Швидкі дії */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3">
            <div className="flex flex-wrap gap-2">
              <Link
                to="/my-address"
                className="inline-flex min-h-10 items-center rounded-full border border-border bg-card px-4 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
              >
                {t('nav.myAddress')}
              </Link>
            </div>

            {schedule?.lastImportedAt && (
              <span className="text-[11px] text-muted-foreground">
                {t('common.updatedAt')} {formatKyivTime(schedule.lastImportedAt)}
              </span>
            )}
          </div>
        </div>
      )}
      </div>
    </section>
  );
};
