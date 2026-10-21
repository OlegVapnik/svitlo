/**
 * Запис дзеркала ГПВ у `schedule_slots` на реальній Postgres (HANDOFF §18.10).
 *
 * Тест фіксує інваріанти, ціна помилки кожного з яких — зламаний графік:
 *  1) імпорт пише лише `source = 'mirror'` і не чіпає рядки інших джерел;
 *  2) повторний імпорт ідемпотентний (жодних дублів), а рядок іншого джерела з тим самим часом
 *     виграє конфлікт за унікальним індексом (queue,date,time_from) — і не плодить повторних спроб;
 *  3) `ensureMirrorSchedule` (шлях сторінки) не пише в БД, коли склад інтервалів уже такий самий,
 *     і САМОВІДНОВЛЮЄ втрачені рядки, коли вони зникли;
 *  4) якщо дзеркало більше не має інтервалів на цю чергу/дату — старі рядки дзеркала видаляються,
 *     а не лишаються «вічним» графіком.
 *
 * Без TEST_DATABASE_URL файл пропускається (як і решта інтеграційних тестів); БД мусить зватись *_test.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { ensureTestSchema, testDatabaseUrlOrSkip } from '../helpers/test-db.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? '';
const describeWithDb = describe.skipIf(!TEST_DATABASE_URL);

/** Той самий живий формат, що в юніт-тесті: `body` — рядок із JSON, кодуємо через `code`. */
function mirrorPayload(codes: Record<string, number>): unknown {
  return {
    body: JSON.stringify({
      regions: [{ cpu: 'chernihivska-oblast', schedule: { '2.2': { '2026-10-10': codes } } }],
    }),
    timestamp: '2026-10-10T12:00:00.000Z',
  };
}

let db: typeof import('../../src/db/connection.js').db;
let scheduleSlots: typeof import('../../src/db/schema.js').scheduleSlots;
let service: typeof import('../../src/services/mirror-schedule.service.js');

/** fetch-стаб: жодного реального запиту, лише віддаємо payload. */
const stubFetch = (payload: unknown): typeof fetch =>
  (async () => new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;

const rows = () =>
  db.select().from(scheduleSlots).where(and(eq(scheduleSlots.queue, '2/2'), eq(scheduleSlots.date, '2026-10-10')));

describeWithDb('дзеркало ГПВ → schedule_slots', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrlOrSkip();
    process.env.LOG_LEVEL = 'silent';
    process.env.ENABLE_SCHEDULER = 'false';
    process.env.MIRROR_SCHEDULE_ENABLED = 'true';
    const connection = await import('../../src/db/connection.js');
    db = connection.db;
    await ensureTestSchema();
    scheduleSlots = (await import('../../src/db/schema.js')).scheduleSlots;
    service = await import('../../src/services/mirror-schedule.service.js');
  });

  beforeEach(async () => {
    await db.delete(scheduleSlots);
    service.resetMirrorCache();
  });

  it('пише лише source=mirror і повторний імпорт не дублює рядки', async () => {
    const fetchImpl = stubFetch(mirrorPayload({ '08:00': 2, '08:30': 2, '09:00': 1, '22:00': 2 }));

    const first = await service.importMirrorScheduleFromSource({ fetchImpl, force: true });
    expect(first.imported).toBe(2); // 08:00–09:00 і 22:00–00:00
    const afterFirst = await rows();
    expect(afterFirst).toHaveLength(2);
    expect(afterFirst.every((row) => row.source === 'mirror')).toBe(true);

    const second = await service.importMirrorScheduleFromSource({ fetchImpl, force: true });
    expect(second.imported).toBe(2);
    expect(await rows()).toHaveLength(2);
  });

  it('рядок іншого джерела з тим самим часом виграє конфлікт і не провокує вічних спроб', async () => {
    await db.insert(scheduleSlots).values({
      queue: '2/2',
      date: '2026-10-10',
      timeFrom: '08:00',
      timeTo: '09:00',
      stateCode: 3,
      stateName: 'Відключення',
      stateColor: '#E33535',
      source: 'telegram',
    });
    const fetchImpl = stubFetch(mirrorPayload({ '08:00': 2, '08:30': 2 }));

    await service.importMirrorScheduleFromSource({ fetchImpl, force: true });
    const stored = await rows();
    expect(stored).toHaveLength(1);
    expect(stored[0]!.source).toBe('telegram');

    // Склад інтервалів уже такий, як у знімку → повторний імпорт не має нічого писати.
    const ensured = await service.ensureMirrorSchedule('2/2', '2026-10-10', { fetchImpl });
    expect(ensured).toMatchObject({ imported: 0 });
    expect((await rows())[0]!.source).toBe('telegram');
  });

  it('ensureMirrorSchedule не пише вдруге, але повертає втрачені рядки', async () => {
    const fetchImpl = stubFetch(mirrorPayload({ '08:00': 2, '08:30': 2 }));

    const first = await service.ensureMirrorSchedule('2/2', '2026-10-10', { fetchImpl });
    expect(first).toMatchObject({ imported: 1 });
    const createdAtBefore = (await rows())[0]!.createdAt.getTime();

    // Другий виклик — no-op: рядок той самий (не перезаписувався).
    const second = await service.ensureMirrorSchedule('2/2', '2026-10-10', { fetchImpl });
    expect(second).toMatchObject({ imported: 0 });
    expect((await rows())[0]!.createdAt.getTime()).toBe(createdAtBefore);

    // Хтось стер наш рядок — наступний запит сторінки має його повернути.
    await db.delete(scheduleSlots).where(eq(scheduleSlots.queue, '2/2'));
    const healed = await service.ensureMirrorSchedule('2/2', '2026-10-10', { fetchImpl });
    expect(healed).toMatchObject({ imported: 1 });
    expect(await rows()).toHaveLength(1);
  });

  it('черга/дата, яких немає у знімку, не пише нічого', async () => {
    const fetchImpl = stubFetch(mirrorPayload({ '08:00': 2, '08:30': 2 }));
    const result = await service.ensureMirrorSchedule('9/9', '2026-10-10', { fetchImpl });
    expect(result).toMatchObject({ imported: 0, empty: true });
    expect(await rows()).toHaveLength(0);
  });
});
