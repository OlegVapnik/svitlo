import type { FastifyInstance } from 'fastify';
import { suggestAddresses } from '../services/addresses.service.js';

export default async function addressesRoutes(fastify: FastifyInstance) {
  fastify.get<{ Querystring: { q?: string; limit?: string } }>('/api/v1/addresses/suggest', async (request, reply) => {
    const q = (request.query.q ?? '').trim();
    if (q.length < 2) return { data: [] };
    const parsedLimit = Number(request.query.limit ?? 8);
    const limit = Number.isFinite(parsedLimit) ? Math.min(20, Math.max(1, Math.floor(parsedLimit))) : 8;
    const data = await suggestAddresses(q, limit);
    reply.header('Cache-Control', 'no-store');
    return { data };
  });
}
