/**
 * Полный цикл импорта зеркала: fetch → fingerprint → diff-write → prune.
 *
 * Одна функция на cron и на «пустую базу»: раньше эти два места (крон и `ensureSchedule`) писали в
 * D1 каждый по-своему, и любое исправление приходилось делать дважды.
 */

import {
  extractCoverage,
  extractSlots,
  isJsonObject,
  listRegionCpus,
  listRegionNames,
  mergeCoverage,
  mergeSlots,
  unwrapMirrorPayload,
  type CoverageEntry,
  type Slot,
} from './mirror-parser.js';
import { kyivToday } from './kyiv-time.js';
import { FEED_KEYS, REGION_CATALOG, regionFeedKeys } from './regions.js';
import {
  HISTORY_KEEP_DAYS,
  getMirrorFingerprint,
  pruneStaleCoverage,
  pruneStaleSlots,
  saveCoverageDiff,
  saveSlotsDiff,
  setMirrorFingerprint,
  slotsFingerprint,
  type WriteStats,
} from './d1-write.js';

export interface MirrorSyncEnv {
  DB: D1Database;
  MIRROR_SCHEDULE_URL: string;
  /** Через запятую — временно ограничить импорт областями; пусто = все области из фида. */
  MIRROR_SCHEDULE_IMPORT_REGIONS?: string;
}

export interface MirrorSyncResult extends WriteStats {
  ok: boolean;
  etag: string | null;
  /** Метка времени из payload зеркала (для `snapshot_meta`). */
  timestamp: string | null;
  regionsInFeed: number;
  regionsImported: number;
  slotsParsed: number;
  coverageParsed: number;
  skippedByFingerprint: boolean;
  pruned: boolean;
  error?: string;
}

function addDays(ymd: string, delta: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** Какие ключи фида реально импортировать. */
function resolveImportCpus(env: MirrorSyncEnv, feedCpus: string[]): string[] {
  const configured = (env.MIRROR_SCHEDULE_IMPORT_REGIONS ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  if (configured.length > 0) {
    // Ограничение задано явно — берём только его ключи. Это аварийный тормоз на случай, когда
    // дневной лимит D1 почти исчерпан: импорт одной области вместо пятнадцати.
    const allowed = new Set<string>();
    for (const cpu of configured) {
      for (const key of regionFeedKeys(cpu)) allowed.add(key);
      allowed.add(cpu);
    }
    return feedCpus.filter((cpu) => allowed.has(cpu));
  }

  // Иначе — все ключи фида, которые мы знаем как область или сеть.
  return feedCpus.filter((cpu) => FEED_KEYS.has(cpu) || REGION_CATALOG.some((entry) => entry.cpu === cpu));
}

/** Есть ли в таблице хотя бы одна строка слотов (одно чтение, без записи). */
async function dbHasSlots(db: D1Database): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 AS one FROM schedule_slots LIMIT 1`)
    .first<{ one: number }>();
  return Boolean(row);
}

async function saveMeta(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare(`INSERT OR REPLACE INTO snapshot_meta (key, value, updated_at) VALUES (?, ?, ?)`)
    .bind(key, value, new Date().toISOString())
    .run();
}

/**
 * Сохраняет имена областей от зеркала, не теряя уже известные (объединение, а не замена).
 *
 * Ключ меты — исторически `mirror_regions`, но лежит в нём `cpu → name_ua` (его читает
 * `loadMirrorRegionNames`). Класть туда список ключей фида нельзя: подписи областей превратились
 * бы в слаг.
 */
async function saveMirrorRegionNames(
  db: D1Database,
  names: Record<string, string>,
): Promise<void> {
  const fresh = Object.entries(names).filter(([, name]) => name.trim().length > 0);
  if (fresh.length === 0) return;

  const row = await db
    .prepare(`SELECT value FROM snapshot_meta WHERE key = 'mirror_regions'`)
    .first<{ value: string }>();
  const known: Record<string, string> = {};
  if (row?.value) {
    try {
      const parsed: unknown = JSON.parse(row.value);
      if (isJsonObject(parsed)) {
        for (const [cpu, name] of Object.entries(parsed)) {
          if (typeof name === 'string' && name.trim()) known[cpu] = name.trim();
        }
      }
    } catch {
      // Битое значение не повод падать: перезапишем тем, что прислало зеркало сейчас.
    }
  }

  await saveMeta(db, 'mirror_regions', JSON.stringify({ ...known, ...Object.fromEntries(fresh) }));
}

/**
 * Чистит историю не чаще раза в сутки.
 *
 * Раньше `DELETE FROM schedule_slots WHERE date < ?` выполнялся на КАЖДОМ обходе крона и на каждом
 * запросе к пустой базе. Строк он не находил, но `rows_written` за удаления D1 считает, а история
 * всё равно меняется не чаще раза в сутки: дата «сегодня» — единственное, что тут двигается.
 */
export async function pruneHistoryOncePerDay(db: D1Database, today = kyivToday()): Promise<boolean> {
  const row = await db
    .prepare(`SELECT value FROM snapshot_meta WHERE key = 'schedule_pruned_on'`)
    .first<{ value: string }>();
  if (row?.value === today) return false;

  const border = addDays(today, -HISTORY_KEEP_DAYS);
  await pruneStaleSlots(db, border);
  await pruneStaleCoverage(db, border);
  await saveMeta(db, 'schedule_pruned_on', today);
  return true;
}

/** Главный импорт: один запрос зеркала на всю Украину и запись только изменившегося. */
export async function syncMirrorSchedule(env: MirrorSyncEnv): Promise<MirrorSyncResult> {
  const emptyStats = (): WriteStats => ({
    slotsDeleted: 0,
    slotsInserted: 0,
    coverageDeleted: 0,
    coverageInserted: 0,
    regionsTouched: 0,
    skippedUnchanged: 0,
  });

  const today = kyivToday();

  // Чистку делаем ДО раннего выхода по fingerprint: иначе в спокойный день, когда график не
  // менялся, история не чистилась бы вовсе и таблица росла бы без границ.
  let pruned = false;
  try {
    pruned = await pruneHistoryOncePerDay(env.DB, today);
  } catch (error) {
    console.log(`mirror: не удалось почистить историю (${String(error)})`);
  }

  const fail = (error: string, etag: string | null = null): MirrorSyncResult => ({
    ok: false,
    etag,
    timestamp: null,
    regionsInFeed: 0,
    regionsImported: 0,
    slotsParsed: 0,
    coverageParsed: 0,
    skippedByFingerprint: false,
    pruned,
    error,
    ...emptyStats(),
  });

  try {
    const response = await fetch(env.MIRROR_SCHEDULE_URL, {
      headers: { 'user-agent': 'svitlo-cf-worker', accept: 'application/json' },
      // Тот же ответ в пределах двух минут не запрашиваем повторно: крон ходит раз в 20 минут,
      // а холодный изолят на запросе к пустой базе не должен ждать сеть дважды.
      cf: { cacheTtl: 120, cacheEverything: true },
    } as RequestInit);

    const etag = response.headers.get('etag');
    if (!response.ok) {
      console.warn(`mirror: HTTP ${response.status} на ${env.MIRROR_SCHEDULE_URL}`);
      return fail(`mirror HTTP ${response.status}`, etag);
    }

    const raw: unknown = await response.json();
    const payload = unwrapMirrorPayload(raw);
    if (!payload) {
      console.warn('mirror: неожиданный формат ответа (не читается regions/body)');
      return fail('mirror payload unwrap failed', etag);
    }
    const timestamp =
      isJsonObject(raw) && typeof raw['timestamp'] === 'string' ? raw['timestamp'] : null;

    const feedCpus = listRegionCpus(payload);
    const importCpus = resolveImportCpus(env, feedCpus);

    // Один проход по областям: слоты и покрытие собираются вместе, чтобы формат разбирался в
    // одном месте, а не в трёх копиях.
    const allSlots: Slot[] = [];
    const allCoverage: CoverageEntry[] = [];
    for (const cpu of importCpus) {
      allSlots.push(...extractSlots(payload, cpu));
      allCoverage.push(...extractCoverage(payload, cpu));
    }

    const slots = mergeSlots(allSlots);
    const coverage = mergeCoverage(allCoverage);
    const fingerprint = slotsFingerprint(slots, coverage);

    const base = {
      ok: true,
      etag,
      timestamp,
      regionsInFeed: feedCpus.length,
      regionsImported: importCpus.length,
      slotsParsed: slots.length,
      coverageParsed: coverage.length,
      pruned,
    };

    // Данные не изменились — не пишем ничего. Именно этот выход и экономит лимит: график
    // обновляется несколько раз в сутки, а крон ходит 72 раза.
    if ((await getMirrorFingerprint(env.DB)) === fingerprint) {
      // Отпечаток живёт в `snapshot_meta`, а строки — в `schedule_slots`: если таблицу очистили
      // (ручной DELETE, откат миграции), «не изменилось» стало бы ложью и график остался бы
      // пустым навсегда. Одно чтение EXISTS дешевле, чем пустой экран.
      if (slots.length === 0 || (await dbHasSlots(env.DB))) {
        return { ...base, skippedByFingerprint: true, ...emptyStats() };
      }
      console.log('mirror: отпечаток совпал, но таблица слотов пуста — перезаписываю');
    }

    const slotStats = await saveSlotsDiff(env.DB, slots, {
      source: 'mirror',
      replace: true,
      // Вчерашний и более поздние дни зеркало перетирает (там данные ещё меняются), более
      // старую историю не трогает: она уже не меняется, а перезапись стоила rows_written.
      historyBorder: addDays(today, -1),
    });
    const coverageStats = await saveCoverageDiff(env.DB, coverage, {
      source: 'mirror',
      replace: true,
    });
    await setMirrorFingerprint(env.DB, fingerprint);

    // Ключи фида и подписи — для `/regions`: фид отдаёт области шире каталога, и без имени
    // человек видел бы технический слаг.
    await saveMirrorRegionNames(env.DB, listRegionNames(payload));

    return {
      ...base,
      skippedByFingerprint: false,
      slotsDeleted: slotStats.slotsDeleted,
      slotsInserted: slotStats.slotsInserted,
      coverageDeleted: coverageStats.coverageDeleted,
      coverageInserted: coverageStats.coverageInserted,
      regionsTouched: new Set(slots.map((slot) => slot.region)).size,
      skippedUnchanged: slotStats.skippedUnchanged,
    };
  } catch (error) {
    // Логируем причину: молча проглоченная ошибка сети выглядит как «у оператора нет графика».
    return fail(error instanceof Error ? error.message : String(error));
  }
}
