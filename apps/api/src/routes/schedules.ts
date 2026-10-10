import { FastifyInstance } from 'fastify';
import { getQueueSchedule, getQueueScheduleMeta } from '../services/schedule-import.service.js';
import { ensureMirrorSchedule } from '../services/mirror-schedule.service.js';
import { readRegionParam } from '../services/regions.service.js';
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
 *
 * `region` — `cpu` області (мультирегіональність): та сама черга «2/2» у Чернігівській і Львівській
 * це РІЗНІ графіки, тому область входить і в імпорт із дзеркала, і в читання слотів.
 */
async function buildQueueSchedule(queue: string, date: string, region: string, log: FastifyInstance['log']) {
  if (!queue.trim()) throw new AppError(400, 'VALIDATION_ERROR', 'Параметр queue обовʼязковий');
  if (!queueCodeSchema.safeParse(queue).success) {
    throw new AppError(400, 'VALIDATION_ERROR', 'queue має вигляд «3» або «2/2»');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) throw new AppError(400, 'VALIDATION_ERROR', 'date має бути YYYY-MM-DD');
  // Дзеркало ГПВ: якщо на цю чергу/дату в БД порожньо (або знімок дзеркала оновився), підтягуємо
  // публічний JSON і пишемо `schedule_slots` — «Мої черги» показують реальний ГПВ без кнопки.
  // Збій дзеркала НЕ ламає відповідь: віддаємо те, що вже є в БД (або чесний порожній графік).
  // Невідома область не є помилкою — у фіді для неї просто немає слотів, тож відповідь порожня.
  try {
    await ensureMirrorSchedule(queue, date, { region });
  } catch (error) {
    log.warn({ err: error, region, queue, date }, 'Mirror schedule ensure failed; serving stored slots');
  }
  // Ніяких підстановок «демо-графіка»: коли слотів немає — віддаємо порожні интервалы и source=null.
  // Вигаданий графік про реальне електрику читається як справжній (hard stop, skills/svitlo-onboarding #14).
  const [meta, intervals] = await Promise.all([
    getQueueScheduleMeta(queue, date, region),
    getQueueSchedule(queue, date, region),
  ]);
  return { data: { queue, date, intervals, source: meta.source, lastImportedAt: meta.lastImportedAt } };
}

export default async function scheduleRoutes(fastify: FastifyInstance) {
  // Основний маршрут: черга передається query-параметром, тому «2/2» працює за будь-яким проксі.
  fastify.get<{ Querystring: { queue?: string; date?: string; region?: string } }>('/api/v1/schedules', async (req) => {
    const queue = String(req.query.queue ?? '');
    const date = String(req.query.date ?? kyivToday());
    return buildQueueSchedule(queue, date, readRegionParam(req.query.region), fastify.log);
  });

  // Сумісність: черги без «/» (напр. «3») можна й надалі брати зі шляху.
  fastify.get('/api/v1/schedules/:queue', async (req: any) => {
    const queue = String(req.params.queue);
    const date = String(req.query.date ?? kyivToday());
    return buildQueueSchedule(queue, date, readRegionParam(req.query.region), fastify.log);
  });
}
