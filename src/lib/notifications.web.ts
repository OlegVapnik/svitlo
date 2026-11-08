/**
 * Web-заглушка сповіщень.
 *
 * У Telegram Mini App (як і в будь-якому браузері) немає ні Notifee, ні `expo-notifications`:
 * Android-канали, постійна плашка в шторці й хронометр — це нативні API. Сповіщення тут
 * замінює сам бот, тому модуль лишає той самий публічний інтерфейс і робить вигляд, що
 * все гаразд: екран не повинен падати через відсутність шторки.
 */
import type { NotificationBanner } from '@/lib/notification-banner';

export const LIVE_CHANNEL = 'power-status';
export const ALERT_CHANNEL = 'power-alerts';

export const ACTION_SHARE = 'share';
export const ACTION_REFRESH = 'refresh';

export interface LiveNotificationPayload {
  title: string;
  body: string;
  color: string;
  progress: number | null;
  endsAtMs: number | null;
  banner?: NotificationBanner | null;
}

export async function requestNotificationPermission(): Promise<boolean> {
  return false;
}

export async function showLiveNotification(_payload: LiveNotificationPayload): Promise<void> {
  /* у браузері постійної плашки немає */
}

export async function hideLiveNotification(): Promise<void> {
  /* нічого не показували — нічого й прибирати */
}

export async function notifyEarlyPower(
  _offUntil: string | null,
  _banner?: NotificationBanner | null,
): Promise<void> {
  /* про раннє повернення світла напише бот */
}
