import type { RegionCoverageItem, RegionCoverageResponse, RegionSummary } from '@svitlo/shared';
import {
  REGION_CATALOG,
  canonicalRegionCpu,
  isRegionCpu,
  regionFeedKeys,
  regionFeedName,
  regionReadKeys,
} from '@svitlo/shared';
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
 *
 * Псевдоніми приводяться до ключа фіда (див. shared/regions-catalog.ts): усі дані лежать під
 * ключами дзеркала, тому `?region=kyivska-oblast` читає `kiivska-oblast`, а `?region=kyiv-city` —
 * `kyiv`. Підміна прозора і нічого не втрачає: це та сама область під іншою назвою.
 *
 * Область, яку фід віддає КІЛЬКОМА мережами (м. Дніпро: ЦЕК і ДнЕМ), раніше вимагала конкретного
 * ключа: 400 `AMBIGUOUS_REGION` з переліком мереж. На живому сайті це ламало екран «область цілком»
 * (людина бачила «даних графіка немає» при живому графіку), тому тепер беремо ПЕРШУ мережу каталогу —
 * під нею дані є, коли оператор їх публікує. Конкретну мережу людина обирає в каталозі
 * (`dnipro-cek` / `dnipro-dnem`), а `/schedules` уточнює вибір за фактичними даними
 * (див. `resolveScheduleRegionScope`). `grouped: 'keep'` лишає канонічний `cpu` — так робить
 * `/queues`, який зводить лише перелік черг (метадані, не години).
 */
export function readRegionParam(raw: unknown, options: { grouped?: 'reject' | 'keep' } = {}): string {
  const value = String(raw ?? '').trim();
  if (!value) return DEFAULT_REGION;
  if (value.length > 64 || !isRegionCpu(value)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'region має вигляд «chernihivska-oblast» (cpu з каталогу /api/v1/regions)');
  }
  const canonical = canonicalRegionCpu(value);
  const keys = regionReadKeys(value);
  // Один ключ — підставляємо його: саме він ключ у `schedule_slots`, довідниках і кеші дзеркала.
  if (keys.length === 1) return keys[0]!;
  // Фід цю область не віддає: лишаємо канонічний `cpu`, запит дасть чесний порожній графік.
  if (keys.length === 0) return canonical;
  if (options.grouped === 'keep') return canonical;
  return keys[0]!;
}

/** Ключі фіда, під якими лежать дані області (для читання БД і дзеркала). Ніколи не порожній. */
export function regionDataKeys(cpu: string): string[] {
  return regionReadKeys(cpu);
}

/**
 * Звужує область, яку фід віддає кількома мережами, до ОДНІЄЇ — за фактичними даними на чергу й дату.
 *
 * Навіщо: людина в Дніпрі не знає, ЦЕК у неї чи ДнЕМ, і не має вгадувати. Якщо відключення показує
 * рівно одна мережа — читаємо її. Якщо обидві — беремо ПЕРШУ мережу каталогу: раніше тут була 400
 * `AMBIGUOUS_REGION`, і екран «область цілком» падав у «даних графіка немає» при живому графіку.
 * Мережі мають спільну нумерацію черг (1/1…6/2), тому підміна не «змішує» два графіки — показує
 * графік однієї реальної мережі; хто хоче саме свою, обирає її в каталозі (`dnipro-cek`).
 *
 * Коли жодна мережа на цю добу нічого не має (`keys` лишається повним), відповідь однаково
 * порожня: читати треба всі ключі, щоб `covered`/`allClear` були спільними для області, а не
 * взяті з першої-ліпшої мережі.
 */
export async function resolveScheduleRegionScope(
  region: string,
  queue: string,
  date: string,
): Promise<{ canonical: string; keys: string[] }> {
  // Ключі беремо від того, що реально прийшло в `?region=` (а `canonical` — лише для підпису
  // в помилці): якщо людина вже назвала мережу (`dnipro-cek`), уточнювати нічого.
  const keys = regionDataKeys(region);
  const canonical = canonicalRegionCpu(region);
  if (keys.length <= 1) return { canonical, keys };

  const { db } = await import('../db/connection.js');
  const { scheduleSlots } = await import('../db/schema.js');
  const { and, eq, inArray, sql } = await import('drizzle-orm');
  const slotRows = await db
    .select({ region: scheduleSlots.region, slots: sql<number>`count(*)::int` })
    .from(scheduleSlots)
    .where(and(inArray(scheduleSlots.region, keys), eq(scheduleSlots.queue, queue), eq(scheduleSlots.date, date)))
    .groupBy(scheduleSlots.region);
  const snapshot = peekMirrorSnapshot();

  const candidates = keys.filter((key) => {
    const hasSlots = (slotRows.find((row) => row.region === key)?.slots ?? 0) > 0;
    const coverage = snapshot ? mirrorDayCoverage(snapshot.payload, key, date) : null;
    const feedShowsOutage = coverage?.offlineQueues.includes(queue) ?? false;
    return hasSlots || feedShowsOutage;
  });

  if (candidates.length === 1) return { canonical, keys: candidates };
  if (candidates.length === 0) return { canonical, keys };
  // Дані є в кількох мережах: «області цілком» не існує, але 400 ламала екран — беремо першу мережу
  // каталогу (порядок `feedKeys` у shared/regions-catalog.ts) і віддаємо її РЕАЛЬНИЙ графік.
  return { canonical, keys: [candidates[0]!] };
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
 *
 * Канонічні області беруться з `REGION_CATALOG` (див. shared/regions-catalog.ts), а дані — з ключів
 * фіда, зазначених у `feedKeys`. Область із ОДНИМ ключем віддається як один рядок (Київська →
 * `kiivska-oblast`, Київ → `kyiv`); область із КІЛЬКОМА — як група з підобластями (`parentCpu`),
 * бо ЦЕК і ДнЕМ мають однакову нумерацію черг, але різні мережі. Область, якої фід не віддає
 * взагалі, у каталозі є з нулями: людина бачить свою область і чесне «даних немає», а не порожній
 * список без неї.
 *
 * Порядок — за назвою, але підобласть завжди стоїть ОДРАЗУ за своїм батьком (ключ сортування
 * враховує назву батька), інакше «м. Дніпро (ЦЕК)» відірвалося б від «Дніпропетровської області».
 */
export async function listRegions(): Promise<RegionSummary[]> {
  const [catalog, snapshot] = await Promise.all([
    readCatalogFromDb(),
    // Тільки кеш, без мережі: публічний GET не має чекати на сторонній worker (див. peekMirrorSnapshot).
    Promise.resolve(peekMirrorSnapshot()),
  ]);
  const { regions: regionRows, slots: slotRows } = catalog;

  /** Факти по КЛЮЧУ ФІДА: те, що справді лежить у БД і в кеші дзеркала. */
  type FeedFacts = {
    cpu: string;
    nameUa: string;
    nameEn: string | null;
    queues: string[];
    slots: number;
    lastDate: string | null;
    allClear?: boolean;
  };
  const byFeedKey = new Map<string, FeedFacts>();
  const feedNames = new Map<string, string>();
  const inactive = new Set(regionRows.filter((row) => !row.isActive).map((row) => row.cpu));

  for (const row of regionRows) {
    if (row.isActive) {
      byFeedKey.set(row.cpu, {
        cpu: row.cpu,
        nameUa: row.nameUa,
        nameEn: row.nameEn,
        queues: [],
        slots: 0,
        lastDate: null,
      });
    }
  }

  // Слоти, яких немає в довіднику (імпорт ДО появи каталогу): показуємо з чесною назвою = cpu.
  for (const row of slotRows) {
    if (inactive.has(row.cpu)) continue;
    const existing =
      byFeedKey.get(row.cpu) ?? { cpu: row.cpu, nameUa: row.cpu, nameEn: null, queues: [], slots: 0, lastDate: null };
    existing.queues.push(row.queue);
    existing.slots += row.slots;
    if (row.lastDate && (!existing.lastDate || row.lastDate > existing.lastDate)) existing.lastDate = row.lastDate;
    byFeedKey.set(row.cpu, existing);
  }

  if (snapshot) {
    // Стан «оператор опублікував ГПВ, відключень немає» інакше не відрізнити від «даних немає»:
    // у такої області нуль слотів у БД, бо зберігати нічого. Дата — сьогодні (як `date_today` фіда),
    // бо саме про «зараз» людина й питає. Фід нічого не опублікував на цю дату → `allClear` не ставимо.
    const todayYmd = kyivYmd(new Date());
    for (const feedRegion of regionsFromSnapshot(snapshot)) {
      if (inactive.has(feedRegion.cpu)) continue;
      feedNames.set(feedRegion.cpu, feedRegion.nameUa);
      const existing =
        byFeedKey.get(feedRegion.cpu) ??
        { cpu: feedRegion.cpu, nameUa: feedRegion.nameUa, nameEn: null, queues: [], slots: 0, lastDate: null };
      const coverage = mirrorDayCoverage(snapshot.payload, feedRegion.cpu, todayYmd);
      if (coverage) existing.allClear = coverage.offlineQueues.length === 0;
      for (const queue of feedRegion.queues) if (!existing.queues.includes(queue)) existing.queues.push(queue);
      byFeedKey.set(feedRegion.cpu, existing);
    }
  }

  /** Один рядок каталогу з ключа фіда (підобласть або область, якої немає в каталозі). */
  const rowOf = (facts: FeedFacts, nameUa: string, parentCpu?: string): RegionSummary => ({
    cpu: facts.cpu,
    nameUa,
    nameEn: facts.nameEn,
    queues: [...new Set(facts.queues)].sort(compareQueueCodes),
    slots: facts.slots,
    lastDate: facts.lastDate,
    ...(facts.allClear !== undefined ? { allClear: facts.allClear } : {}),
    feedKeys: [facts.cpu],
    ...(parentCpu ? { parentCpu } : {}),
  });

  const rows: RegionSummary[] = [];
  const consumed = new Set<string>();

  for (const entry of REGION_CATALOG) {
    // Область вимкнена в довіднику (`is_active = false`) — це свідоме рішення оператора приховати
    // її, тому в каталозі її немає. Область, якої в довіднику просто немає, навпаки, показуємо:
    // саме заради «знайти свою область» каталог і перелічує всі 24 області та Київ.
    if (entry.feedKeys.length > 0 && entry.feedKeys.every((key) => inactive.has(key))) {
      for (const key of entry.feedKeys) consumed.add(key);
      continue;
    }
    const facts = entry.feedKeys
      .map((key) => byFeedKey.get(key))
      .filter((fact): fact is FeedFacts => Boolean(fact));
    for (const key of entry.feedKeys) consumed.add(key);

    // Зведення по мережах області: черги — об'єднання, слоти — сума, дата — найсвіжіша.
    const merged: RegionSummary = {
      cpu: entry.cpu,
      // Назву беремо з довідника (`regions.name_ua`) або з фіда, якщо оператор її там перейменував;
      // інакше — з канонічного каталогу. Для області з кількома мережами назви мереж належать
      // підобластям («м. Дніпро (ЦЕК)»), тому група завжди зветься назвою області.
      nameUa:
        entry.feedKeys.length > 1
          ? entry.nameUa
          : facts.find((fact) => fact.nameUa !== fact.cpu)?.nameUa ?? entry.nameUa,
      // Англійську назву беремо з довідника (`name_en`), якщо вона там є; трансліт не вигадуємо.
      nameEn: facts.find((fact) => fact.nameEn)?.nameEn ?? null,
      queues: [...new Set(facts.flatMap((fact) => fact.queues))].sort(compareQueueCodes),
      slots: facts.reduce((sum, fact) => sum + fact.slots, 0),
      lastDate: facts.reduce<string | null>(
        (max, fact) => (fact.lastDate && (!max || fact.lastDate > max) ? fact.lastDate : max),
        null,
      ),
      feedKeys: [...entry.feedKeys],
    };
    // «Світло за графіком» для області з кількома мережами — тільки якщо КОЖНА з них опублікувала
    // добу без відключень: якщо хоч одна мережа мовчить, чесніше «немає даних», ніж обіцянка світла.
    if (facts.length > 0 && facts.every((fact) => fact.allClear !== undefined)) {
      merged.allClear = facts.every((fact) => fact.allClear === true);
    }
    rows.push(merged);

    // Підобласті — лише для областей із кількома мережами: для 1:1 підміна прозора, окремий рядок
    // був би дублем («Київська область» і ще раз «Київська область»).
    if (entry.feedKeys.length > 1) {
      for (const key of entry.feedKeys) {
        const fact = byFeedKey.get(key);
        if (fact) rows.push(rowOf(fact, regionFeedName(key, feedNames.get(key)), entry.cpu));
      }
    }
  }

  // Ключі, яких немає в каталозі (напр. легасі-область із власним імпортом): віддаємо як є з
  // чесною назвою — вигадувати їм область-«батька» не можна.
  for (const fact of byFeedKey.values()) {
    if (consumed.has(fact.cpu)) continue;
    rows.push(rowOf(fact, feedNames.get(fact.cpu) ?? fact.nameUa));
  }

  // Ключ сортування: підобласть сортується за назвою БАТЬКА, тому вона не відривається від нього.
  const sortKey = new Map<string, string>();
  for (const row of rows) {
    const parentName = row.parentCpu ? rows.find((item) => item.cpu === row.parentCpu)?.nameUa : undefined;
    sortKey.set(row.cpu, parentName ? `${parentName} ${row.nameUa}` : row.nameUa);
  }
  return rows.sort(
    (a, b) =>
      (sortKey.get(a.cpu) ?? a.nameUa).localeCompare(sortKey.get(b.cpu) ?? b.nameUa, 'uk') ||
      a.cpu.localeCompare(b.cpu),
  );
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

