import type { FastifyInstance } from 'fastify';
import type { QueueSummary } from '@svitlo/shared';

/**
 * Область легасі-даних (Чернігівщина).
 * Раніше таблиця `street_queues` описувала лише Чернігівщину та не мала колонки `region`.
 * З міграцією 0013 таблиця підтримує `region`, тож кожна область повертає лише власні вулиці,
 * а якщо адрес для області ще немає — чесний порожній список (0 вулиць).
 */
export const LEGACY_REGION = 'chernihivska-oblast';

/**
 * Список очередей приложения — ТОЛЬКО из реальных данных: интервалы графика (schedule_slots)
 * и привязки улиц (street_queues). Перечня очередей «в коде» нет: если БД пуста, ответ пустой,
 * и UI честно говорит «графік не імпортовано», а не предлагает выдуманные черги.
 */
export type QueueSlotRow = { queue: string; slots: number; lastDate: string | null };
export type QueueStreetRow = { queue: string; streets: number };

/** Порядок «1, 1/2, 2, 2/2, 10»: сначала основная очередь, затем под-очередь. */
export function compareQueueCodes(a: string, b: string): number {
  const parse = (code: string): [number, number] => {
    const [major, minor] = code.split('/');
    return [Number(major), Number(minor ?? 0)];
  };
  const [aMajor, aMinor] = parse(a);
  const [bMajor, bMinor] = parse(b);
  if (Number.isNaN(aMajor) || Number.isNaN(bMajor)) return a.localeCompare(b);
  return aMajor - bMajor || aMinor - bMinor;
}

/** Сводит два источника в один список. Чистая функция — тестируется без БД. */
export function mergeQueues(slotsRows: QueueSlotRow[], streetRows: QueueStreetRow[]): QueueSummary[] {
  const byQueue = new Map<string, QueueSummary>();
  for (const row of slotsRows) {
    byQueue.set(row.queue, { queue: row.queue, slots: row.slots, lastDate: row.lastDate, streets: 0 });
  }
  for (const row of streetRows) {
    const existing = byQueue.get(row.queue);
    if (existing) existing.streets = row.streets;
    else byQueue.set(row.queue, { queue: row.queue, slots: 0, lastDate: null, streets: row.streets });
  }
  return [...byQueue.values()].sort((a, b) => compareQueueCodes(a.queue, b.queue));
}

/**
 * Читает очереди из БД. Импорт connection — динамический: сервис остаётся тестируемым без пула.
 *
 * `region` (cpu области) сужает выборку до слотов этой области. Без `region` — поведение v1
 * (все слоты), чтобы старые клиенты не изменились (контракт /tmp/API-CONTRACT-regions.md).
 */
export async function listQueues(region?: string): Promise<QueueSummary[]> {
  const { db } = await import('../db/connection.js');
  const { scheduleSlots, streetQueues } = await import('../db/schema.js');
  const { eq, sql } = await import('drizzle-orm');
  const slotsQuery = db
    .select({
      queue: scheduleSlots.queue,
      slots: sql<number>`count(*)::int`,
      lastDate: sql<string | null>`max(${scheduleSlots.date})::text`,
    })
    .from(scheduleSlots);
  const streetsQuery = db
    .select({ queue: streetQueues.queue, streets: sql<number>`count(*)::int` })
    .from(streetQueues);
  const [slotsRows, streetRows] = await Promise.all([
    region ? slotsQuery.where(eq(scheduleSlots.region, region)).groupBy(scheduleSlots.queue) : slotsQuery.groupBy(scheduleSlots.queue),
    region ? streetsQuery.where(eq(streetQueues.region, region)).groupBy(streetQueues.queue) : streetsQuery.groupBy(streetQueues.queue),
  ]);
  return mergeQueues(slotsRows, streetRows);
}