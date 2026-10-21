/**
 * Backfill канонічної моделі (крок 3 плану): 30 сирих рядків оператора → 6 подій + 30 адрес.
 *
 * Той самий фікстур, що й у outage-numbers.test.ts, — щоб «6» означало те саме в обох файлах.
 * Ідемпотентність перевіряється повторним запуском backfill: ті самі 6 подій, ті самі 30 адрес,
 * ті самі id (жодних дублікатів).
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { EXPECTED_EVENTS, EXPECTED_ROWS, SOURCE_ID, fixtureRows } from '../fixtures/outage-events.fixture.js';
import { ensureTestSchema, testDatabaseUrlOrSkip } from '../helpers/test-db.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? '';

let db: typeof import('../../src/db/connection.js').db;
let backfillOutageEvents: typeof import('../../src/db/backfill-outage-events.js').backfillOutageEvents;

const describeWithDb = describe.skipIf(!TEST_DATABASE_URL);

/** id подій у стабільному порядку — щоб порівнювати «до/після» другого запуску. */
async function eventIds(): Promise<string[]> {
  const rows = (await db.execute(
    sql`SELECT id::text AS id FROM outage_events ORDER BY event_key`,
  )) as unknown as Array<{ id: string }>;
  return rows.map((row) => row.id);
}

describeWithDb('backfill outage_events', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrlOrSkip();
    process.env.LOG_LEVEL = 'silent';
    const connection = await import('../../src/db/connection.js');
    db = connection.db;
    await ensureTestSchema();
    backfillOutageEvents = (await import('../../src/db/backfill-outage-events.js')).backfillOutageEvents;
  });

  beforeEach(async () => {
    const { sources: sourcesTable, outages: outagesTable } = await import('../../src/db/schema.js');
    await db.execute(
      sql`TRUNCATE TABLE outage_event_addresses, outage_events, outages, incidents, parse_runs, grid_status, sources CASCADE`,
    );
    await db.insert(sourcesTable).values({
      id: SOURCE_ID,
      name: 'test-fixture',
      url: 'http://test-fixture.local/disabled',
      type: 'test',
    });
    await db.insert(outagesTable).values(fixtureRows());
  });

  it(`turns ${EXPECTED_ROWS} address rows into ${EXPECTED_EVENTS} events and ${EXPECTED_ROWS} addresses`, async () => {
    const summary = await backfillOutageEvents();
    expect(summary.rowsRead).toBe(EXPECTED_ROWS);
    expect(summary.events).toBe(EXPECTED_EVENTS);
    expect(summary.addresses).toBe(EXPECTED_ROWS);
  });

  it('classifies every event: 4 regime windows, 1 emergency damage, 1 repair, none unclassified', async () => {
    const summary = await backfillOutageEvents();
    expect(summary.byCategory).toEqual({ emergency: 1, regime: 4, repair: 1 });
    expect(summary.otherSamples).toEqual([]);
  });

  it('keeps the cancelled window cancelled (computed from cancelled_at, not from a status string)', async () => {
    await backfillOutageEvents();
    const [row] = (await db.execute(
      sql`SELECT count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled FROM outage_events_v`,
    )) as unknown as [{ cancelled: number }];
    expect(row?.cancelled).toBe(1);
  });

  it(`keeps each of the ${EXPECTED_EVENTS} events with all ${EXPECTED_ROWS / EXPECTED_EVENTS} of its addresses`, async () => {
    await backfillOutageEvents();
    const rows = (await db.execute(sql`
      SELECT e.event_key, count(a.address_normalized)::int AS addresses
      FROM outage_events e
      JOIN outage_event_addresses a ON a.event_id = e.id
      GROUP BY e.id, e.event_key
    `)) as unknown as Array<{ event_key: string; addresses: number }>;
    expect(rows).toHaveLength(EXPECTED_EVENTS);
    for (const row of rows) expect(row.addresses).toBe(EXPECTED_ROWS / EXPECTED_EVENTS);
  });

  it(`is idempotent: the second run keeps the same ${EXPECTED_EVENTS} events and ${EXPECTED_ROWS} addresses`, async () => {
    const first = await backfillOutageEvents();
    const idsBefore = await eventIds();

    const second = await backfillOutageEvents();

    expect(second.events).toBe(first.events);
    expect(second.addresses).toBe(first.addresses);
    expect(second.events).toBe(EXPECTED_EVENTS);
    expect(second.addresses).toBe(EXPECTED_ROWS);
    expect(await eventIds()).toEqual(idsBefore);
  });

  it('does not add an address row when the operator delivers the same address twice', async () => {
    const { outages: outagesTable } = await import('../../src/db/schema.js');
    const [firstRow] = fixtureRows();
    await db.insert(outagesTable).values({
      ...firstRow!,
      externalId: 'duplicate-of-first-row',
      contentHash: 'duplicate-of-first-row',
    });

    const summary = await backfillOutageEvents();

    expect(summary.events).toBe(EXPECTED_EVENTS);
    expect(summary.addresses).toBe(EXPECTED_ROWS);
  });
});
