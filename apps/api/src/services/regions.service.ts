import type { RegionCoverageItem, RegionCoverageResponse, RegionSummary } from '@svitlo/shared';
import { isRegionCpu } from '@svitlo/shared';
import { env } from '../config.js';
import { AppError } from '../utils/errors.js';
import { mirrorDayCoverage, peekMirrorSnapshot, queueCodesOfRegion, regionsFromPayload } from './mirror-schedule.service.js';
import { kyivDayStart } from './power-summary.js';
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

/** Київська дата `YYYY-MM-DD` — та сама, що дзеркало віддає у `date_today`. */
function kyivYmd(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

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
    // Стан «оператор опублікував ГПВ, відключень немає» інакше не відрізнити від «даних немає»:
    // у такої області нуль слотів у БД, бо зберігати нічого. Дата — сьогодні (як `date_today` фіда),
    // бо саме про «зараз» людина й питає. Фід нічого не опублікував на цю дату → `allClear` не ставимо.
    const todayYmd = kyivYmd(new Date());
    for (const feedRegion of regionsFromSnapshot(snapshot)) {
      if (inactive.has(feedRegion.cpu)) continue;
      const coverage = mirrorDayCoverage(snapshot.payload, feedRegion.cpu, todayYmd);
      const allClear = coverage ? coverage.offlineQueues.length === 0 : undefined;
      const existing = byCpu.get(feedRegion.cpu);
      if (existing) {
        existing.nameUa = feedRegion.nameUa;
        if (allClear !== undefined) existing.allClear = allClear;
        for (const queue of feedRegion.queues) if (!existing.queues.includes(queue)) existing.queues.push(queue);
      } else {
        byCpu.set(feedRegion.cpu, {
          cpu: feedRegion.cpu,
          nameUa: feedRegion.nameUa,
          nameEn: null,
          queues: feedRegion.queues,
          slots: 0,
          lastDate: null,
          allClear,
        });
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

export type RegionFreshness = {
  freshnessHours: number | null;
  stale: boolean;
  covered: boolean;
};

/**
 * Чистий розрахунок свіжості графіка області відносно поточного київського часу.
 *
 * Правила:
 * - Немає дати (null) → covered: false, freshnessHours: null, stale: true.
 * - Графік на сьогодні або майбутнє → covered: true, freshnessHours: 0, stale: false.
 * - Графік у минулому → diffHours (від початку доби останнього графіка до початку поточної доби).
 *   stale: true, якщо diffHours > 48 (старше 48 годин). Рівно 48 год — межа (не застарілий).
 */
export function calculateRegionFreshness(
  lastDate: string | null,
  now: Date = new Date(),
): RegionFreshness {
  if (!lastDate) {
    return { freshnessHours: null, stale: true, covered: false };
  }
  const todayYmd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

  if (lastDate >= todayYmd) {
    return { freshnessHours: 0, stale: false, covered: true };
  }

  const nowDayStart = kyivDayStart(now);
  const lastDateDayStart = kyivDayStart(new Date(`${lastDate}T12:00:00Z`));
  const diffHours = Math.max(0, Math.round((nowDayStart.getTime() - lastDateDayStart.getTime()) / 3_600_000));

  return {
    freshnessHours: diffHours,
    stale: diffHours > 48,
    covered: true,
  };
}

/**
 * Звіт покриття та свіжості даних по всіх областях України (GET /api/v1/regions/coverage).
 * Читає ТІЛЬКИ БД, жодних мережевих запитів.
 */
export async function getRegionsCoverage(now: Date = new Date()): Promise<RegionCoverageResponse> {
  const { db } = await import('../db/connection.js');
  const { regions, regionQueues, scheduleSlots } = await import('../db/schema.js');
  const { sql } = await import('drizzle-orm');

  const [regionRows, queueRows, slotRows] = await Promise.all([
    db.select({ cpu: regions.cpu, nameUa: regions.nameUa, isActive: regions.isActive }).from(regions),
    db
      .select({
        cpu: regionQueues.cpu,
        queuesCount: sql<number>`count(distinct ${regionQueues.queue})::int`,
      })
      .from(regionQueues)
      .groupBy(regionQueues.cpu),
    db
      .select({
        cpu: scheduleSlots.region,
        slotsCount: sql<number>`count(*)::int`,
        lastDate: sql<string | null>`max(${scheduleSlots.date})::text`,
        sources: sql<string[]>`array_agg(distinct ${scheduleSlots.source})`,
      })
      .from(scheduleSlots)
      .groupBy(scheduleSlots.region),
  ]);

  const queuesByCpu = new Map<string, number>();
  for (const q of queueRows) {
    queuesByCpu.set(q.cpu, q.queuesCount);
  }

  const slotsByCpu = new Map<string, { slotsCount: number; lastDate: string | null; sources: string[] }>();
  for (const s of slotRows) {
    const cleanSources = (s.sources ?? []).filter((src): src is string => typeof src === 'string' && src.length > 0).sort();
    slotsByCpu.set(s.cpu, {
      slotsCount: s.slotsCount,
      lastDate: s.lastDate,
      sources: cleanSources,
    });
  }

  const items: RegionCoverageItem[] = [];
  const handledCpus = new Set<string>();

  for (const r of regionRows) {
    if (!r.isActive) continue;
    handledCpus.add(r.cpu);
    const slotInfo = slotsByCpu.get(r.cpu);
    const queues = queuesByCpu.get(r.cpu) ?? 0;
    const slots = slotInfo?.slotsCount ?? 0;
    const lastDate = slotInfo?.lastDate ?? null;
    const sources = slotInfo?.sources ?? [];
    const freshness = calculateRegionFreshness(lastDate, now);

    items.push({
      cpu: r.cpu,
      nameUa: r.nameUa,
      queues,
      slots,
      lastDate,
      freshnessHours: freshness.freshnessHours,
      stale: freshness.stale,
      sources,
      covered: freshness.covered,
    });
  }

  for (const [cpu, slotInfo] of slotsByCpu) {
    if (handledCpus.has(cpu)) continue;
    const queues = queuesByCpu.get(cpu) ?? 0;
    const freshness = calculateRegionFreshness(slotInfo.lastDate, now);
    items.push({
      cpu,
      nameUa: cpu,
      queues,
      slots: slotInfo.slotsCount,
      lastDate: slotInfo.lastDate,
      freshnessHours: freshness.freshnessHours,
      stale: freshness.stale,
      sources: slotInfo.sources,
      covered: freshness.covered,
    });
  }

  items.sort((a, b) => a.nameUa.localeCompare(b.nameUa, 'uk') || a.cpu.localeCompare(b.cpu));

  const coveredRegions = items.filter((item) => item.covered).length;
  const staleRegions = items.filter((item) => item.stale).length;

  return {
    data: items,
    meta: {
      checkedAt: now.toISOString(),
      coveredRegions,
      staleRegions,
    },
  };
}

