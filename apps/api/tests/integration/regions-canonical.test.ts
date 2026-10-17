/**
 * Канонічний каталог областей і псевдоніми ключів фіда — наскрізно через HTTP.
 *
 * Ціна помилки, яку тест тримає закритою: у фіді Київська область зветься `kiivska-oblast`, Київ —
 * `kyiv`, а м. Дніпро приходить двома ключами (`dnipro-cek`, `dnipro-dnem` — ЦЕК і ДнЕМ). Людина ж
 * бачить каталог «Дніпропетровська область / Київська область» і запитує саме так. Без псевдонімів
 * вона отримувала порожній графік про область із опублікованим ГПВ.
 *
 * Друга половина тесту — про чесність: ЦЕК і ДнЕМ мають однакову нумерацію черг (1/1…6/2), але це
 * різні мережі, тому область із кількома мережами НЕ зводиться в один графік: якщо дані є в обох,
 * відповідь — 400 `AMBIGUOUS_REGION` з переліком ключів, а не злитий розклад двох мереж.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { QueueSummary, RegionSummary } from '@svitlo/shared';
import { ensureTestSchema, testDatabaseUrlOrSkip } from '../helpers/test-db.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? '';
const describeWithDb = describe.skipIf(!TEST_DATABASE_URL);

/** Київська «сьогодні»: саме її бере `publishedClearQueues` у `/queues` (не UTC-дату сервера). */
function kyivToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

const DATE = kyivToday();
const ON = 1;
const OFF = 2;

/** Фід: ЦЕК і ДнЕМ (дві мережі м. Дніпро), Київська область — під власними ключами. */
function mirrorPayload(): unknown {
  return {
    body: JSON.stringify({
      regions: [
        {
          cpu: 'dnipro-cek',
          name_ua: 'м. Дніпро (ЦЕК)',
          schedule: {
            '1.1': { [DATE]: { '08:00': ON, '08:30': ON } },
            // Фід уже бачить відключення у ЦЕК: «світло за графіком» по області обіцяти не можна.
            '2.2': { [DATE]: { '08:00': OFF } },
          },
        },
        {
          cpu: 'dnipro-dnem',
          name_ua: 'м. Дніпро (ДнЕМ)',
          schedule: { '1.1': { [DATE]: { '08:00': ON, '08:30': ON } } },
        },
        { cpu: 'kiivska-oblast', name_ua: 'Київська область', schedule: { '4.1': { [DATE]: { '05:00': ON } } } },
      ],
    }),
    timestamp: `${DATE}T00:00:00.000Z`,
  };
}

/** fetch-стаб: жодного реального запиту, лише віддаємо payload. */
const stubFetch = (payload: unknown): typeof fetch =>
  (async () => new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })) as unknown as typeof fetch;

let app: FastifyInstance;
let db: typeof import('../../src/db/connection.js').db;
let regions: typeof import('../../src/db/schema.js').regions;
let scheduleSlots: typeof import('../../src/db/schema.js').scheduleSlots;
let service: typeof import('../../src/services/mirror-schedule.service.js');

/** Слот графика: у БД лежать лише «тёмные» години, тому й фікстура така сама. */
function slot(region: string, queue: string, timeFrom: string, timeTo: string) {
  return {
    region,
    queue,
    date: DATE,
    timeFrom,
    timeTo,
    stateCode: 3,
    stateName: 'Відключення',
    stateColor: '#E33535',
    source: 'mirror',
  };
}


describeWithDb('канонічні області та псевдоніми ключів фіда', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrlOrSkip();
    process.env.LOG_LEVEL = 'silent';
    process.env.ENABLE_SCHEDULER = 'false';
    process.env.MIRROR_SCHEDULE_ENABLED = 'true';
    const connection = await import('../../src/db/connection.js');
    db = connection.db;
    const schema = await import('../../src/db/schema.js');
    regions = schema.regions;
    scheduleSlots = schema.scheduleSlots;
    service = await import('../../src/services/mirror-schedule.service.js');
    await ensureTestSchema();
    const { buildServer } = await import('../../src/app.js');
    app = await buildServer();
  });

  afterAll(async () => {
    if (db) {
      await db.delete(scheduleSlots);
      await db.delete(regions);
    }
    service?.resetMirrorCache();
    await app?.close();
  });

  beforeEach(async () => {
    await db.delete(scheduleSlots);
    await db.delete(regions);
    await db.insert(regions).values([
      { cpu: 'dnipro-cek', nameUa: 'м. Дніпро (ЦЕК)' },
      { cpu: 'dnipro-dnem', nameUa: 'м. Дніпро (ДнЕМ)' },
      { cpu: 'kiivska-oblast', nameUa: 'Київська область' },
      { cpu: 'kyiv', nameUa: 'Київ' },
    ]);
    await db.insert(scheduleSlots).values([
      // «1/1» є в обох мережах (різні години!) — саме той випадок, де злиття було б брехнею.
      slot('dnipro-cek', '1/1', '08:00', '09:00'),
      slot('dnipro-dnem', '1/1', '14:00', '15:00'),
      // «3/1» є лише в ЦЕК, «2/2» — лише в ДнЕМ: такі черги область розв'язує сама.
      slot('dnipro-cek', '3/1', '10:00', '11:00'),
      slot('dnipro-dnem', '2/2', '16:00', '17:00'),
      slot('kiivska-oblast', '4/1', '05:00', '06:00'),
    ]);
    await service.loadMirrorSnapshot({ fetchImpl: stubFetch(mirrorPayload()), force: true });
  });

  const listRegions = async (): Promise<RegionSummary[]> => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/regions' });
    expect(res.statusCode).toBe(200);
    return (res.json() as { data: RegionSummary[] }).data;
  };

  it('/regions: область із кількома мережами — одна група з підобластями, а не два сусідні рядки', async () => {
    const data = await listRegions();
    const dnipropetrovsk = data.find((region) => region.cpu === 'dnipropetrovska-oblast')!;
    expect(dnipropetrovsk).toMatchObject({
      nameUa: 'Дніпропетровська область',
      feedKeys: ['dnipro-cek', 'dnipro-dnem'],
    });
    // Слоти й черги — зведення мереж (це метадані; години так не зводяться ніколи).
    // 1/1 у ЦЕК + 1/1 у ДнЕМ + 3/1 у ЦЕК + 2/2 у ДнЕМ = 4 слоти.
    expect(dnipropetrovsk.slots).toBe(4);
    expect(dnipropetrovsk.queues).toEqual(['1/1', '2/2', '3/1']);
    // «Світло за графіком» по області — тільки якщо так опублікувала КОЖНА мережа: у ЦЕК фід уже
    // бачить відключення у 2/2, тому обіцянки немає.
    expect(dnipropetrovsk.allClear).toBe(false);

    // Підобласті стоять одразу за батьком (дві йдуть підряд), зберігають назви мереж із фіда і
    // позначені `parentCpu`, щоб клієнт показав їх вибором мережі, а не окремими областями.
    const index = data.findIndex((region) => region.cpu === 'dnipropetrovska-oblast');
    const children = data.slice(index + 1, index + 3);
    expect(children.map((region) => region.cpu).sort()).toEqual(['dnipro-cek', 'dnipro-dnem']);
    expect(children.every((region) => region.parentCpu === 'dnipropetrovska-oblast')).toBe(true);
    expect(children.map((region) => region.nameUa).sort()).toEqual(['м. Дніпро (ДнЕМ)', 'м. Дніпро (ЦЕК)']);
  });

  it('/regions: псевдонім 1:1 не дублює рядок, а невідома фіду область лишається з нулями', async () => {
    const data = await listRegions();
    // Київська область — один рядок із ключем фіда `kiivska-oblast`, а не два.
    const kyivska = data.find((region) => region.cpu === 'kyivska-oblast')!;
    expect(kyivska).toMatchObject({ nameUa: 'Київська область', feedKeys: ['kiivska-oblast'], slots: 1 });
    expect(data.find((region) => region.cpu === 'kiivska-oblast')).toBeUndefined();
    // Київ — так само: канонічний `kyiv-city`, ключ фіда `kyiv`.
    expect(data.find((region) => region.cpu === 'kyiv-city')).toMatchObject({ nameUa: 'Київ', feedKeys: ['kyiv'] });
    // Область, якої фід не віддає, у каталозі Є: людина має знайти свою область і побачити «даних немає».
    expect(data.find((region) => region.cpu === 'odeska-oblast')).toMatchObject({
      nameUa: 'Одеська область',
      slots: 0,
      lastDate: null,
      feedKeys: [],
    });
    expect(data.find((region) => region.cpu === 'odeska-oblast')?.allClear).toBeUndefined();
  });

  it('/queues: псевдонім читає дані ключа фіда (Київська область → kiivska-oblast)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/queues?region=kyivska-oblast' });
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: QueueSummary[] }).data;
    expect(data.map((item) => item.queue)).toEqual(['4/1']);
    expect(data[0]).toMatchObject({ slots: 1, covered: true });
  });

  it('/queues: коди груп зводяться, а «без відключень» — лише за згодою всіх мереж', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/queues?region=dnipropetrovnska-oblast' });
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: QueueSummary[] }).data;
    expect(data.map((item) => item.queue)).toEqual(['1/1', '2/2', '3/1']);
    // «1/1» без відключень в обох мережах → світло за графіком.
    expect(data.find((item) => item.queue === '1/1')?.covered).toBe(true);
    // «2/2»: у ДнЕМ відключень немає, але у ЦЕК фід їх уже бачить → обіцяти світло не можна.
    expect(data.find((item) => item.queue === '2/2')?.covered).toBeUndefined();
    // «3/1» фід сьогодні не публікував ні в одній мережі → чесне «не знаємо».
    expect(data.find((item) => item.queue === '3/1')?.covered).toBeUndefined();
  });

  it("/schedules: область розв'язується сама, коли черга є лише в одній мережі", async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/schedules?region=dnipropetrovska-oblast&queue=3/1&date=${DATE}`,
    });
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: { intervals: unknown[]; covered: boolean } }).data;
    expect(data.intervals).toHaveLength(1);
    expect(data.covered).toBe(true);
  });

  it('/schedules: коли черга є в обох мережах — 400 з переліком, а не злитий розклад', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/schedules?region=dnipropetrovska-oblast&queue=1/1&date=${DATE}`,
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error?: { code?: string; message?: string } };
    expect(body.error?.code).toBe('AMBIGUOUS_REGION');
    expect(body.error?.message).toContain('dnipro-cek');
    expect(body.error?.message).toContain('dnipro-dnem');
  });

  it('/schedules: якщо даних немає в жодній мережі — чесне порожньо, без помилки', async () => {
    const grouped = await app.inject({
      method: 'GET',
      url: `/api/v1/schedules?region=dnipropetrovska-oblast&queue=5/1&date=${DATE}`,
    });
    expect(grouped.statusCode).toBe(200);
    const groupedData = (grouped.json() as { data: { intervals: unknown[]; allClear: boolean } }).data;
    expect(groupedData.intervals).toEqual([]);
    // `allClear` по області — ні: фід у ЦЕК уже бачить відключення, тож обіцяти світло не можна.
    expect(groupedData.allClear).toBe(false);

    // А коли в області на цю дату немає ЖОДНОГО слота (Київ у фікстурі), то й публікації немає:
    // `covered: false` — це «не знаємо», а не «графік без відключень».
    const noData = await app.inject({
      method: 'GET',
      url: `/api/v1/schedules?region=kyiv-city&queue=5/1&date=${DATE}`,
    });
    expect(noData.statusCode).toBe(200);
    const noDataBody = (noData.json() as { data: { intervals: unknown[]; covered: boolean; allClear: boolean } }).data;
    expect(noDataBody.intervals).toEqual([]);
    expect(noDataBody.covered).toBe(false);
    expect(noDataBody.allClear).toBe(false);
  });

  it('/reliability і /schedules/upcoming вимагають конкретної мережі (ті самі правила)', async () => {
    const reliability = await app.inject({ method: 'GET', url: '/api/v1/reliability?region=dnipropetrovska-oblast' });
    expect(reliability.statusCode).toBe(400);
    expect((reliability.json() as { error?: { code?: string } }).error?.code).toBe('AMBIGUOUS_REGION');

    const upcoming = await app.inject({ method: 'GET', url: '/api/v1/schedules/upcoming?region=dnipropetrovska-oblast' });
    expect(upcoming.statusCode).toBe(400);
    expect((upcoming.json() as { error?: { code?: string } }).error?.code).toBe('AMBIGUOUS_REGION');

    // Із конкретним ключем усе працює як раніше.
    const concrete = await app.inject({ method: 'GET', url: '/api/v1/reliability?region=dnipro-cek' });
    expect(concrete.statusCode).toBe(200);
  });
});

