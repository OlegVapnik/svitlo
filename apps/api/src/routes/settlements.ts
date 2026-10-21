import type { FastifyInstance } from 'fastify';
import { getSettlementQueues, searchSettlements } from '../services/settlements.service.js';
import { readRegionParam } from '../services/regions.service.js';
import { AppError } from '../utils/errors.js';

/**
 * Публічний довідник населених пунктів: «моє село → моя черга» (див. skills/api-endpoint-change).
 * Персональних даних немає; відповідь кешується коротко, щоб пошук був жвавим, але свіжим.
 */
export default async function settlementRoutes(fastify: FastifyInstance) {
  // Пошук НП області за підрядком (2+ символи). Без результатів — порожній масив, без вигадок.
  fastify.get<{ Querystring: { region?: string; q?: string; limit?: string } }>('/api/v1/settlements', async (request, reply) => {
    reply.header('Cache-Control', 'public, max-age=60');
    const region = readRegionParam(request.query.region);
    const query = (request.query.q ?? '').trim();
    if (query.length < 2) throw new AppError(400, 'VALIDATION_ERROR', 'Параметр q обов’язковий (мінімум 2 символи)');
    const rawLimit = Number(request.query.limit ?? 20);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 50) : 20;
    const { items, total } = await searchSettlements(region, query, limit);
    return { data: items, meta: { total, region } };
  });

  // Черги населеного пункту + сьогоднішні вікна відключень (київська доба).
  fastify.get<{ Params: { id: string } }>('/api/v1/settlements/:id/queues', async (request, reply) => {
    reply.header('Cache-Control', 'public, max-age=30');
    const { id } = request.params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(id)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'id має бути UUID населеного пункту');
    }
    const result = await getSettlementQueues(id);
    if (!result) throw new AppError(404, 'NOT_FOUND', 'Населений пункт не знайдено');
    return { data: result };
  });
}
