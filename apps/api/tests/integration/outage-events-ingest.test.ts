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
import { isNotNull, sql } from 'drizzle-orm';
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
