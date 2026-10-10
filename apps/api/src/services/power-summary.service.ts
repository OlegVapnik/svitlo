import { and, gte, lte } from 'drizzle-orm';
import type { PowerSummary, PowerWindowSummary } from '@svitlo/shared';
import { db } from '../db/connection.js';
import { outages } from '../db/schema.js';
import { computeWindowSummary, kyivDayStart } from './power-summary.js';
import { mergeDuplicateOutages } from './outage-grouping.js';

/** Рахує підсумок по вікну (без світла / зі світлом / надійність) на основі даних БД. */
export async function summarizeWindow(label: string, start: Date, end: Date): Promise<PowerWindowSummary> {
  const rows = await db
    .select({ startsAt: outages.startsAt, endsAt: outages.endsAt, areaName: outages.areaName, addressesRaw: outages.addressesRaw, reason: outages.reason })
    .from(outages)
    .where(and(lte(outages.startsAt, end), gte(outages.endsAt, start)));

  // Згортаємо дублікати за адресами, щоб «кількість перерв» була кількістю подій,
  // а не кількістю вулиць/будинків однієї події.
  return computeWindowSummary(label, start, end, mergeDuplicateOutages(rows));
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
