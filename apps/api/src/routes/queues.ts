import type { FastifyInstance } from 'fastify';
import { listQueues } from '../services/queues.service.js';
import { readRegionParam } from '../services/regions.service.js';

/**
 * Публичный список очередей: только те, о которых есть реальные данные.
 * Раньше список очередей был зашит в вебе одной строкой ('2/2'), а в API его не было вовсе.
 *
 * `?region=<cpu>` (необязательный) сужает список до очередей одной области; без параметра —
 * поведение v1 (все слоты), чтобы старый фронт не изменился (см. /tmp/API-CONTRACT-regions.md).
 */
export default async function queueRoutes(fastify: FastifyInstance) {
  fastify.get<{ Querystring: { region?: string } }>('/api/v1/queues', async (request, reply) => {
    // Данные меняются вместе с импортом графика (~реже 30 минут) — короткий публичный кеш уместен.
    reply.header('Cache-Control', 'public, max-age=30');
    const region = request.query.region ? readRegionParam(request.query.region) : undefined;
    return { data: await listQueues(region) };
  });
}