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

const server = Fastify({ logger: { level: env.LOG_LEVEL } });

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

  // Планировщик парсинга реального источника отключён по умолчанию:
  // данные приходят только вручную из браузера (userscript).
  if (env.ENABLE_SCHEDULER && !env.USE_MOCK_ADAPTER) {
    const { setupCron, setupInitialParse } = await import('./scheduler/cron.js');
    setupCron();
    setupInitialParse();
    server.log.info('Parse scheduler enabled; initial parse scheduled');
  }

  try {
    await server.listen({ port: env.API_PORT, host: env.API_HOST });
    server.log.info(`Server listening on ${env.API_HOST}:${env.API_PORT}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

start();

