import type { FastifyInstance } from 'fastify';
import { listQueues } from '../services/queues.service.js';

/**
 * Публичный список очередей: только те, о которых есть реальные данные.
 * Раньше список очередей был зашит в вебе одной строкой ('2/2'), а в API его не было вовсе.
 */
export default async function queueRoutes(fastify: FastifyInstance) {
  fastify.get('/api/v1/queues', async (_request, reply) => {
    // Данные меняются вместе с импортом графика (~реже 30 минут) — короткий публичный кеш уместен.
    reply.header('Cache-Control', 'public, max-age=30');
    return { data: await listQueues() };
  });
}