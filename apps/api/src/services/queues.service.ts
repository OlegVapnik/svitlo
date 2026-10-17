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
 *
 * `coveredQueues` — группы, которые оператор ОПУБЛИКОВАЛ в ГПВ, но у которых нет ни часа отключения
 * (`schedule_slots` пуст, потому что коды «світло є» мы не храним). Без них список групп в таких
 * областях пустой, и человек читает «графік не імпортовано» там, где график есть: именно так было
 * 17.10.2026 в `dnipro-cek`, где в ГПВ 12 черг и ни одного отключения. Коды — реальные из фида,
 * выдуманных групп в списке нет.
 */
export function mergeQueues(
  slotsRows: QueueSlotRow[],
  streetRows: QueueStreetRow[],
  placesRows: QueuePlacesRow[] = [],
  coveredQueues: string[] = [],
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
  // Опубликованные, но «пустые» группы — последним проходом: у них могут быть слоты на другую
  // дату или привязки улиц, тогда просто помечаем `covered`, иначе добавляем группу без слотов.
  for (const queue of coveredQueues) {
    const existing = byQueue.get(queue);
    if (existing) {
      existing.covered = true;
      continue;
    }
    const created = create(queue, 0, null, 0);
    created.covered = true;
    byQueue.set(queue, created);
  }
  return [...byQueue.values()].sort((a, b) => compareQueueCodes(a.queue, b.queue));
}

/** Киевская дата `YYYY-MM-DD`: «сегодня» для человека, а не для сервера (UTC). */
function kyivToday(at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

/**
 * Коды групп, которые оператор опубликовал на дату И в которых нет ни часа отключения.
 *
 * Зачем отдельная функция: `schedule_slots` хранит только «тёмные» слоты, поэтому в области, где
 * график вышел, а отключений нет, список групп приходил пустым — и это читалось как «графік не
 * імпортовано». Возвращаем именно `queues` минус `offlineQueues`: группа из `offlineQueues` без
 * слотов означает отставший импорт, и объявлять её «без відключень» было бы неправдой.
 *
 * Ключей фіда может быть НЕСКОЛЬКО (м. Дніпро обслуговують ЦЕК і ДнЕМ — разные сети с одинаковой
 * нумерацией черг). Тогда признак ставится только группе, которую БЕЗ отключений опубликовала
 * КАЖДАЯ сеть: если одна сеть молчит или показывает отключение, «світло за графіком» было бы
 * обещанием, которого мы не знаем. Один ключ — прежнее поведение.
 *
 * Читает ТОЛЬКО кеш зеркала: список групп — частый запрос, и ходить из него в сеть нельзя. Холодный
 * кеш возвращает пустой список — это честное «не знаем», а не повод показать группы «на глазок».
 * Импорт динамический: `mirror-schedule.service` импортирует `compareQueueCodes` из этого файла,
 * и статический импорт замкнул бы цикл.
 */
async function publishedClearQueues(regions: string[], date: string = kyivToday()): Promise<string[]> {
  const { mirrorDayCoverage, peekMirrorSnapshot } = await import('./mirror-schedule.service.js');
  const snapshot = peekMirrorSnapshot();
  if (!snapshot || regions.length === 0) return [];
  let clear: Set<string> | null = null;
  for (const region of regions) {
    const coverage = mirrorDayCoverage(snapshot.payload, region, date);
    // Сеть, которая на эту дату вообще ничего не опубликовала, не даёт права звать группы
    // «без отключений»: это «не знаем».
    if (!coverage) return [];
    const here = new Set(coverage.queues.filter((queue) => !coverage.offlineQueues.includes(queue)));
    if (clear === null) {
      clear = here;
    } else {
      // Перетин: група лишається «без відключень», лише якщо так її опублікувала кожна мережа.
      for (const queue of [...clear]) if (!here.has(queue)) clear.delete(queue);
    }
    if (clear.size === 0) return [];
  }
  return clear === null ? [] : [...clear];
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
  return groupNamesByQueue(rows.map((row) => ({ queue: row.queue, name: row.name, skip: nameKey(row.name) === nameKey(row.regionName) })));
}

/**
 * Групування реальних назв за кодом групи (НП або вулиці). Чиста допоміжна функція: однакові назви
 * не дублюються, порожні/заглушки відкидаються, порядок — за абеткою українською.
 */
function groupNamesByQueue(rows: Array<{ queue: string; name: string; skip?: boolean }>): Map<string, string[]> {
  const byQueue = new Map<string, string[]>();
  for (const row of rows) {
    if (row.skip || row.name.trim() === '') continue;
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
  const byQueue = groupNamesByQueue(rows.map((row) => ({ queue: row.queue, name: row.streetName })));
  for (const list of byQueue.values()) list.length = Math.min(list.length, 50);
  return byQueue;
}

/**
 * Читает очереди из БД. Импорт connection — динамический: сервис остаётся тестируемым без пула.
 *
 * `region` (cpu области) сужает выборку до слотов этой области. Роуты ВСЕГДА передают область:
 * отсутствующий `?region=` превращается в DEFAULT_REGION внутри `readRegionParam`, поэтому смесь
 * черг разных областей в одном ответе невозможна. `undefined` оставлен для внутренних вызовов
 * и юнит-тестов чистой сборки `mergeQueues`.
 *
 * Кроме слотов и привязок улиц список наполняют группы из ОПУБЛИКОВАННОГО ГПВ (`publishedQueues`):
 * без них область, где оператор график опубликовал, а отключений нет, отдавала пустой список групп
 * и человек видел «графік не імпортовано».
 */
export async function listQueues(region?: string, keys: string[] = region ? [region] : []): Promise<QueueSummary[]> {
  const { db } = await import('../db/connection.js');
  const { scheduleSlots, streetQueues } = await import('../db/schema.js');
  const { inArray, sql } = await import('drizzle-orm');
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
  const scope = keys.length > 0 ? keys : [];
  const settlementNames = mergeNameMaps(
    scope.length > 0 ? await Promise.all(scope.map((key) => listQueueSettlements(key))) : [],
  );
  const streetNames = mergeNameMaps(
    scope.length > 0 ? await Promise.all(scope.map((key) => listQueueStreetNames(key))) : [],
  );
  const [slotsRows, streetRows, published] = await Promise.all([
    (scope.length > 0 ? slotsQuery.where(inArray(scheduleSlots.region, scope)) : slotsQuery).groupBy(scheduleSlots.queue),
    (scope.length > 0 ? streetsQuery.where(inArray(streetQueues.region, scope)) : streetsQuery).groupBy(streetQueues.queue),
    // Область без имени сюда не попадает: `?region=` роут всегда подставляет (readRegionParam),
    // а гадать область по умолчанию для чужого запроса нельзя.
    publishedClearQueues(scope),
  ]);
  // Обе карты про один ключ `queue`, поэтому собираем по очереди, а не конкатенируем два ряда:
  // иначе вторая перезаписала бы первую, и один из списков молча потерялся бы.
  const queueCodes = new Set<string>([...slotsRows.map((row) => row.queue), ...streetRows.map((row) => row.queue)]);
  const placesRows: QueuePlacesRow[] = [...queueCodes].map((queue) => ({
    queue,
    settlements: settlementNames.get(queue) ?? [],
    streetNames: streetNames.get(queue) ?? [],
  }));
  return mergeQueues(slotsRows, streetRows, placesRows, published);

/** Об'єднання карт «код групи → назви» по кількох ключах області (без дублів, за абеткою). */
function mergeNameMaps(maps: Array<Map<string, string[]>>): Map<string, string[]> {
  const merged = new Map<string, string[]>();
  for (const map of maps) {
    for (const [queue, names] of map) {
      const list = merged.get(queue) ?? [];
      for (const name of names) if (!list.includes(name)) list.push(name);
      merged.set(queue, list);
    }
  }
  for (const list of merged.values()) list.sort((a, b) => a.localeCompare(b, 'uk'));
  return merged;
}

}