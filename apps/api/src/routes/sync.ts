import type { FastifyInstance } from 'fastify';
import { etagMatchesHeader } from '@svitlo/shared';
import { readRegionParam } from '../services/regions.service.js';
import { buildSyncBundle } from '../services/sync.service.js';

/**
 * `GET /api/v1/sync` — один пакет для офлайн-роботи застосунку.
 *
 * Що віддає: стан мережі області, каталог областей, графік на сьогодні й завтра по групах та
 * останні новини. Клієнт (веб і Android) кладе це в localStorage і гідратує кеш TanStack Query
 * синхронно на старті, тому екран заповнюється ще до першого запиту в мережу.
 *
 * `If-None-Match` підтримується, бо пакет важкий (десятки кілобайт), а змінюється кілька разів на
 * добу. Клієнт надсилає `etag` зі збереженого пакета; якщо вміст той самий — отримує `304` без
 * тіла і не витрачає трафік. `Cache-Control: no-store` тут навмисно: HTTP-кеш посередині зберіг би
 * пакет однієї області й віддав би його тому, хто перемкнув область. ETag узгоджується лише між
 * нашим сервером і збереженим пакетом у застосунку.
 */
export default async function syncRoutes(fastify: FastifyInstance) {
  fastify.get<{ Querystring: { region?: string; days?: string } }>('/api/v1/sync', async (request, reply) => {
    const region = readRegionParam(request.query.region);
    // Сырой код области передаём отдельно: пакет кладёт график и под него тоже (у людей в
    // `localStorage` остались `kyiv`/`kiivska-oblast`, а каталог отдаёт `kyiv-city`/`kyivska-oblast`).
    const requestedRegion = String(request.query.region ?? '').trim();
    const days = Number.parseInt(String(request.query.days ?? ''), 10);
    const bundle = await buildSyncBundle(region, {
      now: new Date(),
      days: Number.isFinite(days) ? days : undefined,
      requestedRegion,
    });

    reply.header('Cache-Control', 'no-store');
    reply.header('ETag', bundle.etag);

    const ifNoneMatch = request.headers['if-none-match'];
    const header = Array.isArray(ifNoneMatch) ? ifNoneMatch.join(',') : ifNoneMatch;
    if (etagMatchesHeader(header, bundle.etag)) {
      // 304 без тіла: клієнт уже має цей самий вміст у локальному пакеті й лише оновить у себе
      // час останньої синхронізації.
      return reply.code(304).send();
    }

    // Конверт `{ data }` — як у решті маршрутів застосунку: `fetcher` на клієнті віддає тіло
    // цілком, і однакова форма відповіді скрізь означає, що офлайн-шар не має окремого випадку.
    return { data: bundle };
  });
}
