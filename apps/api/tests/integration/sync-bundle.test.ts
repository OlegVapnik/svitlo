/**
 * Інтеграційні тести пакета офлайн-синхронізації (`GET /api/v1/sync`) на реальній PostgreSQL.
 *
 * Пакет — точка, де сходиться шість сервісів, і саме тому він найлегше ламається непомітно:
 * ендпоінт віддає 200 з валідним JSON, але один зайвий шар вкладеності в `status` чи відсутня
 * гілка `schedulesByRegion[region]` перетворюють його на білий екран у застосунку, який
 * гідратується з нього ДО першого запиту в мережу. Тому перевіряємо саме форму й поведінку:
 * плаский статус, графік лише своєї області, стабільний ETag і 304 без тіла.
 *
 * Дзеркало вимкнене (`MIRROR_SCHEDULE_ENABLED=false`): перевіряємо API, а не мережу — в тестах
 * заборонені виходи в інтернет. Без `TEST_DATABASE_URL` файл пропускається, як і решта
 * інтеграційних тестів; база мусить закінчуватися на `_test`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ensureTestSchema, testDatabaseUrlOrSkip } from '../helpers/test-db.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? '';
const describeWithDb = describe.skipIf(!TEST_DATABASE_URL);

const CHERNIHIV = 'chernihivska-oblast';
const LVIV = 'lvivska-oblast';

interface SyncBody {
  data: {
    syncedAt: string;
    etag: string;
    region: string | null;
    status: Record<string, unknown> & { grid: { level: string; message: string } };
    regions: unknown[];
    queues: unknown[];
    schedulesByRegion: Record<string, { days: string[]; buckets: Array<{ queue: string; date: string }> }>;
    settlements: Array<{ name: string; queues: string[] }>;
    settlementsTotal: number;
    news: unknown[];
    contacts: unknown[];
  };
}

let app: FastifyInstance;
let db: typeof import('../../src/db/connection.js').db;
let scheduleSlots: typeof import('../../src/db/schema.js').scheduleSlots;
let regionCatalog: typeof import('../../src/db/schema.js').regions;
let regionQueueCatalog: typeof import('../../src/db/schema.js').regionQueues;

/** Київські дати «сьогодні + зсув діб» — графік у пакеті рахується від київського календаря. */
function kyivDay(offset = 0): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(Date.now() + offset * 86_400_000));
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

/** Рядок слота з фікстурою стану відключення (код 3 — «Відключення», як у фіді дзеркала). */
function slot(overrides: Partial<{ region: string; queue: string; date: string; timeFrom: string; timeTo: string; stateCode: number }> = {}) {
  return {
    region: CHERNIHIV,
    queue: '1/1',
    date: kyivDay(),
    timeFrom: '02:00',
    timeTo: '05:00',
    stateCode: 3,
    stateName: 'Відключення',
    stateColor: '#E33535',
    source: 'mirror',
    ...overrides,
  };
}

async function getSync(query = `region=${CHERNIHIV}`, headers: Record<string, string> = {}) {
  const response = await app.inject({ method: 'GET', url: `/api/v1/sync?${query}`, headers });
  return {
    statusCode: response.statusCode,
    etag: response.headers.etag as string | undefined,
    body: response.json() as SyncBody,
  };
}

describeWithDb('GET /api/v1/sync: пакет офлайн-старту', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrlOrSkip();
    process.env.LOG_LEVEL = 'silent';
    process.env.ENABLE_SCHEDULER = 'false';
    process.env.MIRROR_SCHEDULE_ENABLED = 'false';
    process.env.USE_MOCK_ADAPTER = 'false';
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
    // Чистимо все, з чого збирається пакет: інакше «порожня база» залежала б від того, який
    // інтеграційний файл відпрацював перед цим (вони ділять одну `svitlo_test`).
    await db.delete(scheduleSlots);
    await db.delete(regionQueueCatalog);
    await db.delete(regionCatalog);
  });

  it('віддає конверт `{ data }`, плаский статус і графік своєї області', async () => {
    await db.insert(scheduleSlots).values([slot(), slot({ queue: '2/2', timeFrom: '05:00', timeTo: '06:00' })]);

    const { statusCode, body } = await getSync();
    const bundle = body.data;

    expect(statusCode).toBe(200);
    expect(bundle.region).toBe(CHERNIHIV);
    expect(bundle.contacts).toEqual([]);
    expect(bundle.schedulesByRegion[CHERNIHIV]?.days).toEqual([kyivDay(), kyivDay(1)]);

    // Ключове: `status` — це САМЕ тіло статусу, а не конверт `{ data: … }` навколо нього.
    // Другий шар вкладеності дає в застосунку `undefined.level` — тобто падіння React на
    // гідратації кеша ще до першого запиту в мережу.
    expect(bundle.status).not.toHaveProperty('data');
    expect(['stable', 'warning', 'emergency']).toContain(bundle.status.grid.level);
    expect(typeof bundle.status.grid.message).toBe('string');
    expect(bundle.status).toHaveProperty('activeGroups');
    expect(bundle.status).toHaveProperty('powerSummary');

    // Цифри в пакеті — з того самого розрахунку, що й `/status` (одне джерело правди).
    const statusResponse = await app.inject({ method: 'GET', url: `/api/v1/status?region=${CHERNIHIV}` });
    const live = (statusResponse.json() as { data: Record<string, unknown> }).data;
    for (const key of ['grid', 'activeOutages', 'scheduledOutages', 'activeGroups', 'totalIncidents', 'dataStale']) {
      expect(bundle.status[key]).toEqual(live[key]);
    }
  });

  it('графік містить лише запрошену область', async () => {
    await db.insert(scheduleSlots).values([slot(), slot({ region: LVIV, queue: '2/2', date: kyivDay() })]);

    const chernihiv = (await getSync(`region=${CHERNIHIV}`)).body.data;
    expect(chernihiv.schedulesByRegion[CHERNIHIV]?.buckets.map((bucket) => bucket.queue)).toEqual(['1/1']);
    expect(chernihiv.schedulesByRegion[LVIV]).toBeUndefined();

    const lviv = (await getSync(`region=${LVIV}`)).body.data;
    expect(lviv.schedulesByRegion[LVIV]?.buckets.map((bucket) => bucket.queue)).toEqual(['2/2']);
    // Різні області — різний вміст, отже й різні хеші: інакше клієнт після перемикання області
    // отримав би 304 і залишився з чужим графіком.
    expect(lviv.etag).not.toBe(chernihiv.etag);
  });

  it('графік лежить і під кодом клієнта: канонічним і ключем фіда', async () => {
    // Клієнт читає `schedulesByRegion[region]` рівно тим кодом, який сам надіслав. У каталозі це
    // `kyivska-oblast`, а в старих закладках і `localStorage` — `kiivska-oblast`. Один ключ означав
    // би «даних графіка немає» при живому графіку.
    await db.insert(scheduleSlots).values([slot({ region: 'kiivska-oblast', queue: '4/1' })]);

    const canonical = (await getSync('region=kyivska-oblast')).body.data;
    expect(canonical.schedulesByRegion['kyivska-oblast']?.buckets.map((bucket) => bucket.queue)).toEqual(['4/1']);
    expect(canonical.schedulesByRegion['kiivska-oblast']?.buckets.map((bucket) => bucket.queue)).toEqual(['4/1']);

    const feedKey = (await getSync('region=kiivska-oblast')).body.data;
    expect(feedKey.schedulesByRegion['kiivska-oblast']?.buckets.map((bucket) => bucket.queue)).toEqual(['4/1']);
    expect(feedKey.schedulesByRegion['kyivska-oblast']?.buckets.map((bucket) => bucket.queue)).toEqual(['4/1']);
    // Дані чужої області під цими ключами не з'являються.
    expect(canonical.schedulesByRegion[CHERNIHIV]).toBeUndefined();
  });

  it('ETag стабільний між викликами, а `If-None-Match` дає 304 без тіла', async () => {
    await db.insert(scheduleSlots).values(slot());

    const first = await getSync();
    const second = await getSync();

    // `syncedAt` у двох пакетах різний — і саме тому хеш рахується без нього та без
    // `status.nextAttemptAt`. Інакше 304 не настав би ніколи, і пакет щоразу їхав би мережею.
    expect(first.body.data.syncedAt).not.toBe('');
    expect(second.etag).toBe(first.etag);
    expect(first.etag).toMatch(/^W\/"[0-9a-f]{8}"$/);

    const notModified = await app.inject({
      method: 'GET',
      url: `/api/v1/sync?region=${CHERNIHIV}`,
      headers: { 'if-none-match': first.etag as string },
    });
    expect(notModified.statusCode).toBe(304);
    expect(notModified.body).toBe('');

    // Дані змінилися — хеш мусить змінитися, інакше 304 «заморозив» би застосунок на старому графіку.
    await db.insert(scheduleSlots).values(slot({ queue: '2/2', timeFrom: '09:00', timeTo: '10:00' }));
    const afterChange = await getSync();
    expect(afterChange.statusCode).toBe(200);
    expect(afterChange.etag).not.toBe(first.etag);
  });

  it('`days` керує горизонтом графіка і обмежений тижнем', async () => {
    const oneDay = (await getSync(`region=${CHERNIHIV}&days=1`)).body.data;
    expect(oneDay.schedulesByRegion[CHERNIHIV]?.days).toEqual([kyivDay()]);

    const tooMany = (await getSync(`region=${CHERNIHIV}&days=99`)).body.data;
    expect(tooMany.schedulesByRegion[CHERNIHIV]?.days).toHaveLength(7);
  });

  it('порожня база — честний порожній пакет, а не 500', async () => {
    const { statusCode, body } = await getSync();
    const bundle = body.data;

    expect(statusCode).toBe(200);
    // Каталог областей у пакеті — ті самі канонічні області, що й у `/api/v1/regions`: людина має
    // знайти свою область і офлайн. У порожній базі даних немає в жодної з них — і це видно.
    expect(bundle.regions.map((region) => region.cpu)).toContain(CHERNIHIV);
    expect(bundle.regions.map((region) => region.cpu)).toContain('dnipropetrovska-oblast');
    expect(bundle.regions.every((region) => region.slots === 0 && region.lastDate === null)).toBe(true);
    expect(bundle.queues).toEqual([]);
    expect(bundle.schedulesByRegion[CHERNIHIV]?.buckets).toEqual([]);
    // НП області беруться ще й із довідника КОАТТГ, тому список не порожній навіть без слотів;
    // обрізаний він чи ні — видно з `settlementsTotal`, яке ніколи не менше за довжину списку.
    expect(bundle.settlementsTotal).toBeGreaterThanOrEqual(bundle.settlements.length);
    expect(bundle.status.grid.level).toBe('stable');
  });

  it('сміття в `?region=` — помилка запиту, а не пакет чужої області', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/sync?region=Kyiv%20City!' });
    expect(response.statusCode).toBe(400);
  });
});
