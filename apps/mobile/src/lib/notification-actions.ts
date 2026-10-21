import notifee, { EventType } from '@notifee/react-native';
import { useEffect } from 'react';

import { ACTION_REFRESH, ACTION_SHARE } from '@/lib/notifications';

export type NotificationAction = 'share' | 'refresh';

type Listener = (action: NotificationAction) => void;

const listeners = new Set<Listener>();
/** Нажатие, пришедшее до монтирования экрана (холодный старт из шторки). */
let pending: NotificationAction | null = null;

function parseAction(id: string | undefined): NotificationAction | null {
  if (id === ACTION_SHARE) return 'share';
  if (id === ACTION_REFRESH) return 'refresh';
  return null;
}

function publish(action: NotificationAction | null): void {
  if (!action) return;
  if (listeners.size === 0) {
    pending = action;
    return;
  }
  for (const listener of listeners) listener(action);
}

/**
 * Подписка на кнопки шторки «Поділитися графіком» и «Оновити».
 *
 * Два источника нажатия: foreground-событие (приложение уже открыто) и `getInitialNotification`
 * (кнопка нажата при закрытом приложении — Notifee отдаёт её при первом обращении). Обработчик
 * один, поэтому кнопка срабатывает в обоих случаях. Вызывается один раз из корневого layout.
 */
export function registerNotificationActions(): () => void {
  const unsubscribe = notifee.onForegroundEvent(({ type, detail }) => {
    if (type !== EventType.ACTION_PRESS) return;
    publish(parseAction(detail.pressAction?.id));
  });

  void notifee
    .getInitialNotification()
    .then((initial) => publish(parseAction(initial?.pressAction?.id)))
    .catch(() => {
      /* нет стартового уведомления — обычный запуск */
    });

  return unsubscribe;
}

/**
 * Реакция экрана на нажатие в шторке.
 *
 * Экран сам решает, что значит «поділитися» (у него есть карточка и данные), поэтому хук
 * отдаёт действие колбэком, а не лезет в навигацию из библиотеки уведомлений.
 */
export function useNotificationAction(handler: Listener): void {
  useEffect(() => {
    listeners.add(handler);
    if (pending) {
      const action = pending;
      pending = null;
      handler(action);
    }
    return () => {
      listeners.delete(handler);
    };
  }, [handler]);
}
