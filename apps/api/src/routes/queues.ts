import type { FastifyInstance } from 'fastify';
import { listQueues } from '../services/queues.service.js';
import { readRegionParam, regionDataKeys } from '../services/regions.service.js';

/**
 * Публичный список очередей: только те, о которых есть реальные данные.
 * Раньше список очередей был зашит в вебе одной строкой ('2/2'), а в API его не было вовсе.
 *
 * `?region=<cpu>` (необязательный) сужает список до очередей одной области; без параметра берём
 * область за замовчуванням (env.MIRROR_SCHEDULE_REGION) — точно так же, как `/api/v1/schedules`.
 *
 * ВАЖНО: без параметра нельзя отдавать смесь всех областей. Пока данные были только черниговские,
 * «все слоты» случайно совпадали с дефолтом; после перехода на мультирегиональность такой ответ
 * показывал человеку чужие черги (напр. 60/1 из Киева в Чернигове). Контракт дефолта —
 * /tmp/API-CONTRACT-regions.md, §1.
 */
export default async function queueRoutes(fastify: FastifyInstance) {
  fastify.get<{ Querystring: { region?: string } }>('/api/v1/queues', async (request, reply) => {
    // Данные меняются вместе с импортом графика (~реже 30 минут) — короткий публичный кеш уместен.
    reply.header('Cache-Control', 'public, max-age=30');
    // readRegionParam(undefined) → DEFAULT_REGION; некорректный cpu → 400 VALIDATION_ERROR.
    // `grouped: 'keep'` — область із кількома мережами (м. Дніпро: ЦЕК і ДнЕМ) лишається канонічною
    // і зводиться з ключів фіда: це перелік кодів груп (метадані), а не години відключень, тому
    // об'єднувати його безпечно. Графік такої області вимагає конкретної мережі (див. /schedules).
    const region = readRegionParam(request.query.region, { grouped: 'keep' });
    return { data: await listQueues(region, regionDataKeys(region)) };
  });
}