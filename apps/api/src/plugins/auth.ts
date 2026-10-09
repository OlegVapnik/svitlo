import fp from 'fastify-plugin';
import { env } from '../config.js';
import { AppError } from '../utils/errors.js';

export default fp(async (fastify) => {
  fastify.decorate('authenticate', async (request: any, reply: any) => {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing or invalid token');
    }
    const token = authHeader.split(' ')[1];
    if (token !== env.ADMIN_TOKEN) {
      throw new AppError(403, 'FORBIDDEN', 'Invalid token');
    }
  });
});
