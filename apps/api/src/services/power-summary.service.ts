import { and, gte, lte, isNull, or, sql } from 'drizzle-orm';
import type { PowerSummary, PowerWindowSummary } from '@svitlo/shared';
import { db } from '../db/connection.js';
import { outageEvents } from '../db/schema.js';
import { computeWindowSummary, kyivDayStart } from './power-summary.js';


/** Рахує підсумок по вікну (без світла / зі світлом / надійність) на основі КАНОНИЧНЫХ данных. */
export async function summarizeWindow(label: string, start: Date, end: Date): Promise<PowerWindowSummary> {
  const now = new Date();
  const rows = await db
    .select({
      startsAt: outageEvents.startsAt,
      endsAt: outageEvents.endsAt,
    })
    .from(outageEvents)
    .where(
      and(
        isNull(outageEvents.cancelledAt),
        or(
          and(lte(outageEvents.startsAt, end), gte(outageEvents.startsAt, start)),
          and(lte(outageEvents.startsAt, end), isNull(outageEvents.endsAt)),
          and(lte(outageEvents.startsAt, end), gte(outageEvents.endsAt, start)),
        ),
      ),
    );

  // Канонические события уже без дубликатов
  const outageRows = rows.map((row) => ({
    startsAt: row.startsAt,
    endsAt: row.endsAt ?? now,
  }));

  return computeWindowSummary(label, start, end, outageRows);
}

/**
 * Реальна «надійність» для головної сторінки: скільки часу за добу було без світла
 * та скільки — зі світлом. Замінює раніше зашите значення 98.2%.
 */
export async function getPowerSummary(now: Date = new Date()): Promise<PowerSummary> {
  const [today, last24h] = await Promise.all([
    summarizeWindow('за добу', kyivDayStart(now), now),
    summarizeWindow('за 24 години', new Date(now.getTime() - 24 * 3_600_000), now),
  ]);
  return { today, last24h };
}
