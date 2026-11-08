/**
 * Web-заглушка кнопок шторки («Поділитися», «Оновити»).
 *
 * Кнопки живуть у нативному сповіщенні Notifee; у Mini App їх немає, тому підписка
 * повертає порожню відписку, а хук просто не викликає обробник.
 */
export type NotificationAction = 'share' | 'refresh';

type Listener = (action: NotificationAction) => void;

export function registerNotificationActions(): () => void {
  return () => {};
}

export function useNotificationAction(_handler: Listener): void {
  /* подій зі шторки в браузері не буває */
}
