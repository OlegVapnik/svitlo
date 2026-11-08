import type { GroupOutageSummary, Outage, ScheduleIntervalUtc } from '@svitlo/shared';
import {
  kyivDateKeyFromMs,
  mergeIntervals,
  minutesOfDay,
  shiftYmd,
  OFF_STATE_CODE,
  type MinuteInterval,
} from '@svitlo/domain';
import { minutesToHm } from './scheduleWindow';
import { isSoonMinutes } from './day-status';
import { canonicalQueueCode, compareQueueCodes } from './queue';

/**
 * Клиентские правила по списку отключений: что считать аварией и что ещё впереди.
 *
 * Раньше оба правила были инлайном в экранах (`AccidentBanner` застосунку и `HomePage` web), и
 * одно и то же событие могло попасть в «аварии» на одной платформе и не попасть на другой.
 */

/** Отключение считается аварией, только если это ремонт и он идёт прямо сейчас. */
export interface AccidentLike {
  kind?: string | null;
  status?: string | null;
}

export function activeAccidents<T extends AccidentLike>(items: readonly T[]): T[] {
  return items.filter((item) => item.kind === 'repair' && item.status === 'active');
}

/**
 * Делит интервалы на будущие и прошедшие по моменту окончания.
 *
 * `nowMs` передаётся явно: экран тикает раз в минуту, и результат должен меняться вместе с
 * тиком, а не вместе с временем рендера.
 */
export function splitFuturePast<T extends { endsAt: string }>(
  items: readonly T[],
  nowMs: number,
): { future: T[]; past: T[] } {
  const future: T[] = [];
  const past: T[] = [];
  for (const item of items) {
    const end = Date.parse(item.endsAt);
    if (Number.isFinite(end) && end > nowMs) future.push(item);
    else past.push(item);
  }
  return { future, past };
}

/** Очередь с одинаковым набором окон на одну дату: одна карточка вместо N групп. */
export interface UpcomingGroup {
  date: string;
  queues: string[];
  intervals: GroupOutageSummary['intervals'];
  isActiveNow: boolean;
  settlements: string[];
  streetNames: string[];
}

/**
 * Склеивает группы с одинаковым расписанием на одну дату.
 *
 * Оператор публикует один и тот же график для десятка очередей. Без склейки блок «Найближчі»
 * показывал десять одинаковых карточек, и человек листал их, чтобы найти свою.
 */
export function mergeUpcomingGroups(items: readonly GroupOutageSummary[]): UpcomingGroup[] {
  const merged = new Map<string, UpcomingGroup>();
  for (const item of items) {
    const signature = item.intervals
      .map((interval) => `${interval.startsAt}-${interval.endsAt}`)
      .sort()
      .join(',');
    const key = `${item.date}|${signature}`;
    const existing = merged.get(key);
    if (existing) {
      if (!existing.queues.includes(item.queue)) existing.queues.push(item.queue);
      existing.isActiveNow = existing.isActiveNow || item.isActiveNow;
      for (const name of item.streetNames) {
        if (!existing.streetNames.includes(name)) existing.streetNames.push(name);
      }
      for (const name of item.settlements) {
        if (!existing.settlements.includes(name)) existing.settlements.push(name);
      }
      continue;
    }
    merged.set(key, {
      date: item.date,
      queues: [item.queue],
      intervals: item.intervals,
      isActiveNow: item.isActiveNow,
      streetNames: [...item.streetNames],
      settlements: [...item.settlements],
    });
  }
  return [...merged.values()].map((group) => ({
    ...group,
    queues: [...group.queues].sort(compareQueueCodes),
  }));
}

/** Причина отключения с уже склеенными окнами — для компактной карточки вместо N строк. */
export interface ReasonBucket {
  key: string;
  reason: string;
  items: Outage[];
  windows: MinuteInterval[];
  date: string;
}

/**
 * Группирует точечные отключения по причине и склеивает смежные получасовки в окна.
 *
 * Человеку нужно «6 год без світла», а не двенадцать кнопок `18:00–18:30`, `18:30–19:00`.
 * Больше всего повторов — первым: развёрнутая группа должна быть осмысленной.
 */
export function groupOutagesByReason(items: readonly Outage[], date: string): ReasonBucket[] {
  const buckets = new Map<string, ReasonBucket>();
  for (const item of items) {
    const reason = item.reason?.trim() || '';
    const key = `${item.kind ?? ''}|${reason}`;
    const existing = buckets.get(key);
    if (existing) existing.items.push(item);
    else buckets.set(key, { key, reason, items: [item], windows: [], date });
  }
  for (const bucket of buckets.values()) {
    bucket.windows = mergeIntervals(bucket.items);
  }
  return [...buckets.values()].sort((a, b) => b.windows.length - a.windows.length);
}

/** Место ремонта: первая улица события, иначе название населённого пункта. */
export interface PlaceGroup {
  label: string;
  items: Outage[];
}

/**
 * Группирует ремонты по месту и сортирует по времени начала.
 *
 * Для ремонта настоящий адрес — улица из `outage_event_addresses`, а не `areaName`: иначе все
 * работы области слипаются в одну плашку. Первыми идут ближайшие работы, а не самые частые.
 */
export function groupOutagesByPlace(
  items: readonly Outage[],
  fallbackLabel: string,
): PlaceGroup[] {
  const groups = new Map<string, PlaceGroup>();
  for (const outage of items) {
    const key = outage.streets?.[0] ?? (outage.areaName || fallbackLabel);
    const existing = groups.get(key);
    if (existing) existing.items.push(outage);
    else groups.set(key, { label: key, items: [outage] });
  }
  return [...groups.values()].sort((a, b) => {
    const firstA = Math.min(...a.items.map((item) => Date.parse(item.startsAt) || Number.POSITIVE_INFINITY));
    const firstB = Math.min(...b.items.map((item) => Date.parse(item.startsAt) || Number.POSITIVE_INFINITY));
    return firstA - firstB;
  });
}

/**
 * Событие ленты «Відключення»: плановое окно графика или точечный ремонт.
 *
 * Тексты («Скоро відключення») остаются в экране: здесь только факты — вид, очередь, окно,
 * причина. Иначе украинские строки переехали бы в общее ядро, которым пользуется и web.
 */
export interface OutageEvent {
  id: string;
  kind: 'active' | 'soon' | 'scheduled' | 'repair';
  queue: string | null;
  startsAt: string;
  endsAt: string;
  timeFrom: string | null;
  timeTo: string | null;
  reason: string | null;
  areaName: string | null;
}

/**
 * Собирает единую ленту событий на дату: окна графика региона плюс аварийные отключения.
 *
 * Раньше весь этот цикл жил в экране «Монітор»: он же решал, что считать активным, что
 * «скоро», а что уже прошло. Теперь правило одно и то же для любого клиента, а экран только
 * подписывает готовые события.
 */
export function buildOutageEvents(
  upcoming: readonly GroupOutageSummary[],
  outages: readonly Outage[],
  input: { date: string; now: Date; regionName?: string },
): OutageEvent[] {
  const nowMs = input.now.getTime();
  const events: OutageEvent[] = [];

  for (const group of upcoming) {
    if (group.date !== input.date) continue;
    for (const interval of group.intervals) {
      if (interval.stateCode !== OFF_STATE_CODE) continue;
      const startMs = Date.parse(interval.startsAt);
      const endMs = Date.parse(interval.endsAt);
      if (!Number.isFinite(endMs) || endMs < nowMs) continue;

      const isActive = startMs <= nowMs && nowMs < endMs;
      const isSoon = !isActive && isSoonMinutes((startMs - nowMs) / 60_000);
      events.push({
        id: `plan-${group.queue}-${interval.startsAt}`,
        kind: isActive ? 'active' : isSoon ? 'soon' : 'scheduled',
        queue: group.queue,
        startsAt: interval.startsAt,
        endsAt: interval.endsAt,
        timeFrom:
          interval.localTimeFrom || minutesToHm(minutesOfDay(interval.startsAt, input.date)),
        timeTo: interval.localTimeTo || minutesToHm(minutesOfDay(interval.endsAt, input.date)),
        reason: null,
        areaName: null,
      });
    }
  }

  for (const outage of outages) {
    events.push({
      id: `outage-${outage.id}`,
      kind: 'repair',
      queue: null,
      startsAt: outage.startsAt,
      endsAt: outage.endsAt,
      timeFrom: null,
      timeTo: null,
      reason: outage.reason ?? null,
      areaName: outage.areaName || input.regionName || null,
    });
  }

  const rank = (kind: OutageEvent['kind']): number =>
    kind === 'active' ? 0 : kind === 'soon' ? 1 : kind === 'repair' ? 2 : 3;
  return events.sort(
    (a, b) => rank(a.kind) - rank(b.kind) || Date.parse(a.startsAt) - Date.parse(b.startsAt),
  );
}

/**
 * Окно внутри карточки очереди: одно отключение с уже готовыми часами и состоянием.
 *
 * `minutes` — сколько минут без света длится именно это окно: сумма по карточке считается
 * здесь, а не в экране, иначе web и mobile показывали бы разные числа.
 */
export interface QueueOutageWindow {
  startsAt: string;
  endsAt: string;
  timeFrom: string;
  timeTo: string;
  minutes: number;
  state: 'active' | 'soon' | 'past' | 'scheduled';
}

/** Одна карточка на очередь: все её окна за день вместо карточки на каждое окно. */
export interface QueueOutageCard {
  /** `null` — аварийный ремонт без привязки к очереди (адресная работа). */
  queue: string | null;
  windows: QueueOutageWindow[];
  /** Суммарные минуты без света за выбранный день (с 1D-слиянием перекрытий). */
  offMinutes: number;
  /** Минуты без света строго за сегодняшние сутки (Киев). */
  todayOffMinutes: number;
  /** Минуты без света строго за завтрашние сутки (Киев). */
  tomorrowOffMinutes: number;
  /** Есть ли окно, которое идёт прямо сейчас. */
  isActiveNow: boolean;
  /** Ближайшее будущее окно (для «далі о 17:00»), если сейчас света нет — `null`. */
  nextStartsAt: string | null;
  isMine: boolean;
}

export interface QueueOutageCardsInput {
  /** Очереди пользователя: поточна на головній і збережені місця. */
  mine?: readonly string[];
  /** Область — потрібна для регіональних синонімів (`3` ≡ `3/1` у Києві). */
  regionCpu?: string | null;
  now: Date;
  /** Выбранная дата (YYYY-MM-DD), если карточка строится для конкретного дня. */
  date?: string;
}

/**
 * Склеює ленту событий в карточки по очередям.
 *
 * Раньше «Відключення» рисовало карточку на КАЖНОЕ окно: у 12 очередей по два окна в день
 * получалась простыня из 25 карточек, и свою очередь человек искал глазами дважды. Теперь
 * одна очередь — одна карточка со списком окон, суммарными часами и статусом.
 *
 * Порядок: сначала «мої» очереди (поточна + збережені місця), затем остальные по
 * `compareQueueCodes`, ремонты — в конце: это не графік, а адресная авария.
 */
export function groupOutageEventsByQueue(
  events: readonly OutageEvent[],
  input: QueueOutageCardsInput,
): QueueOutageCard[] {
  const nowMs = input.now.getTime();
  const todayYmd = kyivDateKeyFromMs(nowMs);
  const tomorrowYmd = shiftYmd(todayYmd, 1);
  const selectedYmd = input.date ?? todayYmd;

  const mine = new Set((input.mine ?? []).map((queue) => canonicalQueueCode(input.regionCpu, queue)));
  const cards = new Map<string, QueueOutageCard>();
  const queueIntervals = new Map<
    string,
    { today: MinuteInterval[]; tomorrow: MinuteInterval[]; selected: MinuteInterval[] }
  >();

  for (const event of events) {
    if (event.kind === 'repair') continue;
    const key = event.queue ?? '';
    const startMs = Date.parse(event.startsAt);
    const endMs = Date.parse(event.endsAt);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue;

    let card = cards.get(key);
    if (!card) {
      card = {
        queue: event.queue,
        windows: [],
        offMinutes: 0,
        todayOffMinutes: 0,
        tomorrowOffMinutes: 0,
        isActiveNow: false,
        nextStartsAt: null,
        isMine: event.queue != null && mine.has(canonicalQueueCode(input.regionCpu, event.queue)),
      };
      cards.set(key, card);
      queueIntervals.set(key, { today: [], tomorrow: [], selected: [] });
    }

    const intervals = queueIntervals.get(key)!;
    const minutes = Math.round((endMs - startMs) / 60_000);
    const state: QueueOutageWindow['state'] =
      startMs <= nowMs && nowMs < endMs
        ? 'active'
        : event.kind === 'soon'
          ? 'soon'
          : endMs <= nowMs
            ? 'past'
            : 'scheduled';

    const existingWindow = card.windows.find(
      (w) => w.startsAt === event.startsAt && w.endsAt === event.endsAt,
    );
    if (!existingWindow) {
      card.windows.push({
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        timeFrom: event.timeFrom ?? '',
        timeTo: event.timeTo ?? '',
        minutes,
        state,
      });
    }

    const todayStart = minutesOfDay(event.startsAt, todayYmd);
    const todayEnd = minutesOfDay(event.endsAt, todayYmd);
    if (todayEnd > todayStart) {
      intervals.today.push({ startMin: todayStart, endMin: todayEnd });
    }

    const tomStart = minutesOfDay(event.startsAt, tomorrowYmd);
    const tomEnd = minutesOfDay(event.endsAt, tomorrowYmd);
    if (tomEnd > tomStart) {
      intervals.tomorrow.push({ startMin: tomStart, endMin: tomEnd });
    }

    const selStart = minutesOfDay(event.startsAt, selectedYmd);
    const selEnd = minutesOfDay(event.endsAt, selectedYmd);
    if (selEnd > selStart) {
      intervals.selected.push({ startMin: selStart, endMin: selEnd });
    }

    if (state === 'active') card.isActiveNow = true;
    if (state === 'scheduled' || state === 'soon') {
      if (!card.nextStartsAt || Date.parse(card.nextStartsAt) > startMs) card.nextStartsAt = event.startsAt;
    }
  }

  for (const [key, card] of cards.entries()) {
    const intervals = queueIntervals.get(key)!;
    const mergedToday = mergeIntervals(intervals.today);
    const mergedTom = mergeIntervals(intervals.tomorrow);
    const mergedSel = mergeIntervals(intervals.selected);

    const durationOf = (i: any) => (i.endMin ?? i.end ?? 0) - (i.startMin ?? i.start ?? 0);
    card.todayOffMinutes = mergedToday.reduce((sum, i) => sum + durationOf(i), 0);
    card.tomorrowOffMinutes = mergedTom.reduce((sum, i) => sum + durationOf(i), 0);
    card.offMinutes = mergedSel.reduce((sum, i) => sum + durationOf(i), 0);

    if (card.offMinutes === 0) {
      if (card.todayOffMinutes > 0) card.offMinutes = card.todayOffMinutes;
      else if (card.tomorrowOffMinutes > 0) card.offMinutes = card.tomorrowOffMinutes;
    }

    card.windows.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
    if (!card.nextStartsAt) card.nextStartsAt = null;
  }

  const result = [...cards.values()];
  return result.sort((a, b) => {
    if (a.isMine !== b.isMine) return a.isMine ? -1 : 1;
    if (a.queue == null || b.queue == null) return a.queue == null ? 1 : -1;
    return compareQueueCodes(a.queue, b.queue);
  });
}

export const buildQueueOutageCards = groupOutageEventsByQueue;

/**
 * Аварийные ремонты для той же вкладки: карточка на ремонт, но без «черги».
 *
 * Отдельная функция, а не поле в `QueueOutageCard`: у ремонта нет очереди и нет статуса
 * «за графіком», и смешивать его с плановыми окнами — значит обещать график, которого нет.
 */
export function repairEvents(events: readonly OutageEvent[]): OutageEvent[] {
  return events
    .filter((event) => event.kind === 'repair')
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

/** Интервал отключения в миллисекундах — формат, который ждёт нативный виджет. */
export interface WidgetInterval {
  startEpochMs: number;
  endEpochMs: number;
}

/**
 * Снимок для нативного Android-виджета и фоновых уведомлений.
 *
 * Считаем по данным области, а не только по выбранной дате: виджет на рабочем столе обязан
 * показывать «сейчас», даже если человек открыл «Завтра». Тексты сюда не входят — ядро
 * возвращает факты и вид подписи (`nextChangeKind`), а слова подставляет i18n экрана.
 */
export interface WidgetSnapshot {
  isOff: boolean;
  /** Есть ли данные, чтобы вообще утверждать «світло є»: пустой график без `allClear` — нет. */
  hasData: boolean;
  nextChangeTime: string | null;
  /** Что произойдёт в `nextChangeTime`: свет вернётся, отключат или изменений нет. */
  nextChangeKind: 'on' | 'off' | 'none';
  todayOutageHours: number;
  upcomingIntervals: WidgetInterval[];
  todayIntervals: WidgetInterval[];
  updatedAt: string;
}

export interface WidgetSnapshotInput {
  queue: string | null | undefined;
  todayKey: string;
  now: Date | number;
  upcoming: ReadonlyArray<{
    queue: string;
    date: string;
    isActiveNow?: boolean;
    intervals: readonly ScheduleIntervalUtc[];
  }>;
  schedule?: {
    intervals?: readonly ScheduleIntervalUtc[];
    lastImportedAt?: string | null;
  } | null;
  windowSummary?: {
    offEndsAt?: string | null;
    nextStartsAt?: string | null;
  } | null;
  selectedDayOffset: number;
  isOff: boolean;
  hasIntervals: boolean;
  allClear: boolean;
}

function toWidgetInterval(interval: ScheduleIntervalUtc): WidgetInterval | null {
  const startEpochMs = Date.parse(interval.startsAt);
  const endEpochMs = Date.parse(interval.endsAt);
  if (!Number.isFinite(startEpochMs) || !Number.isFinite(endEpochMs)) return null;
  return { startEpochMs, endEpochMs };
}

export function buildWidgetSnapshot(input: WidgetSnapshotInput): WidgetSnapshot | null {
  if (!input.queue) return null;
  const nowMs = input.now instanceof Date ? input.now.getTime() : input.now;
  if (!Number.isFinite(nowMs)) return null;

  const groupEntries = input.upcoming.filter((item) => item.queue === input.queue);
  const todayEntries = groupEntries.filter((item) => item.date === input.todayKey);
  const allIntervals = groupEntries.flatMap((item) => item.intervals);
  const todayIntervals = todayEntries.flatMap((item) => item.intervals);

  const todayOffMinutes = todayIntervals
    .filter((interval) => interval.stateCode === OFF_STATE_CODE)
    .reduce((sum, interval) => {
      const span =
        minutesOfDay(interval.endsAt, input.todayKey) -
        minutesOfDay(interval.startsAt, input.todayKey);
      // Битая дата от источника даёт NaN: одна такая запись не должна обнулять весь счётчик.
      return Number.isFinite(span) ? sum + Math.max(0, span) : sum;
    }, 0);

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
    (input.selectedDayOffset === 0 && input.isOff);

  const nextChangeTime =
    currentOff?.endsAt ??
    nextOff?.startsAt ??
    input.windowSummary?.offEndsAt ??
    input.windowSummary?.nextStartsAt ??
    null;

  return {
    isOff: isOffNow,
    hasData: !(!input.hasIntervals && todayIntervals.length === 0 && !input.allClear),
    nextChangeTime,
    nextChangeKind: nextChangeTime == null ? 'none' : isOffNow ? 'on' : 'off',
    todayOutageHours: Math.round((todayOffMinutes / 60) * 10) / 10,
    upcomingIntervals,
    // Сегодняшние окна целиком (включая уже прошедшие): панель 4×2 показывает их списком, а
    // сумма часов без света за сутки должна совпадать с графиком, а не с «остатком».
    todayIntervals: todayIntervals
      .filter((interval) => interval.stateCode === OFF_STATE_CODE)
      .map(toWidgetInterval)
      .filter((interval): interval is WidgetInterval => interval != null),
    updatedAt: input.schedule?.lastImportedAt ?? new Date(nowMs).toISOString(),
  };
}
