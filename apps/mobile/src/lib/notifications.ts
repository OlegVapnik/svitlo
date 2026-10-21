import notifee, { AndroidImportance, AndroidStyle, AndroidVisibility } from '@notifee/react-native';

import { renderNotificationBanner, type NotificationBanner } from '@/lib/notification-banner';
import { notificationIconName } from '@/lib/widget';

export const LIVE_CHANNEL = 'power-status';
export const ALERT_CHANNEL = 'power-alerts';

/** id кнопок-действий: их ловит `notification-actions.ts`. */
export const ACTION_SHARE = 'share';
export const ACTION_REFRESH = 'refresh';

export interface LiveNotificationPayload {
  title: string;
  body: string;
  /** Тон состояния: изумруд / янтарь / рубин / графит. */
  color: string;
  /** 0…100 прогресс текущего слота; null — прогресс неизвестен. */
  progress: number | null;
  /** Конец слота (мс): по нему ОС сама тикает обратный отсчёт. */
  endsAtMs: number | null;
  /** Данные графической плашки. Без них уведомление остаётся текстовым. */
  banner?: NotificationBanner | null;
}

let channelsReady = false;

async function ensureChannels() {
  if (channelsReady) return;
  await notifee.createChannel({
    id: LIVE_CHANNEL,
    name: 'Стан світла',
    importance: AndroidImportance.LOW,
    visibility: AndroidVisibility.PUBLIC,
    description: 'Постійний індикатор у шторці з прогресом поточного слота.',
  });
  await notifee.createChannel({
    id: ALERT_CHANNEL,
    name: 'Раннє включення світла',
    importance: AndroidImportance.HIGH,
    visibility: AndroidVisibility.PUBLIC,
    vibration: true,
    description: 'Повідомлення, коли живлення зʼявилося раніше графіка.',
  });
  channelsReady = true;
}

export async function requestNotificationPermission(): Promise<boolean> {
  const settings = await notifee.requestPermission();
  return settings.authorizationStatus >= 1;
}

/**
 * Кнопки шторки.
 *
 * `launchActivity: 'default'` обязателен: Notifee доставляет нажатие в JS только при живом
 * процессе (foreground-событие), а в фоне без собственного `onBackgroundEvent` событие теряется.
 * Открытие Activity гарантирует, что нажатие доедет — приложение поднимется и разберёт его через
 * `getInitialNotification()`.
 */
const NOTIFICATION_ACTIONS = [
  {
    title: 'Поділитися графіком',
    pressAction: { id: ACTION_SHARE, launchActivity: 'default' as const },
  },
  {
    title: 'Оновити',
    pressAction: { id: ACTION_REFRESH, launchActivity: 'default' as const },
  },
];

/**
 * Постоянная плашка в шторке: статус, графическая карточка, кнопки и системный хронометр.
 *
 * Плашка рисуется RN-вёрсткой (`NotificationBannerHost`) и снимается в PNG. Если снимок не
 * удался (например, приложение стартовало фоном), уведомление показывается как обычно — без
 * картинки, но с текстом и действиями.
 *
 * `showChronometer` + `chronometerDirection: 'down'` — секунды тикает сама ОС, без JS-таймера
 * и без расхода батареи. Прогресс обновляется, когда экран пересчитывает состояние (раз в 30 с).
 */
export async function showLiveNotification(payload: LiveNotificationPayload): Promise<void> {
  await ensureChannels();
  const picture = payload.banner ? await renderNotificationBanner(payload.banner) : null;

  const android: Parameters<typeof notifee.displayNotification>[0]['android'] = {
    channelId: LIVE_CHANNEL,
    smallIcon: notificationIconName(),
    color: payload.color,
    ongoing: true,
    onlyAlertOnce: true,
    importance: AndroidImportance.LOW,
    visibility: AndroidVisibility.PUBLIC,
    pressAction: { id: 'default' },
    showTimestamp: false,
    actions: NOTIFICATION_ACTIONS,
  };

  if (picture) {
    android.style = { type: AndroidStyle.BIGPICTURE, picture };
  }

  if (payload.progress != null) {
    android.progress = {
      max: 100,
      current: Math.max(0, Math.min(100, Math.round(payload.progress))),
      indeterminate: false,
    };
  }

  if (payload.endsAtMs != null) {
    android.showChronometer = true;
    android.chronometerDirection = 'down';
    android.timestamp = payload.endsAtMs;
  }

  await notifee.displayNotification({
    id: 'svitlo-live',
    title: payload.title,
    body: payload.body,
    android,
  });
}

export async function hideLiveNotification(): Promise<void> {
  try {
    await notifee.cancelNotification('svitlo-live');
  } catch {
    /* плашки уже нет */
  }
}

/**
 * Радостный локальный пуш «світло з'явилося раніше графіка».
 *
 * Высокий приоритет и вибрация — это не шум, а редкое хорошее событие. Плашка зелёная в любом
 * случае: сообщение всегда про восстановленное питание.
 */
export async function notifyEarlyPower(
  offUntil: string | null,
  banner?: NotificationBanner | null,
): Promise<void> {
  await ensureChannels();
  const picture = banner ? await renderNotificationBanner(banner) : null;

  const android: Parameters<typeof notifee.displayNotification>[0]['android'] = {
    channelId: ALERT_CHANNEL,
    smallIcon: notificationIconName(),
    color: '#10B981',
    pressAction: { id: 'default' },
    importance: AndroidImportance.HIGH,
    visibility: AndroidVisibility.PUBLIC,
    actions: NOTIFICATION_ACTIONS,
  };

  if (picture) {
    android.style = { type: AndroidStyle.BIGPICTURE, picture };
  }

  await notifee.displayNotification({
    id: 'svitlo-early-power',
    title: "⚡ Світло з'явилося раніше графіка?",
    body: offUntil
      ? `За графіком відключення до ${offUntil}, але живлення відновлено!`
      : 'За графіком зараз відключення, але живлення відновлено!',
    android,
  });
}
