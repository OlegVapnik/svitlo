import { configureStorage, type KeyValueStorage } from '@svitlo/core';

/**
 * Веб-бэкенд хранилища: localStorage.
 *
 * Mini App в Telegram — это WebView, поэтому `expo-sqlite/kv-store` здесь недоступен: его
 * веб-сборка тянет `.wasm`, а Metro не умеет собирать такой ассет без отдельной настройки.
 * Офлайн-слой (`@svitlo/core`) требует только синхронные методы — localStorage их даёт.
 *
 * Файл подхватывается Metro по платформенному расширению (`.web.ts`), нативные сборки
 * продолжают использовать `storage.ts` с kv-store.
 */
const webStorage: KeyValueStorage = {
  getItem: (key) => {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key, value) => {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Приватный режим или переполненная квота не должны ронять экран.
    }
  },
  removeItem: (key) => {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // см. setItem
    }
  },
  keys: () => {
    try {
      return Object.keys(window.localStorage);
    } catch {
      return [];
    }
  },
};

/** Вызывается в корневом layout до рендера экранов. */
export function installStorage(): void {
  configureStorage(webStorage);
}
