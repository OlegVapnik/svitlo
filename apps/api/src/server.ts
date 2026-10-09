import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { env } from './config.js';
import { AppError, createErrorResponse } from './utils/errors.js';
import corsPlugin from './plugins/cors.js';
import authPlugin from './plugins/auth.js';
import swaggerPlugin from './plugins/swagger.js';
import healthRoutes from './routes/health.js';
import outagesRoutes from './routes/outages.js';
import incidentsRoutes from './routes/incidents.js';
import statusRoutes from './routes/status.js';
import contactsRoutes from './routes/contacts.js';
import adminRoutes from './routes/admin.js';
import addressesRoutes from './routes/addresses.js';
import scheduleRoutes from './routes/schedules.js';
import streetQueueRoutes from './routes/street-queues.js';
import reliabilityRoutes from './routes/reliability.js';

// TRUST_PROXY: comma-separated proxy-addr ranges, e.g. "loopback,uniquelocal" (empty = off).
// Behind nginx/Caddy the socket peer is the proxy, not the visitor: without this the rate limit
// (100 req/min per IP) is shared by ALL visitors. Ranges (not `true`) are used on purpose: with `true`
// a client can forge X-Forwarded-For and dodge the limit; with ranges only addresses added by trusted
// (private-network) hops are skipped, so the first public address from the right is the visitor.
const trustProxy = env.TRUST_PROXY
  ? env.TRUST_PROXY.split(',').map((s) => s.trim()).filter(Boolean)
  : false;
const server = Fastify({ logger: { level: env.LOG_LEVEL }, trustProxy });

server.setErrorHandler((error, _request, reply) => {
  if (error instanceof ZodError) {
    return reply.status(400).send({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Некорректные данные запроса',
        details: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      },
    });
  }
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send(createErrorResponse(error));
  }
  const statusCode = (error as { statusCode?: number }).statusCode ?? 500;
  if (statusCode >= 500) server.log.error({ err: error }, 'Unhandled request error');
  return reply.status(statusCode).send(createErrorResponse(error as Error));
});

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

async function start() {
  await server.register(corsPlugin);
  await server.register(helmet);
  await server.register(rateLimit, { max: 100, timeWindow: '1 minute' });
  await server.register(authPlugin);
  await server.register(swaggerPlugin);

  await server.register(healthRoutes);
  await server.register(outagesRoutes);
  await server.register(incidentsRoutes);
  await server.register(statusRoutes);
  await server.register(contactsRoutes);
  await server.register(addressesRoutes);
  await server.register(scheduleRoutes);
  await server.register(streetQueueRoutes);
  await server.register(reliabilityRoutes);
  await server.register(adminRoutes);

  // TODO(verify): close the PostgreSQL client on shutdown, e.g.
  //   server.addHook('onClose', async () => { await sql.end({ timeout: 5 }); });
  // (use the real export name from db/index.ts)

  // The parse scheduler is controlled by ENABLE_SCHEDULER (set it to true in production .env).
  // When it is off, data only arrives via POST /api/v1/admin/parse or the manual schedule import.
  if (env.ENABLE_SCHEDULER && !env.USE_MOCK_ADAPTER) {
    const { setupCron, setupInitialParse } = await import('./scheduler/cron.js');
    setupCron();
    setupInitialParse();
    server.log.info('Parse scheduler enabled; initial parse scheduled');
  } else {
    server.log.warn('Parse scheduler is OFF: data will become stale unless imported manually');
  }

  try {
    await server.listen({ port: env.API_PORT, host: env.API_HOST });
    server.log.info(`Server listening on ${env.API_HOST}:${env.API_PORT}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

start().catch((err) => {
  server.log.error({ err }, 'Startup failed');
  process.exit(1);
});
