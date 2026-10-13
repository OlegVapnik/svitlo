import { FastifyInstance } from 'fastify';
import { outageFiltersSchema } from '@svitlo/shared';
import { getOutages, getOutageStats, getOutageById } from '../services/outage.service.js';

export default async function outagesRoutes(fastify: FastifyInstance) {
  fastify.get('/api/v1/outages', async (req, reply) => {
    const filters = outageFiltersSchema.parse(req.query);
    return await getOutages(filters, { page: 1, limit: 50 });
  });
  
  fastify.get('/api/v1/outages/stats', async (req: any, reply) => {
    const filters = outageFiltersSchema.parse(req.query);
    return { data: await getOutageStats(new Date(), filters.region) };
  });
  
  fastify.get('/api/v1/outages/:id', async (req: any, reply) => {
    const data = await getOutageById(req.params.id);
    if (!data) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Відключення не знайдено' } });
    return { data };
  });
}
