/**
 * Інтеграційний тест каталогу областей (таблиці `regions`, `region_queues`)
 * та мультирегіональності `schedule_slots` на реальній PostgreSQL.
 *
 * Примітка: сервісні функції API/каталогу (routes, services) розробляються іншими інженерами
 * команди паралельно. Цей тест перевіряє схему, індекси, обмеження цілісності та операції Drizzle безпосередньо.
 *
 * Без TEST_DATABASE_URL файл пропускається (як і решта інтеграційних тестів);
 * база даних обов'язково має закінчуватися на `_test`.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { ensureTestSchema, testDatabaseUrlOrSkip } from '../helpers/test-db.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? '';
const describeWithDb = describe.skipIf(!TEST_DATABASE_URL);

let db: typeof import('../../src/db/connection.js').db;
let regions: typeof import('../../src/db/schema.js').regions;
let regionQueues: typeof import('../../src/db/schema.js').regionQueues;
let scheduleSlots: typeof import('../../src/db/schema.js').scheduleSlots;

describeWithDb('Каталог областей та мультирегіональні слоти ГПВ', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrlOrSkip();
    process.env.LOG_LEVEL = 'silent';
    process.env.ENABLE_SCHEDULER = 'false';
    const connection = await import('../../src/db/connection.js');
    db = connection.db;
    await ensureTestSchema();
    const schema = await import('../../src/db/schema.js');
    regions = schema.regions;
    regionQueues = schema.regionQueues;
    scheduleSlots = schema.scheduleSlots;
  });

  beforeEach(async () => {
    await db.delete(scheduleSlots);
    await db.delete(regionQueues);
    await db.delete(regions);
  });

  it('створює область та черги, перевіряє читання каталогу', async () => {
    await db.insert(regions).values({
      cpu: 'chernihivska-oblast',
      nameUa: 'Чернігівська область',
      nameEn: 'Chernihiv Oblast',
    });

    await db.insert(regionQueues).values([
      { cpu: 'chernihivska-oblast', queue: '1/1', groupKey: '1.1' },
      { cpu: 'chernihivska-oblast', queue: '2/2', groupKey: '2.2' },
    ]);

    const storedRegions = await db.select().from(regions).where(eq(regions.cpu, 'chernihivska-oblast'));
    expect(storedRegions).toHaveLength(1);
    expect(storedRegions[0]).toMatchObject({
      cpu: 'chernihivska-oblast',
      nameUa: 'Чернігівська область',
      nameEn: 'Chernihiv Oblast',
      isActive: true,
    });
    expect(storedRegions[0]!.discoveredAt).toBeInstanceOf(Date);
    expect(storedRegions[0]!.updatedAt).toBeInstanceOf(Date);

    const storedQueues = await db.select().from(regionQueues).where(eq(regionQueues.cpu, 'chernihivska-oblast'));
    expect(storedQueues).toHaveLength(2);
    expect(storedQueues.map((q) => q.queue).sort()).toEqual(['1/1', '2/2']);
    expect(storedQueues.every((q) => q.isActive === true)).toBe(true);
  });

  it('підтримує оновлення статусу області та каскадне видалення черг', async () => {
    await db.insert(regions).values({
      cpu: 'kyiv-city',
      nameUa: 'м. Київ',
      nameEn: 'Kyiv City',
    });

    await db.insert(regionQueues).values({
      cpu: 'kyiv-city',
      queue: '3/1',
      groupKey: '3.1',
    });

    // Оновлення: деактивація області без видалення (збереження історії)
    await db.update(regions).set({ isActive: false, updatedAt: new Date() }).where(eq(regions.cpu, 'kyiv-city'));
    const updated = await db.select().from(regions).where(eq(regions.cpu, 'kyiv-city'));
    expect(updated[0]!.isActive).toBe(false);

    // Каскадне видалення: при видаленні області її черги видаляються автоматично (ON DELETE CASCADE)
    await db.delete(regions).where(eq(regions.cpu, 'kyiv-city'));
    const queuesAfterDelete = await db.select().from(regionQueues).where(eq(regionQueues.cpu, 'kyiv-city'));
    expect(queuesAfterDelete).toHaveLength(0);
  });

  it('дозволяє двом різним областям мати однакову чергу, дату й час', async () => {
    await db.insert(scheduleSlots).values([
      {
        region: 'chernihivska-oblast',
        queue: '2/2',
        date: '2026-10-11',
        timeFrom: '08:00',
        timeTo: '10:00',
        stateCode: 3,
        stateName: 'Відключення',
        stateColor: '#E33535',
        source: 'mirror',
      },
      {
        region: 'kyiv-city',
        queue: '2/2',
        date: '2026-10-11',
        timeFrom: '08:00',
        timeTo: '10:00',
        stateCode: 3,
        stateName: 'Відключення',
        stateColor: '#E33535',
        source: 'mirror',
      },
    ]);

    const slots = await db
      .select()
      .from(scheduleSlots)
      .where(and(eq(scheduleSlots.queue, '2/2'), eq(scheduleSlots.date, '2026-10-11')));

    expect(slots).toHaveLength(2);
    expect(slots.map((s) => s.region).sort()).toEqual(['chernihivska-oblast', 'kyiv-city']);
  });

  it('відхиляє дублікат слота для тієї самої області', async () => {
    await db.insert(scheduleSlots).values({
      region: 'chernihivska-oblast',
      queue: '2/2',
      date: '2026-10-11',
      timeFrom: '08:00',
      timeTo: '10:00',
      stateCode: 3,
      stateName: 'Відключення',
      stateColor: '#E33535',
      source: 'mirror',
    });

    await expect(
      db.insert(scheduleSlots).values({
        region: 'chernihivska-oblast',
        queue: '2/2',
        date: '2026-10-11',
        timeFrom: '08:00',
        timeTo: '10:00',
        stateCode: 3,
        stateName: 'Відключення',
        stateColor: '#E33535',
        source: 'mirror',
      }),
    ).rejects.toThrow();
  });

  it('вставка легасі-рядка без region за замовчуванням записує chernihivska-oblast', async () => {
    const [inserted] = await db
      .insert(scheduleSlots)
      .values({
        queue: '1/1',
        date: '2026-10-11',
        timeFrom: '14:00',
        timeTo: '16:00',
        stateCode: 3,
        stateName: 'Відключення',
        stateColor: '#E33535',
        source: 'telegram',
      })
      .returning();

    expect(inserted).toBeDefined();
    expect(inserted!.region).toBe('chernihivska-oblast');

    const read = await db.select().from(scheduleSlots).where(eq(scheduleSlots.id, inserted!.id));
    expect(read[0]!.region).toBe('chernihivska-oblast');
  });
});
