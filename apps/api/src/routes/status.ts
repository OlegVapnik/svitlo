import type { FastifyInstance } from 'fastify';
import { readRegionParam } from '../services/regions.service.js';
import { buildStatusPayload } from '../services/status.service.js';

export default async function statusRoutes(fastify: FastifyInstance) {
  // `?region=` обязателен по смыслу: счётчики групп и статистика считаются по области, а область
  // у человека одна активная. Без параметра берётся область по умолчанию (см. readRegionParam).
  //
  // Сам расчёт живёт в `buildStatusPayload`: тем же ответом гідратується офлайн-пакет `/sync`, и
  // два набори цифр для одного и того же экрана — это не гипотеза, а то, что случилось бы, если
  // бы логика осталась продублирована в двух маршрутах.
  fastify.get<{ Querystring: { region?: string } }>('/api/v1/status', async (req) => {
    const region = readRegionParam(req.query.region);
    return { data: await buildStatusPayload(region, new Date()) };
  });
}
