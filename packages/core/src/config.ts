/**
 * Конфигурация рантайма, которую задаёт платформа (веб или React Native).
 *
 * Зачем не `import.meta.env`: в Vite переменные окружения подставляются на этапе сборки, а в
 * Metro такого механизма нет — при переносе кода в `@svitlo/core` пришлось бы держать две ветки
 * чтения. Вместо этого приложение один раз вызывает `configureCoreApi(...)` на старте, а общий
 * код всюду читает `getCoreConfig()`.
 *
 * Значения по умолчанию рассчитаны на веб: относительный `/api/v1` (тот же origin) и version
 * `dev`. Мобильное приложение обязано задать абсолютный адрес API — на эмуляторе или телефоне
 * относительный путь никуда не ведёт.
 */

export interface CoreConfig {
  /** Базовый адрес API без завершающего слэша, например `https://svitlo.ua/api/v1`. */
  apiBaseUrl: string;
  /** Версия приложения — уходит в заголовок `X-App-Version` и в диагностику. */
  appVersion: string;
}

const DEFAULT_CONFIG: CoreConfig = {
  apiBaseUrl: '/api/v1',
  appVersion: 'dev',
};

let activeConfig: CoreConfig = DEFAULT_CONFIG;

/** Подключает платформенную конфигурацию. Вызывается один раз до первого запроса. */
export function configureCoreApi(options: Partial<CoreConfig>): void {
  activeConfig = { ...DEFAULT_CONFIG, ...options };
}

export function getCoreConfig(): CoreConfig {
  return activeConfig;
}

export function getApiBaseUrl(): string {
  return activeConfig.apiBaseUrl;
}
