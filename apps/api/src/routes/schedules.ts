import { FastifyInstance } from 'fastify';
import { getQueueSchedule, getQueueScheduleMeta } from '../services/schedule-import.service.js';
import { AppError } from '../utils/errors.js';
import { queueCodeSchema } from '@svitlo/shared';

/** Київська дата YYYY-MM-DD (типова, якщо клієнт не передав date). */
function kyivToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

/**
 * Спільна логіка для обох маршрутів (query та path-параметр).
 *
 * Чому два маршрути: черги мають вигляд «2/2», і якщо передавати їх у шляху
 * (`/schedules/2%2F2`), nginx (перед API) декодує `%2F` у `/` і запит потрапляє
 * на неіснуючий `/schedules/2/2` → 404. Тому основний маршрут приймає чергу
 * як query-параметр, а шляховий лишається для сумісності (черги без «/»).
 */
async function buildQueueSchedule(queue: string, date: string) {
  if (!queue.trim()) throw new AppError(400, 'VALIDATION_ERROR', 'Параметр queue обовʼязковий');
  if (!queueCodeSchema.safeParse(queue).success) {
    throw new AppError(400, 'VALIDATION_ERROR', 'queue має вигляд «3» або «2/2»');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) throw new AppError(400, 'VALIDATION_ERROR', 'date має бути YYYY-MM-DD');
  // Ніяких підстановок «демо-графіка»: коли слотів немає — віддаємо порожні интервалы и source=null.
  // Вигаданий графік про реальне електрику читається як справжній (hard stop, skills/svitlo-onboarding #14).
  const [meta, intervals] = await Promise.all([getQueueScheduleMeta(queue, date), getQueueSchedule(queue, date)]);
  return { data: { queue, date, intervals, source: meta.source, lastImportedAt: meta.lastImportedAt } };
}

export default async function scheduleRoutes(fastify: FastifyInstance) {
  // Основний маршрут: черга передається query-параметром, тому «2/2» працює за будь-яким проксі.
  fastify.get<{ Querystring: { queue?: string; date?: string } }>('/api/v1/schedules', async (req) => {
    const queue = String(req.query.queue ?? '');
    const date = String(req.query.date ?? kyivToday());
    return buildQueueSchedule(queue, date);
  });

  // Сумісність: черги без «/» (напр. «3») можна й надалі брати зі шляху.
  fastify.get('/api/v1/schedules/:queue', async (req: any) => {
    const queue = String(req.params.queue);
    const date = String(req.query.date ?? kyivToday());
    return buildQueueSchedule(queue, date);
  });
}

