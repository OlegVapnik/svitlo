import { normalizeAddressQuery } from '../parsers/address-matcher.js';
import { db } from '../db/connection.js';
import { streetQueues } from '../db/schema.js';
import { asc, eq, sql } from 'drizzle-orm';
import type { StreetQueuePair } from '@svitlo/shared';
import { getQueueSchedule, getQueueScheduleMeta } from './schedule-import.service.js';
import type { StreetScheduleData } from '@svitlo/shared';

function toPair(row: { streetNormalized: string; streetName: string; queue: string; updatedAt: Date | string }): StreetQueuePair {
  return {
    streetNormalized: row.streetNormalized,
    streetName: row.streetName,
    queue: row.queue,
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

export async function listStreetQueues(): Promise<StreetQueuePair[]> {
  const rows = await db.select().from(streetQueues).orderBy(asc(streetQueues.streetName));
  return rows.map(toPair);
}

export async function findStreetQueue(street: string): Promise<StreetQueuePair | null> {
  const normalized = normalizeAddressQuery(street);
  if (!normalized) return null;
  const [row] = await db.select().from(streetQueues).where(eq(streetQueues.streetNormalized, normalized)).limit(1);
  return row ? toPair(row) : null;
}

/** Создаёт или перезаписывает пару «улица → очередь». Ключ — нормализованное имя. */
export async function upsertStreetQueue(street: string, queue: string): Promise<StreetQueuePair> {
  const normalized = normalizeAddressQuery(street);
  if (!normalized) throw new Error('Не удалось нормализовать название улицы');
  const streetName = street.trim();
  const [row] = await db
    .insert(streetQueues)
    .values({ streetNormalized: normalized, streetName, queue })
    .onConflictDoUpdate({
      target: streetQueues.streetNormalized,
      set: { streetName, queue, updatedAt: sql`now()` },
    })
    .returning();
  return toPair(row!);
}

export async function removeStreetQueue(streetNormalized: string): Promise<boolean> {
  const normalized = normalizeAddressQuery(streetNormalized);
  const removed = await db.delete(streetQueues).where(eq(streetQueues.streetNormalized, normalized)).returning({ key: streetQueues.streetNormalized });
  return removed.length > 0;
}

/**
 * Возвращает график привязанной к улице очереди. Если улица не привязана —
 * queue = null и пустые интервалы (страница покажет подсказку).
 */
export async function getStreetSchedule(street: string, date: string): Promise<StreetScheduleData> {
  const normalized = normalizeAddressQuery(street);
  const pair = normalized ? await findStreetQueue(street) : null;
  const queue = pair?.queue ?? null;
  if (!queue) {
    return { street, streetNormalized: normalized, queue: null, date, intervals: [], demo: false, source: null, lastImportedAt: null };
  }
  const [meta, intervals] = await Promise.all([getQueueScheduleMeta(queue, date), getQueueSchedule(queue, date)]);
  return {
    street,
    streetNormalized: normalized,
    queue,
    date,
    intervals,
    demo: false,
    source: meta.source,
    lastImportedAt: meta.lastImportedAt,
  };
}
