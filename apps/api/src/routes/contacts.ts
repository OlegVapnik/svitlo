import { FastifyInstance } from 'fastify';
import { db } from '../db/connection.js';
import { contacts } from '../db/schema.js';

export default async function contactsRoutes(fastify: FastifyInstance) {
  fastify.get('/api/v1/contacts', async () => {
    return { data: await db.select().from(contacts) };
  });
}
