/**
 * Офлайн-снимок графиков ВСЕХ групп области.
 *
 * Зачем отдельный кэш, если в `offline-cache.ts` уже кэшируются ответы по эндпоинтам:
 *   - обычный кэш привязан к точному URL (`/schedules?queue=2/2&date=…`), то есть к каждой
 *     кнопке группы своя запись, и без сети работает только та, которую нажимали последней;
 *   - он пишется только ПОСЛЕ успешного ответа, поэтому нажатая кнопка впервые открывается
 *     пустой, даже если рядом уже загружены графики других групп.
 *
 * Здесь снимок один на область и пишется сразу, как только пришёл ответ `upcoming`. После
 * одного визита в приложение со связью в офлайне доступны все кнопки групп 1/1…6/2 — включая
 * те, которые человек ещё ни разу не нажимал.
 *
 * Ключ в localStorage: `svitlo:offline-region-schedules:<region>` (по заданию).
 */
import type { QueueScheduleData, ScheduleIntervalUtc } from '@svitlo/shared';

const PREFIX = 'svitlo:offline-region-schedules:';

/**
 * Потолок размера снимка. Снимок — это интервалы всех групп области за 2 дня; в реальности он
 * занимает десятки килобайт. Ограничение нужно, чтобы не вытеснить из квоты localStorage
 * закладки и кэш ответов API (там уже есть свой лимит на запись).
 */
const MAX_SNAPSHOT_CHARS = 900_000;

/** Одна «корзина» графика: все отключения одной группы за одну дату. */
interface SnapshotBucket {
  queue: string;
  date: string;
  intervals: ScheduleIntervalUtc[];
}

interface RegionSnapshot {
  at: string;
  buckets: SnapshotBucket[];
}

/**
 * Единый вид кода группы для сравнения: «2.2», «2 / 2» и «2/2» — одна и та же группа.
 * Офлайн-снимок пишется из ответа API, где код уже канонический, но сравнивать приходится
 * с кодом из закладки или из localStorage, где мог остаться формат с точкой.
 */
function queueKey(value: string): string {
  return String(value ?? '')
    .trim()
    .replace(/[.\s]+/gu, '/')
    .toLowerCase();
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // Приватный режим / запрет хранилища — просто не кэшируем.
    return null;
  }
}

function snapshotKey(region: string): string {
  return PREFIX + String(region ?? '').trim();
}

/**
 * Сохраняет срез по всем группам области.
 *
 * Молча отказывает, если хранилище недоступно или не помещается: отсутствие кэша — это
 * «в офлайне покажем пусто», но не падение приложения.
 */
export function writeRegionScheduleSnapshot(region: string, buckets: readonly SnapshotBucket[]): void {
  const store = storage();
  if (!store || !region) return;

  const snapshot: RegionSnapshot = {
    at: new Date().toISOString(),
    // Сохраняем только нужное: settlements/streetNames в снимке не участвуют, а место занимают.
    buckets: buckets
      .filter((bucket) => bucket && bucket.queue && bucket.date && Array.isArray(bucket.intervals))
      .map((bucket) => ({ queue: bucket.queue, date: bucket.date, intervals: bucket.intervals })),
  };

  let serialized: string;
  try {
    serialized = JSON.stringify(snapshot);
  } catch {
    return;
  }
  if (serialized.length > MAX_SNAPSHOT_CHARS) return;

  try {
    store.setItem(snapshotKey(region), serialized);
  } catch {
    // Квота исчерпана — не настаиваем.
  }
}

/** Читает снимок области. null — записи нет или она повреждена/чужая по региону. */
export function readRegionScheduleSnapshot(region: string): RegionSnapshot | null {
  const store = storage();
  if (!store || !region) return null;
  try {
    const raw = store.getItem(snapshotKey(region));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RegionSnapshot;
    if (!Array.isArray(parsed?.buckets) || typeof parsed.at !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Достаёт из снимка график конкретной группы за конкретную дату.
 *
 * `source` помечен как 'offline' — человек должен видеть, что это последний известный ответ,
 * а не только что света нет. Иначе в офлайне легко принять устаревший график за сегодняшний.
 */
export function pickRegionSchedule(
  region: string,
  queue: string | undefined,
  date: string,
): QueueScheduleData | null {
  const cleanQueue = String(queue ?? '').trim();
  if (!cleanQueue || !date) return null;

  const snapshot = readRegionScheduleSnapshot(region);
  if (!snapshot) return null;

  const wanted = queueKey(cleanQueue);
  const bucket = snapshot.buckets.find(
    (item) => item.date === date && queueKey(item.queue) === wanted,
  );
  if (!bucket) return null;

  return {
    queue: cleanQueue,
    date,
    intervals: bucket.intervals,
    source: 'offline',
    // Время сохранения снимка, а не выгрузки оператора: офлайн мы не знаем, когда он свежий,
    // поэтому честно показываем, сколько времени прошло с последнего сетевого ответа.
    lastImportedAt: snapshot.at,
  };
}
