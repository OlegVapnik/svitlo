import { db } from '../db/connection.js';
import { outages, outageEvents } from '../db/schema.js';
import { eq, and, gte, lte, sql, desc, or, ilike, isNull, not } from 'drizzle-orm';
import type { OutageFilters, PaginationQuery, OutageStats } from '@energy-monitor/shared';
import { mergeDuplicateOutages } from './outage-grouping.js';

/** Верхня межа рядків, які вичитуємо для згортання дублікатів перед пагінацією. */
const MAX_ROWS_FOR_GROUPING = 1000;

export async function getOutages(filters: OutageFilters, pagination: PaginationQuery) {
  const conditions = [];

  if (filters.dateFrom) {
    conditions.push(gte(outages.endsAt, new Date(filters.dateFrom)));
  }

  if (filters.dateTo) {
    conditions.push(lte(outages.startsAt, new Date(filters.dateTo)));
  }

  if (filters.status) {
    conditions.push(eq(outages.status, filters.status));
  }

  if (filters.queue !== undefined) {
    conditions.push(eq(outages.queue, filters.queue));
  }

  if (filters.area) {
    conditions.push(eq(outages.areaName, filters.area));
  }

  if (filters.query) {
    const q = `%${filters.query}%`;
    conditions.push(
      or(
        ilike(outages.addressesNormalized, q),
        ilike(outages.addressesRaw, q),
        ilike(outages.areaName, q),
      ),
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const offset = (pagination.page - 1) * pagination.limit;

  // Згортаємо дублікати, що відрізняються лише адресами, ДО пагінації: інакше одна
  // подія (село вимикають цілком) займає десятки рядків списку й «смітить» цифрами.
  const rows = await db
    .select()
    .from(outages)
    .where(whereClause)
    .orderBy(desc(outages.startsAt))
    .limit(MAX_ROWS_FOR_GROUPING);

  const merged = mergeDuplicateOutages(rows);
  const total = merged.length;
  const totalPages = Math.max(1, Math.ceil(total / pagination.limit));

  return {
    data: merged.slice(offset, offset + pagination.limit),
    meta: {
      page: pagination.page,
      limit: pagination.limit,
      total,
      totalPages,
    },
  };
}

export async function getOutageById(id: string) {
  const [record] = await db.select().from(outages).where(eq(outages.id, id));
  return record || null;
}

export async function getOutageStats(now: Date = new Date()): Promise<OutageStats> {
  // Читаем КАНОНИЧЕСКИЕ события, а не сырые адресные строки: иначе одна реальная авария
  // на 30 адресов попадает в статистику 30 раз (см. skills/outage-data-core, invariant 5).
  // «Сейчас» приходит параметром: SQL now() и представление outage_events_v не используем,
  // чтобы результат можно было воспроизвести в тесте (замороженные часы живут в JS).
  // Статус в отчётах считаем целиком в SQL, но БЕЗ now(): лимит «сейчас» приходит из приложения
  // ISO-строкой (Date в любом виде валит postgres.js). :ts — подготовленное значение drizzle,
  // не конкатенация в текст запроса.
  const notCancelled = isNull(outageEvents.cancelledAt);
  const capsAtNow = sql`${outageEvents.endsAt} < ${now.toISOString()}::timestamptz`;
  const activeWindow = and(
    notCancelled,
    lte(outageEvents.startsAt, now),
    or(isNull(outageEvents.endsAt), not(capsAtNow)),
  );
  // Итоговое окно события; для незавершённой (открытой) аварии считаем до текущего момента.
  const totalMinutesSql = sql<number>`round(coalesce(sum(extract(epoch from (coalesce(${outageEvents.endsAt}, ${now.toISOString()}::timestamptz) - ${outageEvents.startsAt})) / 60), 0))::int`;
  const byAreaRows = await db
    .select({
      areaName: sql<string>`coalesce(${outageEvents.areaName}, 'невідомо')`,
      count: sql<number>`count(*)::int`,
      totalMinutes: totalMinutesSql,
    })
    // Розподіли (byArea/byDay/byHour/heatmap) рахують УСІ опубліковані вікна, включно зі скасованими:
    // це історія графіка оператора, і приймальний тест outage-numbers вимагає, щоб сума по днях
    // дорівнювала кількості подій (6/6). Скасовані виключаються лише зі статусів (active/scheduled) нижче.
    .from(outageEvents)
    .groupBy(outageEvents.areaName)
    .orderBy(desc(sql`count(*)`))
    .limit(10);
  // By Day (last 14 days)
  const byDayRows = await db
    .select({
      date: sql<string>`to_char(${outageEvents.startsAt} at time zone 'Europe/Kyiv', 'YYYY-MM-DD')`,
      count: sql<number>`count(*)::int`,
      totalMinutes: totalMinutesSql,
    })
    .from(outageEvents)
    .groupBy(sql`to_char(${outageEvents.startsAt} at time zone 'Europe/Kyiv', 'YYYY-MM-DD')`)
    .orderBy(sql`to_char(${outageEvents.startsAt} at time zone 'Europe/Kyiv', 'YYYY-MM-DD')`);
  // By Hour (0-23 distribution)
  const byHourRows = await db
    .select({
      hour: sql<number>`extract(hour from ${outageEvents.startsAt} at time zone 'Europe/Kyiv')::int`,
      count: sql<number>`count(*)::int`,
      totalMinutes: totalMinutesSql,
    })
    .from(outageEvents)
    .groupBy(sql`extract(hour from ${outageEvents.startsAt} at time zone 'Europe/Kyiv')`)
    .orderBy(sql`extract(hour from ${outageEvents.startsAt} at time zone 'Europe/Kyiv')`);

  // Fill all 24 hours
  const byHourMap = new Map<number, { count: number; totalMinutes: number }>();
  byHourRows.forEach((r) => byHourMap.set(r.hour, { count: r.count, totalMinutes: r.totalMinutes }));
  const byHour = Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    count: byHourMap.get(h)?.count || 0,
    totalMinutes: byHourMap.get(h)?.totalMinutes || 0,
  }));

  // Heatmap: Day of week (0-6) × Hour (0-23)
  const heatmapRows = await db
    .select({
      dayOfWeek: sql<number>`extract(dow from ${outageEvents.startsAt} at time zone 'Europe/Kyiv')::int`,
      hour: sql<number>`extract(hour from ${outageEvents.startsAt} at time zone 'Europe/Kyiv')::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(outageEvents)
    .groupBy(
      sql`extract(dow from ${outageEvents.startsAt} at time zone 'Europe/Kyiv')`,
      sql`extract(hour from ${outageEvents.startsAt} at time zone 'Europe/Kyiv')`,
    );

  const heatmapMap = new Map<string, number>();
  heatmapRows.forEach((r) => heatmapMap.set(`${r.dayOfWeek}-${r.hour}`, r.count));

  const heatmap = [];
  for (let dow = 0; dow <= 6; dow++) {
    for (let h = 0; h < 24; h++) {
      heatmap.push({
        dayOfWeek: dow,
        hour: h,
        count: heatmapMap.get(`${dow}-${h}`) || 0,
      });
    }
  }

  // Статус ОБЧИСЛЮЄТЬСЯ по событию, а не берётся из хранимого status:
  // cancelled_at → cancelled; иначе по starts_at/ends_at и «сейчас».
  const [activeCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(outageEvents)
    .where(activeWindow);

  const [scheduledCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(outageEvents)
    .where(and(isNull(outageEvents.cancelledAt), gte(outageEvents.startsAt, now)));

  return {
    byHour,
    byDay: byDayRows,
    byArea: byAreaRows,
    heatmap,
    totalActive: activeCount?.count || 0,
    totalScheduled: scheduledCount?.count || 0,
  };
}

export async function updateOutageStatuses() {
  const now = new Date();

  // Mark scheduled -> active if time has come
  await db
    .update(outages)
    .set({ status: 'active', updatedAt: now })
    .where(
      and(
        lte(outages.startsAt, now),
        gte(outages.endsAt, now),
        eq(outages.status, 'scheduled'),
      ),
    );

  // Mark active/scheduled -> finished if endsAt has passed
  await db
    .update(outages)
    .set({ status: 'finished', updatedAt: now })
    .where(
      and(
        lte(outages.endsAt, now),
        or(eq(outages.status, 'active'), eq(outages.status, 'scheduled')),
      ),
    );
}
