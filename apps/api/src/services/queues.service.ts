import type { FastifyInstance } from 'fastify';
import type { QueueSummary } from '@svitlo/shared';

/**
 * Область легасі-даних (Чернігівщина).
 * Раніше таблиця `street_queues` описувала лише Чернігівщину та не мала колонки `region`.
 * З міграцією 0013 таблиця підтримує `region`, тож кожна область повертає лише власні вулиці,
 * а якщо адрес для області ще немає — чесний порожній список (0 вулиць).
 */
export const LEGACY_REGION = 'chernihivska-oblast';

/**
 * Список очередей приложения — ТОЛЬКО из реальных данных: интервалы графика (schedule_slots)
 * и привязки улиц (street_queues). Перечня очередей «в коде» нет: если БД пуста, ответ пустой,
 * и UI честно говорит «графік не імпортовано», а не предлагает выдуманные черги.
 */
export type QueueSlotRow = { queue: string; slots: number; lastDate: string | null };
export type QueueStreetRow = { queue: string; streets: number };
/** Названия НП и улиц очереди: реальная привязка из settlement_queues / street_queues. */
export type QueuePlacesRow = { queue: string; settlements?: string[]; streetNames?: string[] };

/** Порядок «1, 1/2, 2, 2/2, 10»: сначала основная очередь, затем под-очередь. */
export function compareQueueCodes(a: string, b: string): number {
  const parse = (code: string): [number, number] => {
    const [major, minor] = code.split('/');
    return [Number(major), Number(minor ?? 0)];
  };
  const [aMajor, aMinor] = parse(a);
  const [bMajor, bMinor] = parse(b);
  if (Number.isNaN(aMajor) || Number.isNaN(bMajor)) return a.localeCompare(b);
  return aMajor - bMajor || aMinor - bMinor;
}

/**
 * Сводит источники в один список. Чистая функция — тестируется без БД.
 *
 * `places` — реальная география групп из settlement_queues/street_queues. Её может не быть вовсе:
 * зеркало ГПВ отдаёт номера групп без привязки к районам и улицам, и тогда списки пустые.
 * Пустой список — честный ответ «источник не отдал географию», а не повод придумать районы.
 */
export function mergeQueues(
  slotsRows: QueueSlotRow[],
  streetRows: QueueStreetRow[],
  placesRows: QueuePlacesRow[] = [],
): QueueSummary[] {
  const byQueue = new Map<string, QueueSummary>();
  const create = (queue: string, slots: number, lastDate: string | null, streets: number): QueueSummary => ({
    queue,
    slots,
    lastDate,
    streets,
    settlements: [],
    streetNames: [],
  });
  for (const row of slotsRows) {
    byQueue.set(row.queue, create(row.queue, row.slots, row.lastDate, 0));
  }
  for (const row of streetRows) {
    const existing = byQueue.get(row.queue);
    if (existing) existing.streets = row.streets;
    else byQueue.set(row.queue, create(row.queue, 0, null, row.streets));
  }
  for (const row of placesRows) {
    const existing = byQueue.get(row.queue);
    const settlements = row.settlements ?? [];
    const streetNames = row.streetNames ?? [];
    if (existing) {
      existing.settlements = settlements;
      existing.streetNames = streetNames;
    } else {
      const created = create(row.queue, 0, null, 0);
      created.settlements = settlements;
      created.streetNames = streetNames;
      byQueue.set(row.queue, created);
    }
  }
  return [...byQueue.values()].sort((a, b) => compareQueueCodes(a.queue, b.queue));
}

/** Ключ для сравнения названий: регистр і пробіли не мають значення. */
function nameKey(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Названия населённых пунктов очереди (без «заглушек»).
 *
 * Зеркало ГПВ кладёт в `settlements` ровно одну запись на область — саму область («Чернігівська
 * область», «Київ») — і привязывает её ко всем группам. Это не населённый пункт, а плейсхолдер
 * джерела: показывать его как «НП этой группы» бессмысленно и вводит в заблуждение, поэтому
 * такие записи отбрасываем по совпадению с названием области.
 */
export async function listQueueSettlements(region: string): Promise<Map<string, string[]>> {
  const { db } = await import('../db/connection.js');
  const { settlementQueues, settlements, regions } = await import('../db/schema.js');
  const { eq } = await import('drizzle-orm');
  const rows = await db
    .select({
      queue: settlementQueues.queue,
      name: settlements.name,
      regionName: regions.nameUa,
    })
    .from(settlementQueues)
    .innerJoin(settlements, eq(settlementQueues.settlementId, settlements.id))
    .innerJoin(regions, eq(settlements.region, regions.cpu))
    .where(eq(settlementQueues.region, region));
  const byQueue = new Map<string, string[]>();
  for (const row of rows) {
    if (nameKey(row.name) === nameKey(row.regionName)) continue;
    const list = byQueue.get(row.queue) ?? [];
    if (!list.includes(row.name)) list.push(row.name);
    byQueue.set(row.queue, list);
  }
  for (const list of byQueue.values()) list.sort((a, b) => a.localeCompare(b, 'uk'));
  return byQueue;
}

/** Названия улиц очереди (до 50 первых по алфавиту) — реальные строки из street_queues. */
export async function listQueueStreetNames(region: string): Promise<Map<string, string[]>> {
  const { db } = await import('../db/connection.js');
  const { streetQueues } = await import('../db/schema.js');
  const { eq } = await import('drizzle-orm');
  const rows = await db
    .select({ queue: streetQueues.queue, streetName: streetQueues.streetName })
    .from(streetQueues)
    .where(eq(streetQueues.region, region));
  const byQueue = new Map<string, string[]>();
  for (const row of rows) {
    const list = byQueue.get(row.queue) ?? [];
    if (!list.includes(row.streetName)) list.push(row.streetName);
    byQueue.set(row.queue, list);
  }
  for (const list of byQueue.values()) {
    list.sort((a, b) => a.localeCompare(b, 'uk'));
    list.length = Math.min(list.length, 50);
  }
  return byQueue;
}

/**
 * Читает очереди из БД. Импорт connection — динамический: сервис остаётся тестируемым без пула.
 *
 * `region` (cpu области) сужает выборку до слотов этой области. Роуты ВСЕГДА передают область:
 * отсутствующий `?region=` превращается в DEFAULT_REGION внутри `readRegionParam`, поэтому смесь
 * черг разных областей в одном ответе невозможна. `undefined` оставлен для внутренних вызовов
 * и юнит-тестов чистой сборки `mergeQueues`.
 */
export async function listQueues(region?: string): Promise<QueueSummary[]> {
  const { db } = await import('../db/connection.js');
  const { scheduleSlots, streetQueues } = await import('../db/schema.js');
  const { eq, sql } = await import('drizzle-orm');
  const slotsQuery = db
    .select({
      queue: scheduleSlots.queue,
      slots: sql<number>`count(*)::int`,
      lastDate: sql<string | null>`max(${scheduleSlots.date})::text`,
    })
    .from(scheduleSlots);
  const streetsQuery = db
    .select({ queue: streetQueues.queue, streets: sql<number>`count(*)::int` })
    .from(streetQueues);
  const [slotsRows, streetRows, settlementNames, streetNames] = await Promise.all([
    region ? slotsQuery.where(eq(scheduleSlots.region, region)).groupBy(scheduleSlots.queue) : slotsQuery.groupBy(scheduleSlots.queue),
    region ? streetsQuery.where(eq(streetQueues.region, region)).groupBy(streetQueues.queue) : streetsQuery.groupBy(streetQueues.queue),
    region ? listQueueSettlements(region) : Promise.resolve(new Map<string, string[]>()),
    region ? listQueueStreetNames(region) : Promise.resolve(new Map<string, string[]>()),
  ]);
  // Обе карты про один ключ `queue`, поэтому собираем по очереди, а не конкатенируем два ряда:
  // иначе вторая перезаписала бы первую, и один из списков молча потерялся бы.
  const queueCodes = new Set<string>([...slotsRows.map((row) => row.queue), ...streetRows.map((row) => row.queue)]);
  const placesRows: QueuePlacesRow[] = [...queueCodes].map((queue) => ({
    queue,
    settlements: settlementNames.get(queue) ?? [],
    streetNames: streetNames.get(queue) ?? [],
  }));
  return mergeQueues(slotsRows, streetRows, placesRows);
}