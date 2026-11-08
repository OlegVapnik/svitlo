/**
 * Telegram Mini App: тот же React Native код, но внутри Telegram WebView.
 *
 * Без SDK: полный `telegram-web-app.js` весит больше всей нашей логики, а нужны только
 * `ready`, `expand`, цвета шапки, безопасные зоны и тактильный отклик. Telegram сам вставляет
 * скрипт в Mini App, поэтому достаточно дождаться объекта и не падать в обычном браузере —
 * сборка открывается и по прямой ссылке Pages.
 *
 * Deep link из бота (`?tg=1&region=...&queue=...`, а также `startapp`-параметр) применяется
 * ДО монтирования React: `RegionProvider` читает область из хранилища в `useState`-инициализаторе,
 * поэтому запись должна произойти здесь, а не эффектом после первого кадра.
 */
import type { Metrics } from 'react-native-safe-area-context';

import { normalizeQueueCode } from '@svitlo/core/lib/queue';
import { normalizeRegionCpu, setStoredRegion } from '@svitlo/core/lib/region';
import { setStoredQueueForRegion } from '@svitlo/core/lib/region-queue';

interface TelegramWebApp {
  ready?: () => void;
  expand?: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  disableVerticalSwipes?: () => void;
  hideBackButton?: () => void;
  initData?: string;
  initDataUnsafe?: { start_param?: string };
  viewportHeight?: number;
  viewportStableHeight?: number;
  contentSafeAreaInset?: number;
  safeAreaInset?: number;
  HapticFeedback?: {
    impactOccurred?: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
    notificationOccurred?: (type: 'error' | 'success' | 'warning') => void;
  };
}

interface TelegramGlobal {
  WebApp?: TelegramWebApp;
}

/** Цвет шапки и фона совпадает с фоном нашего тёмного экрана, чтобы не было шва. */
const HEADER_COLOR = '#121417';

function telegram(): TelegramGlobal | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { Telegram?: TelegramGlobal }).Telegram;
}

/** Чи це Mini App: явний `?tg=1` или уже подключённый Telegram-объект с подписью. */
export function isTelegramMiniApp(): boolean {
  if (typeof window === 'undefined') return false;
  if (new URLSearchParams(window.location.search).get('tg') === '1') return true;
  return Boolean(telegram()?.WebApp?.initData);
}

/**
 * Параметры из `startapp`-ссылки (`t.me/bot/app?startapp=region=kyiv-city`).
 * Обычные кнопки бота присылают их в query string, но прямые ссылки — сюда.
 */
function startParam(): URLSearchParams | null {
  const raw = telegram()?.WebApp?.initDataUnsafe?.start_param;
  if (!raw || !raw.includes('=')) return null;
  try {
    return new URLSearchParams(raw);
  } catch {
    return null;
  }
}

/** Область и очередь из ссылки бота: сначала query, затем `startapp`. */
function deepLinkValue(name: 'region' | 'queue'): string | null {
  const fromQuery = new URLSearchParams(window.location.search).get(name);
  if (fromQuery) return fromQuery;
  return startParam()?.get(name) ?? null;
}

/**
 * Активирует Mini App и применяет область/очередь из ссылки.
 * Возвращает `true`, если запуск действительно произошёл.
 */
export function initTelegramMiniApp(): boolean {
  if (!isTelegramMiniApp()) return false;
  const app = telegram()?.WebApp;

  const region = deepLinkValue('region');
  if (region) {
    const normalized = normalizeRegionCpu(region);
    setStoredRegion(normalized);
    const queue = deepLinkValue('queue');
    if (queue) setStoredQueueForRegion(normalized, normalizeQueueCode(queue));
  }

  app?.ready?.();
  app?.expand?.();
  app?.setHeaderColor?.(HEADER_COLOR);
  app?.setBackgroundColor?.(HEADER_COLOR);
  // Свайп вниз закрывает Mini App и конфликтует с нашими горизонтальными жестами
  // (переключение черг и «потянуть для обновления»).
  app?.disableVerticalSwipes?.();
  app?.hideBackButton?.();
  return true;
}

/**
 * Безопасные зоны Telegram.
 *
 * В браузере `env(safe-area-inset-*)` внутри Telegram равен нулю, а нижняя панель Telegram
 * перекрывает наш таб-бар. `contentSafeAreaInset` — единственный достоверный источник.
 * Значение читаем один раз при старте: во время сессии Telegram его не меняет.
 */
export function telegramSafeAreaMetrics(): Metrics | null {
  if (typeof window === 'undefined') return null;
  const app = telegram()?.WebApp;
  if (!app) return null;
  const height = app.viewportStableHeight ?? app.viewportHeight ?? window.innerHeight;
  const bottom = Math.max(app.contentSafeAreaInset ?? 0, app.safeAreaInset ?? 0);
  return {
    frame: { x: 0, y: 0, width: window.innerWidth, height },
    insets: { top: 0, left: 0, right: 0, bottom },
  };
}

/** Тактильный отклик: в вебе `expo-haptics` молчит, а Telegram умеет вибрировать. */
export function telegramHaptic(kind: 'light' | 'medium' | 'success' | 'error'): void {
  const feedback = telegram()?.WebApp?.HapticFeedback;
  if (!feedback) return;
  if (kind === 'success') feedback.notificationOccurred?.('success');
  else if (kind === 'error') feedback.notificationOccurred?.('error');
  else feedback.impactOccurred?.(kind);
}
