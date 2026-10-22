/**
 * Определение iOS Safari для подсказки «Додати на початковий екран».
 *
 * Логика вынесена из компонента, чтобы её можно было проверить без браузера:
 * ошибка в детекте либо прячет подсказку навсегда, либо показывает инструкцию
 * для установленного приложения, где она не нужна.
 */
export const IOS_INSTALL_HINT_KEY = 'svitlo:ios-install-hint';

/** Повторно не напоминаем месяц: установка — добровольное действие, а не блокер. */
export const IOS_INSTALL_HINT_REPEAT_MS = 30 * 24 * 60 * 60 * 1000;

export interface IosEnvironment {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
  /** `navigator.standalone` — нестандартное свойство Safari. */
  standalone?: boolean;
  /** `matchMedia('(display-mode: standalone)')`. */
  displayModeStandalone?: boolean;
}

export interface HintStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** iPhone/iPad, включая iPadOS, который представляется как macOS. */
export function isIosDevice(env: IosEnvironment): boolean {
  const ua = env.userAgent;
  const iphoneOrIpad = /iPhone|iPad|iPod/iu.test(ua);
  const ipadDesktopMode = /Macintosh/iu.test(ua) && (env.maxTouchPoints ?? 0) > 1;
  return iphoneOrIpad || ipadDesktopMode;
}

/**
 * Именно Safari: в Chrome/Firefox/Edge на iOS нет пункта «На початковий екран»,
 * и инструкция в них была бы ложной.
 */
export function isIosSafari(env: IosEnvironment): boolean {
  if (!isIosDevice(env)) return false;
  return !/CriOS|FxiOS|EdgiOS|OPiOS|YaBrowser|DuckDuckGo/iu.test(env.userAgent);
}

export function isStandalonePwa(env: IosEnvironment): boolean {
  return env.standalone === true || env.displayModeStandalone === true;
}

/**
 * Показывать ли подсказку: только iOS Safari, только вне standalone и только если
 * пользователь не закрыл её за последние 30 дней.
 */
export function shouldShowIosInstallHint(
  storage: HintStorage,
  env: IosEnvironment,
  now: number = Date.now(),
): boolean {
  if (!isIosSafari(env) || isStandalonePwa(env)) return false;

  let raw: string | null = null;
  try {
    raw = storage.getItem(IOS_INSTALL_HINT_KEY);
  } catch {
    // Приватный режим: хранилище недоступно. Подсказка не критична — показываем,
    // закрытие в этом случае просто не запомнится.
    return true;
  }
  if (!raw) return true;

  const dismissedAt = Number(raw);
  if (!Number.isFinite(dismissedAt)) return true;
  return now - dismissedAt >= IOS_INSTALL_HINT_REPEAT_MS;
}

/** Запоминает закрытие; ошибки приватного режима намеренно проглатываются. */
export function dismissIosInstallHint(storage: HintStorage, now: number = Date.now()): void {
  try {
    storage.setItem(IOS_INSTALL_HINT_KEY, String(now));
  } catch {
    /* хранилище недоступно — подсказка просто появится в следующий раз */
  }
}
