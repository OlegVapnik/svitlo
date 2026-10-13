import { db } from '../db/connection.js';
import { outageEvents, outageEventAddresses } from '../db/schema.js';
import { eq, and, gte, lte, sql, desc, or, ilike, isNull, not, inArray } from 'drizzle-orm';
import type { OutageFilters, PaginationQuery, OutageStats } from '@svitlo/shared';

/** Верхня межа рядків в одному запиті (для пагінації). */
const MAX_ROWS_FOR_GROUPING = 500;

/**
 * Агрегирует адреса событий: для каждого event_id собирает список уникальных улиц/адресов
 * из outage_event_addresses. Возвращает Map<eventId, addressesSummary>.
 */
async function loadAddressesForEventIds(eventIds: string[]): Promise<Map<string, string>> {
  if (eventIds.length === 0) return new Map();
  const addressRows = await db
    .select({
      eventId: outageEventAddresses.eventId,
      addressRaw: outageEventAddresses.addressRaw,
    })
    .from(outageEventAddresses)
    .where(inArray(outageEventAddresses.eventId, eventIds));

  const byEvent = new Map<string, string[]>();
  for (const row of addressRows) {
    const list = byEvent.get(row.eventId);
    if (list) {
      if (!list.includes(row.addressRaw)) list.push(row.addressRaw);
    } else {
      byEvent.set(row.eventId, [row.addressRaw]);
    }
  }

  const result = new Map<string, string>();
  for (const [eventId, addrs] of byEvent) {
    // Показываем до 4 уникальных улиц, остальные — «та інші вулици»
    const shown = addrs.slice(0, 4).join('; ');
    result.set(eventId, addrs.length > 4 ? `${shown} та інші вулици` : shown);
  }
  return result;
}

/**
 * Вычисляет статус события на лету (без хранимого поля).
 */
function computeStatus(row: {
  startsAt: Date;
  endsAt: Date | null;
  cancelledAt: Date | null;
}, now: Date): 'scheduled' | 'active' | 'finished' | 'cancelled' {
  if (row.cancelledAt) return 'cancelled';
  if (row.startsAt.getTime() > now.getTime()) return 'scheduled';
  if (!row.endsAt || row.endsAt.getTime() > now.getTime()) return 'active';
  return 'finished';
}

export async function getOutages(filters: OutageFilters, pagination: PaginationQuery) {
  const now = new Date();
  const conditions: any[] = [];

  if (filters.dateFrom) {
    conditions.push(gte(outageEvents.startsAt, new Date(filters.dateFrom)));
  }

  if (filters.dateTo) {
    conditions.push(lte(outageEvents.startsAt, new Date(filters.dateTo)));
  }

  if (filters.area) {
    conditions.push(eq(outageEvents.areaName, filters.area));
  }

  if (filters.query) {
    // Поиск по адресам через таблицу адресов ИЛИ по названию области (населенного пункта).
    // Одно логическое условие: подходящие event_id из outage_event_addresses (по улице),
    // либо area_name, похожий на запрос.
    const q = `%${filters.query}%`;
    conditions.push(
      or(
        sql`${outageEvents.id} IN (SELECT event_id FROM outage_event_addresses WHERE address_raw ILIKE ${q})`,
        ilike(outageEvents.areaName ?? sql`''`, q),
      ),
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const offset = (pagination.page - 1) * pagination.limit;

  // Читаем канонические события напрямую из outage_events
  const rows = await db
    .select()
    .from(outageEvents)
    .where(whereClause)
    .orderBy(desc(outageEvents.startsAt))
    .limit(pagination.limit)
    .offset(offset);

  // Собираем адреса для этих событий
  const eventIds = rows.map((r) => r.id);
  const addressesMap = await loadAddressesForEventIds(eventIds);

  // Считаем общее количество (без пагинации)
  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(outageEvents)
    .where(whereClause);
  const total = countRow?.count ?? 0;

  const data = rows.map((row) => ({
    id: row.id.toString(),
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt?.toISOString() ?? null,
    areaName: row.areaName ?? '',
    addressesRaw: addressesMap.get(row.id.toString()) ?? '',
    addressesNormalized: '',
    reason: row.reason ?? null,
    status: computeStatus(row, now),
    queue: null,
    source: 'outage_events',
    sourceId: row.sourceId.toString(),
    contentHash: row.eventKey,
    firstSeenAt: row.firstSeenAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));

  const totalPages = Math.max(1, Math.ceil(total / pagination.limit));

  return {
    data,
    meta: {
      page: pagination.page,
      limit: pagination.limit,
      total,
      totalPages,
    },
  };
}

export async function getOutageById(id: string) {
  const [record] = await db.select().from(outageEvents).where(eq(outageEvents.id, id));
  if (!record) return null;

  const addressesMap = await loadAddressesForEventIds([record.id.toString()]);
  const now = new Date();

  return {
    id: record.id.toString(),
    startsAt: record.startsAt.toISOString(),
    endsAt: record.endsAt?.toISOString() ?? null,
    areaName: record.areaName ?? '',
    addressesRaw: addressesMap.get(record.id.toString()) ?? '',
    addressesNormalized: '',
    reason: record.reason ?? null,
    status: computeStatus(record, now),
    queue: null,
    source: 'outage_events',
    sourceId: record.sourceId.toString(),
    contentHash: record.eventKey,
    firstSeenAt: record.firstSeenAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
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
  // Устарело: после перехода на outage_events статус вычисляется на лету в computeStatus().
  // Оставлено для обратной совместимости parse.service.ts.
  return;
}
