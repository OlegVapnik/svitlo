/**
 * Маршрути API для новин про відключення світла та стан енергосистеми.
 *
 * Ендпоінти:
 * - GET  /api/v1/news         — список новин із фільтрами (region, kind, since, ukraineWide, limit)
 * - GET  /api/v1/news/sources — перелік джерел новин та їх актуальний статус
 * - POST /api/v1/admin/news/collect — ручний запуск збору новин (?dryRun=1 для тестового прогону)
 */
import type { FastifyInstance } from 'fastify';
import { newsQuerySchema } from '@svitlo/shared';
import { collectNews } from '../services/news/news-collector.service.js';
import { queryNews, queryNewsSources } from '../services/news/news-query.service.js';

export default async function newsRoutes(fastify: FastifyInstance) {
  // Публічний список новин
  fastify.get('/api/v1/news', async (request, reply) => {
    const query = newsQuerySchema.parse(request.query);
    const result = await queryNews(query);

    reply.header('Cache-Control', 'public, max-age=300');
    return result;
  });

  // Публічний перелік джерел та якість покриття
  fastify.get('/api/v1/news/sources', async (_request, reply) => {
    const result = await queryNewsSources();

    reply.header('Cache-Control', 'public, max-age=300');
    return result;
  });

  // Адміністративний запуск збору новин
  fastify.post<{ Querystring: { dryRun?: string } }>(
    '/api/v1/admin/news/collect',
    { preHandler: [(fastify as any).authenticate] },
    async (request) => {
      const isDryRun = request.query.dryRun === '1' || request.query.dryRun === 'true';
      const result = await collectNews({ dryRun: isDryRun });
      return result;
    },
  );
}
