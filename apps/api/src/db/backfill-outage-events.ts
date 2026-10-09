/**
 * Backfill канонічної моделі подій: `outages` (рядок = адреса) → `outage_events` + `outage_event_addresses`.
 *
 * Крок 3 з skills/outage-data-core/references/migration-plan.md. Ключ події беремо з РЕАЛЬНОГО
 * `outageEventKey()`, категорію — з `outageCategoryFromReason()`: жодного дублювання цієї логіки в SQL,
 * інакше два джерела правди розійдуться. Нормалізацію адреси робить сама БД (`energy_normalize_address`),
 * щоб не мати другої реалізації нормалізації в TypeScript.
 *
 * Запуск:  pnpm --filter @energy-monitor/api db:backfill-events
 *          (еквівалент: DATABASE_URL=... pnpm --filter @energy-monitor/api exec tsx src/db/backfill-outage-events.ts)
 * Ідемпотентний: upsert за (source_id, event_key) — повторний запуск не створює нових подій.
 * Читачів не перемикає: стара таблиця `outages` не змінюється (dual-write і перемикання — кроки 4–5).
 */
import { sql } from 'drizzle-orm';
import { db } from './connection.js';
import { outages } from './schema.js';
import { outageCategoryFromReason } from '../services/outage-classification.js';
import { outageEventKey } from '../services/outage-grouping.js';
import { upsertOutageEvent, upsertOutageEventAddress } from './outage-events-writer.js';

export interface BackfillSummary {
  /** Скільки сирих рядків оператора прочитано. */
  rowsRead: number;
  /** Скільки подій у таблиці після запуску (має бути «6» на фікстурі 30 рядків). */
  events: number;
  /** Скільки адресних рядків у outage_event_addresses. */
  addresses: number;
  /** Розподіл подій за категоріями. */
  byCategory: Record<string, number>;
  /** Приклади причин, які класифікатор не зміг віднести до відомої категорії ('other'). */
  otherSamples: string[];
}

export async function backfillOutageEvents(): Promise<BackfillSummary> {
  const rows = await db.select().from(outages).orderBy(outages.startsAt);
  const otherSamples = new Set<string>();

  for (const row of rows) {
    const category = outageCategoryFromReason(row.reason);
    if (category === 'other') otherSamples.add((row.reason ?? '(порожня причина)').slice(0, 120));

    const eventKey = outageEventKey(row);

    const eventId = await upsertOutageEvent(db, {
      sourceId: row.sourceId,
      eventKey,
      category,
      reason: row.reason,
      areaName: row.areaName,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      // Статус у старій таблиці — рядок, а не час. Для 'cancelled' беремо updated_at (момент, коли стан
      // востаннє фіксувався оператором): інакше після перемикання читачів скасоване вікно знову
      // виглядало б як заплановане. Це стосується ЛИШЕ історичних рядків: реальний час скасування пише
      // ingest (markMissingEventsCancelled), і в минуле його не відновити.
      cancelledAt: row.status === 'cancelled' ? row.updatedAt : null,
      externalId: row.externalId,
    });

    await upsertOutageEventAddress(db, eventId, row.addressesRaw);
  }

  const [totals] = (await db.execute(sql`
    SELECT (SELECT count(*)::int FROM outage_events) AS events,
           (SELECT count(*)::int FROM outage_event_addresses) AS addresses
  `)) as unknown as [{ events: number; addresses: number }];

  const categoryRows = (await db.execute(sql`
    SELECT category, count(*)::int AS count FROM outage_events GROUP BY category ORDER BY category
  `)) as unknown as Array<{ category: string; count: number }>;

  return {
    rowsRead: rows.length,
    events: totals?.events ?? 0,
    addresses: totals?.addresses ?? 0,
    byCategory: Object.fromEntries(categoryRows.map((row) => [row.category, row.count])),
    otherSamples: [...otherSamples].slice(0, 5),
  };
}

/** Запуск файлу напряму (tsx / node dist): друкує підсумок і закриває з'єднання. */
const entry = process.argv[1] ?? '';
if (/backfill-outage-events\.(ts|js)$/.test(entry)) {
  backfillOutageEvents()
    .then(async (summary) => {
      console.log('[backfill] outage_events:', JSON.stringify(summary));
      if (summary.otherSamples.length > 0) {
        console.warn('[backfill] unclassified ("other") reasons:', summary.otherSamples.join(' | '));
      }
      await db.$client.end();
      process.exit(0);
    })
    .catch(async (error) => {
      console.error('[backfill] failed:', error);
      await db.$client.end();
      process.exit(1);
    });
}
