import { normalizeAddressQuery } from '../parsers/address-matcher.js';
import { streetQueues } from '../db/schema.js';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { StreetQueuePair, StreetScheduleData } from '@svitlo/shared';
import { getQueueSchedule, getQueueScheduleMeta } from './schedule-import.service.js';
import { isAllClear, mirrorDayCoverage, peekMirrorSnapshot } from './mirror-schedule.service.js';
import { DEFAULT_REGION } from './regions.service.js';

function toPair(row: { streetNormalized: string; streetName: string; queue: string; updatedAt: Date | string; region?: string }): StreetQueuePair {
  return {
    streetNormalized: row.streetNormalized,
    streetName: row.streetName,
    queue: row.queue,
    updatedAt: new Date(row.updatedAt).toISOString(),
    region: row.region,
  };
}

export async function listStreetQueues(region = DEFAULT_REGION): Promise<StreetQueuePair[]> {
  const { db } = await import('../db/connection.js');
  const rows = await db
    .select()
    .from(streetQueues)
    .where(eq(streetQueues.region, region))
    .orderBy(asc(streetQueues.streetName));
  return rows.map(toPair);
}

export async function findStreetQueue(street: string, region = DEFAULT_REGION): Promise<StreetQueuePair | null> {
  const { db } = await import('../db/connection.js');
  const normalized = normalizeAddressQuery(street);
  if (!normalized) return null;
  const [row] = await db
    .select()
    .from(streetQueues)
    .where(and(eq(streetQueues.region, region), eq(streetQueues.streetNormalized, normalized)))
    .limit(1);
  return row ? toPair(row) : null;
}

/** Создаёт или перезаписывает пару «улица → очередь». Ключ — (region, street_normalized). */
export async function upsertStreetQueue(street: string, queue: string, region = DEFAULT_REGION): Promise<StreetQueuePair> {
  const { db } = await import('../db/connection.js');
  const normalized = normalizeAddressQuery(street);
  if (!normalized) throw new Error('Не удалось нормализовать название улицы');
  const streetName = street.trim();
  const [row] = await db
    .insert(streetQueues)
    .values({ region, streetNormalized: normalized, streetName, queue })
    .onConflictDoUpdate({
      target: [streetQueues.region, streetQueues.streetNormalized],
      set: { streetName, queue, updatedAt: sql`now()` },
    })
    .returning();
  return toPair(row!);
}

export async function removeStreetQueue(streetNormalized: string, region = DEFAULT_REGION): Promise<boolean> {
  const { db } = await import('../db/connection.js');
  const normalized = normalizeAddressQuery(streetNormalized);
  const removed = await db
    .delete(streetQueues)
    .where(and(eq(streetQueues.region, region), eq(streetQueues.streetNormalized, normalized)))
    .returning({ key: streetQueues.streetNormalized });
  return removed.length > 0;
}

/**
 * Возвращает график привязанной к улице очереди. Если улица не привязана —
 * queue = null и пустые интервалы (страница покажет подсказку).
 *
 * `covered`/`allClear` повторяют логику `routes/schedules.ts`: пустой список интервалов значит либо
 * «оператор опубликовал ГПВ, а отключений нет», либо «на эту дату не публиковали». Кеш зеркала
 * читается без сети — холодный кеш честно даёт `covered: false`, то есть «не знаем».
 */
export async function getStreetSchedule(street: string, date: string, region = DEFAULT_REGION): Promise<StreetScheduleData> {
  const normalized = normalizeAddressQuery(street);
  const pair = normalized ? await findStreetQueue(street, region) : null;
  const queue = pair?.queue ?? null;
  if (!queue) {
    return { street, streetNormalized: normalized, queue: null, date, intervals: [], source: null, lastImportedAt: null, region };
  }
  const [meta, intervals] = await Promise.all([
    getQueueScheduleMeta(queue, date, region),
    getQueueSchedule(queue, date, region),
  ]);
  const snapshot = peekMirrorSnapshot();
  const coverage = snapshot ? mirrorDayCoverage(snapshot.payload, region, date) : null;
  const covered = (coverage?.queues.includes(queue) ?? false) || meta.source !== null;
  return {
    street,
    streetNormalized: normalized,
    queue,
    date,
    intervals,
    source: meta.source,
    lastImportedAt: meta.lastImportedAt,
    region,
    covered,
    allClear: isAllClear(coverage, queue, intervals.length),
  };
}
