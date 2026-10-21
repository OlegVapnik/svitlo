import Storage from 'expo-sqlite/kv-store';
import { configureStorage, type KeyValueStorage } from '@svitlo/core';

/**
 * Мобильный бэкенд хранилища: expo-sqlite/kv-store.
 *
 * Синхронные методы обязательны — офлайн-слой (кеш ответов, пакет /sync, закладки) читает
 * данные до первого рендера, как и в вебе с localStorage. MMKV сознательно не берём: v4
 * требует Nitro-модули и лишнюю нативную настройку, а kv-store — first-party Expo и работает
 * поверх той же SQLite, что уже используется приложением.
 */
const sqliteStorage: KeyValueStorage = {
  getItem: (key) => Storage.getItemSync(key),
  setItem: (key, value) => {
    Storage.setItemSync(key, value);
  },
  removeItem: (key) => {
    Storage.removeItemSync(key);
  },
  keys: () => Storage.getAllKeysSync(),
};

/** Вызывается в корневом layout до рендера экранов. */
export function installStorage(): void {
  configureStorage(sqliteStorage);
}
