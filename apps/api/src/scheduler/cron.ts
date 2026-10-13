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
 * його прогон пропускається, щоб не молотити в оператора наосліп.
 * Примітка: обхід блоку оператора ДОЗВОЛЕНО (дозвіл отримано 2026-10-10, див. AGENTS.md),
 * тому пауза — лише економія запитів, а не заборона; за потреби її можна вимкнути.
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

/**
 * Синхронізація провайдерів графіків (мультирегіональність): дзеркало, YASNO, ДТЕК, e-svitlo,
 * Чернігівобленерго пишуть `schedule_slots` кожен зі своїм `source`, тому дані не затираються.
 *
 * Типово вимкнено (`PROVIDER_SYNC_ENABLED=false`): реліз не має почати писати нові джерела
 * непомітно — це вмикається свідомо після перевірки на живій БД.
 */
export function setupProviderSyncCron() {
  if (!env.PROVIDER_SYNC_ENABLED) {
    logger.info('Provider sync is disabled (PROVIDER_SYNC_ENABLED=false)');
    return;
  }
  const run = async () => {
    const { getRegisteredProviders } = await import('../providers/registry.js');
    const { syncProviderSchedules } = await import('../services/provider-sync.service.js');
    const { providers, skipped } = await getRegisteredProviders();
    if (providers.length === 0) {
      logger.warn({ skipped }, 'Provider sync: no providers registered yet');
      return;
    }
    const reports = await syncProviderSchedules(providers);
    logger.info({ reports }, 'Provider sync cycle finished');
  };
  cron.schedule(`*/${env.PROVIDER_SYNC_INTERVAL_MINUTES} * * * *`, () => {
    void run().catch((err) => logger.error({ err }, 'Provider sync cycle failed'));
  });
  // Не чекаємо першого слота: свіжі дані потрібні одразу після старту (як setupInitialParse).
  setTimeout(() => {
    void run().catch((err) => logger.error({ err }, 'Initial provider sync failed'));
  }, 5_000);
}

/**
 * Збір новин (публічні Telegram-канали + RSS) — окремий розклад із ВЛАСНИМ флагом
 * `NEWS_COLLECT_ENABLED` (типово false). Він навмисно не залежить від `ENABLE_SCHEDULER`:
 * новини читаються з відкритих каналів/стрічок, а не з-під WAF оператора, тож вмикаються
 * незалежно. Кожне джерело ізольоване: падіння одного не роняє цикл (див. news-collector).
 */
export function setupNewsCollectCron() {
  if (!env.NEWS_COLLECT_ENABLED) {
    logger.info('News collection is disabled (NEWS_COLLECT_ENABLED=false)');
    return;
  }
  const run = async () => {
    const { collectNews } = await import('../services/news/news-collector.service.js');
    const result = await collectNews();
    logger.info(
      { collected: result.collected, inserted: result.inserted, skipped: result.skipped },
      'News collect finished',
    );
  };
  cron.schedule(`*/${env.NEWS_COLLECT_INTERVAL_MIN} * * * *`, () => {
    void run().catch((err) => logger.error({ err }, 'News collect cycle failed'));
  });
  // Як і для парсингу: перший прогін одразу після старту, не чекаючи слота розкладу.
  setTimeout(() => {
    void run().catch((err) => logger.error({ err }, 'Initial news collect failed'));
  }, 3_000);
}

