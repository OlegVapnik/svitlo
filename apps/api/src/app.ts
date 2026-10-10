import Fastify, { type FastifyInstance } from 'fastify';
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
import queueRoutes from './routes/queues.js';
import reliabilityRoutes from './routes/reliability.js';

/**
 * Фабрика Fastify-інстансу: плагіни + роути, БЕЗ `listen` і БЕЗ планувальника.
 *
 * Виділена з `server.ts` (де інстанс створювався на рівні модуля і одразу викликав
 * `start()` з `listen`), щоб тести могли імпортувати застосунок і робити
 * `app.inject(...)` без відкриття порту. Точка входу — `server.ts`.
 */
export async function buildServer(): Promise<FastifyInstance> {
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
  await server.register(queueRoutes);
  await server.register(reliabilityRoutes);
  await server.register(adminRoutes);

  return server;
}
