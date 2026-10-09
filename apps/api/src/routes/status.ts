import { FastifyInstance } from 'fastify';
import { db } from '../db/connection.js';
import { gridStatus, outageEvents } from '../db/schema.js';
import { and, gt, gte, isNull, lte, or, sql } from 'drizzle-orm';
import { getPowerSummary } from '../services/power-summary.service.js';
import { getIncidents } from '../services/incidents.service.js';

export default async function statusRoutes(fastify: FastifyInstance) {
  fastify.get('/api/v1/status', async () => {
    const now = new Date();
    const [status] = await db.select().from(gridStatus).orderBy(sql`${gridStatus.updatedAt} desc`).limit(1);

    // Рахуємо КАНОНІЧНІ події (invariant 5 у outage-data-core): одна реальна перерва = одна подія, а не
    // 30 адресних рядків. Статус ОБЧИСЛЮЄТЬСЯ, а не береться зі сховища: cancelled_at → скасовано,
    // інакше за starts_at/ends_at і «зараз». «Зараз» приходить з JS (Date), не з SQL now(), щоб тест
    // міг заморозити час; ORM-шлях мапить Date у рядок для timestamptz (postgres.js валиться лише
    // на Date у сирому sql-шаблоні — див. outage-events-writer.ts).
    const [activeRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(outageEvents)
      .where(
        and(
          isNull(outageEvents.cancelledAt),
          lte(outageEvents.startsAt, now),
          or(isNull(outageEvents.endsAt), gte(outageEvents.endsAt, now)),
        ),
      );
    const [scheduledRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(outageEvents)
      .where(and(isNull(outageEvents.cancelledAt), gt(outageEvents.startsAt, now)));
    const activeOutages = activeRow?.count ?? 0;
    const scheduledOutages = scheduledRow?.count ?? 0;

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
