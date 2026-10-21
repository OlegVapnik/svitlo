import { db } from '../db/connection.js';
import { outageEvents, outageEventAddresses } from '../db/schema.js';
import { eq, and, gte, lte, sql, desc, or, ilike, isNull, not, inArray } from 'drizzle-orm';
import { listGroupOutages } from './group-outages.service.js';
import type { Outage, OutageFilters, PaginationQuery, OutageStats } from '@svitlo/shared';

/** Верхня межа рядків в одному запиті (для пагінації). */
const MAX_ROWS_FOR_GROUPING = 500;

/**
 * Название улицы из строки адреса оператора: «вул. Деснянська 1, 2, 3» → «вул. Деснянська».
 *
 * Номера домов отбрасываем: они персональные по смыслу (привязка к конкретным квартирам) и в
 * блоке «Найближчі відключення» показывать их не нужно — человеку важен уровень улицы.
 * Если в строке есть только номера (без «вул.»), название не выдумываем и возвращаем null.
 */
export function streetNameFromRawAddress(raw: string): string | null {
  const text = String(raw).trim();
  // Свёрнутая агрегатная строка («вул. А, вул. Б, вул. В та інші вулиці») — это не одна улица.
  // Такие лежат рядом с настоящими в outage_event_addresses, поэтому отбрасываем их по признакам
  // «несколько "вул." подряд» либо «… та інші вулиці».
  const streetWordCount = (text.match(/вул\.|провулок|пров\./giu) ?? []).length;
  if (streetWordCount > 1 || /та інші вулиці/iu.test(text)) return null;

  const withoutLeading = text.replace(/^(?:вул(?:ица)?|провулок|пров\.)\.?\s*/iu, '');
  // Отрезаем хвост с номерами домов: «Деснянська 1, 2, 3» → «Деснянська».
  const cut = withoutLeading.split(/\s+\d/u)[0]?.trim() ?? '';
  if (!cut || /\d/u.test(cut)) return null;
  // Всегда с единым префиксом «вул.» — в UI и в группировке назва улицы должна быть одной строкой.
  return `вул. ${cut}`;
}

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
 * Улицы события (без номеров домов) — Map<eventId, string[]>.
 *
 * Раньше блок «Найближчі відключення» показывал одно название населённого пункта на весь экран,
 * хотя оператор отдаёт адрес до уровня улицы. Эти улицы уже лежат в `outage_event_addresses` —
 * берём их оттуда, а не строим группировку «по одному селу».
 */
async function loadStreetNamesForEventIds(eventIds: string[]): Promise<Map<string, string[]>> {
  if (eventIds.length === 0) return new Map();
  const rows = await db
    .select({
      eventId: outageEventAddresses.eventId,
      addressRaw: outageEventAddresses.addressRaw,
    })
    .from(outageEventAddresses)
    .where(inArray(outageEventAddresses.eventId, eventIds));

  const byEvent = new Map<string, string[]>();
  for (const row of rows) {
    const street = streetNameFromRawAddress(row.addressRaw);
    if (!street) continue;
    const list = byEvent.get(row.eventId) ?? [];
    if (!list.includes(street)) list.push(street);
    byEvent.set(row.eventId, list);
  }
  for (const list of byEvent.values()) list.sort((a, b) => a.localeCompare(b, 'uk'));
  return byEvent;
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

  // Фільтр за областю: сьогодні єдиний джерело адресних відключень у `outage_events` —
  // Чернігівобленерго (с. Деснянське та інші). Якщо користувач обрал iншу область (kyiv, lviv),
  // не повертаємо чернігівські записи: для них детальных уличных робот немає — чесний пустий массив.
  // Раніше тут стояв відсів по `'chernihivska-oblast'`: для інших областей сторінка відключень
  // була порожня, бо `outage_events` містить лише точкові ремонти одного села. Тепер відключення
  // за областю береться з графіка ГПВ (`schedule_slots`), а ремонти додаються зверху — див.
  // group-outages.service.ts. Відсів не відновлюємо: він робив би 15 областей з 16 порожніми.

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
  const [addressesMap, streetsMap] = await Promise.all([
    loadAddressesForEventIds(eventIds),
    loadStreetNamesForEventIds(eventIds),
  ]);

  // Считаем общее количество (без пагинации)
  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(outageEvents)
    .where(whereClause);
  const repairTotal = countRow?.count ?? 0;

  const data = rows.map((row) => ({
    id: row.id.toString(),
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt?.toISOString() ?? null,
    areaName: row.areaName ?? '',
    addressesRaw: addressesMap.get(row.id.toString()) ?? '',
    addressesNormalized: '',
    // Улицы события — чтобы блок «Найближчі відключення» группировал по улицам/районам,
    // а не по одному названию села на весь экран.
    streets: streetsMap.get(row.id.toString()) ?? [],
    reason: row.reason ?? null,
    status: computeStatus(row, now),
    queue: null,
    source: 'outage_events',
    sourceId: row.sourceId.toString(),
    kind: 'repair',
    contentHash: row.eventKey,
    firstSeenAt: row.firstSeenAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));

  // Планові відключення за графіком ГПВ области. Саме вони дають сторінці «Відключення»
  // зміст для всіх областей; ремонти (outage_events) додаються до них.
  const groupOutages = filters.region
    ? await listGroupOutages(filters.region, filters.dateFrom, filters.dateTo, now)
    : [];

  // Фільтри «Статус» і «Черга» з панелі пошуку. Вони застосовуються до об'єднаних даних, а не
  // лише до таблиці: статус у ремонтів обчислюється на льоту (окремий стовпці немає), а черга
  // є тільки у групових відключеннях. Раніше ці фільтри просто ігнорувалися — випадаючі списки
  // були no-op.
  const repairFiltered = (filters.status || filters.queue != null)
    ? data.filter((item) => {
        const matchesStatus = !filters.status || item.status === filters.status;
        const matchesQueue = filters.queue == null || item.queue === filters.queue;
        return matchesStatus && matchesQueue;
      })
    : data;

  const groupsFiltered = groupOutages.filter((item) => {
    const matchesStatus = !filters.status || item.status === filters.status;
    const matchesQueue = filters.queue == null || item.queue === filters.queue;
    return matchesStatus && matchesQueue;
  });

  const merged = [...groupsFiltered, ...repairFiltered].sort(
    (a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt),
  );
  const total = groupsFiltered.length + repairFiltered.length;
  const totalPages = Math.max(1, Math.ceil(total / pagination.limit));

  // Обмечение по размеру страницы делаем после слияния: иначе пагинация ремонтов «съедала» бы
  // первую страницу и групповые отключения вообще не показывались.
  return {
    data: merged.slice(0, pagination.limit),
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


/**
 * Зведення статистики з відключень по групах.
 *
 * Рахуємо в пам'яті з тих самих записів, що показує список відключень, тож лічильники
 * на вкладках «Графік»/«Карта» завжди збігаються з тим, що видно в списку.
 */
function statsFromGroupOutages(outages: Outage[], now: Date): OutageStats {
  const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0, totalMinutes: 0 }));
  const byDay: Array<{ date: string; count: number; totalMinutes: number }> = [];
  const byArea: OutageStats['byArea'] = [];
  const heatmap = Array.from({ length: 7 * 24 }, (_, i) => ({ dayOfWeek: Math.floor(i / 24), hour: i % 24, count: 0 }));

  const kyivParts = (iso: string) => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Kyiv',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      }).formatToParts(new Date(iso)).map((part) => [part.type, part.value]),
    );
    return {
      date: `${parts['year']}-${parts['month']}-${parts['day']}`,
      hour: Number(parts['hour']) % 24,
      // 0 = понеділок: тиждень починається з понеділка, як в українському календарі.
      dayOfWeek: (new Date(`${parts['year']}-${parts['month']}-${parts['day']}T00:00:00Z`).getUTCDay() + 6) % 7,
    };
  };

  for (const outage of outages) {
    const start = kyivParts(outage.startsAt);
    const end = kyivParts(outage.endsAt);
    const minutes = Math.max(0, Math.round((Date.parse(outage.endsAt) - Date.parse(outage.startsAt)) / 60_000));

    byHour[start.hour]!.count += 1;
    byHour[start.hour]!.totalMinutes += minutes;
    heatmap[start.dayOfWeek * 24 + start.hour]!.count += 1;

    const day = byDay.find((item) => item.date === start.date);
    if (day) { day.count += 1; day.totalMinutes += minutes; }
    else byDay.push({ date: start.date, count: 1, totalMinutes: minutes });

    const area = outage.areaName || outage.group || 'невідомо';
    const areaRow = byArea.find((item) => item.areaName === area);
    if (areaRow) { areaRow.count += 1; areaRow.totalMinutes += minutes; }
    else byArea.push({ areaName: area, count: 1, totalMinutes: minutes });

    // Окно, перешедшее за опівночі, відносимо ще й до наступного дня.
    if (end.date !== start.date) {
      const nextDay = byDay.find((item) => item.date === end.date);
      if (nextDay) { nextDay.count += 1; nextDay.totalMinutes += minutes; }
      else byDay.push({ date: end.date, count: 1, totalMinutes: minutes });
    }
  }

  return {
    byHour,
    byDay: byDay.sort((a, b) => a.date.localeCompare(b.date)),
    byArea: byArea.sort((a, b) => b.totalMinutes - a.totalMinutes),
    heatmap,
    totalActive: outages.filter((item) => item.status === 'active').length,
    totalScheduled: outages.filter((item) => item.status === 'scheduled').length,
  };
}

export async function getOutageStats(
  now: Date = new Date(),
  region?: string,
  dateFrom?: string,
  dateTo?: string,
): Promise<OutageStats> {
  const empty = (): OutageStats => ({
    byHour: Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0, totalMinutes: 0 })),
    byDay: [],
    byArea: [],
    heatmap: Array.from({ length: 7 * 24 }, (_, i) => ({ dayOfWeek: Math.floor(i / 24), hour: i % 24, count: 0 })),
    totalActive: 0,
    totalScheduled: 0,
  });

  // Статистика по графіку ГПВ области: розподіл відключень за годинами/днями/теплиною.
  //
  // Раніше тут стояв відсів по Чернігівщині, а решта рахувалася по `outage_events`, де лишилися
  // одиничні ремонти. Через це вкладки «Графік» і «Карта» були порожні для 15 областей із 16.
  // Тепер показуємо те, що люди називають відключеннями, — планові вікна груп.
  if (region) {
    const groupOutages = await listGroupOutages(region, dateFrom, dateTo, now);
    if (groupOutages.length > 0) return statsFromGroupOutages(groupOutages, now);
  }
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
