/**
 * «Цифри мають збігатися» — інтеграційний тест за `outage-data-core/references/migration-plan.md` §1.
 *
 * Фікстура: 30 сирих рядків оператора (по одному на адресу), які описують РІВНО 6 подій:
 * два «вікна» одного дня з однаковою причиною, ремонт, скасоване вікно, відкрита аварія
 * (без дати завершення) і заплановане вікно. «Зараз» заморожене (2026-10-09 12:00 Київ).
 *
 * Кожен ендпоінт мусить показати ті самі 6 подій. Сьогодні `/outages` згортає дублікати
 * (`mergeDuplicateOutages`) і дає 6, а `/outages/stats` рахує сирі рядки й дає 30 —
 * саме тому цей тест ЧЕРВОНИЙ: він і є доказом, що моделі потрібна `outage_events`.
 *
 * Потребує окремої БД (щоб не чіпати робочу); без TEST_DATABASE_URL файл ПРОПУСКАЄТЬСЯ (skipped),
 * щоб `pnpm test` лишався зеленим без БД. «Червоний» прогін — явно, через `test:integration`:
 *   docker compose exec -T db createdb -U energymon energymon_test
 *   TEST_DATABASE_URL=postgresql://energymon:energymon@localhost:5432/energymon_test \   (scan:allow: local dev default, not a secret)
 *     pnpm --filter @energy-monitor/api test:integration
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { AREA, EXPECTED_EVENTS, EXPECTED_ROWS, NOW, SOURCE_ID, fixtureRows } from '../fixtures/outage-events.fixture.js';
import { ensureTestSchema, testDatabaseUrlOrSkip } from '../helpers/test-db.js';

interface OutagesResponse {
  data: unknown[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}
interface StatsResponse {
  data: {
    byDay: Array<{ date: string; count: number }>;
    totalActive: number;
    totalScheduled: number;
  };
}
interface StatusResponse {
  data: { activeOutages: number; scheduledOutages: number };
}
interface IncidentsResponse {
  data: Array<{ kind: string; reason: string | null }>;
}

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? '';

let app: FastifyInstance;
let db: typeof import('../../src/db/connection.js').db;

// Без TEST_DATABASE_URL файл пропускается (skipped) вместо падения: `pnpm test` остаётся зелёным
// без БД, а «красный»/зелёный прогон против реальной схемы делается явно — `pnpm test:integration`.
const describeWithDb = describe.skipIf(!TEST_DATABASE_URL);

describeWithDb('numbers must match: 6 events described by 30 address rows', () => {
  beforeAll(async () => {
    // config.ts читає process.env на імпорті — тому застосунок імпортуємо ПІСЛЯ підстановки URL.
    // testDatabaseUrlOrSkip() так само відмовляється бігти проти БД, чиє ім'я не закінчується на _test.
    process.env.DATABASE_URL = testDatabaseUrlOrSkip();
    process.env.ENABLE_SCHEDULER = 'false';
    process.env.USE_MOCK_ADAPTER = 'false';
    process.env.ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? 'test-admin-token';
    process.env.LOG_LEVEL = 'silent';

    // Заморожуємо «зараз» лише для Date (таймери лишаємо справжніми, інакше I/O «зависне»).
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);

    const connection = await import('../../src/db/connection.js');
    db = connection.db;
    await ensureTestSchema();

    const { buildServer } = await import('../../src/app.js');
    app = await buildServer();
  });

  beforeEach(async () => {
    const { sources: sourcesTable, outages: outagesTable } = await import('../../src/db/schema.js');
    await db.execute(sql`TRUNCATE TABLE grid_status, outages, incidents, parse_runs, sources CASCADE`);
    await db.insert(sourcesTable).values({
      id: SOURCE_ID,
      name: 'test-fixture',
      url: 'http://test-fixture.local/disabled',
      type: 'test',
    });
    await db.insert(outagesTable).values(fixtureRows());
  });

  afterAll(async () => {
    await app?.close();
    vi.useRealTimers();
  });

  it(`stores ${EXPECTED_ROWS} address rows that describe ${EXPECTED_EVENTS} events`, async () => {
    const [row] = (await db.execute(
      sql`SELECT count(*)::int AS rows, count(DISTINCT (area_name, starts_at, ends_at, reason))::int AS events FROM outages`,
    )) as unknown as [{ rows: number; events: number }];
    expect(row).toEqual({ rows: EXPECTED_ROWS, events: EXPECTED_EVENTS });
  });

  it(`lists ${EXPECTED_EVENTS} events in /outages, not ${EXPECTED_ROWS} addresses`, async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/outages?limit=100' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as OutagesResponse;
    expect(body.meta.total).toBe(EXPECTED_EVENTS);
  });

  it(`counts the same ${EXPECTED_EVENTS} events in /outages/stats`, async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/outages/stats' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as StatsResponse;
    const byDayTotal = body.data.byDay.reduce((sum, day) => sum + day.count, 0);
    expect(byDayTotal).toBe(EXPECTED_EVENTS);
  });

  it('reports active and scheduled counts as events in /outages/stats, not rows', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/outages/stats' });
    const body = res.json() as StatsResponse;
    // «Зараз» — 12:00 09.10: тривають ремонт і відкрита аварія; заплановане — одне вікно 10.10.
    expect({ active: body.data.totalActive, scheduled: body.data.totalScheduled }).toEqual({
      active: 2,
      scheduled: 1,
    });
  });

  it('/status agrees with the frozen clock (2 active events, 1 scheduled window)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/status' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as StatusResponse;
    expect(body.data.activeOutages).toBe(2);
    // Скасоване вікно (10-09 15:00–17:00) не є запланованим відключенням.
    expect(body.data.scheduledOutages).toBe(1);
  });

  it('/incidents shows exactly the emergency and repair events', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/incidents' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as IncidentsResponse;
    const outageIncidents = body.data.filter((incident) => incident.kind === 'outage');
    expect(outageIncidents).toHaveLength(2);
  });
});
