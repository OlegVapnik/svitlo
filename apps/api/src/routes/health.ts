import { FastifyInstance } from 'fastify';

export default async function healthRoutes(fastify: FastifyInstance) {
  fastify.get('/api/v1/health', async () => {
    return { status: 'ok' };
  });
}
