/**
 * /status обязан показывать состояние circuit breaker: lastError (без персональных данных),
 * nextAttemptAt и число неудач подряд. Проверяем на живой схеме (миграция 0009), без сети:
 * оператор в этих тестах не вызывается вообще.
 *
 * Без TEST_DATABASE_URL файл пропускается (skipped) — как остальные интеграционные тесты.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { ensureTestSchema, testDatabaseUrlOrSkip } from '../helpers/test-db.js';

interface StatusBody {
  data: {
    activeOutages: number;
    dataStale: boolean;
    lastError: string | null;
    nextAttemptAt: string | null;
    pausedUntil: string | null;
    consecutiveParseFailures: number;
  };
}

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? '';
const describeWithDb = describe.skipIf(!TEST_DATABASE_URL);

let app: FastifyInstance;
let db: typeof import('../../src/db/connection.js').db;

describeWithDb('/status: circuit breaker источника виден снаружи', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrlOrSkip();
    process.env.ENABLE_SCHEDULER = 'false';
    process.env.USE_MOCK_ADAPTER = 'false';
    process.env.ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? 'test-admin-token';
    process.env.LOG_LEVEL = 'silent';

    const connection = await import('../../src/db/connection.js');
    db = connection.db;
    await ensureTestSchema();

    const { buildServer } = await import('../../src/app.js');
    app = await buildServer();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE grid_status, outages, incidents, parse_runs, sources CASCADE`);
  });

  it('на паузе отдаёт paused_until, причину и счётчик неудач', async () => {
    const { sources } = await import('../../src/db/schema.js');
    const pausedUntil = new Date(Date.now() + 30 * 60_000);
    await db.insert(sources).values({
      name: 'fixture-operator',
      url: 'http://fixture.invalid/disabled',
      type: 'api',
      consecutiveFailures: 3,
      pausedUntil,
      lastError: '[http_429] Operator /api/list_acc returned HTTP 429 (city=<number>, type=1)',
    });

    const response = await app.inject({ method: 'GET', url: '/api/v1/status' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as StatusBody;

    expect(body.data.consecutiveParseFailures).toBe(3);
    expect(body.data.lastError).toContain('[http_429]');
    expect(body.data.pausedUntil).toBe(pausedUntil.toISOString());
    expect(body.data.nextAttemptAt).toBe(pausedUntil.toISOString());
  });

  it('без паузы и с выключенным планировщиком nextAttemptAt = null, ошибок нет', async () => {
    const { sources } = await import('../../src/db/schema.js');
    await db.insert(sources).values({
      name: 'fixture-operator',
      url: 'http://fixture.invalid/disabled',
      type: 'api',
    });

    const response = await app.inject({ method: 'GET', url: '/api/v1/status' });
    const body = response.json() as StatusBody;

    expect(body.data.nextAttemptAt).toBeNull();
    expect(body.data.lastError).toBeNull();
    expect(body.data.consecutiveParseFailures).toBe(0);
    expect(body.data.pausedUntil).toBeNull();
  });

  it('истёкшая пауза не выдаётся за активную, но причина остаётся', async () => {
    const { sources } = await import('../../src/db/schema.js');
    await db.insert(sources).values({
      name: 'fixture-operator',
      url: 'http://fixture.invalid/disabled',
      type: 'api',
      consecutiveFailures: 3,
      pausedUntil: new Date(Date.now() - 60_000),
      lastError: '[timeout] Operator request timed out for /api/list_acc (city=<number>, type=1)',
    });

    const response = await app.inject({ method: 'GET', url: '/api/v1/status' });
    const body = response.json() as StatusBody;

    expect(body.data.pausedUntil).toBeNull();
    expect(body.data.lastError).toBe('[timeout] Operator request timed out for /api/list_acc (city=<number>, type=1)');
    expect(body.data.consecutiveParseFailures).toBe(3);
  });
});
