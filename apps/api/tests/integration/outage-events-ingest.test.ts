/**
 * Dual-write (крок 4 плану міграції): один прогін ingest пише і старі адресні рядки `outages`,
 * і канонічні `outage_events` разом з `outage_event_addresses` — в одній транзакції.
 *
 * Доводимо дві речі:
 *  1) цифри збігаються: старий шлях згортання і нова таблиця бачать ті самі 6 подій на 30 рядках
 *     тієї самої фікстури, що й outage-numbers.test.ts / backfill-тест;
 *  2) скасування: подія, якої більше немає у стрічці оператора (і яка ще не почалася), отримує
 *     `cancelled_at`; порожня стрічка не скасовує нічого (інакше один мережевий збій убив би графік).
 *
 * Без TEST_DATABASE_URL файл пропускається (skipped) — як і решта інтеграційних тестів.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, isNotNull, sql } from 'drizzle-orm';
import { EXPECTED_EVENTS, EXPECTED_ROWS, NOW, SOURCE_ID, fixtureRows } from '../fixtures/outage-events.fixture.js';
import { ensureTestSchema, testDatabaseUrlOrSkip } from '../helpers/test-db.js';
import type { NormalizedOutage } from '../../src/parsers/adapter.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? '';
const describeWithDb = describe.skipIf(!TEST_DATABASE_URL);

let db: typeof import('../../src/db/connection.js').db;
let outageEvents: typeof import('../../src/db/schema.js').outageEvents;
let ingestOutages: typeof import('../../src/services/parse.service.js').ingestOutages;

/** Стрічка оператора: рядок на адресу — так само, як її віддає адаптер. */
function feed(): NormalizedOutage[] {
  return fixtureRows().map((row) => ({
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    areaName: row.areaName,
    addressesRaw: row.addressesRaw,
    reason: row.reason,
    queue: null,
    externalId: row.externalId,
  }));
}

/** Та сама стрічка, але без однієї події: оператор перепублікував графік без цього вікна. */
function feedWithout(label: string): NormalizedOutage[] {
  return feed().filter((row) => !row.externalId?.startsWith(`fixture-${label}-`));
}

/** id подій у стабільному порядку — щоб порівнювати «до/після» другого прогону. */
async function eventIds(): Promise<string[]> {
  const rows = (await db.execute(
    sql`SELECT id::text AS id FROM outage_events ORDER BY event_key`,
  )) as unknown as Array<{ id: string }>;
  return rows.map((row) => row.id);
}

describeWithDb('outage ingest dual-write', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrlOrSkip();
    process.env.ENABLE_SCHEDULER = 'false';
    process.env.USE_MOCK_ADAPTER = 'false';
    process.env.LOG_LEVEL = 'silent';
    const connection = await import('../../src/db/connection.js');
    db = connection.db;
    await ensureTestSchema();
    outageEvents = (await import('../../src/db/schema.js')).outageEvents;
    ingestOutages = (await import('../../src/services/parse.service.js')).ingestOutages;
  });

  beforeEach(async () => {
    const { sources: sourcesTable } = await import('../../src/db/schema.js');
    await db.execute(
      sql`TRUNCATE TABLE outage_event_addresses, outage_events, outages, incidents, parse_runs, grid_status, sources CASCADE`,
    );
    await db.insert(sourcesTable).values({
      id: SOURCE_ID,
      name: 'test-fixture',
      url: 'http://test-fixture.local/disabled',
      type: 'test',
    });
  });

  it('does not mark the source successful for zero outage rows', async () => {
    const { sources } = await import('../../src/db/schema.js');
    await db.update(sources).set({ lastSuccessAt: null }).where(eq(sources.id, SOURCE_ID));
    await ingestOutages(SOURCE_ID, 'test-fixture', [], { now: NOW });
    const [source] = await db.select({ lastSuccessAt: sources.lastSuccessAt }).from(sources).where(eq(sources.id, SOURCE_ID));
    expect(source?.lastSuccessAt).toBeNull();
  });

  it('marks the source successful only on a complete feed with records (ingest is the gate)', async () => {
    const { sources } = await import('../../src/db/schema.js');
    const readSuccess = async () => {
      const [source] = await db
        .select({ lastSuccessAt: sources.lastSuccessAt })
        .from(sources)
        .where(eq(sources.id, SOURCE_ID));
      return source?.lastSuccessAt ?? null;
    };

    // 1) Полный фид с данными — единственный случай, когда last_success_at двигается.
    await db.update(sources).set({ lastSuccessAt: null }).where(eq(sources.id, SOURCE_ID));
    await ingestOutages(SOURCE_ID, 'test-fixture', feed(), { now: NOW });
    expect(await readSuccess()).toEqual(NOW);

    // 2) Частичный ответ оператора (complete=false): runParse в этом случае не вызывает ingest вообще,
    //    поэтому метка успеха обязана остаться прежней, а не «догонять» частичную ленту.
    await ingestOutages(SOURCE_ID, 'test-fixture', feed().slice(0, 1), { now: new Date(NOW.getTime() + 60_000), complete: false });
    expect(await readSuccess()).toEqual(NOW);

    // 3) Пустая (но полная) лента — тоже не успех: записей нет — метку не трогаем.
    await ingestOutages(SOURCE_ID, 'test-fixture', [], { now: new Date(NOW.getTime() + 120_000) });
    expect(await readSuccess()).toEqual(NOW);
  });

  it(`keeps the numbers equal: ${EXPECTED_ROWS} address rows and ${EXPECTED_EVENTS} events in both paths`, async () => {
    const result = await ingestOutages(SOURCE_ID, 'test-fixture', feed(), { now: NOW });

    expect(result.rowsInFeed).toBe(EXPECTED_ROWS);
    expect(result.eventsOldPath).toBe(EXPECTED_EVENTS);
    expect(result.eventsNewPath).toBe(EXPECTED_EVENTS);
    expect(result.eventsInTable).toBe(EXPECTED_EVENTS);
    expect(result.addressesInTable).toBe(EXPECTED_ROWS);
    expect(result.unclassifiedReasons).toEqual([]);
    expect(result.cancelledMarked).toBe(0);
  });

  it('still writes the old address-level rows, so no reader has to change yet', async () => {
    await ingestOutages(SOURCE_ID, 'test-fixture', feed(), { now: NOW });

    const [row] = (await db.execute(
      sql`SELECT count(*)::int AS rows, count(DISTINCT (area_name, starts_at, ends_at, reason))::int AS events FROM outages`,
    )) as unknown as [{ rows: number; events: number }];

    expect(row).toEqual({ rows: EXPECTED_ROWS, events: EXPECTED_EVENTS });
  });

  it('classifies every event with the shared classifier (4 regime, 1 emergency, 1 repair)', async () => {
    await ingestOutages(SOURCE_ID, 'test-fixture', feed(), { now: NOW });

    const rows = (await db.execute(sql`
      SELECT category, count(*)::int AS count FROM outage_events GROUP BY category ORDER BY category
    `)) as unknown as Array<{ category: string; count: number }>;

    expect(rows).toEqual([
      { category: 'emergency', count: 1 },
      { category: 'regime', count: 4 },
      { category: 'repair', count: 1 },
    ]);
  });

  it(`is idempotent: the second run keeps ${EXPECTED_EVENTS} events, ${EXPECTED_ROWS} addresses and the same ids`, async () => {
    const first = await ingestOutages(SOURCE_ID, 'test-fixture', feed(), { now: NOW });
    const idsBefore = await eventIds();

    const second = await ingestOutages(SOURCE_ID, 'test-fixture', feed(), { now: NOW });

    expect(second.eventsInTable).toBe(first.eventsInTable);
    expect(second.addressesInTable).toBe(EXPECTED_ROWS);
    expect(await eventIds()).toEqual(idsBefore);
  });

  it('marks a window the operator dropped from the feed as cancelled at the observed time', async () => {
    await ingestOutages(SOURCE_ID, 'test-fixture', feed(), { now: NOW });

    const result = await ingestOutages(SOURCE_ID, 'test-fixture', feedWithout('cancelled-window'), { now: NOW });

    expect(result.cancelledMarked).toBe(1);

    // Порівнюємо час у JS, а не в SQL: сирий sql-шаблон із Date-параметром валить драйвер
    // (див. коментар у outage-events-writer.ts), а ORM-вибірка повертає справжні Date.
    const cancelledRows = await db
      .select({
        eventKey: outageEvents.eventKey,
        startsAt: outageEvents.startsAt,
        cancelledAt: outageEvents.cancelledAt,
      })
      .from(outageEvents)
      .where(isNotNull(outageEvents.cancelledAt));

    expect(cancelledRows).toHaveLength(1);
    const cancelledEvent = cancelledRows[0]!;
    // Скасовано саме те вікно 09.10 15:00 (12:00Z), яке ще не почалося, і саме в момент спостереження.
    expect(cancelledEvent.eventKey).toContain('2026-10-09T12:00:00.000Z');
    expect(cancelledEvent.startsAt.getTime()).toBeGreaterThan(NOW.getTime());
    expect(cancelledEvent.cancelledAt?.getTime()).toBe(NOW.getTime());
  });

  it('cancels nothing when a configured operator type fails to load, but still cancels on a complete feed', async () => {
    const { ChernihivWebAdapter } = await import('../../src/parsers/chernihiv-web.adapter.js');

    const cancelledCount = async () => {
      const [row] = (await db.execute(
        sql`SELECT count(*)::int AS cancelled FROM outage_events WHERE cancelled_at IS NOT NULL`,
      )) as unknown as [{ cancelled: number }];
      return row?.cancelled ?? 0;
    };

    // Стрічка, яку віддає оператор за найгіршого сценарію: тип, чий запит впав, повертає ПОРОЖНІЙ список,
    // інші типи не мають записів. Тобто якщо вірити цій ленті, всі попередні події зникли —
    // але це дірка в даних, а не скасування.
    const brokenFetch = (failedType: number): typeof fetch => async (input, init) => {
      const requestUrl = new URL(String(input));
      const body = JSON.parse(String(init?.body ?? '{}')) as { req_param?: string };
      const query = JSON.parse(decodeURIComponent(body.req_param ?? '{}')) as { t?: number };
      if (requestUrl.pathname === '/api/list_acc' && query.t === failedType) {
        return new Response('unavailable', { status: 503 });
      }
      return Response.json({ status: '200', list: [] });
    };

    for (const failedType of [1, 2, 6]) {
      await ingestOutages(SOURCE_ID, 'test-fixture', feed(), { now: NOW, db });
      // Метка ингеста: фид с дыркой — отмен не должно быть вообще.
      const ingestResult = await ingestOutages(SOURCE_ID, 'test-fixture', [], { now: NOW, complete: false, db });
      expect(ingestResult.cancelledMarked, `failed configured type ${failedType}`).toBe(0);
      expect(await cancelledCount(), `failed configured type ${failedType}`).toBe(0);

      // Адаптер в той же ситуации отвечает complete=false: он сам себя признаёт неполным.
      const adapter = new ChernihivWebAdapter(brokenFetch(failedType), {
        baseUrl: 'https://operator.invalid',
        cityIds: ['test-city'],
        types: [1, 2, 6],
        retries: 0,
        // 503 у боевом адаптере — ретраящий статус; здесь fataл=true, чтобы тест не ждал паузы.
        requestDelayMs: 0,
        sessionWarmup: false,
        retryAfterMaxMs: 0,
      });
      const result = await adapter.fetch();
      expect(result.complete, `failed configured type ${failedType}`).toBe(false);
      expect(result.completeScopeKeys ?? [], `failed configured type ${failedType}`).not.toContain(`test-city:${failedType}`);
    }

    // Контроль в другую сторону: на ПОЛНОЙ ленте без будущего окна то же окно отменяется.
    // Без этого «ничего не отменяем» можно было бы выполнить, просто никогда ничего не отменяя.
    const onlyPresent = feed().filter((row) => !row.externalId?.startsWith('fixture-scheduled-window-'));
    const completeRun = await ingestOutages(SOURCE_ID, 'test-fixture', onlyPresent, { now: NOW, db });
    expect(completeRun.cancelledMarked).toBe(1);
    expect(await cancelledCount()).toBe(1);
  });

  it('cancels nothing for windows that already started and nothing on an empty feed', async () => {
    await ingestOutages(SOURCE_ID, 'test-fixture', feed(), { now: NOW });

    // Без минулих вікон 08.10-ранку: вони вже почалися, тому скасуванню не підлягають.
    const onlyFuture = feed().filter((row) => row.startsAt > NOW);
    const futureRun = await ingestOutages(SOURCE_ID, 'test-fixture', onlyFuture, { now: NOW });
    expect(futureRun.cancelledMarked).toBe(0);

    // Порожня (або обірвана) стрічка — це НЕ «оператор скасував усе».
    const emptyRun = await ingestOutages(SOURCE_ID, 'test-fixture', [], { now: NOW });
    expect(emptyRun.rowsInFeed).toBe(0);
    expect(emptyRun.cancelledMarked).toBe(0);

    const [row] = (await db.execute(
      sql`SELECT count(*)::int AS cancelled FROM outage_events WHERE cancelled_at IS NOT NULL`,
    )) as unknown as [{ cancelled: number }];
    expect(row?.cancelled).toBe(0);
  });
});
