import type { FastifyInstance } from 'fastify';
import { buildServer } from './app.js';
import { env } from './config.js';

/**
 * Точка входу: збирає застосунок (app.ts), вмикає планувальник, слухає порт
 * і ставить обробники сигналів. Сам застосунок лишається тестованим без порту.
 */
async function start(): Promise<void> {
  const server: FastifyInstance = await buildServer();

  // TODO(verify): close the PostgreSQL client on shutdown, e.g.
  //   server.addHook('onClose', async () => { await sql.end({ timeout: 5 }); });
  // (use the real export name from db/index.ts)

  // The parse scheduler is controlled by ENABLE_SCHEDULER (set it to true in production .env).
  // When it is off, data only arrives via POST /api/v1/admin/parse or the manual schedule import.
  if (env.ENABLE_SCHEDULER && !env.USE_MOCK_ADAPTER) {
    const { setupCron, setupInitialParse, setupProviderSyncCron } = await import('./scheduler/cron.js');
    setupCron();
    setupInitialParse();
    // Провайдери графіків (YASNO/ДТЕК/e-svitlo/дзеркало) — окремий розклад зі своїм флагом.
    setupProviderSyncCron();
    server.log.info('Parse scheduler enabled; initial parse scheduled');
  } else {
    server.log.warn('Parse scheduler is OFF: data will become stale unless imported manually');
  }

  // Новини: власний флаг NEWS_COLLECT_ENABLED, бо джерела — публічні канали/RSS, а не WAF оператора.
  // Тому збір новин працює й тоді, коли парсинг оператора вимкнено (ENABLE_SCHEDULER=false).
  const { setupNewsCollectCron } = await import('./scheduler/cron.js');
  setupNewsCollectCron();

  // Graceful shutdown. `docker stop` sends SIGTERM and kills the container with SIGKILL (exit 137)
  // after 10 s. Node as PID 1 ignores SIGTERM unless a handler exists, so without this the process
  // was always killed (exit 137). We stop accepting connections, let in-flight requests finish, then exit 0.
  // A parse that is mid-write is rolled back by PostgreSQL (each parse step runs in a transaction).
  let shuttingDown = false;
  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    server.log.info({ signal }, 'Shutting down');
    const force = setTimeout(() => {
      server.log.error('Graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, 8000); // must stay below Docker's default stop timeout (10 s)
    force.unref();
    try {
      await server.close(); // stops listening, waits for in-flight requests, runs onClose hooks
      process.exit(0);
    } catch (err) {
      server.log.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  try {
    await server.listen({ port: env.API_PORT, host: env.API_HOST });
    server.log.info(`Server listening on ${env.API_HOST}:${env.API_PORT}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

start().catch((err) => {
  // `server` (and its pino logger) may not exist yet, so report on stderr — visible in `docker logs`.
  console.error('Startup failed', err);
  process.exit(1);
});
