/**
 * Довідник населених пунктів і їхніх черг — «моє село → моя черга» (міграція 0015).
 *
 * Навіщо: ГПВ задається не вулицею, а населеним пунктом + чергою. Людина має знайти своє село
 * (пошук за 2+ символами) і побачити саме свою чергу та сьогоднішні вікна відключень.
 *
 * Правила:
 * 1. Нічого не вигадуємо: немає прив'язок у БД → `queues: []`, немає слотів → `hasScheduleToday: false`.
 * 2. Персональних даних немає: лише назви населених пунктів і коди черг.
 * 3. Час і дата — київські (Europe/Kyiv), не UTC.
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { scheduleSlots, settlementQueues, settlements } from '../db/schema.js';
import { timeToMinutes } from './data-quality.js';

export type SettlementKind = 'місто' | 'смт' | 'село';

const KIND_ALIASES: Record<string, SettlementKind> = {
  м: 'місто', місто: 'місто', city: 'місто', город: 'місто',
  смт: 'смт', с: 'село', село: 'село', village: 'село', селище: 'смт',
};

/** Київська календарна дата YYYY-MM-DD. */
export function kyivDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

/** Київський настінний час HH:MM. */
export function kyivTime(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Kyiv', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(now);
}

/**
 * Нормалізація назви населеного пункту для пошуку й дедуплікації:
 * нижній регістр, уніфіковані апострофи (`’ʼ´` → `'`) і дефіси (`—–` → `-`), без префіксів
 * «с.», «смт», «м.», «село», «селище», без крапок і зайвих пробілів.
 */
export function normalizeSettlementName(raw: string): string {
  return String(raw ?? '')
    .trim()
    .toLocaleLowerCase('uk-UA')
    .replace(/[’ʼ`´]/gu, "'")
    .replace(/[—–]/gu, '-')
    .replace(/^(?:с|смт|м|село|селище|села|селища)\.?\s+/iu, '')
    .replace(/\./gu, '')
    .replace(/[,\s]+/gu, ' ')
    .trim();
}

/** Тип населеного пункту з довільного рядка джерела; невідоме → null (не вигадуємо). */
export function normalizeSettlementKind(raw: unknown): SettlementKind | null {
  const value = String(raw ?? '').trim().toLocaleLowerCase('uk-UA').replace(/\./gu, '');
  return KIND_ALIASES[value] ?? null;
}

export type SettlementListItem = {
  id: string;
  region: string;
  name: string;
  kind: SettlementKind | null;
  queues: string[];
};

export type SettlementQueueItem = {
  queue: string;
  source: string;
  /** ISO-час останнього підтвердження прив'язки джерелом. */
  lastSeenAt: string;
  /** Чи є в БД хоч якийсь слот цієї черги на сьогодні (київська доба). */
  hasScheduleToday: boolean;
  /** Найближче майбутнє вікно відключення сьогодні; null — даних немає. */
  nextOutage: { date: string; timeFrom: string; timeTo: string } | null;
};

export type SettlementQueuesResult = {
  settlement: { id: string; region: string; name: string; kind: SettlementKind | null };
  queues: SettlementQueueItem[];
};

/** Пошук населених пунктів області за підрядком (мінімум 2 символи після нормалізації). */
export async function searchSettlements(
  region: string,
  query: string,
  limit: number,
): Promise<{ items: SettlementListItem[]; total: number }> {
  const normalized = normalizeSettlementName(query);
  if (normalized.length < 2) return { items: [], total: 0 };
  const pattern = `%${normalized}%`;
  const where = and(eq(settlements.region, region), sql`${settlements.nameNormalized} LIKE ${pattern}`);

  const [rows, countRows] = await Promise.all([
    db
      .select({ id: settlements.id, region: settlements.region, name: settlements.name, kind: settlements.kind })
      .from(settlements)
      .where(where)
      .orderBy(asc(settlements.name))
      .limit(limit),
    db.select({ total: sql<number>`count(*)::int` }).from(settlements).where(where),
  ]);

  const ids = rows.map((row) => row.id);
  const queueRows = ids.length
    ? await db
        .select({ settlementId: settlementQueues.settlementId, queue: settlementQueues.queue })
        .from(settlementQueues)
        .where(inArray(settlementQueues.settlementId, ids))
        .orderBy(asc(settlementQueues.queue))
    : [];

  const bySettlement = new Map<string, string[]>();
  for (const row of queueRows) {
    const list = bySettlement.get(row.settlementId) ?? [];
    if (!list.includes(row.queue)) list.push(row.queue);
    bySettlement.set(row.settlementId, list);
  }

  return {
    items: rows.map((row) => ({
      id: row.id,
      region: row.region,
      name: row.name,
      kind: (row.kind as SettlementKind | null) ?? null,
      queues: bySettlement.get(row.id) ?? [],
    })),
    total: countRows[0]?.total ?? rows.length,
  };
}

/** Черги населеного пункту + сьогоднішні вікна відключень (київська доба). Немає даних → чесно false/null. */
export async function getSettlementQueues(id: string, now: Date = new Date()): Promise<SettlementQueuesResult | null> {
  const [settlement] = await db
    .select({ id: settlements.id, region: settlements.region, name: settlements.name, kind: settlements.kind })
    .from(settlements)
    .where(eq(settlements.id, id))
    .limit(1);
  if (!settlement) return null;

  const rows = await db
    .select({ queue: settlementQueues.queue, source: settlementQueues.source, lastSeenAt: settlementQueues.lastSeenAt })
    .from(settlementQueues)
    .where(eq(settlementQueues.settlementId, id))
    .orderBy(asc(settlementQueues.queue), asc(settlementQueues.source));

  const queueCodes = [...new Set(rows.map((row) => row.queue))];
  const today = kyivDate(now);
  const nowMinutes = timeToMinutes(kyivTime(now), false) ?? 0;

  const slotRows = queueCodes.length
    ? await db
        .select({ queue: scheduleSlots.queue, timeFrom: scheduleSlots.timeFrom, timeTo: scheduleSlots.timeTo })
        .from(scheduleSlots)
        .where(and(eq(scheduleSlots.region, settlement.region), eq(scheduleSlots.date, today), inArray(scheduleSlots.queue, queueCodes)))
        .orderBy(asc(scheduleSlots.timeFrom))
    : [];

  const slotsByQueue = new Map<string, Array<{ timeFrom: string; timeTo: string }>>();
  for (const slot of slotRows) {
    const list = slotsByQueue.get(slot.queue) ?? [];
    list.push({ timeFrom: slot.timeFrom, timeTo: slot.timeTo });
    slotsByQueue.set(slot.queue, list);
  }

  const queues: SettlementQueueItem[] = rows.map((row) => {
    const slotsForQueue = slotsByQueue.get(row.queue) ?? [];
    const upcoming = slotsForQueue
      .map((slot) => ({ slot, start: timeToMinutes(slot.timeFrom, false), end: timeToMinutes(slot.timeTo, true) }))
      .filter((item) => item.start !== null && item.end !== null && item.end > nowMinutes)
      .sort((a, b) => (a.start ?? 0) - (b.start ?? 0))[0];
    return {
      queue: row.queue,
      source: row.source,
      lastSeenAt: row.lastSeenAt.toISOString(),
      hasScheduleToday: slotsForQueue.length > 0,
      nextOutage: upcoming ? { date: today, timeFrom: upcoming.slot.timeFrom, timeTo: upcoming.slot.timeTo } : null,
    };
  });

  return {
    settlement: {
      id: settlement.id,
      region: settlement.region,
      name: settlement.name,
      kind: (settlement.kind as SettlementKind | null) ?? null,
    },
    queues,
  };
}

/** Ідемпотентний upsert населеного пункту (ключ — region + нормалізована назва). */
export async function upsertSettlement(input: {
  region: string;
  name: string;
  kind?: SettlementKind | null;
  source: string;
  sourceRef?: string | null;
}): Promise<{ id: string } | null> {
  const nameNormalized = normalizeSettlementName(input.name);
  if (!nameNormalized) return null;
  const [row] = await db
    .insert(settlements)
    .values({
      region: input.region,
      name: input.name.trim(),
      nameNormalized,
      kind: input.kind ?? null,
      source: input.source,
      sourceRef: input.sourceRef ?? null,
    })
    .onConflictDoUpdate({
      target: [settlements.region, settlements.nameNormalized],
      set: {
        // Назву беремо як у джерела; тип і sourceRef НЕ затираємо порожнім значенням.
        name: sql`excluded.name`,
        kind: sql`coalesce(excluded.kind, ${settlements.kind})`,
        sourceRef: sql`coalesce(excluded.source_ref, ${settlements.sourceRef})`,
        updatedAt: sql`now()`,
      },
    })
    .returning({ id: settlements.id });
  return row ?? null;
}

/** Ідемпотентний upsert прив'язки «населений пункт → черга» (оновлює last_seen_at). */
export async function upsertSettlementQueue(input: {
  region: string;
  settlementId: string;
  queue: string;
  source: string;
  sourceRef?: string | null;
}): Promise<void> {
  await db
    .insert(settlementQueues)
    .values({
      region: input.region,
      settlementId: input.settlementId,
      queue: input.queue,
      source: input.source,
      sourceRef: input.sourceRef ?? null,
    })
    .onConflictDoUpdate({
      target: [settlementQueues.settlementId, settlementQueues.queue, settlementQueues.source],
      set: { lastSeenAt: sql`now()`, sourceRef: sql`coalesce(excluded.source_ref, ${settlementQueues.sourceRef})` },
    });
}
