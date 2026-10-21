import fp from 'fastify-plugin';
import cors from '@fastify/cors';
import { env } from '../config.js';
import type { FastifyInstance } from 'fastify';

export default fp(async (fastify: FastifyInstance) => {
  // За замовчуванням CORS вимкнено (немає заголовків): фронт і API в прод ходять на один
  // origin через Cloudflare (Pages + Worker), тому CORS там не потрібен. У development явно
  // задайте CORS_ORIGINS=http://localhost:5173 або поставте '*' лише для локальної розробки.
  // Origin нативного Android-застосунку старої Capacitor-збірки: вона віддавала сторінку з
  // origin `https://localhost` / `capacitor://localhost`, тому запити до API йшли кросс-доменно,
  // і без CORS-заголовків відповідь блокується — застосунок бачив би порожні екрани без жодної
  // помилки в UI. Це конкретний адрес, а не '*': безпека не знижується, звичайний браузер з
  // таким origin сюди не потрапить.
  const nativeOrigins = ['https://localhost', 'capacitor://localhost'];
  const allowed = [...new Set([...env.CORS_ORIGINS, ...nativeOrigins])];
  await fastify.register(cors, {
    origin: allowed.includes('*') ? true : allowed,
  });
});
