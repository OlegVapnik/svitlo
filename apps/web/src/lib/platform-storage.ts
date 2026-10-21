import { configureStorage, type KeyValueStorage } from '@svitlo/core';

/**
 * Подключает localStorage как бэкенд общего хранилища `@svitlo/core`.
 *
 * Общий код (region, закладки, офлайн-кеш) больше не знает про localStorage — он работает через
 * интерфейс `KeyValueStorage`. В вебе реализация именно такая; мобильное приложение подставит
 * expo-sqlite/kv-store. Доступ к localStorage завёрнут в try/catch: приватный режим и запрет
 * хранилища не должны ронять приложение, просто перестанут сохраняться данные.
 */
function createWebStorage(): KeyValueStorage {
  let backing: Storage | null = null;
  try {
    backing = typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    backing = null;
  }

  if (!backing) {
    // Хранилище недоступно: отдаём пустую заглушку, configureStorage ниже не вызывается.
    return {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
      keys: () => [],
    };
  }

  return {
    getItem: (key) => backing!.getItem(key),
    setItem: (key, value) => backing!.setItem(key, value),
    removeItem: (key) => backing!.removeItem(key),
    keys: () => {
      const result: string[] = [];
      for (let index = 0; index < backing!.length; index += 1) {
        const key = backing!.key(index);
        if (key !== null) result.push(key);
      }
      return result;
    },
  };
}

export function installWebStorage(): void {
  configureStorage(createWebStorage());
}
