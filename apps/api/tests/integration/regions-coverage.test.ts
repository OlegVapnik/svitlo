/**
 * Інтеграційний тест ендпоінта GET /api/v1/regions/coverage на тестовій PostgreSQL.
 * Перевіряє три сеяні області:
 * 1. Свіжа (сьогоднішні слоти): covered: true, stale: false, freshnessHours: 0
 * 2. Устаріла (липневі слоти > 48 год): covered: true, stale: true, freshnessHours > 48
 * 3. Порожня (без слотів): covered: false, stale: true, slots: 0, lastDate: null, freshnessHours: null
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { RegionCoverageResponse } from '@svitlo/shared';
import { ensureTestSchema, testDatabaseUrlOrSkip } from '../helpers/test-db.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? '';
const describeWithDb = describe.skipIf(!TEST_DATABASE_URL);

const FRESH_REGION = 'kiivska-oblast';
const STALE_REGION = 'lvivska-oblast';
const EMPTY_REGION = 'ivano-frankivska-oblast';

let app: FastifyInstance;
let db: typeof import('../../src/db/connection.js').db;
let scheduleSlots: typeof import('../../src/db/schema.js').scheduleSlots;
let regions: typeof import('../../src/db/schema.js').regions;
let regionQueues: typeof import('../../src/db/schema.js').regionQueues;

describeWithDb('Інтеграція: GET /api/v1/regions/coverage', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrlOrSkip();
    process.env.LOG_LEVEL = 'silent';
    process.env.ENABLE_SCHEDULER = 'false';
    process.env.MIRROR_SCHEDULE_ENABLED = 'false';
    const connection = await import('../../src/db/connection.js');
    db = connection.db;
    const schema = await import('../../src/db/schema.js');
    scheduleSlots = schema.scheduleSlots;
    regions = schema.regions;
    regionQueues = schema.regionQueues;
    await ensureTestSchema();
    const { buildServer } = await import('../../src/app.js');
    app = await buildServer();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    await db.delete(scheduleSlots);
    await db.delete(regionQueues);
    await db.delete(regions);
  });

  it('повертає коректний звіт покриття та метадані для трьох областей (свіжа, устаріла, порожня)', async () => {
    // 1. Створюємо довідник трьох областей
    await db.insert(regions).values([
      { cpu: FRESH_REGION, nameUa: 'Київська область' },
      { cpu: STALE_REGION, nameUa: 'Львівська область' },
      { cpu: EMPTY_REGION, nameUa: 'Івано-Франківська область' },
    ]);

    // 2. Черги
    await db.insert(regionQueues).values([
      { cpu: FRESH_REGION, queue: '1/1', groupKey: '1.1' },
      { cpu: FRESH_REGION, queue: '1/2', groupKey: '1.2' },
      { cpu: STALE_REGION, queue: '2/1', groupKey: '2.1' },
      { cpu: EMPTY_REGION, queue: '3/1', groupKey: '3.1' },
    ]);

    // Поточна дата у Києві — 2026-10-11
    const todayYmd = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Kyiv',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());

    // 3. Слоти: для FRESH — на сьогодні, для STALE — стара дата 2026-07-01, для EMPTY — 0 слотів
    await db.insert(scheduleSlots).values([
      {
        region: FRESH_REGION,
        queue: '1/1',
        date: todayYmd,
        timeFrom: '08:00',
        timeTo: '10:00',
        stateCode: 3,
        stateName: 'Відключення',
        stateColor: '#E33535',
        source: 'mirror',
      },
      {
        region: STALE_REGION,
        queue: '2/1',
        date: '2026-07-01',
        timeFrom: '12:00',
        timeTo: '14:00',
        stateCode: 3,
        stateName: 'Відключення',
        stateColor: '#E33535',
        source: 'mirror',
      },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/regions/coverage',
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=300');

    const json = res.json() as RegionCoverageResponse;
    expect(json).toHaveProperty('data');
    expect(json).toHaveProperty('meta');

    const { data, meta } = json;
    expect(data).toHaveLength(3);

    // Сортування: українською мовою (Івано-Франківська, Київська, Львівська)
    expect(data.map((r) => r.cpu)).toEqual([EMPTY_REGION, FRESH_REGION, STALE_REGION]);

    // Порожня область
    const empty = data.find((r) => r.cpu === EMPTY_REGION)!;
    expect(empty).toEqual({
      cpu: EMPTY_REGION,
      nameUa: 'Івано-Франківська область',
      queues: 1,
      slots: 0,
      lastDate: null,
      freshnessHours: null,
      stale: true,
      sources: [],
      covered: false,
    });

    // Свіжа область
    const fresh = data.find((r) => r.cpu === FRESH_REGION)!;
    expect(fresh).toEqual({
      cpu: FRESH_REGION,
      nameUa: 'Київська область',
      queues: 2,
      slots: 1,
      lastDate: todayYmd,
      freshnessHours: 0,
      stale: false,
      sources: ['mirror'],
      covered: true,
    });

    // Устаріла область
    const stale = data.find((r) => r.cpu === STALE_REGION)!;
    expect(stale.cpu).toBe(STALE_REGION);
    expect(stale.nameUa).toBe('Львівська область');
    expect(stale.queues).toBe(1);
    expect(stale.slots).toBe(1);
    expect(stale.lastDate).toBe('2026-07-01');
    expect(stale.covered).toBe(true);
    expect(stale.stale).toBe(true);
    expect(stale.freshnessHours).toBeGreaterThan(48);
    expect(stale.sources).toEqual(['mirror']);

    // Meta: перевіряємо статистику
    expect(meta.coveredRegions).toBe(2); // FRESH + STALE
    expect(meta.staleRegions).toBe(2);   // STALE + EMPTY
    expect(Date.parse(meta.checkedAt)).toBeGreaterThan(0);
  });
});
