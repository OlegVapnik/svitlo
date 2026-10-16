/**
 * Інтеграційні тести мультирегіональності адресного довідника (`street_queues` та маршрутів `/api/v1/street-queues`,
 * `/api/v1/street-queues/schedule`, `/api/v1/queues`) на реальній тестовій базі PostgreSQL.
 *
 * Перевіряють ключові вимоги місії:
 * 1. Вулиці області A ніколи не повертаються для області B.
 * 2. Рядки без явного вказання region отримують дефолт ('chernihivska-oblast').
 * 3. Запит без ?region= поводиться точно як раніше (регресійний захист для старих клієнтів).
 * 4. Некоректний ?region= повертає 400 VALIDATION_ERROR.
 * 5. Невідомий, але валідний cpu повертає 200 з порожнім списком (без вигаданих даних).
 * 6. Підрахунок прив'язаних вулиць у /api/v1/queues повертає дані лише для області-власника.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { ensureTestSchema, testDatabaseUrlOrSkip } from '../helpers/test-db.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? '';
const describeWithDb = describe.skipIf(!TEST_DATABASE_URL);

const CHERNIHIV = 'chernihivska-oblast';
const LVIV = 'lvivska-oblast';
const POLTAVA = 'poltavska-oblast';

let app: FastifyInstance;
let db: typeof import('../../src/db/connection.js').db;
let streetQueues: typeof import('../../src/db/schema.js').streetQueues;
let scheduleSlots: typeof import('../../src/db/schema.js').scheduleSlots;

describeWithDb('Мультирегіональний адресний довідник (street_queues)', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrlOrSkip();
    process.env.LOG_LEVEL = 'silent';
    process.env.ENABLE_SCHEDULER = 'false';
    process.env.MIRROR_SCHEDULE_ENABLED = 'false';

    const connection = await import('../../src/db/connection.js');
    db = connection.db;
    const schema = await import('../../src/db/schema.js');
    streetQueues = schema.streetQueues;
    scheduleSlots = schema.scheduleSlots;

    await ensureTestSchema();
    const { buildServer } = await import('../../src/app.js');
    app = await buildServer();
  });

  afterAll(async () => {
    if (db) {
      await db.delete(streetQueues);
      await db.delete(scheduleSlots);
    }
    await app?.close();
  });

  beforeEach(async () => {
    await db.delete(streetQueues);
    await db.delete(scheduleSlots);
  });

  it('вулиці області A ніколи не повертаються для області B, навіть з однаковою назвою', async () => {
    // ЧОМУ: у різних областях є однакові назви вулиць (наприклад, Шевченка). Запит по Львівській області
    // має повертати лише львівські вулиці й черги і в жодному разі не змішувати їх із чернігівськими.
    await db.insert(streetQueues).values([
      { region: CHERNIHIV, streetNormalized: 'шевченка', streetName: 'вул. Шевченка', queue: '1/1' },
      { region: LVIV, streetNormalized: 'шевченка', streetName: 'вул. Шевченка', queue: '2/2' },
      { region: LVIV, streetNormalized: 'городоцька', streetName: 'вул. Городоцька', queue: '2/2' },
    ]);

    const lvivRes = await app.inject({ method: 'GET', url: `/api/v1/street-queues?region=${LVIV}` });
    expect(lvivRes.statusCode).toBe(200);
    const lvivData = (lvivRes.json() as { data: Array<{ streetName: string; queue: string; region: string }> }).data;

    expect(lvivData).toHaveLength(2);
    expect(lvivData.map((s) => s.streetName)).toEqual(['вул. Городоцька', 'вул. Шевченка']);
    expect(lvivData.find((s) => s.streetName === 'вул. Шевченка')?.queue).toBe('2/2');
    expect(lvivData.every((s) => s.region === LVIV)).toBe(true);

    const chernihivRes = await app.inject({ method: 'GET', url: `/api/v1/street-queues?region=${CHERNIHIV}` });
    expect(chernihivRes.statusCode).toBe(200);
    const chernihivData = (chernihivRes.json() as { data: Array<{ streetName: string; queue: string; region: string }> }).data;

    expect(chernihivData).toHaveLength(1);
    expect(chernihivData[0]).toMatchObject({ streetName: 'вул. Шевченка', queue: '1/1', region: CHERNIHIV });
  });

  it('рядки без явного region у SQL автоматично отримують дефолтну область chernihivska-oblast', async () => {
    // ЧОМУ: легасі-імпортери та старі скрипти вставки без колонки region мають автоматично записуватися
    // у дефолтну Чернігівську область завдяки DEFAULT 'chernihivska-oblast' у схемі БД.
    await db.execute(
      sql`INSERT INTO street_queues (street_normalized, street_name, queue) VALUES ('нова', 'вул. Нова', '3/1')`,
    );

    const chernihivRes = await app.inject({ method: 'GET', url: `/api/v1/street-queues?region=${CHERNIHIV}` });
    const chernihivData = (chernihivRes.json() as { data: Array<{ streetName: string; region: string }> }).data;
    expect(chernihivData).toHaveLength(1);
    expect(chernihivData[0]).toMatchObject({ streetName: 'вул. Нова', region: CHERNIHIV });

    const lvivRes = await app.inject({ method: 'GET', url: `/api/v1/street-queues?region=${LVIV}` });
    const lvivData = (lvivRes.json() as { data: Array<{ streetName: string }> }).data;
    expect(lvivData).toHaveLength(0);
  });

  it('відсутність ?region= поводиться точно як раніше (регресійний захист для старих клієнтів)', async () => {
    // ЧОМУ: старий фронтенд та існуючі клієнти не передають ?region= до /api/v1/street-queues;
    // поведінка за замовчуванням має зберігати сумісність і повертати легасі-довідник Чернігівщини.
    await db.insert(streetQueues).values([
      { region: CHERNIHIV, streetNormalized: 'миру', streetName: 'вул. Миру', queue: '1/2' },
      { region: LVIV, streetNormalized: 'городоцька', streetName: 'вул. Городоцька', queue: '2/2' },
    ]);

    const res = await app.inject({ method: 'GET', url: '/api/v1/street-queues' });
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: Array<{ streetName: string; queue: string }> }).data;

    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({ streetName: 'вул. Миру', queue: '1/2' });
  });

  it('некоректний (malformed) ?region= повертає 400 VALIDATION_ERROR на всіх роутах довідника', async () => {
    // ЧОМУ: підозріле сміття у параметрі ?region= не повинно потрапляти в SQL або логи як валідне значення;
    // API зобов'язане суворо відхиляти такий запит з HTTP 400 VALIDATION_ERROR.
    const resList = await app.inject({ method: 'GET', url: '/api/v1/street-queues?region=Bad_Region!' });
    expect(resList.statusCode).toBe(400);
    expect((resList.json() as { error: { code: string } }).error.code).toBe('VALIDATION_ERROR');

    const resSchedule = await app.inject({ method: 'GET', url: '/api/v1/street-queues/schedule?street=Миру&region=UPPERCASE' });
    expect(resSchedule.statusCode).toBe(400);
    expect((resSchedule.json() as { error: { code: string } }).error.code).toBe('VALIDATION_ERROR');

    const resQueues = await app.inject({ method: 'GET', url: '/api/v1/queues?region=drop-table--1' });
    expect(resQueues.statusCode).toBe(400);
    expect((resQueues.json() as { error: { code: string } }).error.code).toBe('VALIDATION_ERROR');
  });

  it('невідомий, але валідний за форматом cpu повертає 200 з порожнім списком (контракт)', async () => {
    // ЧОМУ: згідно з контрактом /tmp/API-CONTRACT-regions.md, відсутність даних для валідної області
    // не є помилкою 400: API повертає чесний порожній результат (200 OK з data: []).
    const resList = await app.inject({ method: 'GET', url: `/api/v1/street-queues?region=${POLTAVA}` });
    expect(resList.statusCode).toBe(200);
    expect(resList.json()).toEqual({ data: [] });

    const resSchedule = await app.inject({ method: 'GET', url: `/api/v1/street-queues/schedule?street=Невідома&region=${POLTAVA}` });
    expect(resSchedule.statusCode).toBe(200);
    expect(resSchedule.json()).toMatchObject({
      data: { queue: null, intervals: [], source: null },
    });
  });

  it('пошук графіка вулиці (/street-queues/schedule) ізолює області та прив\'язані черги', async () => {
    // ЧОМУ: коли одна й та сама назва вулиці прив'язана до черги 1/1 у Чернігові та до черги 2/2 у Львові,
    // запит графіка за вулицею повинен визначати чергу відповідної області, а не підставляти чужу.
    await db.insert(streetQueues).values([
      { region: CHERNIHIV, streetNormalized: 'шевченка', streetName: 'вул. Шевченка', queue: '1/1' },
      { region: LVIV, streetNormalized: 'шевченка', streetName: 'вул. Шевченка', queue: '2/2' },
    ]);

    const lvivSched = await app.inject({
      method: 'GET',
      url: `/api/v1/street-queues/schedule?street=${encodeURIComponent('вул. Шевченка')}&region=${LVIV}&date=2026-10-11`,
    });
    expect(lvivSched.statusCode).toBe(200);
    expect((lvivSched.json() as { data: { queue: string } }).data.queue).toBe('2/2');

    const chernihivSched = await app.inject({
      method: 'GET',
      url: `/api/v1/street-queues/schedule?street=${encodeURIComponent('вул. Шевченка')}&region=${CHERNIHIV}&date=2026-10-11`,
    });
    expect(chernihivSched.statusCode).toBe(200);
    expect((chernihivSched.json() as { data: { queue: string } }).data.queue).toBe('1/1');
  });

  it('GET /api/v1/queues повертає кількість вулиць лише для тієї області, якій вони належать', async () => {
    // ЧОМУ: список черг listQueues раніше мав хардкод LEGACY_REGION. Тепер черги Львівської області
    // мають відображати кількість львівських вулиць, а черги Чернігівської — чернігівських.
    await db.insert(scheduleSlots).values([
      {
        region: LVIV,
        queue: '2/2',
        date: '2026-10-11',
        timeFrom: '08:00',
        timeTo: '09:00',
        stateCode: 3,
        stateName: 'Відключення',
        stateColor: '#E33535',
        source: 'mirror',
      },
      {
        region: CHERNIHIV,
        queue: '1/1',
        date: '2026-10-11',
        timeFrom: '08:00',
        timeTo: '09:00',
        stateCode: 3,
        stateName: 'Відключення',
        stateColor: '#E33535',
        source: 'mirror',
      },
    ]);

    await db.insert(streetQueues).values([
      { region: LVIV, streetNormalized: 'городоцька', streetName: 'вул. Городоцька', queue: '2/2' },
      { region: LVIV, streetNormalized: 'личаківська', streetName: 'вул. Личаківська', queue: '2/2' },
      { region: CHERNIHIV, streetNormalized: 'миру', streetName: 'вул. Миру', queue: '1/1' },
    ]);

    const lvivQueuesRes = await app.inject({ method: 'GET', url: `/api/v1/queues?region=${LVIV}` });
    expect(lvivQueuesRes.statusCode).toBe(200);
    const lvivQueues = (lvivQueuesRes.json() as { data: Array<{ queue: string; streets: number; slots: number }> }).data;
    // `streetNames` — та сама географія, що й `streets`: перелік реальних вулиць групи (за абеткою).
    expect(lvivQueues).toEqual([
      {
        queue: '2/2',
        slots: 1,
        lastDate: '2026-10-11',
        streets: 2,
        settlements: [],
        streetNames: ['вул. Городоцька', 'вул. Личаківська'],
      },
    ]);

    const chernihivQueuesRes = await app.inject({ method: 'GET', url: `/api/v1/queues?region=${CHERNIHIV}` });
    expect(chernihivQueuesRes.statusCode).toBe(200);
    const chernihivQueues = (chernihivQueuesRes.json() as { data: Array<{ queue: string; streets: number; slots: number }> }).data;
    expect(chernihivQueues).toEqual([
      {
        queue: '1/1',
        slots: 1,
        lastDate: '2026-10-11',
        streets: 1,
        settlements: [],
        streetNames: ['вул. Миру'],
      },
    ]);

    // Область без вулиць має чесний 0 (порожній список вулиць)
    const poltavaQueuesRes = await app.inject({ method: 'GET', url: `/api/v1/queues?region=${POLTAVA}` });
    expect(poltavaQueuesRes.statusCode).toBe(200);
    expect(poltavaQueuesRes.json()).toEqual({ data: [] });
  });
});
