import { eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { sources } from '../db/schema.js';
import { logger } from '../utils/logger.js';
import { classifySourceFailure } from '../parsers/source-errors.js';
import { pauseMsFor, sanitizeSourceError } from './source-breaker.js';

/**
 * Запис стану circuit breaker у `sources`. Політика (скільки чекати) — у source-breaker.ts,
 * тут тільки БД: так політику можна тестувати без Postgres, а стан переживає пересоздание
 * контейнера (`docker compose up`), чого in-memory змінна не вміє.
 */

export interface SourceFailureState {
  kind: ReturnType<typeof classifySourceFailure>['kind'];
  consecutiveFailures: number;
  pausedUntil: Date | null;
}

/**
 * Записує невдачу і, за потреби, ставить джерело на паузу.
 * НІКОЛИ не кидає: службовий запис не має валити прогін парсингу — інакше ми втратили б і дані
 * допоміжних джерел (Telegram), які до блоку оператора не мають відношення.
 */
export async function recordSourceFailure(
  sourceId: string,
  error: unknown,
  now: Date = new Date(),
): Promise<SourceFailureState> {
  const failure = classifySourceFailure(error);
  const rawMessage = error instanceof Error ? error.message : String(error);
  const message = sanitizeSourceError(rawMessage);
  try {
    const [current] = await db
      .select({ failures: sources.consecutiveFailures, pausedUntil: sources.pausedUntil })
      .from(sources)
      .where(eq(sources.id, sourceId))
      .limit(1);

    const consecutiveFailures = (current?.failures ?? 0) + 1;
    const pauseMs = pauseMsFor(failure.kind, consecutiveFailures, failure.retryAfterMs);
    // Уже встановлену паузу не скорочуємо: невдача «всередині паузи» не означає, що джерело ожило.
    const activePause =
      current?.pausedUntil && current.pausedUntil.getTime() > now.getTime() ? current.pausedUntil : null;
    const pausedUntil = pauseMs > 0 ? new Date(now.getTime() + pauseMs) : activePause;

    await db
      .update(sources)
      .set({
        consecutiveFailures,
        pausedUntil,
        // Префікс з видом збою — щоб у /status і parse_runs було видно КЛАС проблеми, а не лише текст.
        lastError: `[${failure.kind}] ${message}`,
      })
      .where(eq(sources.id, sourceId));

    return { kind: failure.kind, consecutiveFailures, pausedUntil };
  } catch (breakerError) {
    logger.error({ err: breakerError, sourceId }, 'Failed to persist source circuit-breaker state');
    return { kind: failure.kind, consecutiveFailures: 0, pausedUntil: null };
  }
}

/**
 * Скидає лічильник і паузу, не чіпаючи `last_success_at`: повний (але порожній) фід означає
 * «джерело живе», а не «дані оновилися» — last_success_at рухає тільки успіх із записами.
 */
export async function clearSourcePause(sourceId: string): Promise<void> {
  try {
    await db
      .update(sources)
      .set({ consecutiveFailures: 0, pausedUntil: null })
      .where(eq(sources.id, sourceId));
  } catch (error) {
    logger.error({ err: error, sourceId }, 'Failed to reset source circuit breaker');
  }
}

/** Повний успіх: скидає лічильник, паузу, помилку і рухає `last_success_at`. */
export async function recordSourceSuccess(sourceId: string, now: Date = new Date()): Promise<void> {
  try {
    await db
      .update(sources)
      .set({ lastSuccessAt: now, lastError: null, consecutiveFailures: 0, pausedUntil: null })
      .where(eq(sources.id, sourceId));
  } catch (error) {
    logger.error({ err: error, sourceId }, 'Failed to persist source success state');
  }
}
