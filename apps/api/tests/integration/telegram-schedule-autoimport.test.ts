/**
 * Автоматичний шлях: `parse.service` після КОЖНОГО прогону парсингу викликає `importTelegramSchedule`,
 * тож будь-яка правка графіка в публічному каналі оператора сама доїжджає в `schedule_slots` — без
 * кнопки в адмінці (HANDOFF §18.9.1). Тест фіксує три інваріанти цього шляху, бо ціна помилки — або
 * порожній графік, або сміття в ньому:
 *  1) беруться лише пости з ГПВ (`kind = 'outage_schedule'`) — новина зі згадкою черги не плодить слотів;
 *  2) повторний виклик (а він щоцикл!) не дублює рядки й відновлює втрачені — імпорт ідемпотентний;
 *  3) ручний/операторський рядок за тією ж чергою+датою+часом НЕ затирається.
 *
 * Без TEST_DATABASE_URL файл пропускається (як і решта інтеграційних тестів); БД мусить мати ім'я *_test.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { ensureTestSchema, testDatabaseUrlOrSkip } from '../helpers/test-db.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? '';
const describeWithDb = describe.skipIf(!TEST_DATABASE_URL);

/** Той самий текст, що й у фікстурах telegram-schedule.test.ts, але без дати — беремо київську добу. */
const POST_TWO_QUEUES = 'За вказівкою НЕК "Укренерго", маємо зміни у Графіку погодинних відключень (ГПВ) ☝️.🕗 З 16:40 до 18:30 додатково відключається черга 6/2. 🕗 З 18:30 до 22:00 додатково відключається черга 3/2.';
/** Новина, у якій випадково є і черга, і час: у слоти потрапити не має. */
const POST_NEWS = 'Нагадуємо про режим економії: з 10:00 до 12:00 додатково відключається черга 9/9 (це новина, не графік).';

let db: typeof import('../../src/db/connection.js').db;
let telegramPosts: typeof import('../../src/db/schema.js').telegramPosts;
let scheduleSlots: typeof import('../../src/db/schema.js').scheduleSlots;
let importTelegramSchedule: typeof import('../../src/services/telegram-schedule.service.js').importTelegramSchedule;
let kyivDateOf: typeof import('../../src/services/telegram-schedule.service.js').kyivDateOf;

/** Пост «щойно з каналу»: рухаємо дату від реального now, бо імпорт бере вікно останніх 14 діб. */
const publishedAt = () => new Date(Date.now() - 2 * 60 * 60 * 1000);

async function seedPost(id: string, text: string, kind: string, when: Date): Promise<void> {
  await db.insert(telegramPosts).values({
    postId: id,
    postText: text,
    publishedAt: when,
    link: `https://t.me/chernigivoblenergo/${id}`,
    kind,
  });
}

describeWithDb('автоімпорт ГПВ з Telegram-каналу', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrlOrSkip();
    process.env.ENABLE_SCHEDULER = 'false';
    process.env.USE_MOCK_ADAPTER = 'false';
    process.env.LOG_LEVEL = 'silent';
    const connection = await import('../../src/db/connection.js');
    db = connection.db;
    await ensureTestSchema();
    const schema = await import('../../src/db/schema.js');
    telegramPosts = schema.telegramPosts;
    scheduleSlots = schema.scheduleSlots;
    const service = await import('../../src/services/telegram-schedule.service.js');
    importTelegramSchedule = service.importTelegramSchedule;
    kyivDateOf = service.kyivDateOf;
  });

  beforeEach(async () => {
    await db.delete(scheduleSlots);
    await db.delete(telegramPosts);
  });

  it('бере лише пости з ГПВ і не плодить слоти з новин', async () => {
    const when = publishedAt();
    await seedPost('90001', POST_TWO_QUEUES, 'outage_schedule', when);
    await seedPost('90002', POST_NEWS, 'news', when);

    const result = await importTelegramSchedule();

    const date = kyivDateOf(when);
    const rows = await db.select().from(scheduleSlots);
    expect(rows.map((row) => `${row.queue} ${row.date} ${row.timeFrom}-${row.timeTo} ${row.source} ${row.stateCode}`).sort())
      .toEqual([
        `3/2 ${date} 18:30-22:00 telegram 3`,
        `6/2 ${date} 16:40-18:30 telegram 3`,
      ]);
    expect(result.matchedPosts).toBe(1);
    expect(rows.some((row) => row.queue === '9/9')).toBe(false);
  });

  it('повторний цикл не дублює слоти й відновлює втрачені', async () => {
    const when = publishedAt();
    await seedPost('90003', POST_TWO_QUEUES, 'outage_schedule', when);

    await importTelegramSchedule();
    const first = await db.select().from(scheduleSlots);
    await importTelegramSchedule();
    const second = await db.select().from(scheduleSlots);
    expect(second).toHaveLength(first.length);

    // «Слоти зникли» (руками, збій, чистка) — наступний цикл має їх повернути сам.
    await db.delete(scheduleSlots);
    await importTelegramSchedule();
    expect(await db.select().from(scheduleSlots)).toHaveLength(first.length);
  });

  it('не затирає ручний рядок за тією ж чергою, датою й часом', async () => {
    const when = publishedAt();
    const date = kyivDateOf(when);
    await seedPost('90004', POST_TWO_QUEUES, 'outage_schedule', when);
    await db.insert(scheduleSlots).values({
      queue: '6/2',
      date,
      timeFrom: '16:40',
      timeTo: '18:30',
      stateCode: 1,
      stateName: 'Світло є',
      stateColor: '#4CAF50',
      source: 'manual',
    });

    await importTelegramSchedule();

    const manualRows = await db
      .select()
      .from(scheduleSlots)
      .where(eq(scheduleSlots.queue, '6/2'));
    const sameSlot = manualRows.filter((row) => row.date === date && row.timeFrom === '16:40');
    expect(sameSlot).toHaveLength(1);
    expect(sameSlot[0]!.source).toBe('manual');
  });
});
