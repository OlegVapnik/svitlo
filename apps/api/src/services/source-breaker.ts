import { isBlockKind, type SourceFailureKind } from '../parsers/source-errors.js';

/**
 * Політика circuit breaker джерела (skills/scraper-adapter-hardening, §Run-level behaviour).
 *
 * Ідея: оператор за WAF раптово віддає 403/429 або рве з'єднання. Корисна поведінка — зберегти
 * останні добрі дані й сказати людині. Примітка: обхід блоку оператора ДОЗВОЛЕНО (дозвіл отримано
 * 2026-10-10, див. AGENTS.md), тому пауза — це лише економія запитів і захист даних, а не заборона
 * на доступ; за потреби breaker можна вимкнути. Стан паузи живе в БД
 * (sources.consecutive_failures / paused_until, див. source-breaker-state.ts), а сама політика —
 * тут, чистими функціями: їх можна перевірити без БД і без мережі.
 *
 * Правила:
 *   - явний блок (403 / 429 / таймаут / обрив TLS) — сигнал джерела: пауза ставиться ОДРАЗУ,
 *     а Retry-After поважається (але не довше за добу — довша пауза сховала б втрату даних);
 *   - інші збої (формат, 5xx) — пауза тільки після трьох підряд;
 *   - пауза зростає: 30 хв → 1 год → 3 год → 6 год (далі стеля 6 год);
 *   - повний успішний збір скидає і лічильник, і паузу.
 */

/** Пауза після N-ї підряд невдачі; далі — стеля 6 годин. */
export const BREAKER_PAUSE_MS = [30 * 60_000, 60 * 60_000, 3 * 60 * 60_000, 6 * 60 * 60_000] as const;

/** Скільки підряд «звичайних» невдач потрібно, щоб зупинити джерело. */
export const BREAKER_TRIP_AFTER = 3;

/** Retry-After довший за добу вважаємо аномалією і не тримаємо паузу довше. */
export const RETRY_AFTER_CAP_MS = 24 * 60 * 60_000;

/** Пауза за кількістю підряд невдач; 0 — пауза ще не потрібна. */
export function pauseMsForFailures(consecutiveFailures: number): number {
  if (consecutiveFailures < BREAKER_TRIP_AFTER) return 0;
  const step = Math.min(consecutiveFailures - BREAKER_TRIP_AFTER, BREAKER_PAUSE_MS.length - 1);
  return BREAKER_PAUSE_MS[step]!;
}

/** Скільки мс тримати джерело на паузі після цієї невдачі; 0 — пауза не потрібна. */
export function pauseMsFor(
  kind: SourceFailureKind,
  consecutiveFailures: number,
  retryAfterMs: number | null = null,
): number {
  // Блок реагує одразу: чекати трьох відмов, коли нас прямо просять зачекати, — це і є «долбіжка».
  const effectiveFailures = isBlockKind(kind)
    ? Math.max(consecutiveFailures, BREAKER_TRIP_AFTER)
    : consecutiveFailures;
  const fromBackoff = pauseMsForFailures(effectiveFailures);
  const fromRetryAfter = Math.min(Math.max(retryAfterMs ?? 0, 0), RETRY_AFTER_CAP_MS);
  return Math.max(fromBackoff, fromRetryAfter);
}

/** Чи джерело зараз на паузі. */
export function isPaused(pausedUntil: Date | null | undefined, now: Date): boolean {
  return Boolean(pausedUntil && pausedUntil.getTime() > now.getTime());
}

/**
 * Коли планувальник звернеться до джерела наступного разу (оцінка для /status).
 * На паузі — момент її закінчення; без паузи — наступний слот cron. Джиттер може зсунути
 * фактичний запит на PARSE_INTERVAL_JITTER_MINUTES, тому це саме оцінка, а не обіцянка.
 * Планувальник вимкнено — null (автоматичних спроб не буде).
 */
export function nextAttemptAt(
  pausedUntil: Date | null | undefined,
  now: Date,
  intervalMinutes: number,
  schedulerEnabled: boolean,
): Date | null {
  if (isPaused(pausedUntil, now)) return pausedUntil!;
  if (!schedulerEnabled) return null;
  return new Date(now.getTime() + intervalMinutes * 60_000);
}

/**
 * Текст помилки, безпечний для логів, /status і parse_runs: без довгих послідовностей цифр
 * (номер рахунку, ідентифікатори абонента) — див. skills/secrets-pii-hygiene.
 */
export function sanitizeSourceError(message: string, limit = 300): string {
  const collapsed = message.replace(/\s+/gu, ' ').trim();
  const redacted = collapsed.replace(/\d{5,}/gu, '<number>');
  return redacted.length > limit ? `${redacted.slice(0, limit)}…` : redacted;
}

/** Мінімум, який потрібен /status від рядка `sources`. */
export interface SourceHealthRow {
  name: string;
  consecutiveFailures: number;
  pausedUntil: Date | null;
  lastError: string | null;
}

export interface SourceHealth {
  consecutiveParseFailures: number;
  /** Момент, до якого джерело на паузі (null — не на паузі). */
  pausedUntil: string | null;
  lastError: string | null;
  nextAttemptAt: string | null;
}

/**
 * Згортає активні джерела в один блок для /status: показуємо найгірше (максимум невдач підряд),
 * бо саме воно керує паузою. Порожній список (немає активних джерел) — «все спокійно».
 */
export function summarizeSourceHealth(
  rows: SourceHealthRow[],
  now: Date,
  options: { schedulerEnabled: boolean; intervalMinutes: number },
): SourceHealth {
  const worst = [...rows].sort(
    (a, b) => b.consecutiveFailures - a.consecutiveFailures || a.name.localeCompare(b.name),
  )[0];
  const next = nextAttemptAt(worst?.pausedUntil ?? null, now, options.intervalMinutes, options.schedulerEnabled);
  return {
    consecutiveParseFailures: worst?.consecutiveFailures ?? 0,
    pausedUntil: isPaused(worst?.pausedUntil ?? null, now) ? worst!.pausedUntil!.toISOString() : null,
    lastError: worst?.lastError ?? null,
    nextAttemptAt: next?.toISOString() ?? null,
  };
}
