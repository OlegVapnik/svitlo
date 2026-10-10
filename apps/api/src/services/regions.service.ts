import type { RegionSummary } from '@svitlo/shared';
import { isRegionCpu } from '@svitlo/shared';
import { env } from '../config.js';
import { AppError } from '../utils/errors.js';
import { peekMirrorSnapshot, queueCodesOfRegion, regionsFromPayload } from './mirror-schedule.service.js';
import { compareQueueCodes } from './queues.service.js';

/**
 * Каталог областей ГПВ: що взагалі є в системі і що з цього вже імпортовано в БД.
 *
 * Два джерела, які НЕ можна заміняти одне одним:
 * 1. фід дзеркала — знає всі області України й коди їхніх черг; читаємо його ЛИШЕ з кеша (без мережі),
 *    тож холодний кеш просто нічого не додає, а сторінка ніколи не чекає на сторонній worker;
 * 2. таблиці `regions` / `region_queues` + `schedule_slots` — те, що реально є в нас.
 * Каталог = об'єднання. Дзеркало недоступне — віддаємо те, що знаємо; обидва джерела порожні —
 * порожній список, а не 500 і не вигадана область.
 */
export const DEFAULT_REGION = env.MIRROR_SCHEDULE_REGION;

/**
 * Розбирає `?region=`. Порожньо → типова область (старий фронт без параметра працює як раніше).
 * Сміття в параметрі — 400: це не «невідома область», а підозрілий рядок, який далі піде в SQL і логи.
 * Невідома, але коректна за форматом область — НЕ помилка: віддаємо порожній графік (контракт).
 */
export function readRegionParam(raw: unknown): string {
  const value = String(raw ?? '').trim();
  if (!value) return DEFAULT_REGION;
  if (value.length > 64 || !isRegionCpu(value)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'region має вигляд «chernihivska-oblast» (cpu з каталогу /api/v1/regions)');
  }
  return value;
}

type RegionRow = { cpu: string; nameUa: string; nameEn: string | null; isActive: boolean };
type SlotRow = { cpu: string; queue: string; slots: number; lastDate: string | null };

/** Знімок каталогу з БД: довідник областей + агрегати слотів. Два простих запити, без N+1. */
async function readCatalogFromDb(): Promise<{ regions: RegionRow[]; slots: SlotRow[] }> {
  const { db } = await import('../db/connection.js');
  const { regions, scheduleSlots } = await import('../db/schema.js');
  const { sql } = await import('drizzle-orm');
  const [regionRows, slotRows] = await Promise.all([
    db.select({ cpu: regions.cpu, nameUa: regions.nameUa, nameEn: regions.nameEn, isActive: regions.isActive }).from(regions),
    db
      .select({
        cpu: scheduleSlots.region,
        queue: scheduleSlots.queue,
        slots: sql<number>`count(*)::int`,
        lastDate: sql<string | null>`max(${scheduleSlots.date})::text`,
      })
      .from(scheduleSlots)
      .groupBy(scheduleSlots.region, scheduleSlots.queue),
  ]);
  return { regions: regionRows, slots: slotRows };
}

/**
 * Каталог областей для `GET /api/v1/regions`.
 * Сортування — українською назвою, далі `cpu`: людина шукає «Чернігівська», а не «chernihivska».
 */
export async function listRegions(): Promise<RegionSummary[]> {
  const [catalog, snapshot] = await Promise.all([
    readCatalogFromDb(),
    // Тільки кеш, без мережі: публічний GET не має чекати на сторонній worker (див. peekMirrorSnapshot).
    Promise.resolve(peekMirrorSnapshot()),
  ]);
  const { regions: regionRows, slots: slotRows } = catalog;

  const byCpu = new Map<string, RegionSummary>();
  const inactive = new Set(regionRows.filter((row) => !row.isActive).map((row) => row.cpu));

  for (const row of regionRows) {
    if (row.isActive) byCpu.set(row.cpu, { cpu: row.cpu, nameUa: row.nameUa, nameEn: row.nameEn, queues: [], slots: 0, lastDate: null });
  }

  // Слоти, яких немає в довіднику (імпорт ДО появи каталогу): показуємо з чесною назвою = cpu.
  for (const row of slotRows) {
    if (inactive.has(row.cpu)) continue;
    const existing = byCpu.get(row.cpu);
    if (existing) {
      existing.queues.push(row.queue);
      existing.slots += row.slots;
      if (row.lastDate && (!existing.lastDate || row.lastDate > existing.lastDate)) existing.lastDate = row.lastDate;
    } else {
      byCpu.set(row.cpu, { cpu: row.cpu, nameUa: row.cpu, nameEn: null, queues: [row.queue], slots: row.slots, lastDate: row.lastDate });
    }
  }

  if (snapshot) {
    for (const feedRegion of regionsFromSnapshot(snapshot)) {
      if (inactive.has(feedRegion.cpu)) continue;
      const existing = byCpu.get(feedRegion.cpu);
      if (existing) {
        existing.nameUa = feedRegion.nameUa;
        for (const queue of feedRegion.queues) if (!existing.queues.includes(queue)) existing.queues.push(queue);
      } else {
        byCpu.set(feedRegion.cpu, { cpu: feedRegion.cpu, nameUa: feedRegion.nameUa, nameEn: null, queues: feedRegion.queues, slots: 0, lastDate: null });
      }
    }
  }

  return [...byCpu.values()]
    .map((region) => ({ ...region, queues: [...new Set(region.queues)].sort(compareQueueCodes) }))
    .sort((a, b) => a.nameUa.localeCompare(b.nameUa, 'uk') || a.cpu.localeCompare(b.cpu));
}

/** Області та їхні черги з payload дзеркала (без мережі — payload уже в кеші). */
function regionsFromSnapshot(snapshot: { payload: Record<string, unknown> }): Array<{ cpu: string; nameUa: string; queues: string[] }> {
  return regionsFromPayload(snapshot.payload).map((region) => ({
    cpu: region.cpu,
    nameUa: region.nameUa,
    queues: queueCodesOfRegion(snapshot.payload, region.cpu),
  }));
}
