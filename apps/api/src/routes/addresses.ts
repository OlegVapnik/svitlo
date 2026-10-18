import type { FastifyInstance } from 'fastify';
import { suggestAddresses } from '../services/addresses.service.js';
import {
  canonicalQueue as canonicalQueueCode,
  importAddressQueuesBatch,
  isQueueCode,
  listAddressHouses,
  liveLookupFromProvider,
  resolveQueueByAddress,
  suggestSettlements,
  suggestStreets,
  type ImportRow,
} from '../services/address-lookup.service.js';
import { getQueueSchedule, getQueueScheduleMeta } from '../services/schedule-import.service.js';
import { isAllClear, mirrorDayCoverage, peekMirrorSnapshot } from '../services/mirror-schedule.service.js';
import { readRegionParam } from '../services/regions.service.js';
import { AppError } from '../utils/errors.js';

function intParam(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

export default async function addressesRoutes(fastify: FastifyInstance) {
  /**
   * Старый адресный подсказчик по таблице `addresses` (улицы из выгрузок отключений).
   * Оставлен для совместимости — он ничего не знает про группы.
   */
  fastify.get<{ Querystring: { q?: string; limit?: string } }>('/api/v1/addresses/suggest', async (request, reply) => {
    const q = (request.query.q ?? '').trim();
    if (q.length < 2) return { data: [] };
    const limit = intParam(request.query.limit, 8, 1, 20);
    const data = await suggestAddresses(q, limit);
    reply.header('Cache-Control', 'no-store');
    return { data };
  });

  /**
   * Подсказки населённых пунктов области — шаг 1 мастера «найти свою группу».
   * Пустой массив означает «привязок нет», а не ошибку: данных может не быть вовсе.
   */
  fastify.get<{ Querystring: { region?: string; q?: string; limit?: string } }>(
    '/api/v1/addresses/settlements',
    async (request, reply) => {
      const q = (request.query.q ?? '').trim();
      if (q.length < 2) return { data: [] };
      const region = readRegionParam(request.query.region);
      const limit = intParam(request.query.limit, 10, 1, 50);
      const data = await suggestSettlements(region, q, limit);
      reply.header('Cache-Control', 'no-store');
      // В облаке тот же контракт — объекты, а не строки: клиент читает `name`/`normalized`.
      return { data: data.map((name) => ({ name })), region };
    },
  );

  /**
   * Подсказки улиц внутри НП — шаг 2. Дополнительно отдаём `wholeSettlementQueue`, если на всё
   * село известна одна группа: тогда мастер может сразу показать ответ и не спрашивать улицу.
   */
  fastify.get<{ Querystring: { region?: string; settlement?: string; q?: string; limit?: string } }>(
    '/api/v1/addresses/streets',
    async (request, reply) => {
      const settlement = (request.query.settlement ?? '').trim();
      if (settlement.length < 2) return { data: [], wholeSettlementQueue: null };
      const region = readRegionParam(request.query.region);
      const q = (request.query.q ?? '').trim();
      const limit = intParam(request.query.limit, 10, 1, 50);
      const data = await suggestStreets(region, settlement, q, limit);
      reply.header('Cache-Control', 'no-store');
      return {
        data,
        wholeSettlementQueue: data[0]?.wholeSettlementQueue ?? null,
        region,
      };
    },
  );

  /**
   * Дома выбранной улицы с группами. Нужны для чипов «12 → 2/2»: человеку не нужно печатать
   * номер дома, если оператор уже опубликовал привязку.
   */
  fastify.get<{ Querystring: { region?: string; settlement?: string; street?: string } }>(
    '/api/v1/addresses/houses',
    async (request, reply) => {
      const settlement = (request.query.settlement ?? '').trim();
      const street = (request.query.street ?? '').trim();
      if (settlement.length < 2 || street.length < 2) return { data: [], wholeStreetQueue: null };
      const region = readRegionParam(request.query.region);
      const result = await listAddressHouses({ region, settlement, street });
      reply.header('Cache-Control', 'public, max-age=300');
      return result;
    },
  );

  /**
   * Поиск группы по адресу и расписание этой группы на сегодня.
   *
   * Если адреса в базе нет, делается одна попытка спросить реального провайдера (DTEK КЕМ).
   * Провайдер недоступен — возвращаем честный «не найдено», а не 500: человек увидит, что
   * группа неизвестна, и это правда.
   */
  fastify.get<{
    Querystring: { region?: string; settlement?: string; street?: string; house?: string; live?: string };
  }>('/api/v1/addresses/resolve', async (request, reply) => {
    const settlement = (request.query.settlement ?? '').trim();
    if (settlement.length < 2) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Параметр settlement обязателен');
    }
    const region = readRegionParam(request.query.region);
    const street = (request.query.street ?? '').trim();
    const house = (request.query.house ?? '').trim();
    const allowLive = request.query.live !== 'false';

    reply.header('Cache-Control', 'no-store');

    let resolved = await resolveQueueByAddress({ region, settlement, street, house });

    // Не нашли и разрешена живая подкачка — спрашиваем провайдера ровно один раз.
    if (resolved.queue === null && allowLive && street) {
      const fetched = await liveLookupFromProvider({ region, settlement, street });
      if (fetched.length > 0) {
        resolved = await resolveQueueByAddress({ region, settlement, street, house });
      }
    }

    if (resolved.queue === null) {
      return {
        data: {
          queue: null,
          options: resolved.options,
          reason: resolved.reason,
          source: resolved.source,
          schedule: null,
        },
      };
    }

    // Сразу отдаём график найденной группы на сегодня: человек узнал номер группы и заодно
    // видит, есть ли сейчас свет, не делая второй запрос.
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Kyiv',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());

    const [intervals, meta] = await Promise.all([
      getQueueSchedule(resolved.queue, today, region),
      getQueueScheduleMeta(resolved.queue, today, region),
    ]);

    // Ровно та же разница, что и в `/schedules`: пустые интервалы могут значить «оператор ГПВ
    // опубликовал, отключений на сегодня нет». Иначе мастер поиска писал «графіку на сьогодні
    // немає» про группу, у которой график есть. Кеш зеркала — без сети, холодный кеш даёт false.
    const snapshot = peekMirrorSnapshot();
    const coverage = snapshot ? mirrorDayCoverage(snapshot.payload, region, today) : null;
    const covered = (coverage?.queues.includes(resolved.queue) ?? false) || meta.source !== null;

    return {
      data: {
        queue: resolved.queue,
        options: resolved.options,
        reason: resolved.reason,
        source: resolved.source,
        schedule: {
          queue: resolved.queue,
          date: today,
          intervals,
          source: meta.source,
          lastImportedAt: meta.lastImportedAt,
          covered,
          allClear: isAllClear(coverage, resolved.queue, intervals.length),
        },
      },
    };
  });

  /**
   * Народна привязка: человек сам називає свою чергу, якщо для його адреси її ще немає.
   *
   * Обмеження свідомі: код черги має бути справжнім (1/1…6/2), інакше в базу потрапить сміття;
   * зберігається ОДИН адреса за раз, без імені та телефону — персональних даних не збираємо;
   * джерело позначається 'community', щоб в інтерфейсі було видно, що прив'язка народна, і її
   * можна було перевірити, а не видавати за вивантаження оператора.
   */
  fastify.post('/api/v1/addresses/contribute', async (request, reply) => {
    // `house` в теле вкладаем в housePattern: отдельного поля в типе импорта нет, а человеку
    // в форме удобнее вводить именно «номер дома».
    const body = request.body as (Partial<ImportRow> & { house?: string }) | undefined;
    const region = String(body?.region ?? '').trim();
    const settlement = String(body?.settlement ?? '').trim();
    const street = String(body?.street ?? '').trim();
    const house = String(body?.house ?? '').trim();
    const queue = canonicalQueueCode(String(body?.queue ?? ''));

    if (!region || settlement.length < 2) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Потрібні region і settlement');
    }
    if (!isQueueCode(queue)) {
      throw new AppError(400, 'VALIDATION_ERROR', `Невірний код черги «${queue}»`);
    }

    const result = await importAddressQueuesBatch(
      [{ region, settlement, street, housePattern: house || '*', queue }],
      'community',
    );
    return reply.status(201).send({ data: { saved: result.imported > 0, queue, source: 'community' } });
  });

  /**
   * Массовый импорт привязок адрес → группа (выгрузка обленерго, ручная таблица).
   * Под админ-токеном: маршрут меняет данные, которые читают все пользователи.
   */
  fastify.post(
    '/api/v1/admin/addresses/import',
    { preHandler: [(fastify as any).authenticate] },
    async (request) => {
      const body = request.body as { rows?: ImportRow[] } | undefined;
      const rows = Array.isArray(body?.rows) ? body.rows : null;
      if (!rows || rows.length === 0) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Ожидается массив rows с привязками адрес → очередь');
      }
      // Ограничение на размер: импорт на пол-Украины должен идти частями, а не одним телом —
      // иначе один кривой запрос положит процесс.
      if (rows.length > 5000) {
        throw new AppError(400, 'VALIDATION_ERROR', 'За раз не больше 5000 строк — разбейте импорт на части');
      }
      const result = await importAddressQueuesBatch(rows, 'manual');
      return { data: result };
    },
  );
}