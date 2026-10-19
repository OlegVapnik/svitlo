import { storage as coreStorage, type KeyValueStorage } from '../storage';
import { isQueueCode, normalizeQueueCode, sanitizeQueueList } from './queue';
import { normalizeRegionCpu } from './region';

/** Минимальный контракт хранилища: тесты передают in-memory заглушку. */
type StorageLike = Pick<KeyValueStorage, 'getItem'> & Partial<Pick<KeyValueStorage, 'setItem'>>;

export const REGION_QUEUES_STORAGE_KEY = 'svitlo_region_queues';
export const LEGACY_MY_QUEUES_KEY = 'myQueues';

/** Отримує карту збережених черг за областями з key-value сховища. */
export function getRegionQueuesMap(storage?: StorageLike): Record<string, string> {
  try {
    const raw = (storage ?? coreStorage).getItem(REGION_QUEUES_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const map: Record<string, string> = {};
    for (const [cpu, queue] of Object.entries(parsed)) {
      if (typeof queue === 'string') {
        const cleanQueue = normalizeQueueCode(queue);
        if (isQueueCode(cleanQueue)) {
          map[normalizeRegionCpu(cpu)] = cleanQueue;
        }
      }
    }
    return map;
  } catch {
    return {};
  }
}

/** Читає збережену чергу для вказаної області з урахуванням доступних черг. */
export function getStoredQueueForRegion(
  regionCpu: string,
  availableQueues: string[],
  storage?: StorageLike,
): string | null {
  const cleanCpu = normalizeRegionCpu(regionCpu);
  const map = getRegionQueuesMap(storage);

  // 1. Пріоритет: збережений вибір користувача для цієї конкретної області
  const storedForRegion = map[cleanCpu];
  if (storedForRegion) {
    if (availableQueues.length === 0 || availableQueues.includes(storedForRegion)) {
      return storedForRegion;
    }
  }

  // 2. Фолбек на legacy myQueues (якщо черга підходить для цієї області)
  try {
    const rawLegacy = (storage ?? coreStorage).getItem(LEGACY_MY_QUEUES_KEY);
    if (rawLegacy) {
      const parsedLegacy = sanitizeQueueList(JSON.parse(rawLegacy));
      const firstLegacy = parsedLegacy[0];
      if (firstLegacy) {
        if (availableQueues.length === 0 || availableQueues.includes(firstLegacy)) {
          return firstLegacy;
        }
      }
    }
  } catch {
    // ігноруємо помилки парсингу
  }

  // 3. Якщо черги є, але вибору ще немає — беремо першу чергу області (ніколи не хардкодимо '2/2')
  if (availableQueues.length > 0) {
    return availableQueues[0]!;
  }

  return null;
}


/** Зберігає обрану чергу для області в key-value сховище. */
export function setStoredQueueForRegion(
  regionCpu: string,
  queue: string,
  storage?: StorageLike,
): void {
  const cleanCpu = normalizeRegionCpu(regionCpu);
  const cleanQueue = normalizeQueueCode(queue);
  if (!isQueueCode(cleanQueue)) return;

  try {
    const map = getRegionQueuesMap(storage);
    map[cleanCpu] = cleanQueue;

    const json = JSON.stringify(map);
    const store = storage ?? coreStorage;
    store.setItem?.(REGION_QUEUES_STORAGE_KEY, json);
    // Також оновлюємо legacy myQueues для сумісності з іншими сторінками
    store.setItem?.(LEGACY_MY_QUEUES_KEY, JSON.stringify([cleanQueue]));
  } catch {
    // ігноруємо помилки квоти сховища
  }
}
