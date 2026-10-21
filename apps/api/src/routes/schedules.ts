import { FastifyInstance } from 'fastify';
import { getQueueSchedule, getQueueScheduleMeta, queueReadVariants } from '../services/schedule-import.service.js';
import {
  MIRROR_SCHEDULE_SOURCE,
  ensureMirrorSchedule,
  isAllClear,
  mirrorDayCoverage,
  peekMirrorSnapshot,
} from '../services/mirror-schedule.service.js';
import { listUpcomingGroupOutages } from '../services/upcoming-outages.service.js';
import { readRegionParam, resolveScheduleRegionScope } from '../services/regions.service.js';
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
 *
 * `region` може бути канонічною назвою області (див. shared/regions-catalog.ts). Якщо фід віддає її
 * кількома мережами (м. Дніпро: ЦЕК і ДнЕМ), область звужується до тієї мережі, де на цю чергу й дату
 * є дані; коли дані є в обох — береться перша мережа каталогу. 400 `AMBIGUOUS_REGION` більше немає:
 * вона ламала екран «область цілком» («даних графіка немає» при живому графіку).
 */
async function buildQueueSchedule(queue: string, date: string, region: string, log: FastifyInstance['log']) {
  if (!queue.trim()) throw new AppError(400, 'VALIDATION_ERROR', 'Параметр queue обовʼязковий');
  if (!queueCodeSchema.safeParse(queue).success) {
    throw new AppError(400, 'VALIDATION_ERROR', 'queue має вигляд «3» або «2/2»');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) throw new AppError(400, 'VALIDATION_ERROR', 'date має бути YYYY-MM-DD');
  const scope = await resolveScheduleRegionScope(region, queue, date);
  // Дзеркало ГПВ: якщо на цю чергу/дату в БД порожньо (або знімок дзеркала оновився), підтягуємо
  // публічний JSON і пишемо `schedule_slots` — «Мої черги» показують реальний ГПВ без кнопки.
  // Збій дзеркала НЕ ламає відповідь: віддаємо те, що вже є в БД (або чесний порожній графік).
  // Невідома область не є помилкою — у фіді для неї просто немає слотів, тож відповідь порожня.
  for (const key of scope.keys) {
    try {
      await ensureMirrorSchedule(queue, date, { region: key });
    } catch (error) {
      log.warn({ err: error, region: key, queue, date }, 'Mirror schedule ensure failed; serving stored slots');
    }
  }
  // Ніяких підстановок «демо-графіка»: коли слотів немає — віддаємо порожні интервалы и source=null.
  // Вигаданий графік про реальне електрику читається як справжній (hard stop, skills/svitlo-onboarding #14).
  const perKey = await Promise.all(
    scope.keys.map(async (key) => {
      const [meta, intervals] = await Promise.all([
        getQueueScheduleMeta(queue, date, key),
        getQueueSchedule(queue, date, key),
      ]);
      // Порожній `intervals` має ДВІ різні смисли, і фронтенд мусить їх розрізняти: «оператор опублікував
      // ГПВ, відключень немає» і «на цю дату нічого не публікували». Перший бачимо у знімку дзеркала:
      // комірки дня є, але всі — «світло є» (коди 0/1). Дзеркало читаємо ЛИШЕ з кеша (без мережі — його
      // щойно наповнив `ensureMirrorSchedule`), холодний кеш дає чесне «не знаємо» (`covered: false`).
      const snapshot = peekMirrorSnapshot();
      const coverage = snapshot ? mirrorDayCoverage(snapshot.payload, key, date) : null;
      return { coverage, meta, intervals };
    }),
  );
  // Ключі тут — або один ключ фіда, або мережі області, жодна з яких не має даних на цю добу.
  // Об'єднання інтервалів у другому випадку безпечне: порожні множини нічого не додають.
  const intervals = perKey
    .flatMap((entry) => entry.intervals)
    .filter((interval, index, all) => all.findIndex((item) => item.startsAt === interval.startsAt && item.endsAt === interval.endsAt) === index)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const source = perKey.find((entry) => entry.meta.source !== null)?.meta.source ?? null;
  const lastImportedAt = perKey
    .map((entry) => entry.meta.lastImportedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .pop() ?? null;
  // Коды покрытия ищем с учётом региональных синонимов (у Києва «1» ≡ «1/1»): покриття дзеркала
  // лежить у формі «1/1», а запрос от живого источника приходит плоским «1».
  const queueVariants = queueReadVariants(queue, region);
  const covered = perKey.some(
    (entry) =>
      (entry.coverage ? entry.coverage.queues.some((code) => queueVariants.includes(code)) : false) ||
      entry.meta.source !== null,
  );
  return {
    data: {
      queue,
      date,
      intervals,
      // Джерело беремо у слотів; коли слотів немає, але графік опубліковано — джерело саме дзеркало:
      // саме з нього ми знаємо, що на цю дату відключень немає.
      source: source ?? (covered ? MIRROR_SCHEDULE_SOURCE : null),
      lastImportedAt,
      covered,
      // «Світло за графіком» — не те саме, що `covered`: коли фід на цю добу вже показує відключення,
      // а слотів ще немає (імпорт відстав), чесніше «даних немає», ніж «світло є» (див. `isAllClear`).
      // Для області з кількома мережами — тільки якщо БЕЗ ВІДКЛЮЧЕНЬ КОЖНА з них.
      allClear:
        perKey.length > 0 &&
        perKey.every((entry) => {
          // `isAllClear` сверяет код с покрытием дзеркала — берём ту форму кода, что реально в нём.
          const coverageQueue = entry.coverage?.queues.find((code) => queueVariants.includes(code)) ?? queue;
          return isAllClear(entry.coverage, coverageQueue, entry.intervals.length);
        }),
    },
  };
}

export default async function scheduleRoutes(fastify: FastifyInstance) {
  /**
   * Ближні відключення по ГРУПАХ усієї області (GET /api/v1/schedules/upcoming).
   *
   * На відміну від `/schedules?queue=…` (одна черга) — це зріз по всій області: головна й блок
   * «Найближчі відключення» показують, які саме групи гасять сьогодні/завтра, з реальними
   * интервалами. Порожній масив = графіка в области на ці дати немає (чесно, без «демо»).
   */
  fastify.get<{ Querystring: { region?: string; days?: string } }>('/api/v1/schedules/upcoming', async (req, reply) => {
    const days = Number(req.query.days ?? 2);
    if (!Number.isInteger(days) || days < 1 || days > 7) {
      throw new AppError(400, 'VALIDATION_ERROR', 'days має бути цілим від 1 до 7');
    }
    reply.header('Cache-Control', 'public, max-age=60');
    const region = readRegionParam(req.query.region);
    return { data: await listUpcomingGroupOutages(region, days) };
  });

  // Основний маршрут: черга передається query-параметром, тому «2/2» працює за будь-яким проксі.
  fastify.get<{ Querystring: { queue?: string; date?: string; region?: string } }>('/api/v1/schedules', async (req) => {
    const queue = String(req.query.queue ?? '');
    const date = String(req.query.date ?? kyivToday());
    // `grouped: 'keep'` — область із кількома мережами лишаємо канонічною: нижче її звузить
    // `resolveScheduleRegionScope` за фактичними даними (або чесно відповість 400, якщо дані є в обох).
    return buildQueueSchedule(queue, date, readRegionParam(req.query.region, { grouped: 'keep' }), fastify.log);
  });

  // Сумісність: черги без «/» (напр. «3») можна й надалі брати зі шляху.
  fastify.get('/api/v1/schedules/:queue', async (req: any) => {
    const queue = String(req.params.queue);
    const date = String(req.query.date ?? kyivToday());
    return buildQueueSchedule(queue, date, readRegionParam(req.query.region, { grouped: 'keep' }), fastify.log);
  });
}
