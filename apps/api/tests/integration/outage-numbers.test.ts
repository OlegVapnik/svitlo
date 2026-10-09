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
 * Потребує окремої БД (щоб не чіпати робочу):
 *   docker compose exec -T db createdb -U energymon energymon_test
 *   TEST_DATABASE_URL=postgresql://energymon:energymon@localhost:5432/energymon_test \
 *     pnpm --filter @energy-monitor/api exec vitest run tests/integration/outage-numbers.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

/** Заморожене «зараз»: 2026-10-09 12:00 за Києвом (EEST, UTC+3). */
const NOW = new Date('2026-10-09T09:00:00Z');

/** 6 подій × 5 адресних рядків = 30 сирих рядків. */
const ADDRESSES_PER_EVENT = 5;

const SOURCE_ID = '00000000-0000-4000-8000-000000000001';
const AREA = 'с. Деснянське';

interface FixtureEvent {
  label: string;
  startsAt: string;
  endsAt: string;
  reason: string;
  status: 'scheduled' | 'active' | 'finished' | 'cancelled';
  street: string;
}

const FIXTURE: FixtureEvent[] = [
  {
    label: 'regime-window-1',
    startsAt: '2026-10-08T08:00:00+03:00',
    endsAt: '2026-10-08T10:00:00+03:00',
    reason: 'Заходи обмеження',
    status: 'finished',
    street: 'вул. Шевченка',
  },
  {
    label: 'regime-window-2',
    startsAt: '2026-10-08T16:00:00+03:00',
    endsAt: '2026-10-08T18:00:00+03:00',
    reason: 'Заходи обмеження',
    status: 'finished',
    street: 'вул. Польова',
  },
  {
    label: 'repair-active',
    startsAt: '2026-10-09T10:00:00+03:00',
    endsAt: '2026-10-09T13:00:00+03:00',
    reason: 'Виконання ремонтних робіт',
    status: 'active',
    street: 'вул. Садова',
  },
  {
    label: 'cancelled-window',
    startsAt: '2026-10-09T15:00:00+03:00',
    endsAt: '2026-10-09T17:00:00+03:00',
    reason: 'Заходи обмеження',
    status: 'cancelled',
    street: 'вул. Лугова',
  },
  {
    label: 'emergency-open-ended',
    startsAt: '2026-10-09T07:00:00+03:00',
    endsAt: '2026-10-20T00:00:00+03:00',
    reason: 'Пошкодження мережі',
    status: 'active',
    street: 'вул. Київська',
  },
  {
    label: 'scheduled-window',
    startsAt: '2026-10-10T08:00:00+03:00',
    endsAt: '2026-10-10T10:00:00+03:00',
    reason: 'Заходи обмеження',
    status: 'scheduled',
    street: 'вул. Миру',
  },
];
const EXPECTED_EVENTS = FIXTURE.length; // 6
const EXPECTED_ROWS = FIXTURE.length * ADDRESSES_PER_EVENT; // 30

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

/** Сирі рядки оператора: кожна подія розкидана на 30/6 = 5 адрес. */
function fixtureRows() {
  return FIXTURE.flatMap((event) =>
    Array.from({ length: ADDRESSES_PER_EVENT }, (_, index) => {
      const house = index + 1;
      const address = `${AREA}, ${event.street}, буд. ${house}`;
      return {
        sourceId: SOURCE_ID,
        startsAt: new Date(event.startsAt),
        endsAt: new Date(event.endsAt),
        areaName: AREA,
        addressesRaw: address,
        addressesNormalized: address.toLowerCase(),
        reason: event.reason,
        status: event.status,
        source: 'test-fixture',
        externalId: `fixture-${event.label}-${house}`,
        contentHash: `fixture-${event.label}-${house}`,
      };
    }),
  );
}

/** Схема створюється тими самими SQL-міграціями, що й у проді (як у db/migrate.ts). */
async function ensureSchema(): Promise<void> {
  const [existing] = (await db.execute(
    sql`SELECT to_regclass('public.outages') AS name`,
  )) as unknown as [{ name: string | null }?];
  if (existing?.name) return;

  const migrationUrl = new URL('../../src/db/migrations/', import.meta.url);
  const files = (await readdir(migrationUrl)).filter((file) => file.endsWith('.sql')).sort();
  for (const file of files) {
    await db.execute(sql.raw(await readFile(new URL(file, migrationUrl), 'utf8')));
  }
}
describe('numbers must match: 6 events described by 30 address rows', () => {
  beforeAll(async () => {
    expect(
      TEST_DATABASE_URL,
      'TEST_DATABASE_URL is required: create a throwaway DB with `docker compose exec -T db createdb -U energymon energymon_test` and pass postgresql://energymon:energymon@localhost:5432/energymon_test',
    ).not.toBe('');

    const databaseName = new URL(TEST_DATABASE_URL).pathname.replace(/^\//, '');
    if (!/_test$/.test(databaseName)) {
      throw new Error(
        `refusing to run: TEST_DATABASE_URL must point at a throwaway *_test database (got "${databaseName}")`,
      );
    }

    // config.ts читає process.env на імпорті — тому застосунок імпортуємо ПІСЛЯ підстановки URL.
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.ENABLE_SCHEDULER = 'false';
    process.env.USE_MOCK_ADAPTER = 'false';
    process.env.ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? 'test-admin-token';
    process.env.LOG_LEVEL = 'silent';

    // Заморожуємо «зараз» лише для Date (таймери лишаємо справжніми, інакше I/O «зависне»).
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);

    const connection = await import('../../src/db/connection.js');
    db = connection.db;
    await ensureSchema();

    const { buildServer } = await import('../../src/app.js');
    app = await buildServer();
  });

  beforeEach(async () => {
    const { sources: sourcesTable, outages: outagesTable } = await import('../../src/db/schema.js');
    await db.execute(sql`TRUNCATE TABLE outages, incidents, parse_runs, sources CASCADE`);
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
