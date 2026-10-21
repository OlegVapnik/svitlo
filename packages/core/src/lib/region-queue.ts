import { storage as coreStorage, type KeyValueStorage } from '../storage';
import {
  canonicalQueueCode,
  isQueueCode,
  normalizeQueueCode,
  queueCodeMatches,
  sanitizeQueueList,
} from './queue';
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

/**
 * Знаходить канонічний код із доступних груп області, що відповідає збереженому коду.
 *
 * Строге `includes` тут непридатне: у Києва збережений «3» і отримана з джерела «3/1» — одна
 * група, і без зведення до канонічної форми вибір «зникав» (сітка показувала одну кодировку,
 * а графік запитувався за іншою). Коли доступних кодів немає, повертаємо канонічний код — тоді
 * сервер віддасть дані під будь-якою з форм.
 */
function resolveQueueSelection(
  regionCpu: string,
  storedCode: string,
  availableQueues: string[],
): string | null {
  if (availableQueues.length === 0) {
    const canonical = canonicalQueueCode(regionCpu, storedCode);
    return isQueueCode(canonical) ? canonical : null;
  }
  return availableQueues.find((candidate) => queueCodeMatches(regionCpu, candidate, storedCode)) ?? null;
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
    const matched = resolveQueueSelection(cleanCpu, storedForRegion, availableQueues);
    if (matched) return matched;
  }

  // 2. Фолбек на legacy myQueues (якщо черга підходить для цієї області)
  try {
    const rawLegacy = (storage ?? coreStorage).getItem(LEGACY_MY_QUEUES_KEY);
    if (rawLegacy) {
      const parsedLegacy = sanitizeQueueList(JSON.parse(rawLegacy));
      const firstLegacy = parsedLegacy[0];
      if (firstLegacy) {
        const matched = resolveQueueSelection(cleanCpu, firstLegacy, availableQueues);
        if (matched) return matched;
      }
    }
  } catch {
    // ігноруємо помилки парсингу
  }

  // 3. Якщо черги є, але вибору ще немає — беремо першу чергу області (ніколи не хардкодимо '2/2')
  if (availableQueues.length > 0) {
    const first = canonicalQueueCode(cleanCpu, availableQueues[0]!);
    return isQueueCode(first) ? first : availableQueues[0]!;
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
  const cleanQueue = canonicalQueueCode(cleanCpu, normalizeQueueCode(queue));
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
