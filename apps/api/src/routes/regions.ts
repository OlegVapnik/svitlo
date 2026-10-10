import type { FastifyInstance } from 'fastify';
import type { RegionCoverageResponse, RegionListResponse } from '@svitlo/shared';
import { getRegionsCoverage, listRegions } from '../services/regions.service.js';

/**
 * Каталог областей ГПВ (multi-region Ukraine).
 *
 * Дані змінюються разом з імпортом дзеркала (типово раз на 30–60 хв), тому 5 хвилин публічного кеша
 * доречні. Маршрут НІКОЛИ не віддає 500 через дзеркало: якщо фід недоступний, повертаємо каталог із БД,
 * а якщо й там порожньо — чесний порожній список (вигаданих областей не буває).
 */
export default async function regionRoutes(fastify: FastifyInstance) {
  fastify.get<{ Reply: RegionCoverageResponse }>('/api/v1/regions/coverage', async (_request, reply) => {
    reply.header('Cache-Control', 'public, max-age=300');
    return await getRegionsCoverage();
  });

  fastify.get<{ Reply: RegionListResponse }>('/api/v1/regions', async (_request, reply) => {
    reply.header('Cache-Control', 'public, max-age=300');
    return { data: await listRegions() };
  });
}

