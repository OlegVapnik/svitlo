/**
 * Единый интерфейс хранилища для веба и React Native.
 *
 * В вебе это localStorage, в мобильном приложении — expo-sqlite/kv-store (синхронные методы).
 * Офлайн-слой (пакеты /sync, кеш ответов, закладки) работает поверх этого интерфейса, поэтому
 * логика не знает, где именно лежат данные. Один контракт — два бэкенда, никаких `typeof
 * localStorage` в бизнес-коде.
 *
 * Инициализация: приложение вызывает `configureStorage(...)` до первого чтения. Если этого не
 * сделали (тесты, SSR), используется пустое in-memory хранилище — операции не падают.
 */

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  /** Список ключей — нужен для LRU-вытеснения кеша и «Скинути кеш». Может отсутствовать. */
  keys?(): string[];
}

/** Простое in-memory хранилище: тесты и безопасный фолбэк без DOM/нативного модуля. */
export function createMemoryStorage(initial?: Record<string, string>): KeyValueStorage {
  const map = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
    keys: () => [...map.keys()],
  };
}

let activeStorage: KeyValueStorage | null = null;

/** Подключает платформенный бэкенд. Вызывается один раз на старте приложения. */
export function configureStorage(next: KeyValueStorage | null): void {
  activeStorage = next;
}

export function getStorage(): KeyValueStorage {
  if (!activeStorage) activeStorage = createMemoryStorage();
  return activeStorage;
}

/**
 * Прокси-объект для бизнес-кода: всегда смотрит в текущий активный бэкенд.
 * Импортируется как `import { storage } from '@svitlo/core'`.
 */
export const storage: KeyValueStorage = {
  getItem: (key) => getStorage().getItem(key),
  setItem: (key, value) => getStorage().setItem(key, value),
  removeItem: (key) => getStorage().removeItem(key),
  keys: () => getStorage().keys?.() ?? [],
};
