import fp from 'fastify-plugin';
import cors from '@fastify/cors';
import { env } from '../config.js';
import type { FastifyInstance } from 'fastify';

export default fp(async (fastify: FastifyInstance) => {
  // За замовчуванням CORS вимкнено (немає заголовків): фронт і API в прод ходять на один
  // origin через nginx-проксі, тому CORS там не потрібен. У development явно задайте
  // CORS_ORIGINS=http://localhost:3000 або поставте '*' лише для локальної розробки.
  const allowed = env.CORS_ORIGINS;
  if (allowed.length === 0) {
    // Явно жодного origin — не реєструємо CORS (відповіді без Access-Control-*).
    return;
  }
  await fastify.register(cors, {
    origin: allowed.includes('*') ? true : allowed,
  });
});
