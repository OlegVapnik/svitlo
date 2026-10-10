import { z } from 'zod';

export type OutageStatus = 'scheduled' | 'active' | 'finished' | 'cancelled';
export type OperatorStateCode = 1 | 2 | 3;
export interface OperatorInterval { time_from: string; time_to: string; queue: OperatorStateCode; }
export interface OperatorState { name: string; color: string; }
export interface OperatorScheduleResponse { status?: string; aData: OperatorInterval[]; aState: Record<string, OperatorState>; }
export interface ScheduleIntervalUtc { startsAt: string; endsAt: string; stateCode: OperatorStateCode; stateName: string; stateColor: string; }
export interface Outage { id: string; startsAt: string; endsAt: string; areaName: string; addressesRaw: string; addressesNormalized: string; reason?: string | null; status: OutageStatus; queue?: number | null; source: string; sourceId: string; contentHash: string; firstSeenAt: string; updatedAt: string; }
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
export interface Contact { id: string; type: string; label: string; value: string; region?: string | null; }
export interface StatusResponse { grid: { level: 'stable' | 'warning' | 'emergency'; message: string }; activeOutages: number; scheduledOutages: number; activeIncidents: number; scheduledIncidents?: number; totalIncidents?: number; lastUpdatedAt?: string | null; dataStale?: boolean; /** Оцінка моменту наступной спроби опитування (пауза circuit breaker або наступний слот); null — планувальник вимкнено. */ nextAttemptAt?: string | null; /** Остання помилка джерела без персональних даних (уже санитизована на боці API). */ lastError?: string | null; /** До цього моменту джерело на паузі; null — не на паузі. */ pausedUntil?: string | null; /** Невдач підряд при опитуванні джерела. */ consecutiveParseFailures?: number; powerSummary?: PowerSummary | null; }
export interface PaginationQuery { page: number; limit: number; }
export interface OutageFilters { query?: string; status?: OutageStatus; queue?: number; area?: string; dateFrom?: string; dateTo?: string; limit?: number; }
export interface OutageListResponse { data: Outage[]; meta?: Record<string, unknown>; }
export interface OutageDetailResponse { data: Outage; }
export interface OutageStatsResponse { data: OutageStats; }
export interface IncidentListResponse { data: Incident[]; }
export interface ContactListResponse { data: Contact[]; }
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
}

/** Статистика електропостачання з початку поточного місяця. */
export interface ReliabilityReport {
  /** Початок звіту — 1-ше число поточного місяця (київський час). */
  from: string;
  to: string;
  generatedAt: string;
  days: ReliabilityBucket[];
  weeks: ReliabilityBucket[];
  months: ReliabilityBucket[];
}

export interface ReliabilityResponse {
  data: ReliabilityReport;
}

export function getOperatorState(states: Record<string, OperatorState>, queue: number): OperatorState | undefined { return states[String(queue)]; }

export const operatorScheduleResponseSchema = z.object({
  status: z.string().optional(),
  aData: z.array(
    z.object({
      time_from: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time_from должно быть HH:MM (00:00-23:59)'),
      time_to: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time_to должно быть HH:MM (00:00-23:59)'),
      queue: z.union([z.number().int().min(1).max(3), z.string().regex(/^[123]$/)]),
    }),
  ),
  aState: z.record(z.string(), z.object({ name: z.string(), color: z.string() })),
});

const QUEUE_REGEX = /^\d+(?:\/\d+)?$/;

/**
 * Единый формат кода очереди: «3» или «2/2». Один источник правды для импорта графика,
 * списка моих очередей и маршрута GET /schedules (раньше regex дублировался по файлам).
 */
export const queueCodeSchema = z.string().regex(QUEUE_REGEX, 'Queue должно быть вида "1/2" или "3"');

export const scheduleImportRequestSchema = z.object({
  queue: queueCodeSchema,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date должно быть YYYY-MM-DD'),
  payload: z.object({
    status: z.string().optional(),
    aData: z.array(
      z.object({
        time_from: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time_from должно быть HH:MM (00:00-23:59)'),
        time_to: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time_to должно быть HH:MM (00:00-23:59)'),
        queue: z.union([z.number().int().min(1).max(3), z.string().regex(/^[123]$/)]),
      }),
    ),
    aState: z.record(z.string(), z.object({ name: z.string(), color: z.string() })),
  }),
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
}

export interface StreetScheduleData extends Omit<QueueScheduleData, 'queue'> {
  street: string;
  streetNormalized: string;
  /** Привязанная очередь или null, если улица не найдена в street_queues. */
  queue: string | null;
}

/** Публичная/админская запись пары «улица → очередь». */
export const streetQueueInputSchema = z.object({
  street: z.string().trim().min(2, 'Укажите название улицы'),
  queue: z.string().trim().regex(QUEUE_REGEX, 'Черга має бути виду "3" або "2/2"'),
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
    if (typeof value.dateFrom === 'string') result.dateFrom = value.dateFrom;
    if (typeof value.dateTo === 'string') result.dateTo = value.dateTo;
    if (value.limit !== undefined) result.limit = Number(value.limit);
    return result;
  },
};