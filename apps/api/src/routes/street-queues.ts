import type { FastifyInstance } from 'fastify';
import { streetQueueInputSchema } from '@svitlo/shared';
import { listStreetQueues, upsertStreetQueue, removeStreetQueue, getStreetSchedule } from '../services/street-queues.service.js';
import { readRegionParam } from '../services/regions.service.js';
import { AppError } from '../utils/errors.js';

function kyivToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export default async function streetQueueRoutes(fastify: FastifyInstance) {
  // Публичный список пар «улица → очередь».
  fastify.get<{ Querystring: { region?: string } }>('/api/v1/street-queues', async (request, reply) => {
    reply.header('Cache-Control', 'public, max-age=30');
    const region = readRegionParam(request.query.region);
    return { data: await listStreetQueues(region) };
  });

  // Поиск по улице: возвращает график привязанной очереди на дату (по умолчанию — сегодня).
  fastify.get<{ Querystring: { street?: string; date?: string; region?: string } }>('/api/v1/street-queues/schedule', async (request) => {
    const street = (request.query.street ?? '').trim();
    if (street.length < 2) throw new AppError(400, 'VALIDATION_ERROR', 'Параметр street обязателен (минимум 2 символа)');
    const date = (request.query.date ?? kyivToday()).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) throw new AppError(400, 'VALIDATION_ERROR', 'date має бути YYYY-MM-DD');
    const region = readRegionParam(request.query.region);
    return { data: await getStreetSchedule(street, date, region) };
  });

  // Создать/изменить пару (требуется админ-токен).
  fastify.put('/api/v1/admin/street-queues', { preHandler: [(fastify as any).authenticate] }, async (request) => {
    const parsed = streetQueueInputSchema.parse(request.body);
    const region = parsed.region ? readRegionParam(parsed.region) : undefined;
    return { data: await upsertStreetQueue(parsed.street, parsed.queue, region) };
  });

  // Удалить пару по имени улицы (нормализуется на сервере).
  fastify.delete<{ Params: { street: string }; Querystring: { region?: string } }>(
    '/api/v1/admin/street-queues/:street',
    { preHandler: [(fastify as any).authenticate] },
    async (request) => {
      const region = readRegionParam(request.query.region);
      const removed = await removeStreetQueue(request.params.street, region);
      return { data: { removed } };
    },
  );
}
