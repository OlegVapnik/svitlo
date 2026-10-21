import fp from 'fastify-plugin';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { env } from '../config.js';
import { AppError } from '../utils/errors.js';
import { timingSafeStringEqual } from '../utils/timing-safe.js';

export default fp(async (fastify) => {
  fastify.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing or invalid token');
    }
    const token = authHeader.split(' ')[1];
    if (!token || !timingSafeStringEqual(token, env.ADMIN_TOKEN)) {
      // Єдина точка відповіді для невалідного токена — не розрізняємо «немає» і «невірний»,
      // щоб не підказувати атакуючому.
      throw new AppError(403, 'FORBIDDEN', 'Invalid token');
    }
  });
});
