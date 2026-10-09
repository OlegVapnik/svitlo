import { FastifyInstance } from 'fastify';
import { getIncidents } from '../services/incidents.service.js';

export default async function incidentsRoutes(fastify: FastifyInstance) {
  fastify.get('/api/v1/incidents', async () => {
    return { data: await getIncidents() };
  });
}
