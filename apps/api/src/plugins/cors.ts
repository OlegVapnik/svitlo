import fp from 'fastify-plugin';
import cors from '@fastify/cors';
import { env } from '../config.js';
import type { FastifyInstance } from 'fastify';

export default fp(async (fastify: FastifyInstance) => {
  // За замовчуванням CORS вимкнено (немає заголовків): фронт і API в прод ходять на один
  // origin через nginx-проксі, тому CORS там не потрібен. У development явно задайте
  // CORS_ORIGINS=http://localhost:3000 або поставте '*' лише для локальної розробки.
  // Origin нативного Android-застосунку (Capacitor): воно віддає сторінку з origin
  // `https://localhost` (див. capacitor.config.json → server.androidScheme), тому запити до API
  // йдуть кросс-доменно, і без CORS-заголовків відповідь блокується — застосунок бачив би порожні
  // екрани без жодної помилки в UI. Це конкретний адрес, а не '*': безпека не знижується,
  // звичайний браузер з таким origin сюди не потрапить.
  const nativeOrigins = ['https://localhost', 'capacitor://localhost'];
  const allowed = [...new Set([...env.CORS_ORIGINS, ...nativeOrigins])];
  await fastify.register(cors, {
    origin: allowed.includes('*') ? true : allowed,
  });
});
