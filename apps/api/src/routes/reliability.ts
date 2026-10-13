import { FastifyInstance } from 'fastify';
import { and, gte, lte, sql } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { outageEvents } from '../db/schema.js';
import type { OutageRow } from '../services/power-summary.js';
import { buildReliabilityReport, kyivMonthStart } from '../services/reliability.js';

export default async function reliabilityRoutes(fastify: FastifyInstance) {
  // Надійність електропостачання по днях/тижнях/місяцях з початку поточного місяця.
  fastify.get('/api/v1/reliability', async () => {
    const now = new Date();
    const from = kyivMonthStart(now);
    const rows = await db
      .select({
        startsAt: outageEvents.startsAt,
        endsAt: outageEvents.endsAt,
        areaName: outageEvents.areaName,
        reason: outageEvents.reason,
      })
      .from(outageEvents)
      .where(
        and(
          // События, которые хотя бы частично пересекаются с окном [from, now]
          gte(outageEvents.endsAt ?? sql`${outageEvents.startsAt}`, from),
          lte(outageEvents.startsAt, now),
        ),
      );
    // Маппим в OutageRow для buildReliabilityReport
    const outageRows: OutageRow[] = rows.map((row) => ({
      startsAt: row.startsAt,
      endsAt: row.endsAt ?? now,  // незавершённая авария = длится до сейчас
    }));
    return { data: buildReliabilityReport(now, outageRows) };
  });
}
