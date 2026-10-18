import { z } from 'zod';

export type OutageStatus = 'scheduled' | 'active' | 'finished' | 'cancelled';
export type OperatorStateCode = 1 | 2 | 3;
export interface OperatorInterval { time_from: string; time_to: string; queue: OperatorStateCode; }
export interface OperatorState { name: string; color: string; }
export interface OperatorScheduleResponse { status?: string; aData: OperatorInterval[]; aState: Record<string, OperatorState>; }
export interface ScheduleIntervalUtc { startsAt: string; endsAt: string; stateCode: OperatorStateCode; stateName: string; stateColor: string; }
export interface Outage { id: string; startsAt: string; endsAt: string; areaName: string; addressesRaw: string; addressesNormalized: string;
  /** Улицы события без номеров домов (из outage_event_addresses). Пусто — источник адрес не отдал. */
  streets?: string[];
  /**
   * 'group' — плановое отключение по графику ГПВ (schedule_slots, одна запись на группу);
   * 'repair' — точечный ремонт по адресам (outage_events). Различать нужно, потому что это
   * разные сущности: у группы нет адреса, а у ремонта нет группы.
   */
  kind?: 'group' | 'repair';
  /** Код группы для kind='group', напр. «2/2». */
  group?: string; reason?: string | null; status: OutageStatus; queue?: number | null; source: string; sourceId: string; contentHash: string; firstSeenAt: string; updatedAt: string; }
export interface Incident {
  id: string;
  title: string;
  description: string;
  startedAt: string;
  etaAt?: string | null;
  severity: string;
  status: string;
  /** 'outage' — аварійне/ремонтне відключення з даних оператора; 'report' — повідомлення (Telegram, news). */
  kind?: 'outage' | 'report';
  /** Населений пункт / район, де сталася подія (видобуто з тексту). */
  areaName?: string | null;
  /** Причина події (видобуто з тексту): обстріл, пошкодження мережі, ремонт тощо. */
  reason?: string | null;
  /** Посилання на першоджерело (сторінка оператора / повідомлення Telegram). */
  sourceUrl?: string | null;
}
export interface StatusResponse { grid: { level: 'stable' | 'warning' | 'emergency'; message: string }; activeOutages: number; scheduledOutages: number;
  /** Сколько групп области сейчас по графику ГПВ без света (region из ?region=). */
  activeGroups?: number;
  /** Сколько групп области погашены дальше сегодня по графику ГПВ. */
  scheduledGroups?: number; activeIncidents: number; scheduledIncidents?: number; totalIncidents?: number; lastUpdatedAt?: string | null; dataStale?: boolean; /** Оцінка моменту наступной спроби опитування (пауза circuit breaker або наступний слот); null — планувальник вимкнено. */ nextAttemptAt?: string | null; /** Остання помилка джерела без персональних даних (уже санитизована на боці API). */ lastError?: string | null; /** До цього моменту джерело на паузі; null — не на паузі. */ pausedUntil?: string | null; /** Невдач підряд при опитуванні джерела. */ consecutiveParseFailures?: number; powerSummary?: PowerSummary | null; }
export interface PaginationQuery { page: number; limit: number; }
export interface OutageFilters { query?: string; status?: OutageStatus; queue?: number; area?: string; region?: string; dateFrom?: string; dateTo?: string; limit?: number; }
export interface OutageListResponse { data: Outage[]; meta?: Record<string, unknown>; }
export interface OutageDetailResponse { data: Outage; }
export interface OutageStatsResponse { data: OutageStats; }
export interface IncidentListResponse { data: Incident[]; }
/**
 * Область ГПВ у каталозі `GET /api/v1/regions`. `cpu` — ідентифікатор із дзеркала
 * (`chernihivska-oblast`, `kyiv-city`), він же ключ у `schedule_slots.region`.
 */
export interface RegionSummary {
  cpu: string;
  /** Українська назва для показу. Якщо фід її не віддав — це сам `cpu` (вигадувати назву не можна). */
  nameUa: string;
  /** Англійська назва, якщо дзеркало її віддає; інакше `null` (трансліт не вигадуємо). */
  nameEn: string | null;
  /** Черги області у форматі застосунку (`1/1`, `2/2`): фід або вже збережені слоти. */
  queues: string[];
  /** Скільки слотів області збережено в БД (0 = ще не імпортовано). */
  slots: number;
  /**
   * Скільки з цих слотів припадає на сьогодні й завтра.
   *
   * Окреме поле, бо `slots` — це вся історія: у Закарпатській області в БД лежали 6 слотів від
   * 1 липня, і бейдж «6 сл.» читався як «графік на сьогодні завантажено», хоча на екрані було
   * порожньо. Бейдж і порожній стан спираються на `todaySlots`; за його відсутності (старий
   * кеш/офлайн-пакет) клієнт падає назад на `slots`.
   */
  todaySlots?: number;
  /** Остання дата зі слотами в БД (`YYYY-MM-DD`) або `null`. */
  lastDate: string | null;
  /**
   * На `lastDate` оператор опублікував ГПВ, і жодної години відключення в ньому немає.
   *
   * Разом із `slots === 0` це «відключень за графіком немає», а не «даних немає»: зеркало ГПВ
   * віддає і «світло за графіком» (код 1), і без цього поля фронтенд не міг відрізнити
   * «опубліковано, але без відключень» від «не публікували нічого» — і писав «Немає даних» там,
   * де оператор графік опублікував.
   */
  allClear?: boolean;
  /**
   * `cpu` фіда, під якими реально лежать дані цієї області (`schedule_slots.region`).
   *
   * Каталог показує канонічні області, а фід віддає їх під власними ключами: Київська область —
   * `kiivska-oblast`, Київ — `kyiv`, а м. Дніпро взагалі двома ключами (`dnipro-cek` + `dnipro-dnem`,
   * ЦЕК і ДнЕМ). Клієнту потрібен саме ключ фіда, щоб запитати графік: він же ключ у
   * `/schedules`, `/queues` і в закладках.
   */
  feedKeys?: string[];
  /**
   * Ця область — підобласть іншої (наприклад `dnipro-cek` під `dnipropetrovska-oblast`).
   *
   * Виділяємо тому, що «м. Дніпро (ЦЕК)» і «м. Дніпро (ДнЕМ)» — різні мережі з однаковою
   * нумерацією черг, і злити їхні графіки в один означало б показати години відключень, яких у
   * людини немає. Каталог віддає батьківську область як групу, а підобласті — як вибір мережі.
   */
  parentCpu?: string;
}

export interface RegionListResponse { data: RegionSummary[]; }

/** Формат `cpu` області: kebab-case з малих латинських літер і цифр. */
export const REGION_CPU_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Чи схоже значення на `cpu` області. Використовується для валідації `?region=`: сміття в параметрі —
 * це помилка запиту, а коректний, але невідомий `cpu` — ні (він дає чесний порожній графік).
 */
export function isRegionCpu(value: unknown): value is string {
  return typeof value === 'string' && REGION_CPU_PATTERN.test(value.trim());
}
export interface OutageStats { byHour: Array<{ hour: number; count: number; totalMinutes: number }>; byDay: Array<{ date: string; count: number; totalMinutes: number }>; byArea: Array<{ areaName: string; count: number; totalMinutes: number }>; heatmap: Array<{ dayOfWeek: number; hour: number; count: number }>; totalActive: number; totalScheduled: number; }

/** Підсумок по часовому вікну: скільки часу без світла та скільки зі світлом. */
export interface PowerWindowSummary {
  /** Підпис вікна, напр. «за добу» / «за 24 години». */
  windowLabel: string;
  /** Довжина вікна в хвилинах. */
  windowMinutes: number;
  /** Сумарний час без світла (хвилини, з урахуванням перетинів інтервалів). */
  outageMinutes: number;
  /** Час зі світлом (хвилини). */
  poweredMinutes: number;
  /** Надійність у відсотках: poweredMinutes / windowMinutes, округлено до 0.1. */
  reliabilityPct: number;
  /** Кількість записів про перерви у вікні. */
  outageCount: number;
  /** Чи є взагалі дані за вікно (інакше показувати «немає даних», а не 100%). */
  hasData: boolean;
}

export interface PowerSummary {
  /** Від початку поточних місцевих (Europe/Kyiv) доби до зараз. */
  today: PowerWindowSummary;
  /** Ковзне вікно за останні 24 години. */
  last24h: PowerWindowSummary;
}

/** Один відрізок часу у статистиці надійності (день / тиждень / місяць). */
export interface ReliabilityBucket {
  /** Стабільний ключ, напр. `day:2026-10-09`, `week:2026-10-05`, `month:2026-10`. */
  key: string;
  /** Підпис для UI («9 жовт.», «6 жовт. – 12 жовт.», «жовтень 2026 р.»). */
  label: string;
  /** Початок/кінець вікна (ISO, UTC). */
  start: string;
  end: string;
  windowMinutes: number;
  outageMinutes: number;
  poweredMinutes: number;
  reliabilityPct: number;
  outageCount: number;
  hasData: boolean;
  /**
   * Відрізок ще не настав — цифри пораховані за опублікованим ГПВ і можуть змінитися.
   * Фронтенд малює такий рядок з поміткою «прогноз», щоб майбутнє не читалося як факт.
   */
  isForecast?: boolean;
}

/** Статистика електропостачання з початку поточного місяця. */
/** Зведення по одній групі (черзі) за весь звітний період. */
export interface ReliabilityGroup {
  /** Код группы, напр. «2/2». */
  queue: string;
  windowMinutes: number;
  outageMinutes: number;
  poweredMinutes: number;
  reliabilityPct: number;
  hasData: boolean;
}

export interface ReliabilityReport {
  /** Початок звіту — 1-ше число поточного місяця (київський час). */
  from: string;
  to: string;
  generatedAt: string;
  days: ReliabilityBucket[];
  weeks: ReliabilityBucket[];
  months: ReliabilityBucket[];
  /** Розбиття по групах за той самий період — щоб було видно, кому з них не повезло. */
  groups: ReliabilityGroup[];
  /**
   * Той самий розрахунок, але зведенням по всіх областях — для порівняння «як у мене і як поруч».
   * Считается только по областям, где есть данные: пустые области в список не попадают.
   */
  byRegionSummary?: ReliabilityRegionSummary[];
  /**
   * Надійність однієї конкретної групи за період (`?queue=2/2`). Есть, только когда группа
   * запрошена явно: без параметра цифры в отчёте — среднее по группам.
   */
  queue?: ReliabilityGroup | null;
}

/** Зведення надійності по одній області за звітний період. */
export interface ReliabilityRegionSummary {
  /** `cpu` області, как в каталоге `/regions`. */
  region: string;
  /** Украинское название области для подписи (без выдумок — из каталога). */
  nameUa: string;
  windowMinutes: number;
  outageMinutes: number;
  poweredMinutes: number;
  reliabilityPct: number;
  outageCount: number;
  hasData: boolean;
  /** Сколько дней периода реально покрыто данными (слоты или опубликованный ГПВ). */
  daysKnown?: number;
}

export interface ReliabilityResponse {
  data: ReliabilityReport;
}

export function getOperatorState(states: Record<string, OperatorState>, queue: number): OperatorState | undefined { return states[String(queue)]; }

/** Один інтервал ГПВ у відповіді оператора. Один источник правды для живої і ручної відповіді. */
export const operatorIntervalSchema = z.object({
  time_from: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time_from должно быть HH:MM (00:00-23:59)'),
  time_to: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time_to должно быть HH:MM (00:00-23:59)'),
  queue: z.union([z.number().int().min(1).max(3), z.string().regex(/^[123]$/)]),
});

export const operatorScheduleResponseSchema = z.object({
  status: z.string().optional(),
  aData: z.array(operatorIntervalSchema),
  aState: z.record(z.string(), z.object({ name: z.string(), color: z.string() })),
});

/**
 * Жива відповідь оператора (`POST /api/info_schedule`, капчі немає): `aData` приходить `null`,
 * коли на цю чергу/дату погодинного ГПВ не публікували (перевірено 10.10.2026). Для автозавантаження
 * і ручної вставки це не помилка, а «розкладу немає» — тому тут масив nullable.
 */
export const operatorScheduleLiveSchema = operatorScheduleResponseSchema.extend({
  aData: z.array(operatorIntervalSchema).nullable(),
});
export type OperatorScheduleLivePayload = z.infer<typeof operatorScheduleLiveSchema>;

const QUEUE_REGEX = /^\d+(?:\/\d+)?$/;

/** Тот же формат очереди строкой — веб строит из него RegExp, не подтягивая zod в бандл. */
export const QUEUE_CODE_PATTERN = '^\\d+(?:\\/\\d+)?$';

/** Формат особового рахунку (9–12 цифр) — строкой, по той же причине, что и QUEUE_CODE_PATTERN. */
export const ACCOUNT_NUMBER_PATTERN = '^\\d{9,12}$';

/** Особовий рахунок: только цифры, 9–12 знаков. */
export const accountNumberSchema = z.string().trim().regex(new RegExp(ACCOUNT_NUMBER_PATTERN), 'Особовий рахунок — 9–12 цифр');

/** Ввод довідника «рахунок → вулиця + черга» (адмін-маршрут PUT /api/v1/admin/places). */
export const subscriberPlaceInputSchema = z.object({
  account: accountNumberSchema,
  street: z.string().trim().min(2, 'Назва вулиці — мінімум 2 символи'),
  queue: z.string().trim().regex(new RegExp(QUEUE_CODE_PATTERN), 'Черга має вигляд "3" або "2/2"'),
});

/**
 * Единый формат кода очереди: «3» или «2/2». Один источник правды для импорта графика,
 * списка моих очередей и маршрута GET /schedules (раньше regex дублировался по файлам).
 */
export const queueCodeSchema = z.string().regex(QUEUE_REGEX, 'Queue должно быть вида "1/2" или "3"');

export const scheduleImportRequestSchema = z.object({
  queue: queueCodeSchema,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date должно быть YYYY-MM-DD'),
  // Той самий payload, що віддає оператор: `aData: null` — це «графіка на цю чергу/дату немає»,
  // а не помилка введення (раніше така вставка відхилялася з 400).
  payload: operatorScheduleLiveSchema,
});

/** Данные, которые отдаёт GET /api/v1/schedules/:queue. */
export interface QueueScheduleData {
  queue: string;
  date: string;
  intervals: ScheduleIntervalUtc[];
  /** 'manual' — импорт графика оператора, null — по этой очереди/дате данных нет. Синтетики нет. */
  source: string | null;
  /** Время последнего ручного импорта по этой очереди/дате (ISO) либо null. */
  lastImportedAt: string | null;
  /**
   * На эту дату оператор опубликовал ГПВ, и очередь в нем есть. Тогда пустой `intervals` —
   * это «отключений нет», а не «график не загружен».
   */
  covered?: boolean;
  /**
   * На эту дату очередь есть в опубликованном ГПВ и ни одного часа отключения в ней нет. Тогда пустой
   * `intervals` — это «світло за графіком», а не «график не загружен». Не то же, что `covered`: если
   * фид уже видит отключение, а слотов ещё нет (импорт отстал), `covered: true`, `allClear: false`.
   */
  allClear?: boolean;
}

export interface QueueSummary {
  /** Код очереди: «3» или «2/2». */
  queue: string;
  /** Сколько интервалов графика импортировано по всем датам (schedule_slots). */
  slots: number;
  /** Последняя дата, на которую есть график (YYYY-MM-DD), либо null. */
  lastDate: string | null;
  /** Сколько улиц привязано к очереди в street_queues. */
  streets: number;
  /**
   * Населённые пункты (населені пункти), привязанные к очереди в этой области (settlement_queues).
   * Пустой массив — значит источник не отдал географию групп; выдумывать её нельзя (AGENTS.md).
   */
  settlements: string[];
  /** Названия улиц, привязанных к очереди в этой области (до 50 первых по алфавиту). */
  streetNames: string[];
  /**
   * Очередь есть в опубликованном на запрошенную дату ГПВ, и ни часа отключения в ней нет.
   *
   * Такие очереди приходят без слотов: `schedule_slots` хранит только «тёмные» часы, поэтому список
   * групп в области без отключений наполняется именно этим признаком. Он разделяет «графік не
   * імпортовано» и «графік є, відключень не заплановано». Не путать с `offlineQueues`: если фід уже
   * видит отключение, а слотов ещё нет (импорт отстал), признак не ставится — это «не знаємо».
   */
  covered?: boolean;
}

/** Интервал отключения группы с локальным временем оператора (для карточек: «10:00–11:00»). */
export interface GroupOutageInterval extends ScheduleIntervalUtc {
  /** Начало в киевском локальном времени, HH:MM — так график показывает оператор. */
  localTimeFrom: string;
  /** Конец в киевском локальном времени, HH:MM. */
  localTimeTo: string;
}

/** Ближайшие отключения по группам области: один элемент — одна черга на одну дату. */
export interface GroupOutageSummary {
  queue: string;
  /** Київська дата YYYY-MM-DD. */
  date: string;
  /** Джерело слотів: 'mirror' | 'manual' | … */
  source: string;
  intervals: GroupOutageInterval[];
  settlements: string[];
  streetNames: string[];
  /** Отключение этой группы идёт прямо сейчас. */
  isActiveNow: boolean;
  /** Начало ближайшего ещё не начавшегося отключения группы (ISO) либо null. */
  nextStartsAt: string | null;
}

/** Особовий рахунок → вулиця + черга (довідник для перевірки даних, GET /api/v1/places/:account). */
export interface SubscriberPlace {
  account: string;
  street: string;
  queue: string;
  /** Когда запись обновляли из данных оператора (ISO). */
  updatedAt: string;
}

/** Ответ автодополнения/поиска улицы с привязанной очередью. */
export interface StreetQueuePair {
  /** Нормализованное имя улицы (ключ). */
  streetNormalized: string;
  /** Отображаемое название улицы. */
  streetName: string;
  /** Привязанная очередь, например "3" или "2/2". */
  queue: string;
  updatedAt: string;
  /** Область прив'язки (cpu, напр. 'chernihivska-oblast'). */
  region?: string;
}

export interface StreetScheduleData extends Omit<QueueScheduleData, 'queue'> {
  street: string;
  streetNormalized: string;
  /** Привязанная очередь или null, если улица не найдена в street_queues. */
  queue: string | null;
  /** Область прив'язки (cpu). */
  region?: string;
}

/** Публичная/админская запись пары «улица → очередь». */
export const streetQueueInputSchema = z.object({
  street: z.string().trim().min(2, 'Укажите название улицы'),
  queue: z.string().trim().regex(QUEUE_REGEX, 'Черга має бути виду "3" або "2/2"'),
  region: z.string().optional(),
});

export type StreetQueueInput = z.infer<typeof streetQueueInputSchema>;

export const outageFiltersSchema = {
  parse(input: unknown): OutageFilters {
    if (!input || typeof input !== 'object') return {};
    const value = input as Record<string, unknown>;
    const result: OutageFilters = {};
    if (typeof value.query === 'string') result.query = value.query;
    if (['scheduled', 'active', 'finished', 'cancelled'].includes(String(value.status))) result.status = value.status as OutageStatus;
    if (value.queue !== undefined) result.queue = Number(value.queue);
    if (typeof value.area === 'string') result.area = value.area;
    if (typeof value.region === 'string') result.region = value.region;
    if (typeof value.dateFrom === 'string') result.dateFrom = value.dateFrom;
    if (typeof value.dateTo === 'string') result.dateTo = value.dateTo;
    if (value.limit !== undefined) result.limit = Number(value.limit);
    return result;
  },
};

/**
 * Елемент звіту покриття областей (GET /api/v1/regions/coverage).
 * Тільки фактичні дані з БД, без мережевих запитів.
 */
export interface RegionCoverageItem {
  cpu: string;
  nameUa: string;
  queues: number;
  slots: number;
  lastDate: string | null;
  freshnessHours: number | null;
  stale: boolean;
  sources: string[];
  covered: boolean;
}

export interface RegionCoverageMeta {
  checkedAt: string;
  coveredRegions: number;
  staleRegions: number;
}

export interface RegionCoverageResponse {
  data: RegionCoverageItem[];
  meta: RegionCoverageMeta;
}

/**
 * Населений пункт у результатах пошуку (GET /api/v1/settlements). Саме тут людина обирає
 * «своє село → свою чергу»; порожній `queues` = джерело ще не дало прив'язки (не вигадуємо).
 */
export interface SettlementListItem {
  id: string;
  region: string;
  name: string;
  kind: 'місто' | 'смт' | 'село' | null;
  queues: string[];
}

export interface SettlementSearchResponse {
  data: SettlementListItem[];
  meta: { total: number; region: string };
}

export interface SettlementQueueItem {
  queue: string;
  source: string;
  /** ISO-час останнього підтвердження прив'язки джерелом. */
  lastSeenAt: string;
  /** Чи є в БД хоч один слот цієї черги на сьогодні (київська доба). */
  hasScheduleToday: boolean;
  /** Найближче майбутнє вікно відключення сьогодні; null — даних немає. */
  nextOutage: { date: string; timeFrom: string; timeTo: string } | null;
}

export interface SettlementQueuesResponse {
  data: {
    settlement: { id: string; region: string; name: string; kind: 'місто' | 'смт' | 'село' | null };
    queues: SettlementQueueItem[];
  };
}

/** Звіт синхронізації одного провайдера графіків (POST /api/v1/admin/providers/sync). */
export interface ProviderSyncReport {
  providerId: string;
  ok: boolean;
  /** Записано рядків у schedule_slots (нові + перезаписані). */
  slots: number;
  inserted: number;
  rewritten: number;
  /** Відхилено як некоректні (битий формат даних джерела). */
  rejected: number;
  /** Дати з минулого — свідомо не записані (не видаємо старе за актуальне). */
  staleDatesSkipped: number;
  /** Область не з каталогу `regions`. */
  unknownRegion: number;
  settlements: number;
  settlementQueues: number;
  error: string | null;
}

/** Моніторинг провайдерів (GET /api/v1/admin/providers). */
export interface ProviderMonitoringItem {
  id: string;
  displayName: string;
  sourceUrl: string;
  regions: string[];
  lastRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
}

export interface ProviderSyncResponse {
  data: { providers: ProviderSyncReport[] };
  meta: { skipped: string[] };
}

/** Новини (GET /api/v1/news): лише публічні публікації каналів/стрічок, без персональних даних. */
export type NewsKind = 'outage' | 'schedule-change' | 'repair' | 'emergency' | 'ukraine' | 'other';

export interface NewsItem {
  id: string;
  sourceKey: string;
  url: string;
  title: string;
  summary?: string | null;
  body?: string | null;
  publishedAt: string | null;
  firstSeenAt: string;
  regionCpu?: string | null;
  kind: NewsKind;
  isUkraineWide: boolean;
  tags: string[];
  /**
   * URL зображень, прикріплених до поста. Для Чернігівобленерго графіки відключень часто
   * опубліковані КАРТИНКАМИ, а не текстом — без цього поля «зміна графіка» показувалась порожньою.
   * Порожній масив — звичайний текстовий пост (RSS-новини завжди такі).
   */
  imageUrls: string[];
  contentHash: string;
}

export interface NewsSource {
  sourceKey: string;
  kind: string;
  baseUrl?: string | null;
  regionCpu?: string | null;
  enabled: boolean;
  lastOkAt?: string | null;
  lastError?: string | null;
  itemsCount: number;
}

export interface NewsListMeta {
  count: number;
  limit: number;
  /** true, якщо свіжих публікацій (за 24 год) немає — UI має показати це чесно, а не «тишу». */
  stale: boolean;
}

export interface NewsListResponse {
  data: NewsItem[];
  meta: NewsListMeta;
}

/**
/** Вариант «дома 1-15 → черга 2/1», когда на улице несколько групп. */
export interface AddressHouseOption {
  housePattern: string;
  queue: string;
}

/** Улица в подсказках мастера адреса. */
export interface AddressStreetOption {
  name: string;
  normalized: string;
  source?: string;
  /** На весь населённый пункт известна одна группа — можно не спрашивать улицу. */
  wholeSettlementQueue?: string | null;
}

/** Подсказки улиц (GET /api/v1/addresses/streets). */
export interface AddressStreetsResponse {
  data: AddressStreetOption[];
  wholeSettlementQueue: string | null;
  region?: string;
}

/** Дома выбранной улицы с группами (GET /api/v1/addresses/houses). */
export interface AddressHousesResponse {
  data: AddressHouseOption[];
  /** Группа на всю улицу, если оператор не разбил её по домам. */
  wholeStreetQueue: string | null;
}

/** Ответ поиска своей группы (GET /api/v1/addresses/resolve). */
export interface AddressResolveResult {
  /** Найденная группа; null — привязки в базе нет. */
  queue: string | null;
  options: AddressHouseOption[];
  reason:
    | 'exact-house'
    | 'whole-street'
    | 'whole-settlement'
    | 'not-found'
    /** Кворум голосов жителей: >= 3 голосов и >= 70% за одну группу. */
    | 'community-verified'
    /** 1–2 голоса: подсказка, а не подтверждённый факт. */
    | 'community-pending';
  /** Откуда привязка: 'manual' | 'operator' | 'dtek' | 'curated' | 'community'. */
  source: string | null;
  /**
   * Насколько привязке можно верить.
   *
   * `official` — справочник ОСР/провайдера; `community_verified` — кворум жителей;
   * `community_pending` — голосов ещё мало (1–2), и один клик соседа не должен выглядеть как
   * проверенный факт. Старые сборки поля не знают и ведут себя как раньше.
   */
  confidence?: AddressQueueConfidence | null;
  /** Сколько голосов у лидирующей группы по этому дому (0 для официальной привязки). */
  votesCount?: number;
  /** График найденной группы на сегодня — чтобы не делать второй запрос. */
  schedule: QueueScheduleData | null;
}

/** Достоверность привязки адреса → очередь. */
export type AddressQueueConfidence = 'official' | 'community_verified' | 'community_pending';

/** Ответ на голос «це моя черга» (POST /api/v1/addresses/confirm). */
export interface AddressConfirmResult {
  saved: boolean;
  region: string;
  /** Группа, за которую голос учтён (при защите официальных данных — официальная). */
  queue: string;
  source: string;
  housePattern: string;
  confidence?: AddressQueueConfidence | null;
  /** Голоса за лидирующую группу по этому дому. */
  votesCount?: number;
  /** Сколько всего голосов по дому (включая голоса за другие группы). */
  totalVotes?: number;
  /** true — дом уже есть в справочнике, и голос не перезаписывал официальную привязку. */
  protected?: boolean;
}

/** Параметры поиска группы по адресу. */
export interface AddressResolveInput {
  region: string;
  settlement: string;
  street?: string;
  house?: string;
}

/** Обновление приложения: данные публикует сборка APK (GET /api/v1/version). */
export interface AppVersionInfo {
  /** Семантическая версия серверной/последней сборки, например «2.15.1». */
  version: string;
  /** Прямая ссылка на APK. */
  apkUrl: string;
  /** SHA-256 APK в hex: клиент обязан сверить файл перед установкой. */
  sha256: string;
  /** Размер APK в байтах. */
  sizeBytes: number;
  /** Когда сборка опубликована (ISO). */
  releasedAt: string;
  /** Короткий список изменений для окна обновления. */
  notes: string[];
}

/** Строка массового импорта привязок (POST /api/v1/admin/addresses/import). */
export interface AddressQueueImportRow {
  region: string;
  settlement: string;
  street?: string;
  /** '*' = вся улица; иначе «12», «2, 4, 6А» или «1-19». */
  housePattern?: string;
  queue: string;
}

/**
 * Чейджлог приложения (GET /api/v1/changelog).
 *
 * Отдельный тип живёт здесь, потому что список приходит с сервера: серверный фикс должен быть
 * виден в уже установленном приложении без пересборки APK.
 */
export interface ChangelogRelease {
  version: string;
  date: string;
  tag: 'Release' | 'Update';
  features: string[];
  fixes: string[];
  optimizations: string[];
}

export interface ChangelogFile {
  generatedAt: string | null;
  /** Версия серверной сборки — по ней клиент понимает, есть ли обновление. */
  version: string;
  totalReleases: number;
  totalFeatures: number;
  totalFixes: number;
  totalOptimizations: number;
  releases: ChangelogRelease[];
  /** Плоский список для старых APK. Новый код читает `releases`. */
  entries?: Array<{ hash: string; date: string; kind: 'new' | 'fix' | 'perf'; label: string; text: string }>;
}

export interface NewsSourcesResponse {
  data: NewsSource[];
}

export interface NewsCollectPerSource {
  sourceKey: string;
  collected: number;
  inserted: number;
  skipped: number;
  error?: string | null;
}

export interface NewsCollectResponse {
  collected: number;
  inserted: number;
  skipped: number;
  perSource: NewsCollectPerSource[];
}

// ───────────────────────────── Пакет синхронізації офлайн-застосунку ─────────────────────────────

/**
 * Контакт обленерго у пакеті синхронізації.
 *
 * Тип залишено для сумісності контракту `/api/v1/sync`. Самі контакти з проєкту прибрані
 * (див. `apps/api/src/db/migrations/0018_drop_contacts.sql` та `InfoPage.tsx`): застосунок від
 * них більше не залежить, і вигадувати номери телефонів замість видалених було б обманом.
 * Тому `SyncBundle.contacts` приходить порожнім масивом, а не вигаданим довідником.
 */
export interface SyncContact {
  /** cpu області, до якої належить контакт. */
  regionCpu: string;
  /** Назва обленерго. */
  name: string;
  /** Телефон диспетчера/кол-центру, якщо відомий. */
  phone?: string | null;
  /** Сторінка оператора для перевірки графіка. */
  url?: string | null;
}

/**
 * Графік однієї області в пакеті синхронізації: по одному елементу на пару «група × дата».
 *
 * Форма елемента навмисно дорівнює `GroupOutageSummary` — саме так її віддає
 * `GET /api/v1/schedules/upcoming`. Завдяки цьому той самий JSON гідратує одразу два кеші
 * TanStack Query: список ближніх відключень (`upcomingGroupOutages`) і графік конкретної групи
 * (`queueSchedule`), без окремих структур даних і без перекладів між ними на клієнті.
 */
export interface SyncRegionSchedules {
  /** Київські дати, на які зібрано графік (сьогодні й завтра). */
  days: string[];
  /** Групи з реальними інтервалами відключень на ці дати. Порожньо — графіка немає. */
  buckets: GroupOutageSummary[];
}

/**
 * Пакет синхронізації `GET /api/v1/sync`: усе, що потрібне телефону для автономної роботи.
 *
 * Один запит замість шести (`/status`, `/regions`, `/schedules/upcoming`, `/schedules`, `/news`,
 * `/contacts`) — це головна причина появи ендпоінта: у мобільної мережі важлива не швидкість
 * кожного запиту, а їх кількість.
 */
export interface SyncSettlement {
  /** Назва населеного пункту так, як її віддає джерело («с. Деснянське», «Чернігів»). */
  name: string;
  /** 'місто' | 'село' | 'смт' — з довідника КОАТТГ; `null`, якщо джерело типу не знає. */
  kind: string | null;
  /** Коди груп, прив'язаних до НП. Порожньо — прив'язки немає, і вигадувати її не можна. */
  queues: string[];
}

export interface SyncBundle {
  /** Коли зібрано пакет (ISO, UTC). */
  syncedAt: string;
  /**
   * Детермінований хеш вмісту — клієнт надсилає його в `If-None-Match`.
   *
   * Рахується від вмісту БЕЗ `syncedAt` і без `status.nextAttemptAt`: обидва поля похідні від
   * моменту запиту, а не від даних. Якщо їх не виключити, хеш змінюється на кожен виклик,
   * `If-None-Match` не збігається ніколи і 304 не настає — заголовок стає декоративним.
   */
  etag: string;
  /** Область, для якої зібрано графік; `null` — пакет містить усі відомі області. */
  region: string | null;
  /** Повний стан мережі для вибраної області (для `useStatus`). */
  status: StatusResponse;
  /** Каталог областей зі статистикою. */
  regions: RegionSummary[];
  /** Очереди області (для `useQueues`): без них «Мої черги» в офлайні були б порожні. */
  queues: QueueSummary[];
  /** Графіки за областями: ключ — `cpu` області. */
  schedulesByRegion: Record<string, SyncRegionSchedules>;
  /**
   * Населені пункти області для офлайн-пошуку адреси (майстер «область → НП → вулиця → дом»).
   *
   * Це не повний географічний реєстр країни, а те, що ми справді знаємо про область: НП із
   * довідника КОАТТГ і ті, у яких є прив'язка до групи. Обрізаний до ліміту рунтайма —
   * скільки всього, видно в `settlementsTotal`.
   */
  settlements: SyncSettlement[];
  /** Скільки НП області відомо всього (а не скільки потрапило в `settlements`). */
  settlementsTotal: number;
  /** Останні 20 публікацій каналів операторів. */
  news: NewsItem[];
  /** Довідник контактів обленерго (наразі порожній, див. `SyncContact`). */
  contacts: SyncContact[];
}

/**
 * Детермінований хеш пакета синхронізації (FNV-1a, 32 біти) у формі weak-ETag.
 *
 * Потрібен рівно для одного: щоб `If-None-Match` працював у двох різних рантаймах (Cloudflare
 * Workers і Node) без криптографії. `crypto.subtle.digest` асинхронний і в воркері дає інший
 * результат, ніж у Node, якщо передати рядок різними шляхами; FNV-1a — це чиста функція над
 * текстом, тому обидві реалізації рахують однаково. Криптостійкість тут не потрібна: ETag не
 * захищає дані, він лише відрізняє «те саме» від «нове».
 */
export function computeSyncEtag(payload: unknown): string {
  const text = JSON.stringify(payload) ?? '';
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `W/"${hash.toString(16).padStart(8, '0')}"`;
}

/**
 * Чи збігається клієнтський `If-None-Match` з нашим ETag.
 *
 * Заголовок — список значень через кому, кожне може мати префікс `W/` (weak). Строге порівняння
 * рядків тут не працювало б: браузер може віддати той самий ETag із префіксом, без нього або в
 * списку разом з іншими. `*` означає «будь-яке вже збережене представлення» — це теж 304.
 */
export function etagMatchesHeader(header: string | null | undefined, etag: string): boolean {
  if (!header) return false;
  const normalize = (value: string) => value.trim().replace(/^W\//u, '');
  const wanted = normalize(etag);
  return header
    .split(',')
    .map((part) => part.trim())
    .some((part) => part === '*' || normalize(part) === wanted);
}

export const newsKindSchema = z.enum(['outage', 'schedule-change', 'repair', 'emergency', 'ukraine', 'other']);

export const newsQuerySchema = z.object({
  region: z.string().trim().optional(),
  kind: newsKindSchema.optional(),
  /**
   * Виключити категорію (напр. `other`): місцеві стрічки віддають багато загальних новин,
   * і без серверного фільтра найсвіжіші 50 записів можуть бути майже всі не про світло.
   */
  excludeKind: newsKindSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'since має бути у форматі YYYY-MM-DD').optional(),
  ukraineWide: z.preprocess((val) => {
    if (typeof val === 'string') return val === 'true' || val === '1';
    return Boolean(val);
  }, z.boolean()).optional(),
});

export type NewsQuery = z.infer<typeof newsQuerySchema>;

/**
 * Канонічний каталог областей і псевдоніми ключів фіда (`kyivska-oblast` → `kiivska-oblast`,
 * `dnipropetrovska-oblast` → ЦЕК + ДнЕМ). Окремий файл — щоб `index.ts` не розростався ще на сотню
 * рядків довідника, а каталог читався як самостійне правило (див. `regions-catalog.ts`).
 */
/**
 * Канонічний каталог областей і псевдоніми ключів фіда (див. сам файл).
 *
 * Розширення `.ts` тут навмисне, а не `.js`, і це не дрібниця: `@svitlo/shared` кладеться в образ
 * API як ДЖЕРЕЛО (`COPY packages/shared/src`), і Node виконує його через type stripping. Стріпінг
 * підставляє розширення буквально, без резолву `./x.js` → `x.ts`, тому імпорт із `.js` валив
 * контейнер на старті (`ERR_MODULE_NOT_FOUND .../regions-catalog.js`). Флаг
 * `rewriteRelativeImportExtensions` у tsconfig.base.json дозволяє такий специфікатор для `tsc`
 * і переписує його на `.js` у зібраних проєктах. Коли покидаєте цей модуль простим `.js` —
 * згадайте, що в проді він читається як TS-джерело.
 */
export * from './regions-catalog.ts';
