import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  BadgeCheck,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronUp,
  Pencil,
  FileQuestion,
  PhoneCall,
  RefreshCw,
  Star,
  X,
  Zap,
  ZapOff,
} from 'lucide-react';
import { PlaceIconMark } from '../places/PlaceIcon.js';
import { QueueSelector } from '../queue/QueueSelector.js';
import { Timeline24h } from '../schedule/Timeline24h.js';
import { ShareScheduleButton } from '../schedule/ShareScheduleButton.js';
import { HomeToolsPills } from './HomeToolsPills.js';
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
import { useNativeWidgetSync, type NativeWidgetState } from '../../hooks/useNativeWidgetSync.js';
import { getApiBaseUrl } from '@svitlo/core';
import { kyivDateOffsetKey } from '../../lib/outage-dates.js';
import {
  formatMinutesUk,
  minutesOfDay,
  OFF_STATE_CODE,
  scheduleWindow,
} from '../../lib/scheduleWindow.js';
import { dayPowerState, type DayPowerState } from '../../lib/day-status.js';
import type { QueueScheduleData, ScheduleIntervalUtc } from '@svitlo/shared';
import type { DaySchedule } from '../../lib/day-schedule.js';
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
 * Скільки місць видно на головній без «Ще».
 *
 * Чотири — межа швидкого перемикача: пʼятий чип уже починає виглядати як список і зʼїдає
 * перший екран. Решта ховається за «Ще N», а повний список із перейменуванням живе на
 * сторінці пошуку адреси.
 */
const PLACE_CHIP_LIMIT = 4;

export const HomeHeroSection: React.FC = () => {
  const { t } = useTranslation();
  const { currentRegion, currentRegionData, setRegion, isLoading: regionLoading } = useRegion();
  const { address } = useMyAddress();
  const { bookmarks, primaryBookmark, addBookmark, removeBookmark, setPrimaryBookmark, renameBookmark } =
    useBookmarks();
  const [showAllPlaces, setShowAllPlaces] = useState(false);
  const [editingBookmarkId, setEditingBookmarkId] = useState<string | null>(null);
  const [bookmarkDraft, setBookmarkDraft] = useState('');

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
  // Тот же запрос, но ответ нужен ещё и нативному виджету: из него берутся сегодняшние
  // часы без света и будущие интервалы для будильников. Кеш TanStack общий — лишнего
  // сетевого запроса нет.
  const { data: upcomingGroupOutages } = useUpcomingGroupOutages(currentRegion, 2);

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

  /**
   * Статус дня — единственный источник правды для героя, заголовка вкладки и виджета.
   *
   * Пустой день считаем подтверждённым (`allClear`) при явном `allClear` графика очереди, а
   * если слотов нет вовсе — из каталога области (там `allClear` про день «сьогодні»; на «завтра»
   * обещать «світло за графіком» нельзя). Ядро отличает это от «даних немає».
   */
  const allClear =
    !hasIntervals &&
    (schedule?.allClear === true || (selectedDayOffset === 0 && currentRegionData.allClear === true));
  const heroState: DayPowerState = useMemo(() => {
    if (allClear) return 'allClear';
    return dayPowerState(schedule, selectedDate, now).state;
  }, [allClear, schedule, selectedDate, now]);

  /**
   * Дві доби для планувальника: сьогодні й завтра.
   *
   * Основне джерело — `/schedules/upcoming` (там уже обидві дати однією відповіддю). Для вибраної
   * дати уточнюємо з `/schedules`: саме цей графік намальовано в таймлайні, і планувальник не
   * повинен радити вікно, якого на екрані немає.
   */
  const plannerDays = useMemo<DaySchedule[]>(() => {
    const todayKey = kyivDateOffsetKey(0);
    const tomorrowKey = kyivDateOffsetKey(1);
    const collect = (date: string): DaySchedule => {
      const entries = (upcomingGroupOutages?.data ?? []).filter(
        (item) => item.queue === selectedQueue && item.date === date,
      );
      let dayIntervals: ScheduleIntervalUtc[] = entries.flatMap((item) => item.intervals);
      let covered = entries.length > 0;
      if (date === selectedDate) {
        dayIntervals = intervals;
        covered =
          covered ||
          schedule?.covered === true ||
          schedule?.allClear === true ||
          dayIntervals.length > 0;
      }
      return { date, intervals: dayIntervals, covered };
    };
    return [collect(todayKey), collect(tomorrowKey)];
  }, [upcomingGroupOutages, selectedQueue, selectedDate, intervals, schedule]);


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
    status: heroState === 'off' ? 'off' : heroState === 'unknown' ? 'unknown' : 'on',
    theme,
    statusLabel:
      heroState === 'unknown'
        ? t('home.heroUnknown')
        : heroState === 'allClear'
          ? t('home.heroNoOutages')
          : heroState === 'off'
            ? t('home.heroTitleOff')
            : heroState === 'warning'
              ? t('home.heroTitleSoon')
              : t('home.heroTitleOn'),
    minutesLabel: chromeMinutes ? t('home.chromeMinutes', { time: chromeMinutes }) : null,
  });

  /**
   * Снимок для нативного Android-виджета и фоновых уведомлений.
   *
   * Считаем по данным области, а не только по выбранной дате: виджет на рабочем столе
   * обязан показывать «сейчас», даже если человек открыл «Завтра». `upcomingGroupOutages`
   * уже содержит сегодня и завтра, поэтому дополнительных запросов нет.
   */
  const widgetState = useMemo<NativeWidgetState | null>(() => {
    if (!selectedQueue || !currentRegionData.nameUa) return null;

    const nowMs = now.getTime();
    const todayKey = kyivDateOffsetKey(0);
    const groupEntries = (upcomingGroupOutages?.data ?? []).filter(
      (item) => item.queue === selectedQueue,
    );
    const todayEntries = groupEntries.filter((item) => item.date === todayKey);
    const allIntervals = groupEntries.flatMap((item) => item.intervals);
    const todayIntervals = todayEntries.flatMap((item) => item.intervals);

    const todayOffMinutes = todayIntervals
      .filter((interval) => interval.stateCode === OFF_STATE_CODE)
      .reduce(
        (sum, interval) =>
          sum +
          Math.max(
            0,
            minutesOfDay(interval.endsAt, todayKey) -
              minutesOfDay(interval.startsAt, todayKey),
          ),
        0,
      );

    // Для будильников нужны только отключения впереди: начало — за 15 минут, конец — момент,
    // когда свет возвращается. Текущее отключение тоже попадает (start подрезан до «сейчас»),
    // иначе уведомление о включении не запланировалось бы.
    const upcomingIntervals = allIntervals
      .filter(
        (interval) =>
          interval.stateCode === OFF_STATE_CODE && Date.parse(interval.endsAt) > nowMs,
      )
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
      .map((interval) => ({
        startEpochMs: Math.max(nowMs, Date.parse(interval.startsAt)),
        endEpochMs: Date.parse(interval.endsAt),
      }))
      .filter(
        (interval) =>
          Number.isFinite(interval.startEpochMs) && Number.isFinite(interval.endEpochMs),
      );

    const currentOff = allIntervals.find(
      (interval) =>
        interval.stateCode === OFF_STATE_CODE &&
        Date.parse(interval.startsAt) <= nowMs &&
        nowMs < Date.parse(interval.endsAt),
    );
    const nextOff = allIntervals
      .filter(
        (interval) =>
          interval.stateCode === OFF_STATE_CODE && Date.parse(interval.startsAt) > nowMs,
      )
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0];

    const isOffNow =
      Boolean(currentOff) ||
      todayEntries.some((item) => item.isActiveNow) ||
      // Страховка, когда `/schedules/upcoming` ещё не ответил, а график выбранной очереди уже
      // загружен: виджет не должен говорить «світло є» во время отключения.
      (selectedDayOffset === 0 && isOff);
    const nextChangeTime =
      currentOff?.endsAt ??
      nextOff?.startsAt ??
      windowSummary?.offEndsAt ??
      windowSummary?.nextStartsAt ??
      null;

    const statusText =
      !hasIntervals && todayIntervals.length === 0 && !allClear
        ? t('home.heroNoData')
        : isOffNow
          ? t('home.heroOff')
          : t('home.heroOn');
    const nextChangeLabel = nextChangeTime
      ? isOffNow
        ? t('home.widgetNextOn', { time: formatKyivTime(nextChangeTime) })
        : t('home.widgetNextOff', { time: formatKyivTime(nextChangeTime) })
      : t('home.widgetNoChanges');

    return {
      regionName: currentRegionData.nameUa,
      regionCpu: currentRegionData.cpu,
      apiBaseUrl: getApiBaseUrl(),
      queue: selectedQueue,
      isOff: isOffNow,
      statusText,
      nextChangeTime,
      nextChangeLabel,
      todayOutageHours: Math.round((todayOffMinutes / 60) * 10) / 10,
      upcomingIntervals,
      // Сегодняшние окна целиком (включая уже прошедшие): панель 4×2 показывает их списком, а
      // сумма часов без света за сутки должна совпадать с графиком, а не с «остатком».
      updatedAt: schedule?.lastImportedAt ?? new Date(nowMs).toISOString(),
      todayIntervals: todayIntervals
        .filter((interval) => interval.stateCode === OFF_STATE_CODE)
        .map((interval) => ({
          startEpochMs: Date.parse(interval.startsAt),
          endEpochMs: Date.parse(interval.endsAt),
        }))
        .filter(
          (interval) =>
            Number.isFinite(interval.startEpochMs) && Number.isFinite(interval.endEpochMs),
        ),
    };
  }, [
    selectedQueue,
    currentRegionData.nameUa,
    currentRegionData.cpu,
    upcomingGroupOutages,
    now,
    windowSummary,
    hasIntervals,
    selectedDayOffset,
    isOff,
    allClear,
    t,
  ]);

  useNativeWidgetSync(widgetState);

  return (
    <section className="space-y-4">
      {/* Hero — первый экран и главный ответ приложения. Отдельным компонентом: в нём
          четыре состояния и правило «пустой график ≠ свет есть», и это правило не должно
          размываться среди разметки страницы. */}
      <HeroStatus
        intervals={intervals}
        date={selectedDate}
        now={now}
        isOff={isOff}
        nextInMinutes={windowSummary?.nextInMinutes ?? null}
        backInMinutes={windowSummary?.backInMinutes ?? null}
        nextBoundaryAt={windowSummary?.offEndsAt ?? windowSummary?.nextStartsAt ?? null}
        allClear={allClear}
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
          // Края гасим маской: чипы, обрезанные рамкой контейнера, читаются как «сломанная
          // вёрстка», а не как намёк, что список листается вбок. Без этого подсказки не видно.
          className="-mx-1 flex snap-x snap-mandatory items-center gap-2 overflow-x-auto px-1 pb-1 scrollbar-none [&::-webkit-scrollbar]:hidden [mask-image:linear-gradient(to_right,transparent_0,black_12px,black_calc(100%-12px),transparent_100%)]"
        >
          {(showAllPlaces ? bookmarks : bookmarks.slice(0, PLACE_CHIP_LIMIT)).map((bm) => {
            const isActive = bm.regionCpu === currentRegion && bm.queue === selectedQueue;
            return (
              <div
                key={bm.id}
                className={cn(
                  // M3 Filter Chip: форма-капсула, тон поверхности вместо рамки у активного чипа.
                  'inline-flex snap-start items-center gap-0.5 rounded-full py-1 pl-1 pr-1.5 transition-colors duration-200 ease-m3-expressive-fast',
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
                  className="inline-flex min-h-10 items-center gap-1.5 rounded-full px-2 text-xs font-bold transition-transform duration-200 ease-m3-expressive-fast active:scale-96"
                >
                  {isActive ? (
                    <Check className="h-4 w-4" strokeWidth={2.5} aria-hidden />
                  ) : (
                    <PlaceIconMark icon={bm.icon} className="h-4 w-4" />
                  )}
                  <span className="max-w-40 truncate">{bm.label}</span>
                  {bm.addressConfirmed && (
                    <BadgeCheck
                      className="h-3.5 w-3.5 text-primary"
                      aria-label={t('addressWizard.confirmedByYou')}
                    />
                  )}
                  <span className="rounded-full bg-surface-container-highest px-2 py-0.5 text-[11px] font-bold text-on-surface-variant tabular">
                    {bm.queue}
                  </span>
                </button>
                {/* Управление закладкой — только у ВЫБРАННОЙ.
                    Раньше + и × висели у каждого чипа, из-за чего один чип занимал
                    пол-экрана, а палец целился переключить закладку и промахивался
                    в удаление. Теперь неактивные чипы — просто иконка, название и группа. */}
                {isActive ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingBookmarkId(bm.id);
                        setBookmarkDraft(bm.label);
                      }}
                      aria-label={t('home.renameBookmark', { label: bm.label })}
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-primary"
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeBookmark(bm.id)}
                      aria-label={`${t('common.delete')} ${bm.label}`}
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-destructive"
                    >
                      <X className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
                    </button>
                  </>
                ) : null}
              </div>
            );
          })}

          {/* «Ще» — не навігація, а розкриття ряду: людина не втрачає контекст головної.
              Рахунок показуємо тільки для прихованих, щоб кнопка не обіцяла більше, ніж є. */}
          {bookmarks.length > PLACE_CHIP_LIMIT && (
            <button
              type="button"
              onClick={() => setShowAllPlaces((value) => !value)}
              aria-expanded={showAllPlaces}
              className="inline-flex min-h-10 shrink-0 snap-start items-center gap-1 rounded-full border border-outline-variant/70 bg-surface-container px-3 text-xs font-bold text-on-surface transition-colors hover:bg-surface-container-high"
            >
              {showAllPlaces ? (
                <ChevronUp className="h-4 w-4" aria-hidden />
              ) : (
                <ChevronDown className="h-4 w-4" aria-hidden />
              )}
              {showAllPlaces
                ? t('places.hideMoreChips')
                : t('places.moreChips', { count: bookmarks.length - PLACE_CHIP_LIMIT })}
            </button>
          )}
          {editingBookmarkId && (
            <form
              className="flex min-w-56 shrink-0 snap-start items-center gap-1.5 rounded-full border border-primary/40 bg-surface-container px-2 py-1"
              onSubmit={(event) => {
                event.preventDefault();
                renameBookmark(editingBookmarkId, bookmarkDraft);
                setEditingBookmarkId(null);
              }}
            >
              <input
                autoFocus
                maxLength={24}
                value={bookmarkDraft}
                onChange={(event) => setBookmarkDraft(event.target.value)}
                aria-label={t('home.bookmarkName')}
                className="h-9 min-w-0 flex-1 bg-transparent px-2 text-sm text-on-surface outline-hidden"
              />
              <button type="submit" className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-primary text-on-primary" aria-label={t('common.save')}>
                <Check className="h-4 w-4" aria-hidden />
              </button>
              <button type="button" onClick={() => setEditingBookmarkId(null)} className="inline-flex h-9 w-9 items-center justify-center rounded-full text-on-surface-variant" aria-label={t('common.cancel')}>
                <X className="h-4 w-4" aria-hidden />
              </button>
            </form>
          )}
        </div>
      )}

      {/* 2. Панель керування: перемикач дати та вибір черги в одній зручній картці */}
      <div className="flex min-w-0 flex-col gap-3 rounded-2xl border border-hairline bg-surface-container-low/60 p-3 sm:p-4">
        <div className="flex items-center gap-2">
          {/* Перемикач дати: Сьогодні / Завтра */}
          <DaySegment
            value={selectedDayOffset === 0 ? 'today' : 'tomorrow'}
            today={t('outages.today')}
            tomorrow={t('outages.tomorrow')}
            onChange={(next) => setSelectedDayOffset(next === 'tomorrow' ? 1 : 0)}
            className="min-w-0 flex-1 sm:w-auto sm:flex-none"
          />

          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-hairline bg-surface-container text-on-surface hover:bg-surface-container-high"
            disabled={!selectedQueue}
            onClick={saveCurrentAsBookmark}
            aria-label={t('home.addToBookmarks')}
            title={t('home.addToBookmarks')}
          >
            <Star className="h-4 w-4" aria-hidden />
          </Button>
        </div>

        {/* Вибір черги: чиста рівна сітка 6×2 без зайвого тексту «Черга:» */}
        <QueueSelector
          queues={availableQueues}
          selectedQueue={selectedQueue}
          onSelect={selectQueue}
          disabled={scheduleLoading}
          hideHeader
          className="w-full min-w-0"
        />
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

              {/* Статус и таймер живут только в HeroStatus сверху. Здесь раньше стояли
                  второй огромный «Світло є» и повтор «Наступне відключення через 3 год 35 хв»:
                  на одном экране два одинаковых ответа, и человек не понимал, какой из них
                  главный. Нижняя карточка отвечает на другой вопрос — «когда именно». */}
            </div>
          </div>

          {/* Сводка суток и «Поділитися» — одной строкой, как заголовок шкалы. */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            {windowSummary ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface-container-high px-3 py-1.5 text-xs font-semibold text-on-surface-variant">
                {t('home.offTodayLabel')}:
                <span className="tabular text-sm font-bold text-foreground">
                  {formatMinutesUk(windowSummary.offMinutes)}
                </span>
              </span>
            ) : (
              <span />
            )}
            {selectedQueue && (
              <ShareScheduleButton
                queue={selectedQueue}
                regionName={currentRegionData.nameUa ?? currentRegion}
                date={selectedDate}
                intervals={intervals}
                className="w-full sm:w-auto"
              />
            )}
          </div>

          {/* 24-годинний горизонтальний таймлайн із півгодинними комірками */}
          <div className="pt-1">
            <Timeline24h intervals={intervals} date={selectedDate} />

            {/* Компактні інструменти: планувальник приладів і порівняння черг за пігулками.
                Під таймлайном і кнопкою «Поділитися» — там, де людина вже побачила вікна зі
                світлом і хоче щось із ними зробити. */}
            {selectedQueue && (
              <HomeToolsPills
                region={currentRegion}
                queue={selectedQueue}
                date={selectedDate}
                days={plannerDays}
                now={now}
                className="mt-3"
              />
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
