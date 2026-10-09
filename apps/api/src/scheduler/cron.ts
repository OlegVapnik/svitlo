import cron from 'node-cron';
import { sql } from 'drizzle-orm';
import { env } from '../config.js';
import { runParse } from '../services/parse.service.js';
import { logger } from '../utils/logger.js';
import { db } from '../db/connection.js';
import { sources } from '../db/schema.js';

import { isPaused } from '../services/source-breaker.js';

/**
 * Один цикл опитування ВСІХ активних джерел. Спільний код для cron і старту, щоб правила
 * (і передусім пропуск джерел на паузі) жили рівно в одному місці.
 *
 * Circuit breaker: якщо джерело на паузі (403/429/таймаут — політика в services/source-breaker.ts),
 * його прогон ПРОПУСКАЄТЬСЯ повністю: молча стукати кожні 30 хвилин у WAF оператора не можна.
 * Обходів блоку в проєкті немає і бути не повинно (skills/scraper-adapter-hardening, hard rule 1).
 */
export async function runParseCycle(reason: 'startup' | 'cron', now: Date = new Date()): Promise<void> {
  const activeSources = await db.select().from(sources).where(sql`is_active = true`);
  for (const source of activeSources) {
    if (isPaused(source.pausedUntil, now)) {
      logger.warn(
        {
          sourceId: source.id,
          sourceName: source.name,
          pausedUntil: source.pausedUntil,
          consecutiveFailures: source.consecutiveFailures,
        },
        `${reason} parse skipped: source is paused by circuit breaker`,
      );
      continue;
    }
    try {
      await runParse(source.id);
    } catch (err) {
      logger.error({ err, sourceId: source.id }, `${reason} parse run failed`);
    }
  }
}

export function setupCron() {
  cron.schedule(`*/${env.PARSE_INTERVAL_MINUTES} * * * *`, async () => {
    // Джиттер: зсуваємо запуск на випадковий проміжок, щоб запити не йшли строго по «розкладу»
    // (оператор за WAF реагує на регулярні автоматичні звернення).
    const jitterMs = env.PARSE_INTERVAL_JITTER_MINUTES > 0
      ? Math.floor(Math.random() * env.PARSE_INTERVAL_JITTER_MINUTES * 60_000)
      : 0;
    if (jitterMs > 0) {
      logger.info({ jitterMs }, 'Cron jitter before parse run');
      await new Promise((resolve) => setTimeout(resolve, jitterMs));
    }
    logger.info('Starting cron parse run');
    await runParseCycle('cron');
  });
}

// Запускаем первый парсинг сразу после старта, а не ожидаем следующего cron-слота.
export function setupInitialParse() {
  setTimeout(() => {
    logger.info('Starting initial parse run');
    void runParseCycle('startup').catch((err) => logger.error({ err }, 'Initial parse cycle failed'));
  }, 1_000);
}

