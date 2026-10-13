import type { OperatorScheduleLivePayload, ScheduleIntervalUtc } from '@svitlo/shared';
import { kyivOffsetMinutes } from './schedule-normalizer.js';

export type ScheduleImportResult = { queue: string; date: string; imported: number; mergedIntervals: number };

export function localTimeForUtc(iso: string, date: string): string {
  const shifted = new Date(Date.parse(iso) + kyivOffsetMinutes(date) * 60_000);
  return `${String(shifted.getUTCHours()).padStart(2, '0')}:${String(shifted.getUTCMinutes()).padStart(2, '0')}`;
}

/**
 * Импорт графика. Персональные данные из ответов не принимаются и не сохраняются;
 * в БД попадают только aData (интервалы) и aState (названия/цвета).
 * `payload.aData === null` (жива відповідь оператора «ГПВ на цю дату немає») — це 0 слотів, не помилка.
 */
export async function importOperatorSchedule(
  queue: string,
  date: string,
  payload: OperatorScheduleLivePayload,
  /** 'manual' — людина вставила JSON; 'operator' — автозавантаження з /api/info_schedule (без капчі). */
  source: 'manual' | 'operator' = 'manual',
): Promise<ScheduleImportResult> {
  const mergedRawSlots = mergeRawScheduleSlots(payload);

  const { db } = await import('../db/connection.js');
  const { scheduleSlots } = await import('../db/schema.js');
  const { and, eq } = await import('drizzle-orm');
  await db.transaction(async (tx) => {
    await tx.delete(scheduleSlots).where(and(eq(scheduleSlots.queue, queue), eq(scheduleSlots.date, date)));
    for (const slot of mergedRawSlots) {
      await tx.insert(scheduleSlots).values({
        queue, date, timeFrom: slot.time_from, timeTo: slot.time_to,
        stateCode: slot.queue, stateName: slot.stateName, stateColor: slot.stateColor, source,
      });
    }
  });

  return { queue, date, imported: payload.aData?.length ?? 0, mergedIntervals: mergedRawSlots.length };
}

export function mergeRawScheduleSlots(payload: OperatorScheduleLivePayload) {
  const result: Array<{ time_from: string; time_to: string; queue: 1 | 2 | 3; stateName: string; stateColor: string }> = [];
  // `aData: null` = «графіка на цю чергу/дату немає» (жива відповідь оператора) — це не помилка.
  for (const slot of payload.aData ?? []) {
    const previous = result.at(-1);
    // Невідомий код стану не має ламати імпорт: підписуємо нейтрально (як normalizeScheduleResponse).
    const state = payload.aState[String(slot.queue)] ?? { name: String(slot.queue), color: '#AFAFAF' };
    const stateCode = Number(slot.queue) as 1 | 2 | 3;
    if (previous && previous.queue === stateCode && previous.time_to === slot.time_from) {
      previous.time_to = slot.time_to;
    } else {
      result.push({ time_from: slot.time_from, time_to: slot.time_to, queue: stateCode, stateName: state.name, stateColor: state.color });
    }
  }
  return result;
}

export type QueueScheduleMeta = { count: number; source: string | null; lastImportedAt: string | null };

/**
 * Типова область застосунку (з конфіга) — читаємо ЛІНИВО: цей модуль імпортують юніт-тести
 * нормалізації, які працюють без DATABASE_URL, а статичний імпорт `config.js` упав би вже на імпорті
 * (zod-схема вимагає DATABASE_URL). Так само ліниво тут підключається й `db/connection.js`.
 */
async function defaultRegion(): Promise<string> {
  const { env } = await import('../config.js');
  return env.MIRROR_SCHEDULE_REGION;
}

/**
 * Метаданные импорта по очереди/дате: количество слотов, источник и время последнего импорта.
 *
 * `region` (cpu области) — типова область застосунку, якщо не передано. Без нього кількість і джерело
 * змішували б «2/2 Чернігівської» і «2/2 Львівської» в одне число, поэтому фільтр за областю обовʼязковий.
 *
 * Важна умова: если для (region, queue, date) слотов НЕТ, но хотя бы для (region, date) в БД слоты ЕСТЬ
 * (по любой очереди), то это означает «график для области опубликован, но для этой очереди на эту дату
 * отключений не запланировано» (source не null, count=0). Если же слотов нет совсем — source=null.
 */
export async function getQueueScheduleMeta(
  queue: string,
  date: string,
  region?: string,
): Promise<QueueScheduleMeta> {
  const targetRegion = region ?? (await defaultRegion());
  const { db } = await import('../db/connection.js');
  const { scheduleSlots } = await import('../db/schema.js');
  const { and, eq, desc, inArray, sql } = await import('drizzle-orm');
  // Варіанти одного коду черги: «2/2», «2.2», «2_2» — нечутливий пошук по роздільнику.
  const queueVariants = [
    queue,
    queue.replace('/', '.').replace('_', '.'),
    queue.replace('/', '_').replace('.', '_'),
  ].filter((value, index, self) => self.indexOf(value) === index);
  // 1. Сначала пытаемся найти слоты для конкретной очереди
  const rows = await db
    .select({ source: scheduleSlots.source, createdAt: scheduleSlots.createdAt })
    .from(scheduleSlots)
    .where(and(eq(scheduleSlots.region, targetRegion), inArray(scheduleSlots.queue, queueVariants), eq(scheduleSlots.date, date)))
    .orderBy(desc(scheduleSlots.createdAt));
  const latest = rows[0];
  if (latest) return { count: rows.length, source: latest.source, lastImportedAt: latest.createdAt.toISOString() };
  // 2. Если для конкретной очереди слотов нет — проверяем, есть ли вообще данные региона на эту дату
  const [anySlot] = await db
    .select({ source: scheduleSlots.source, createdAt: scheduleSlots.createdAt })
    .from(scheduleSlots)
    .where(and(eq(scheduleSlots.region, targetRegion), eq(scheduleSlots.date, date)))
    .orderBy(desc(scheduleSlots.createdAt))
    .limit(1);
  if (anySlot) {
    // Данные региона есть: отключений для этой очереди не запланировано — не null, не «не импортовано»
    return { count: 0, source: anySlot.source, lastImportedAt: anySlot.createdAt.toISOString() };
  }
  // 3. Совсем нет данных региона на эту дату
  return { count: 0, source: null, lastImportedAt: null };
}

/**
 * Слоти однієї області/черги/дати у UTC. Невідома область дає порожній масив — це не помилка
 * (контракт: невідома область = чесний порожній графік, а не чужий).
 *
 * Пошук НЕчутливий до роздільника черги: «2/2», «2.2» і «2_2» — один і той самий код. Це потрібно,
 * бо дзеркало та провайдери можуть віддавати `2.2`, а UI та канонічний формат використовують `2/2`.
 * При записі всі сервіси нормалізують очередь через `normalizeQueueCode` до `2/2`, але при читанні
 * скасовуємо помилки старих/чужих рядків.
 */
export async function getQueueSchedule(
  queue: string,
  date: string,
  region?: string,
): Promise<ScheduleIntervalUtc[]> {
  const targetRegion = region ?? (await defaultRegion());
  const { db } = await import('../db/connection.js');
  const { scheduleSlots } = await import('../db/schema.js');
  const { and, eq, inArray } = await import('drizzle-orm');
  // Варіанти одного коду черги: «2/2», «2.2», «2_2» — нечутливий пошук по роздільнику.
  const queueVariants = [
    queue,
    queue.replace('/', '.').replace('_', '.'),
    queue.replace('/', '_').replace('.', '_'),
  ].filter((value, index, self) => self.indexOf(value) === index);
  const rows = await db
    .select()
    .from(scheduleSlots)
    .where(and(eq(scheduleSlots.region, targetRegion), inArray(scheduleSlots.queue, queueVariants), eq(scheduleSlots.date, date)));
  const toUtc = (time: string, end: boolean) => {
    if (end && time === '00:00') {
      const nextDay = new Date(`${date}T00:00:00Z`);
      nextDay.setUTCDate(nextDay.getUTCDate() + 1);
      const nextLocalDate = `${nextDay.getUTCFullYear()}-${String(nextDay.getUTCMonth() + 1).padStart(2, '0')}-${String(nextDay.getUTCDate()).padStart(2, '0')}`;
      return new Date(Date.parse(`${nextLocalDate}T00:00:00Z`) - kyivOffsetMinutes(nextLocalDate) * 60_000).toISOString();
    }
    const [year, month, day] = date.split('-').map(Number);
    const [hour, minute] = time.split(':').map(Number);
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const target = Date.UTC(year!, month! - 1, day!, hour!, minute!);
    let guess = target;
    for (let i = 0; i < 3; i++) {
      const parts = Object.fromEntries(formatter.formatToParts(new Date(guess)).map((part) => [part.type, part.value]));
      const represented = Date.UTC(Number(parts['year']), Number(parts['month']) - 1, Number(parts['day']), Number(parts['hour']), Number(parts['minute']));
      const delta = target - represented;
      if (!delta) break;
      guess += delta;
    }
    return new Date(guess).toISOString();
  };
  return rows.map((row) => ({
    startsAt: toUtc(row.timeFrom, false),
    endsAt: toUtc(row.timeTo, true),
    stateCode: row.stateCode as 1 | 2 | 3,
    stateName: row.stateName,
    stateColor: row.stateColor,
  }));
}
