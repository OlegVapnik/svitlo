import { FastifyInstance } from 'fastify';
import { outageFiltersSchema } from '@svitlo/shared';
import { getOutages, getOutageStats, getOutageById } from '../services/outage.service.js';

export default async function outagesRoutes(fastify: FastifyInstance) {
  fastify.get('/api/v1/outages', async (req, reply) => {
    const filters = outageFiltersSchema.parse(req.query);
    return await getOutages(filters, { page: 1, limit: 50 });
  });
  
  // Статистика для вкладок «Графік» и «Карта». Период берём из dateFrom/dateTo, иначе график
  // показывал бы все сроки, а не выбранный (раньше даты в запрос просто игнорировались).
  fastify.get('/api/v1/outages/stats', async (req: any, reply) => {
    const filters = outageFiltersSchema.parse(req.query);
    return { data: await getOutageStats(new Date(), filters.region, filters.dateFrom, filters.dateTo) };
  });
  
  fastify.get('/api/v1/outages/:id', async (req: any, reply) => {
    const data = await getOutageById(req.params.id);
    if (!data) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Відключення не знайдено' } });
    return { data };
  });
}
