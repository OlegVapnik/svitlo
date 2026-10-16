/**
 * «Оператор опублікував ГПВ без відключень» проти «даних немає» — наскрізь через HTTP.
 *
 * Ціна помилки видна 17.10.2026: у `dnipro-cek` фід віддав 12 черг і по 48 комірок на кожну, усі —
 * «світло є». У `schedule_slots` такі комірки не пишуться (там лише «тёмные» години), тому екран
 * вибору групи писав «графік не імпортовано», а сторінка групи — «Немає даних» про опублікований
 * графік. Тест фіксує три різні стани на одному фіді:
 *   1) черга є у фіді й без відключень → `/queues` віддає її з `covered: true`, `/schedules` — `allClear: true`;
 *   2) черга є у фіді, але з відключенням → «світло за графіком» не показуємо ніколи (імпорт міг відстати);
 *   3) черги у фіді немає → чесне «даних немає» (`covered: false`, `allClear: false`).
 *
 * Знімок дзеркала підставляємо fetch-стабом: тест перевіряє НАШУ логіку, а не доступність чужого
 * воркера, і не має ходити в мережу. `force: true` — щоб кеш не залежав від інших файлів прогону.
 *
 * Без `TEST_DATABASE_URL` файл пропускається (як і решта інтеграційних тестів); БД мусить зватись `*_test`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { QueueScheduleData, QueueSummary } from '@svitlo/shared';
import { ensureTestSchema, testDatabaseUrlOrSkip } from '../helpers/test-db.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? '';
const describeWithDb = describe.skipIf(!TEST_DATABASE_URL);

const REGION = 'dnipro-cek';

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
/** Код комірки «світло є» (дзеркало: 0/1) і «відключення» (дзеркало: 2). */
const ON = 1;
const OFF = 2;

/**
 * Фід області: `2/2` опублікована і без відключень, `3/1` — з відключенням 08:00–08:30.
 * Ті самі ключі груп, що у живому фіді (`2.2` → черга `2/2`), тому йдемо через реальний парсер.
 */
function mirrorPayload(): unknown {
  return {
    body: JSON.stringify({
      regions: [
        {
          cpu: REGION,
          name_ua: 'Дніпропетровська область',
          schedule: {
            '2.2': { [DATE]: { '08:00': ON, '08:30': ON } },
            '3.1': { [DATE]: { '08:00': OFF, '08:30': ON } },
          },
        },
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
let streetQueues: typeof import('../../src/db/schema.js').streetQueues;
let scheduleSlots: typeof import('../../src/db/schema.js').scheduleSlots;
let service: typeof import('../../src/services/mirror-schedule.service.js');

/** Кладёт знімок фіда в кеш: без нього перевірки нижче давали б «не знаємо» і не доводили нічого. */
async function primeMirror(): Promise<void> {
  await service.loadMirrorSnapshot({ fetchImpl: stubFetch(mirrorPayload()), force: true });
}

describeWithDb('публікація ГПВ без відключень: /queues і /schedules', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrlOrSkip();
    process.env.LOG_LEVEL = 'silent';
    process.env.ENABLE_SCHEDULER = 'false';
    // Імпорт дозволений: маршрут /schedules кличе `ensureMirrorSchedule`, і саме на ньому перевіряємо,
    // що свіжий знімок береться з кеша (мережі в тесті немає — див. `primeMirror`).
    process.env.MIRROR_SCHEDULE_ENABLED = 'true';
    const connection = await import('../../src/db/connection.js');
    db = connection.db;
    const schema = await import('../../src/db/schema.js');
    streetQueues = schema.streetQueues;
    scheduleSlots = schema.scheduleSlots;
    service = await import('../../src/services/mirror-schedule.service.js');
    await ensureTestSchema();
    const { buildServer } = await import('../../src/app.js');
    app = await buildServer();
  });

  afterAll(async () => {
    if (db) {
      await db.delete(streetQueues);
      await db.delete(scheduleSlots);
    }
    service?.resetMirrorCache();
    await app?.close();
  });

  beforeEach(async () => {
    await db.delete(streetQueues);
    await db.delete(scheduleSlots);
  });

  it('/queues: група з опублікованого ГПВ без відключень є у списку, навіть без слотів', async () => {
    // `1/1` — только привязка улиц (реальный справочник), `2/2` — опубликована фідом без отключений.
    await db.insert(streetQueues).values([
      { region: REGION, streetNormalized: 'січова', streetName: 'вул. Січова', queue: '1/1' },
    ]);
    await primeMirror();

    const res = await app.inject({ method: 'GET', url: `/api/v1/queues?region=${REGION}` });
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: QueueSummary[] }).data;

    // Порядок числовой (1/1, 2/2) — как в серверной сборке и в облачной, а не строковый.
    expect(data.map((item) => item.queue)).toEqual(['1/1', '2/2']);
    expect(data.find((item) => item.queue === '2/2')).toMatchObject({ slots: 0, covered: true });
    // «Не знаємо» не має виглядати як «графік без відключень»: у группы только с улицами флага нет.
    expect(data.find((item) => item.queue === '1/1')?.covered).toBeUndefined();
    // Фід бачить у `3/1` відключення, а слотів немає: це відсталий імпорт, а не «світло за графіком».
    expect(data.find((item) => item.queue === '3/1')).toBeUndefined();
  });

  it('/schedules: порожній графік на опубліковану добу — це allClear, а не «немає даних»', async () => {
    await primeMirror();

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/schedules?region=${REGION}&queue=2/2&date=${DATE}`,
    });
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: QueueScheduleData }).data;

    expect(data.intervals).toEqual([]);
    expect(data.covered).toBe(true);
    expect(data.allClear).toBe(true);
    // Слотов нет, но источник известен: «відключень немає» мы знаем именно из дзеркала.
    expect(data.source).toBe('mirror');
  });

  it('/schedules: якщо фід уже показує відключення, «світло за графіком» не показуємо', async () => {
    await primeMirror();

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/schedules?region=${REGION}&queue=3/1&date=${DATE}`,
    });
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: QueueScheduleData }).data;

    expect(data.covered).toBe(true);
    expect(data.allClear).toBe(false);
  });

  it('/schedules: групи, якої немає у фіді, лишається чесне «даних немає»', async () => {
    await primeMirror();

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/schedules?region=${REGION}&queue=5/1&date=${DATE}`,
    });
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: QueueScheduleData }).data;

    expect(data.intervals).toEqual([]);
    expect(data.covered).toBe(false);
    expect(data.allClear).toBe(false);
  });

  it('холодний кеш дзеркала не вигадує ні груп, ні «світла за графіком»', async () => {
    await db.insert(streetQueues).values([
      { region: REGION, streetNormalized: 'січова', streetName: 'вул. Січова', queue: '1/1' },
    ]);
    // Публічний GET не ходить у мережу: без знімка список складається лише з того, що є в БД.
    service.resetMirrorCache();

    const res = await app.inject({ method: 'GET', url: `/api/v1/queues?region=${REGION}` });
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: QueueSummary[] }).data;

    expect(data.map((item) => item.queue)).toEqual(['1/1']);
    expect(data[0].covered).toBeUndefined();
  });
});
