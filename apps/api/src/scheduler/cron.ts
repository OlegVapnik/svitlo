import cron from 'node-cron';
import { sql } from 'drizzle-orm';
import { env } from '../config.js';
import { runParse } from '../services/parse.service.js';
import { logger } from '../utils/logger.js';
import { db } from '../db/connection.js';
import { sources } from '../db/schema.js';

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
    const allSources = await db.select().from(sources).where(sql`is_active = true`);
    for (const source of allSources) {
      try {
        await runParse(source.id);
      } catch (err) {
        logger.error({ err, sourceId: source.id }, 'Parse run failed');
      }
    }
  });
}


// Запускаем первый парсинг сразу после старта, а не ожидаем следующего cron-слота.
export function setupInitialParse() {
  setTimeout(() => {
    logger.info('Starting initial parse run');
    void db.select().from(sources).where(sql`is_active = true`).then(async (allSources) => {
      for (const source of allSources) {
        try {
          await runParse(source.id);
        } catch (err) {
          logger.error({ err, sourceId: source.id }, 'Initial parse run failed');
        }
      }
    }).catch((err) => logger.error({ err }, 'Unable to load sources for initial parse'));
  }, 1_000);
}
