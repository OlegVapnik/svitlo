import type { SubscriberPlace } from '@svitlo/shared';

/** Строка довідника → ответ API. Ни ПІБ, ни номера квартир в довіднику не зберігаються. */
function toPlace(row: { account: string; street: string; queue: string; updatedAt: Date | string }): SubscriberPlace {
  return {
    account: row.account,
    street: row.street,
    queue: row.queue,
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

/**
 * Ищет адрес и чергу по особовому рахунку (довідник subscriber_places).
 * Импорт connection-а динамический: сервис остаётся тестируемым без пула соединений.
 */
export async function findPlaceByAccount(account: string): Promise<SubscriberPlace | null> {
  const { db } = await import('../db/connection.js');
  const { subscriberPlaces } = await import('../db/schema.js');
  const { eq } = await import('drizzle-orm');
  const [row] = await db
    .select()
    .from(subscriberPlaces)
    .where(eq(subscriberPlaces.account, account.trim()))
    .limit(1);
  return row ? toPlace(row) : null;
}

/** Создаёт или перезаписывает запись довідника. Ключ — сам номер рахунку. */
export async function upsertPlace(account: string, street: string, queue: string): Promise<SubscriberPlace> {
  const { db } = await import('../db/connection.js');
  const { subscriberPlaces } = await import('../db/schema.js');
  const { sql } = await import('drizzle-orm');
  const [row] = await db
    .insert(subscriberPlaces)
    .values({ account: account.trim(), street: street.trim(), queue: queue.trim() })
    .onConflictDoUpdate({
      target: subscriberPlaces.account,
      set: { street: street.trim(), queue: queue.trim(), updatedAt: sql`now()` },
    })
    .returning();
  return toPlace(row!);
}