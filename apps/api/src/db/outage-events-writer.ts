/**
 * Запис канонічної моделі подій (`outage_events` + `outage_event_addresses`) — ЄДИНЕ місце, де ці
 * таблиці наповнюються. Користуються ним обидва шляхи: backfill (історія) і parse.service (dual-write
 * на ingest), інакше ключ події та категорія розійшлися б між двома джерелами правди
 * (invariant 3 у skills/outage-data-core).
 *
 * Функції приймають «executor»: сам `db` або `tx` із `db.transaction()`. Завдяки цьому ingest пише
 * події В ТІЙ САМІЙ транзакції, що й старий upsert `outages` (крок 4 плану: dual-write).
 */
import { and, eq, gt, isNull, notInArray, sql } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { outageEvents } from './schema.js';
import type { OutageEventCategory } from '../services/outage-classification.js';

/**
 * Верхний тип для параметра-исполнителя: принимает и `db` (типизированный схемой),
 * и `tx` из транзакции, и пул тестовой БД, не теряя тип таблиц на месте вызовов.
 */
export type Database = PgDatabase<PgQueryResultHKT, any, any>;

/** Набір методів, спільний для `db` і для транзакції drizzle, — щоб не плодити окремі підписи. */
export type DbExecutor = Database;

export interface OutageEventInput {
  sourceId: string;
  /** З `outageEventKey()`: ідентичність події БЕЗ адрес (саме вона згортає 30 рядків у 6 подій). */
  eventKey: string;
  category: OutageEventCategory;
  reason: string | null;
  areaName: string;
  startsAt: Date;
  /** NULL = без дати завершення (відкрита аварія). */
  endsAt: Date | null;
  /**
   * Час, коли подію СКАСОВАНО, якщо це реально спостережено (див. markMissingEventsCancelled).
   * Ніколи не виводимо його з `updated_at`: це була б вигадка, а не факт.
   */
  cancelledAt: Date | null;
  externalId: string | null;
}

/** Upsert події за (source_id, event_key): злиття вікон — найраніший старт, найпізніше завершення. */
export async function upsertOutageEvent(executor: DbExecutor, input: OutageEventInput): Promise<string> {
  const [event] = await executor
    .insert(outageEvents)
    .values({
      sourceId: input.sourceId,
      eventKey: input.eventKey,
      category: input.category,
      reason: input.reason,
      areaName: input.areaName,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      cancelledAt: input.cancelledAt,
      externalId: input.externalId,
    })
    .onConflictDoUpdate({
      target: [outageEvents.sourceId, outageEvents.eventKey],
      set: {
        category: sql`excluded.category`,
        // Злиття за планом: найраніший старт і найпізніше завершення.
        // GREATEST/LEAST ігнорують NULL, тому «без завершення» не губиться.
        startsAt: sql`least(${outageEvents.startsAt}, excluded.starts_at)`,
        endsAt: sql`greatest(${outageEvents.endsAt}, excluded.ends_at)`,
        // Перше відоме скасування не перезаписуємо: cancelled_at — час ПЕРШОГО спостереження.
        cancelledAt: sql`coalesce(${outageEvents.cancelledAt}, excluded.cancelled_at)`,
        updatedAt: sql`now()`,
      },
    })
    .returning({ id: outageEvents.id });

  if (!event) throw new Error(`upsert into outage_events failed for key "${input.eventKey}"`);
  return event.id;
}

/** Додає адресу до події. Нормалізацію робить БД (`energy_normalize_address`) — одна реалізація. */
export async function upsertOutageEventAddress(
  executor: DbExecutor,
  eventId: string,
  addressRaw: string,
): Promise<void> {
  await executor.execute(sql`
    INSERT INTO outage_event_addresses (event_id, address_raw, address_normalized)
    VALUES (${eventId}, ${addressRaw}, energy_normalize_address(${addressRaw}))
    ON CONFLICT DO NOTHING
  `);
}

/**
 * Позначає скасованими події джерела, яких більше НЕМАЄ у стрічці оператора, хоч вони ще не почалися:
 * оператор перепублікував графік без цього вікна. `cancelled_at` — момент, коли скасування ВПЕРШЕ
 * побачив парсер (переданий `now`), а не `updated_at` рядка.
 *
 * Викликати лише для повної стрічки: порожня чи часткова відповідь оператора — це НЕ скасування,
 * інакше один мережевий збій скасував би весь графік (тому порожній список ключів нічого не робить).
 *
 * Запит зібрано query builder-ом, а не сирим `sql`-шаблоном: у сирому шаблоні drizzle передає
 * параметри драйверу як є, і postgres.js 3.4 падає на Date-параметрі («The "string" argument must
 * be a string... Received an instance of Date»). ORM-шлях мапить дату в ISO-рядок для колонки.
 */
export async function markMissingEventsCancelled(
  executor: DbExecutor,
  sourceId: string,
  seenEventKeys: string[],
  now: Date,
  scope?: { areaName?: string; eventKeyPrefix?: string },
): Promise<number> {
  if (seenEventKeys.length === 0) return 0;
  const cancelled = await executor
    .update(outageEvents)
    .set({ cancelledAt: now, updatedAt: now })
    .where(
      and(
        eq(outageEvents.sourceId, sourceId),
        isNull(outageEvents.cancelledAt),
        gt(outageEvents.startsAt, now),
        scope?.areaName ? eq(outageEvents.areaName, scope.areaName) : undefined,
        scope?.eventKeyPrefix ? sql`${outageEvents.eventKey} LIKE ${`${scope.eventKeyPrefix}%`}` : undefined,
        notInArray(outageEvents.eventKey, seenEventKeys),
      ),
    )
    .returning({ id: outageEvents.id });

  return cancelled.length;
}
