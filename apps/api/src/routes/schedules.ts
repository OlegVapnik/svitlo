import { FastifyInstance } from 'fastify';
import { importOperatorSchedule, getQueueSchedule, getQueueScheduleMeta } from '../services/schedule-import.service.js';
import { AppError } from '../utils/errors.js';
import { demoScheduleForQueue } from '../services/schedule-mock.service.js';
import { env } from '../config.js';
import { normalizeScheduleResponse } from '../services/schedule-normalizer.js';

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
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) throw new AppError(400, 'VALIDATION_ERROR', 'date має бути YYYY-MM-DD');
  const meta = await getQueueScheduleMeta(queue, date);
  const demoSchedule = env.SCHEDULE_DEMO ? demoScheduleForQueue(queue) : null;
  if (meta.count === 0 && demoSchedule) {
    return { data: { queue, date, intervals: normalizeScheduleResponse(demoSchedule, date), demo: true, source: 'demo', lastImportedAt: null } };
  }
  const intervals = await getQueueSchedule(queue, date);
  return { data: { queue, date, intervals, demo: false, source: meta.source, lastImportedAt: meta.lastImportedAt } };
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

