import { FastifyInstance } from 'fastify';
import { db } from '../db/connection.js';
import { gridStatus, outages } from '../db/schema.js';
import { sql } from 'drizzle-orm';
import { getPowerSummary } from '../services/power-summary.service.js';
import { mergeDuplicateOutages } from '../services/outage-grouping.js';
import { getIncidents } from '../services/incidents.service.js';

export default async function statusRoutes(fastify: FastifyInstance) {
  fastify.get('/api/v1/status', async () => {
    const now = new Date();
    const [status] = await db.select().from(gridStatus).orderBy(sql`${gridStatus.updatedAt} desc`).limit(1);

    // Рахуємо без дублікатів за адресами — щоб цифри збігались зі списками.
    const outageRows = await db
      .select({ startsAt: outages.startsAt, endsAt: outages.endsAt, areaName: outages.areaName, addressesRaw: outages.addressesRaw, reason: outages.reason })
      .from(outages);
    const mergedOutages = mergeDuplicateOutages(outageRows);
    const activeOutages = mergedOutages.filter((outage) => outage.startsAt.getTime() <= now.getTime() && outage.endsAt.getTime() >= now.getTime()).length;
    const scheduledOutages = mergedOutages.filter((outage) => outage.startsAt.getTime() > now.getTime()).length;

    // Той самий список, що й на сторінці «Аварії та ремонтні роботи».
    const incidentList = await getIncidents(now);
    const activeIncidents = incidentList.filter((incident) => incident.status === 'active').length;
    const scheduledIncidents = incidentList.filter((incident) => incident.status === 'scheduled').length;

    const powerSummary = await getPowerSummary(now);
    const lastUpdatedAt = status?.updatedAt ?? null;
    const dataStale = !lastUpdatedAt || now.getTime() - lastUpdatedAt.getTime() > 2 * 60 * 60 * 1000;
    return {
      data: {
        grid: { level: status?.level ?? 'unknown', message: status?.message ?? '' },
        activeOutages,
        scheduledOutages,
        activeIncidents,
        scheduledIncidents,
        totalIncidents: incidentList.length,
        lastUpdatedAt: lastUpdatedAt?.toISOString() ?? null,
        dataStale,
        powerSummary,
      },
    };
  });
}
