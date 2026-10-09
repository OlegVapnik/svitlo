import { FastifyInstance } from 'fastify';
import { and, gte, lte } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { outages } from '../db/schema.js';
import { buildReliabilityReport, kyivMonthStart } from '../services/reliability.js';
import { mergeDuplicateOutages } from '../services/outage-grouping.js';

export default async function reliabilityRoutes(fastify: FastifyInstance) {
  // Надійність електропостачання по днях/тижнях/місяцях з початку поточного місяця.
  fastify.get('/api/v1/reliability', async () => {
    const now = new Date();
    const from = kyivMonthStart(now);
    const rows = await db
      .select({ startsAt: outages.startsAt, endsAt: outages.endsAt, areaName: outages.areaName, addressesRaw: outages.addressesRaw, reason: outages.reason })
      .from(outages)
      .where(and(gte(outages.endsAt, from), lte(outages.startsAt, now)));
    // Без дублікатів за адресами — щоб «кількість перерв» була кількістю подій.
    return { data: buildReliabilityReport(now, mergeDuplicateOutages(rows)) };
  });
}
