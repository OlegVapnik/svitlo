/**
 * Офлайн-кеш ответов API для мобильного приложения.
 *
 * Зачем: человек в районе без связи (это в Чернигівщине обычное дело) должен всё равно видеть
 * график отключений — хотя бы тот, что был при последнем подключении. Когда сеть возвращается,
 * следующий успешный ответ автоматически перезаписывает кеш, так что данные «свежеют» сами.
 *
 * Почему НЕ Service Worker: в нативной обёртке (Capacitor) SW встаёт перед локальной раздачей
 * ассетов и ломает загрузку приложения — это уже приходилось выяснять (см.
 * tools/build-android-apk.sh, где sw.js вырезается из APK). Для кеша ДАННЫХ он не нужен:
 * ассеты и так лежат внутри APK, а ответы API мы храним сами.
 *
 * Хранилище — платформенный key-value бэкенд `@svitlo/core` (localStorage в вебе,
 * expo-sqlite/kv-store в мобильном): один контракт, две реализации.
 * Ответы небольшие (каталог областей ~140 КБ, график группы — килобайты), но размер всё равно
 * ограничиваем и чистим, иначе можно упереться в квоту и потерять кеш целиком.
 */

import { storage } from '../storage';

const PREFIX = 'svitlo:api:';
const INDEX_KEY = 'svitlo:api:index';
/** Максимальный размер одного ответа. Крупнее — не кешируем (это уже не «график отключения»). */
const MAX_ENTRY_CHARS = 300_000;
/** Сколько ответов держим. Областей и очередей десятки, эндпоинтов — полтора десятка. */
const MAX_ENTRIES = 60;

export interface CacheEntry {
  /** Когда ответ получен (ISO). */
  at: string;
  data: unknown;
}

type Listener = () => void;

const listeners = new Set<Listener>();

/** Ответ был отдан из кеша (значит сети не было) — флаг для баннера в интерфейсе. */
let servedFromCache = false;
let lastCacheAt: string | null = null;

function notify(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // Слушатель не должен ронять запись кеша.
    }
  }
}

export function subscribeOffline(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isOfflineServed(): boolean {
  return servedFromCache;
}

export function offlineServedAt(): string | null {
  return lastCacheAt;
}

function readIndex(): string[] {
  const store = storage;
  try {
    const parsed = JSON.parse(store.getItem(INDEX_KEY) ?? '[]');
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

function writeIndex(keys: string[]): void {
  const store = storage;
  try {
    store.setItem(INDEX_KEY, JSON.stringify(keys));
  } catch {
    // Квота исчерпана — не настаиваем: лучше кеш без индекса, чем падение запроса.
  }
}

/** Сохраняет успешный ответ. Молча отказывает, если хранилище недоступно или переполнено. */
export function writeCache(endpoint: string, data: unknown): void {
  const store = storage;
  let serialized: string;
  try {
    serialized = JSON.stringify({ at: new Date().toISOString(), data });
  } catch {
    return; // Ответ не сериализуется (циклы, BigInt) — кешировать нечего.
  }
  if (serialized.length > MAX_ENTRY_CHARS) return;

  const key = PREFIX + endpoint;
  try {
    store.setItem(key, serialized);
  } catch {
    return;
  }

  const index = readIndex().filter((item) => item !== key);
  index.push(key);
  // Вытесняем самые старые записи, чтобы не упереться в квоту.
  while (index.length > MAX_ENTRIES) {
    const evicted = index.shift();
    if (evicted) store.removeItem(evicted);
  }
  writeIndex(index);
}

/** Читает кеш ответа. null — если записи нет или она повреждена. */
export function readCache(endpoint: string): CacheEntry | null {
  const store = storage;
  try {
    const raw = store.getItem(PREFIX + endpoint);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry;
    if (typeof parsed?.at !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Помечает состояние «сейчас отдаём из кеша» — вызывается из fetcher, когда сеть не ответила.
 * Один запрос без сети не считается офлайном: режим включается после неудачи, а сбрасывается
 * при первом же успешном ответе (см. noteServedOnline).
 */
export function noteServedFromCache(entry: CacheEntry): void {
  servedFromCache = true;
  lastCacheAt = entry.at;
  notify();
}

export function noteServedOnline(): void {
  if (!servedFromCache) return;
  servedFromCache = false;
  lastCacheAt = null;
  notify();
}

/** Очистка кеша (например, при смене области или по кнопке в интерфейсе). */
export function clearCache(): void {
  const store = storage;
  for (const key of readIndex()) store.removeItem(key);
  writeIndex([]);
  servedFromCache = false;
  lastCacheAt = null;
  notify();
}