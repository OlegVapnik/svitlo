import type { ChangelogRelease } from '@svitlo/shared';

/**
 * Логика экрана обновлений: сравнение версий, сводка «что изменилось с прошлого раза»
 * и запуск OTA-обновления.
 *
 * Чистые функции вынесены сюда, чтобы их можно было проверить тестом без DOM. Побочные
 * действия (localStorage, DownloadManager, Service Worker) изолированы в конце файла.
 */

export const LAST_SEEN_VERSION_KEY = 'svitlo_last_seen_version';
export const APK_FILE_NAME = 'svitlo-latest.apk';

/** Публичный адрес Pages. APK лежит рядом с сайтом, поэтому ссылка не зависит от API-домена. */
const DEFAULT_PUBLIC_SITE = 'https://svitlo-ua-4ze.pages.dev';

export function parseVersion(value: string | null | undefined): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/u.exec(String(value ?? '').trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** > 0, если `left` новее `right`; 0 — равны; < 0 — старее. */
export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return 0;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index]! - b[index]!;
  }
  return 0;
}

export function isNewerVersion(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0;
}

export interface UpdateSummary {
  /** От какой версии считаем изменения. */
  fromVersion: string;
  /** Куда обновляемся (серверная версия, если она новее установленной). */
  toVersion: string;
  /** Есть ли на сервере сборка новее установленной. */
  hasUpdate: boolean;
  /** Релизы, которые стоит показать в сводке. */
  releases: ChangelogRelease[];
  features: number;
  fixes: number;
  optimizations: number;
}

/**
 * Сводка для экрана обновлений.
 *
 * `lastSeen` — версия, которую человек уже видел. Если её нет (первый запуск экрана), считаем
 * от предыдущего релиза: так новый пользователь видит, что принесла установленная версия, а не
 * пустую историю. Для OTA-обновления базой становится установленная версия: показываем ровно
 * то, что появится после обновления.
 */
export function summarizeUpdate(
  releases: ChangelogRelease[],
  installedVersion: string,
  serverVersion: string,
  lastSeen: string | null,
): UpdateSummary {
  const knownInstalled = parseVersion(installedVersion) ? installedVersion : '0.0.0';
  const knownServer = parseVersion(serverVersion) ? serverVersion : knownInstalled;
  const hasUpdate = isNewerVersion(knownServer, knownInstalled);
  const toVersion = hasUpdate ? knownServer : knownInstalled;
  const seen = parseVersion(lastSeen) ? lastSeen : null;

  const previousRelease = releases.find((release) => compareVersions(release.version, toVersion) < 0);
  const fromVersion = seen ?? (hasUpdate ? knownInstalled : previousRelease?.version ?? toVersion);

  let selected = releases.filter(
    (release) => compareVersions(release.version, fromVersion) > 0 && compareVersions(release.version, toVersion) <= 0,
  );
  // История без новых пунктов: показываем последний релиз, а не пустую сводку.
  if (selected.length === 0) selected = releases.slice(0, 1);

  return {
    fromVersion,
    toVersion,
    hasUpdate,
    releases: selected,
    features: selected.reduce((sum, release) => sum + release.features.length, 0),
    fixes: selected.reduce((sum, release) => sum + release.fixes.length, 0),
    optimizations: selected.reduce((sum, release) => sum + release.optimizations.length, 0),
  };
}

function envValue(name: string): string | null {
  const value = (import.meta.env as Record<string, string | undefined>)[name];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Прямая ссылка на последний APK. Может быть переопределена на этапе сборки. */
export function apkDownloadUrl(): string {
  const explicit = envValue('VITE_APK_URL');
  if (explicit) return explicit;
  const site = envValue('VITE_PUBLIC_SITE_URL') ?? DEFAULT_PUBLIC_SITE;
  return `${site.replace(/\/+$/u, '')}/${APK_FILE_NAME}`;
}

export function readLastSeenVersion(): string | null {
  try {
    const value = typeof localStorage === 'undefined' ? null : localStorage.getItem(LAST_SEEN_VERSION_KEY);
    return parseVersion(value) ? value : null;
  } catch {
    return null;
  }
}

export function markVersionSeen(version: string): void {
  if (!parseVersion(version)) return;
  try {
    localStorage.setItem(LAST_SEEN_VERSION_KEY, version);
  } catch {
    // Приватный режим или запрет хранилища: экран просто покажется ещё раз.
  }
}

export interface NativeUpdateBridge {
  downloadUpdate: (apkUrl: string) => boolean;
}

function nativeBridge(): NativeUpdateBridge | null {
  if (typeof window === 'undefined') return null;
  const bridge = (window as Window & { SvitloNative?: Partial<NativeUpdateBridge> }).SvitloNative;
  return typeof bridge?.downloadUpdate === 'function' ? (bridge as NativeUpdateBridge) : null;
}

export function isNativeApp(): boolean {
  return nativeBridge() !== null;
}

/**
 * Скачивание APK. В Android-обёртке — системный DownloadManager через мост; в браузере —
 * обычное открытие файла, потому что установить APK из PWA всё равно нельзя.
 */
export function downloadAndroidUpdate(url = apkDownloadUrl()): boolean {
  const bridge = nativeBridge();
  if (bridge) {
    try {
      return bridge.downloadUpdate(url);
    } catch {
      return false;
    }
  }
  if (typeof window === 'undefined') return false;
  window.open(url, '_blank', 'noopener,noreferrer');
  return true;
}

/** Удаляет кэши и регистрации Service Worker, чтобы после reload загрузился новый бандл. */
export async function clearWebCaches(): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } catch {
    // Кэши могли быть уже удалены или запрещены — reload всё равно имеет смысл.
  }
  try {
    const registrations = await navigator.serviceWorker?.getRegistrations?.();
    await Promise.all((registrations ?? []).map((registration) => registration.unregister()));
  } catch {
    // Нет Service Worker — это не ошибка для PWA, которая живёт без него.
  }
}

/** Обновление веб-версии: сброс кэша и жёсткая перезагрузка на свежий бандл. */
export async function reloadWebApp(): Promise<void> {
  await clearWebCaches();
  window.location.reload();
}

