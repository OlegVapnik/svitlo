import type { OperatorScheduleResponse, ScheduleIntervalUtc } from '@svitlo/shared';
import { kyivOffsetMinutes } from './schedule-normalizer.js';

export type ScheduleImportResult = { queue: string; date: string; imported: number; mergedIntervals: number };

export function localTimeForUtc(iso: string, date: string): string {
  const shifted = new Date(Date.parse(iso) + kyivOffsetMinutes(date) * 60_000);
  return `${String(shifted.getUTCHours()).padStart(2, '0')}:${String(shifted.getUTCMinutes()).padStart(2, '0')}`;
}

/**
 * Импорт ручного графика. Персональные данные из ответов не принимаются и не сохраняются;
 * в БД попадают только aData (интервалы) и aState (названия/цвета).
 */
export async function importOperatorSchedule(
  queue: string,
  date: string,
  payload: OperatorScheduleResponse,
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
        stateCode: slot.queue, stateName: slot.stateName, stateColor: slot.stateColor, source: 'manual',
      });
    }
  });

  return { queue, date, imported: payload.aData.length, mergedIntervals: mergedRawSlots.length };
}

export function mergeRawScheduleSlots(payload: OperatorScheduleResponse) {
  const result: Array<{ time_from: string; time_to: string; queue: 1 | 2 | 3; stateName: string; stateColor: string }> = [];
  for (const slot of payload.aData) {
    const previous = result.at(-1);
    const state = payload.aState[String(slot.queue)]!;
    const stateCode = slot.queue as 1 | 2 | 3;
    if (previous && previous.queue === stateCode && previous.time_to === slot.time_from) {
      previous.time_to = slot.time_to;
    } else {
      result.push({ time_from: slot.time_from, time_to: slot.time_to, queue: stateCode, stateName: state.name, stateColor: state.color });
    }
  }
  return result;
}

export type QueueScheduleMeta = { count: number; source: string | null; lastImportedAt: string | null };

/** Метаданные импорта по очереди/дате: количество слотов, источник и время последнего импорта. */
export async function getQueueScheduleMeta(queue: string, date: string): Promise<QueueScheduleMeta> {
  const { db } = await import('../db/connection.js');
  const { scheduleSlots } = await import('../db/schema.js');
  const { and, eq, desc } = await import('drizzle-orm');
  const rows = await db
    .select({ source: scheduleSlots.source, createdAt: scheduleSlots.createdAt })
    .from(scheduleSlots)
    .where(and(eq(scheduleSlots.queue, queue), eq(scheduleSlots.date, date)))
    .orderBy(desc(scheduleSlots.createdAt));
  const latest = rows[0];
  if (!latest) return { count: 0, source: null, lastImportedAt: null };
  return { count: rows.length, source: latest.source, lastImportedAt: latest.createdAt.toISOString() };
}

export async function getQueueSchedule(queue: string, date: string): Promise<ScheduleIntervalUtc[]> {
  const { db } = await import('../db/connection.js');
  const { scheduleSlots } = await import('../db/schema.js');
  const { and, eq } = await import('drizzle-orm');
  const rows = await db.select().from(scheduleSlots).where(and(eq(scheduleSlots.queue, queue), eq(scheduleSlots.date, date)));
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
