import { isQueueCode, normalizeQueueCode, sanitizeQueueList } from './queue.js';
import { normalizeRegionCpu } from './region.js';

export const REGION_QUEUES_STORAGE_KEY = 'svitlo_region_queues';
export const LEGACY_MY_QUEUES_KEY = 'myQueues';

/** Отримує карту збережених черг за областями з localStorage. */
export function getRegionQueuesMap(storage?: Pick<Storage, 'getItem'>): Record<string, string> {
  try {
    const raw = storage
      ? storage.getItem(REGION_QUEUES_STORAGE_KEY)
      : typeof localStorage !== 'undefined'
        ? localStorage.getItem(REGION_QUEUES_STORAGE_KEY)
        : null;
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
  storage?: Pick<Storage, 'getItem'>,
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
    const rawLegacy = storage
      ? storage.getItem(LEGACY_MY_QUEUES_KEY)
      : typeof localStorage !== 'undefined'
        ? localStorage.getItem(LEGACY_MY_QUEUES_KEY)
        : null;
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


/** Зберігає обрану чергу для області в localStorage. */
export function setStoredQueueForRegion(
  regionCpu: string,
  queue: string,
  storage?: Pick<Storage, 'getItem' | 'setItem'>,
): void {
  const cleanCpu = normalizeRegionCpu(regionCpu);
  const cleanQueue = normalizeQueueCode(queue);
  if (!isQueueCode(cleanQueue)) return;

  try {
    const map = getRegionQueuesMap(storage);
    map[cleanCpu] = cleanQueue;

    const json = JSON.stringify(map);
    if (storage) {
      storage.setItem(REGION_QUEUES_STORAGE_KEY, json);
      // Також оновлюємо legacy myQueues для сумісності з іншими сторінками
      storage.setItem(LEGACY_MY_QUEUES_KEY, JSON.stringify([cleanQueue]));
    } else if (typeof localStorage !== 'undefined') {
      localStorage.setItem(REGION_QUEUES_STORAGE_KEY, json);
      localStorage.setItem(LEGACY_MY_QUEUES_KEY, JSON.stringify([cleanQueue]));
    }
  } catch {
    // ігноруємо помилки квоти сховища
  }
}
