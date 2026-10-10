/**
 * Інтеграційні тести мультирегіонального API (`GET /api/v1/regions`) і вибірки за областю
 * (`?region=` у `/api/v1/queues` та `/api/v1/schedules`) на реальній PostgreSQL.
 *
 * Дзеркало тут свідомо ВИМКНЕНО (`MIRROR_SCHEDULE_ENABLED=false`): перевіряємо API, а не мережу.
 * Заодно це підтверджує вимогу контракту «дзеркало недоступне → віддаємо те, що вже є в БД,
 * а якщо й там порожньо — чесний порожній результат, а не 500 і не вигадана область».
 *
 * Без TEST_DATABASE_URL файл пропускається (як і решта інтеграційних тестів); база має закінчуватися
 * на `_test`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ensureTestSchema, testDatabaseUrlOrSkip } from '../helpers/test-db.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? '';
const describeWithDb = describe.skipIf(!TEST_DATABASE_URL);

const CHERNIHIV = 'chernihivska-oblast';
const LVIV = 'lvivska-oblast';

type RegionRow = {
  cpu: string;
  nameUa: string;
  nameEn: string | null;
  queues: string[];
  slots: number;
  lastDate: string | null;
};

let app: FastifyInstance;
let db: typeof import('../../src/db/connection.js').db;
let scheduleSlots: typeof import('../../src/db/schema.js').scheduleSlots;
let regionCatalog: typeof import('../../src/db/schema.js').regions;
let regionQueueCatalog: typeof import('../../src/db/schema.js').regionQueues;

/** Рядок слота з фікстурою стану відключення (коди стану — як у фіді дзеркала). */
function slot(overrides: Partial<{ region: string; queue: string; date: string; timeFrom: string; timeTo: string; source: string }> = {}) {
  return {
    region: CHERNIHIV,
    queue: '1/1',
    date: '2026-10-11',
    timeFrom: '08:00',
    timeTo: '09:00',
    stateCode: 3,
    stateName: 'Відключення',
    stateColor: '#E33535',
    source: 'mirror',
    ...overrides,
  };
}

/** Запит графіка однієї черги/дати з необов'язковою областю. */
async function fetchSchedule(queue: string, region?: string) {
  const suffix = region ? `&region=${encodeURIComponent(region)}` : '';
  const response = await app.inject({
    method: 'GET',
    url: `/api/v1/schedules?queue=${encodeURIComponent(queue)}&date=2026-10-11${suffix}`,
  });
  return {
    statusCode: response.statusCode,
    body: response.json() as { data: { intervals: unknown[]; source: string | null } },
  };
}
describeWithDb('Мультирегіональний API: каталог областей і вибірка за region', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrlOrSkip();
    process.env.LOG_LEVEL = 'silent';
    process.env.ENABLE_SCHEDULER = 'false';
    process.env.MIRROR_SCHEDULE_ENABLED = 'false';
    const connection = await import('../../src/db/connection.js');
    db = connection.db;
    const schema = await import('../../src/db/schema.js');
    scheduleSlots = schema.scheduleSlots;
    regionCatalog = schema.regions;
    regionQueueCatalog = schema.regionQueues;
    await ensureTestSchema();
    const { buildServer } = await import('../../src/app.js');
    app = await buildServer();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    await db.delete(scheduleSlots);
    await db.delete(regionQueueCatalog);
    await db.delete(regionCatalog);
  });

  it('GET /api/v1/regions: каталог із БД, коли дзеркало недоступне, назва не вигадується', async () => {
    await db.insert(scheduleSlots).values([
      slot({ region: LVIV, queue: '2/2', date: '2026-10-11', timeFrom: '08:00', timeTo: '10:00' }),
      slot({ region: LVIV, queue: '2/2', date: '2026-10-11', timeFrom: '10:00', timeTo: '12:00' }),
      slot({ region: LVIV, queue: '2/2', date: '2026-10-12', timeFrom: '08:00', timeTo: '10:00' }),
      slot({ region: LVIV, queue: '1/2', date: '2026-10-11', timeFrom: '14:00', timeTo: '15:00' }),
      slot(),
    ]);

    const response = await app.inject({ method: 'GET', url: '/api/v1/regions' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('public, max-age=300');
    const { data } = response.json() as { data: RegionRow[] };
    expect(data.map((region) => region.cpu)).toEqual([CHERNIHIV, LVIV]);

    // Назви в довіднику немає → показуємо сам cpu, а не вигаданий трансліт.
    expect(data[1]).toEqual({ cpu: LVIV, nameUa: LVIV, nameEn: null, queues: ['1/2', '2/2'], slots: 4, lastDate: '2026-10-12' });
    expect(data[0]).toEqual({ cpu: CHERNIHIV, nameUa: CHERNIHIV, nameEn: null, queues: ['1/1'], slots: 1, lastDate: '2026-10-11' });
  });

  it('GET /api/v1/regions: довідник дає українську назву, неактивна область не показується', async () => {
    await db.insert(regionCatalog).values([
      { cpu: LVIV, nameUa: 'Львівська область', nameEn: 'Lviv Oblast' },
      { cpu: 'zakarpatska-oblast', nameUa: 'Закарпатська область', isActive: false },
    ]);
    await db.insert(regionQueueCatalog).values({ cpu: LVIV, queue: '2/2', groupKey: '2.2' });
    await db.insert(scheduleSlots).values(slot({ region: LVIV, queue: '2/2' }));

    const { data } = (await app.inject({ method: 'GET', url: '/api/v1/regions' })).json() as { data: RegionRow[] };

    // Область є в довіднику, але вимкнена — її не показуємо навіть разом зі слотами.
    expect(data.map((region) => region.cpu)).toEqual([LVIV]);
    expect(data[0]).toMatchObject({
      cpu: LVIV,
      nameUa: 'Львівська область',
      nameEn: 'Lviv Oblast',
      queues: ['2/2'],
      slots: 1,
      lastDate: '2026-10-11',
    });
  });

  it('GET /api/v1/regions: обидва джерела порожні → порожній список, а не 500', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/regions' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: [] });
  });

  it('GET /api/v1/queues?region=… віддає лише черги цієї області (вулиці — тільки для Чернігівщини)', async () => {
    await db.insert(scheduleSlots).values([slot({ region: LVIV, queue: '2/2' }), slot()]);

    const lviv = await app.inject({ method: 'GET', url: `/api/v1/queues?region=${LVIV}` });
    expect(lviv.statusCode).toBe(200);
    // Вулиці не приписуємо Львівській: адресний довідник поки чернігівський, тож 0 — чесніше, ніж чужі дані.
    expect(lviv.json()).toEqual({ data: [{ queue: '2/2', slots: 1, lastDate: '2026-10-11', streets: 0 }] });

    const chernihiv = await app.inject({ method: 'GET', url: `/api/v1/queues?region=${CHERNIHIV}` });
    expect(chernihiv.json()).toEqual({ data: [{ queue: '1/1', slots: 1, lastDate: '2026-10-11', streets: 0 }] });

    // Без region — сумісність з v1: усі слоти в одному списку.
    const all = await app.inject({ method: 'GET', url: '/api/v1/queues' });
    const queues = (all.json() as { data: Array<{ queue: string }> }).data.map((item) => item.queue);
    expect(queues).toEqual(['1/1', '2/2']);
  });

  it('GET /api/v1/schedules?region=… не змішує графіки різних областей', async () => {
    await db.insert(scheduleSlots).values([
      slot({ region: LVIV, queue: '2/2', timeFrom: '08:00', timeTo: '09:00' }),
      slot({ region: LVIV, queue: '2/2', timeFrom: '09:00', timeTo: '10:00' }),
      slot({ region: CHERNIHIV, queue: '2/2', timeFrom: '20:00', timeTo: '21:00' }),
    ]);

    const lviv = await fetchSchedule('2/2', LVIV);
    expect(lviv.statusCode).toBe(200);
    expect(lviv.body.data.intervals).toHaveLength(2);
    expect(lviv.body.data.source).toBe('mirror');

    const chernihiv = await fetchSchedule('2/2', CHERNIHIV);
    expect(chernihiv.body.data.intervals).toHaveLength(1);

    // Невідома, але коректна за форматом область — це НЕ 400: вигаданого графіка не існує.
    const unknown = await fetchSchedule('2/2', 'atlantyda-oblast');
    expect(unknown.statusCode).toBe(200);
    expect(unknown.body.data).toMatchObject({ intervals: [], source: null });

    // Сміття в параметрі — помилка запиту: такий рядок далі пішов би в SQL і логи.
    const malformed = await fetchSchedule('2/2', 'Kyiv City!');
    expect(malformed.statusCode).toBe(400);
  });
});

