/**
 * Экономный запись в D1: минимум `rows_written` при масштабе на все области.
 *
 * Проблема бесплатного тарифа: 100 000 `rows_written` в сутки. Старый путь писал на КАЖДОМ кроне
 * (раз в 20 минут) `DELETE (region, date)` + `INSERT` всех интервалов, даже если график не изменился:
 * пятнадцать областей × десятки интервалов × 72 обхода — и лимит сгорал за день.
 *
 * Новый путь:
 *  1. Читаем текущие строки только для затронутых `(region, date)`.
 *  2. Строим разницу множеств: `toDelete` / `toInsert`.
 *  3. Пишем только дельту. Данные не изменились — 0 writes.
 *  4. Удаление точечное (область, очередь, дата, начало) — чужие очереди и источники не трогаем.
 */

import type { CoverageEntry, Slot } from './mirror-parser.js';

/** Лимит D1 на число связанных переменных в одном запросе. */
const MAX_VARIABLES = 100;
const SLOT_COLUMNS = 6;
const COVERAGE_COLUMNS = 6;
const SLOT_CHUNK = Math.max(1, Math.floor(MAX_VARIABLES / SLOT_COLUMNS));
const COVERAGE_CHUNK = Math.max(1, Math.floor(MAX_VARIABLES / COVERAGE_COLUMNS));

/**
 * Сколько дней истории графика хранить.
 *
 * Неделя, а не 5 дней: от этих строк зависит отчёт «Статистика електропостачання» (`/reliability`,
 * окно до 7 дней). Экономию даёт не укорачивание окна, а то, что чистка выполняется раз в сутки,
 * а не на каждом обходе.
 */
export const HISTORY_KEEP_DAYS = 7;

/** Сколько строк реально тронуто — для логов и `/status`. */
export interface WriteStats {
  slotsDeleted: number;
  slotsInserted: number;
  coverageDeleted: number;
  coverageInserted: number;
  regionsTouched: number;
  skippedUnchanged: number;
}

/** Ключ строки слота: первичный ключ таблицы без источника. */
function slotKey(s: { region: string; queue: string; date: string; timeFrom: string }): string {
  return `${s.region}|${s.queue}|${s.date}|${s.timeFrom}`;
}

function coverageKey(c: { region: string; date: string; queue: string }): string {
  return `${c.region}|${c.date}|${c.queue}`;
}

/**
 * Отпечаток набора слотов и покрытия (FNV-1a 32 бита).
 *
 * Достаточно, чтобы отличить «график не менялся» от «менялся»: коллизия дала бы пропуск одной
 * записи до следующего обхода, а не порчу графика. `crypto.subtle` тут не нужен и стоил бы CPU.
 */
export function slotsFingerprint(slots: Slot[], coverage: CoverageEntry[] = []): string {
  const parts = slots
    .map((s) => `${s.region}|${s.queue}|${s.date}|${s.timeFrom}|${s.timeTo}`)
    .concat(coverage.map((c) => `${c.region}|${c.date}|${c.queue}|${c.hasOutages ? 1 : 0}`))
    .sort();
  let h = 0x811c9dc5;
  const str = parts.join('\n');
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/**
 * Сохраняет слоты разницей.
 *
 * `replace: true` — зеркало (авторитетный источник): строки за затронутые (область, дата) сверяются
 * с пришедшими, лишние удаляются точечно. `replace: false` — Telegram: снимаем только СВОИ строки и
 * вставляем с `INSERT OR IGNORE`, чужой график не перетираем (та же семантика, что у Node-бэкенда).
 *
 * `historyBorder` — граница, раньше которой зеркало историю не трогает: иначе вчерашние и более
 * старые слоты перезаписывались бы на каждом обходе, хотя они уже не меняются.
 */
export async function saveSlotsDiff(
  db: D1Database,
  slots: Slot[],
  options: { source?: string; replace?: boolean; historyBorder?: string } = {},
): Promise<Pick<WriteStats, 'slotsDeleted' | 'slotsInserted' | 'skippedUnchanged'>> {
  if (slots.length === 0) {
    return { slotsDeleted: 0, slotsInserted: 0, skippedUnchanged: 0 };
  }
  const source = options.source ?? 'mirror';
  const replace = options.replace ?? true;
  const historyBorder = options.historyBorder ?? '1970-01-01';

  // Группируем по (region, date): это единица замены у зеркала.
  const byRegionDate = new Map<string, Slot[]>();
  const history: Slot[] = [];
  for (const slot of slots) {
    if (replace && slot.date < historyBorder) {
      // Прошлые даты не переписываем, но и не теряем: на чистой базе это единственный способ
      // заполнить историю, от которой зависит «Статистика електропостачання». `INSERT OR IGNORE`
      // существующие строки не трогает, поэтому повторные обходы ничего не пишут.
      history.push(slot);
      continue;
    }
    const key = `${slot.region}|${slot.date}`;
    const list = byRegionDate.get(key);
    if (list) list.push(slot);
    else byRegionDate.set(key, [slot]);
  }

  let slotsDeleted = 0;
  let slotsInserted = 0;
  let skippedUnchanged = 0;

  for (const [rdKey, incoming] of byRegionDate) {
    const [region, date] = rdKey.split('|') as [string, string];

    // Один SELECT на (region, date) дешевле, чем DELETE + INSERT всего блока.
    const existing = await db
      .prepare(
        `SELECT region, queue, date, time_from AS timeFrom, time_to AS timeTo, source
         FROM schedule_slots WHERE region = ? AND date = ?`,
      )
      .bind(region, date)
      .all<{
        region: string;
        queue: string;
        date: string;
        timeFrom: string;
        timeTo: string;
        source: string;
      }>();

    const existingMap = new Map<string, { timeTo: string; source: string }>();
    for (const row of existing.results ?? []) {
      // При replace смотрим все источники; при Telegram — только свои.
      if (!replace && row.source !== source) continue;
      existingMap.set(slotKey(row), { timeTo: row.timeTo, source: row.source });
    }

    const incomingMap = new Map<string, Slot>();
    for (const slot of incoming) incomingMap.set(slotKey(slot), slot);

    const toDelete: Array<{ region: string; queue: string; date: string; timeFrom: string }> = [];
    for (const [key, prev] of existingMap) {
      const next = incomingMap.get(key);
      // `prev.source !== source` — авторитетный источник забирает строку себе: иначе интервал,
      // который Telegram записал раньше, навсегда остался бы с чужим `source`.
      if (!next || next.timeTo !== prev.timeTo || prev.source !== source) {
        const [r, q, d, tf] = key.split('|') as [string, string, string, string];
        toDelete.push({ region: r, queue: q, date: d, timeFrom: tf });
      }
    }

    const toInsert: Slot[] = [];
    for (const [key, slot] of incomingMap) {
      const prev = existingMap.get(key);
      if (!prev || prev.timeTo !== slot.timeTo || prev.source !== source) toInsert.push(slot);
    }

    if (toDelete.length === 0 && toInsert.length === 0) {
      skippedUnchanged += 1;
      continue;
    }

    for (const row of toDelete) {
      await db
        .prepare(
          `DELETE FROM schedule_slots WHERE region = ? AND queue = ? AND date = ? AND time_from = ?`,
        )
        .bind(row.region, row.queue, row.date, row.timeFrom)
        .run();
      slotsDeleted += 1;
    }

    const verb = replace ? 'INSERT OR REPLACE' : 'INSERT OR IGNORE';
    for (let start = 0; start < toInsert.length; start += SLOT_CHUNK) {
      const chunk = toInsert.slice(start, start + SLOT_CHUNK);
      const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
      const values = chunk.flatMap((slot) => [
        slot.region,
        slot.queue,
        slot.date,
        slot.timeFrom,
        slot.timeTo,
        source,
      ]);
      await db
        .prepare(
          `${verb} INTO schedule_slots (region, queue, date, time_from, time_to, source)
           VALUES ${placeholders}`,
        )
        .bind(...values)
        .run();
      slotsInserted += chunk.length;
    }
  }

  if (history.length > 0) {
    for (let start = 0; start < history.length; start += SLOT_CHUNK) {
      const chunk = history.slice(start, start + SLOT_CHUNK);
      const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
      const values = chunk.flatMap((slot) => [
        slot.region,
        slot.queue,
        slot.date,
        slot.timeFrom,
        slot.timeTo,
        source,
      ]);
      const result = await db
        .prepare(
          `INSERT OR IGNORE INTO schedule_slots (region, queue, date, time_from, time_to, source)
           VALUES ${placeholders}`,
        )
        .bind(...values)
        .run();
      // Считаем именно записанные строки: на уже заполненной истории это 0.
      slotsInserted += result.meta?.changes ?? 0;
    }
  }

  return { slotsDeleted, slotsInserted, skippedUnchanged };
}

/**
 * Сохраняет покрытие разницей — так же, как слоты.
 *
 * Покрытие пишется отдельно от слотов сознательно: «оператор опубликовал график, отключений нет» и
 * «оператор ничего не публиковал» дают одинаково пустой список слотов, и без этой таблицы второе
 * неотличимо от первого.
 */
export async function saveCoverageDiff(
  db: D1Database,
  entries: CoverageEntry[],
  options: { source?: string; replace?: boolean } = {},
): Promise<Pick<WriteStats, 'coverageDeleted' | 'coverageInserted'>> {
  if (entries.length === 0) return { coverageDeleted: 0, coverageInserted: 0 };
  const source = options.source ?? 'mirror';
  const replace = options.replace ?? true;
  const now = new Date().toISOString();

  const byRegionDate = new Map<string, CoverageEntry[]>();
  for (const entry of entries) {
    const key = `${entry.region}|${entry.date}`;
    const list = byRegionDate.get(key);
    if (list) list.push(entry);
    else byRegionDate.set(key, [entry]);
  }

  let coverageDeleted = 0;
  let coverageInserted = 0;

  for (const [rdKey, incoming] of byRegionDate) {
    const [region, date] = rdKey.split('|') as [string, string];
    const existing = await db
      .prepare(
        `SELECT region, date, queue, has_outages AS hasOutages, source
         FROM schedule_coverage WHERE region = ? AND date = ?`,
      )
      .bind(region, date)
      .all<{
        region: string;
        date: string;
        queue: string;
        hasOutages: number;
        source: string;
      }>();

    const existingMap = new Map<string, { hasOutages: boolean; source: string }>();
    for (const row of existing.results ?? []) {
      if (!replace && row.source !== source) continue;
      existingMap.set(coverageKey(row), { hasOutages: row.hasOutages === 1, source: row.source });
    }

    const incomingMap = new Map<string, CoverageEntry>();
    for (const entry of incoming) incomingMap.set(coverageKey(entry), entry);

    const toDelete: Array<{ region: string; date: string; queue: string }> = [];
    for (const [key, prev] of existingMap) {
      const next = incomingMap.get(key);
      // Смена `source` — тоже изменение: строка, пришедшая из Telegram, должна стать зеркальной.
      if (!next || next.hasOutages !== prev.hasOutages || prev.source !== source) {
        const [r, d, q] = key.split('|') as [string, string, string];
        toDelete.push({ region: r, date: d, queue: q });
      }
    }

    const toInsert: CoverageEntry[] = [];
    for (const [key, entry] of incomingMap) {
      const prev = existingMap.get(key);
      if (!prev || prev.hasOutages !== entry.hasOutages || prev.source !== source) toInsert.push(entry);
    }

    for (const row of toDelete) {
      await db
        .prepare(`DELETE FROM schedule_coverage WHERE region = ? AND date = ? AND queue = ?`)
        .bind(row.region, row.date, row.queue)
        .run();
      coverageDeleted += 1;
    }

    for (let start = 0; start < toInsert.length; start += COVERAGE_CHUNK) {
      const chunk = toInsert.slice(start, start + COVERAGE_CHUNK);
      const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
      const values = chunk.flatMap((entry) => [
        entry.region,
        entry.date,
        entry.queue,
        entry.hasOutages ? 1 : 0,
        source,
        now,
      ]);
      await db
        .prepare(
          `INSERT OR REPLACE INTO schedule_coverage
             (region, date, queue, has_outages, source, updated_at)
           VALUES ${placeholders}`,
        )
        .bind(...values)
        .run();
      coverageInserted += chunk.length;
    }
  }

  return { coverageDeleted, coverageInserted };
}

/** Удаляет протухшие слоты. Вызывать раз в сутки, а не на каждом обходе. */
export async function pruneStaleSlots(db: D1Database, borderDate: string): Promise<number> {
  const result = await db.prepare(`DELETE FROM schedule_slots WHERE date < ?`).bind(borderDate).run();
  return result.meta?.changes ?? 0;
}

/** То же для покрытия: иначе «график опубликован» остаётся на давно ушедшие даты. */
export async function pruneStaleCoverage(db: D1Database, borderDate: string): Promise<number> {
  const result = await db
    .prepare(`DELETE FROM schedule_coverage WHERE date < ?`)
    .bind(borderDate)
    .run();
  return result.meta?.changes ?? 0;
}

/** Отпечаток последнего успешного импорта; `null` — импорта ещё не было. */
export async function getMirrorFingerprint(db: D1Database): Promise<string | null> {
  const row = await db
    .prepare(`SELECT value FROM snapshot_meta WHERE key = 'mirror_slots_fp'`)
    .first<{ value: string }>();
  return row?.value ?? null;
}

export async function setMirrorFingerprint(db: D1Database, fingerprint: string): Promise<void> {
  await db
    .prepare(`INSERT OR REPLACE INTO snapshot_meta (key, value, updated_at) VALUES ('mirror_slots_fp', ?, ?)`)
    .bind(fingerprint, new Date().toISOString())
    .run();
}
