import notifee, { AndroidImportance, AndroidStyle, AndroidVisibility } from '@notifee/react-native';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { renderNotificationBanner, type NotificationBanner } from '@/lib/notification-banner';
import { notificationIconName } from '@/lib/widget';

export const LIVE_CHANNEL = 'power-status';
export const ALERT_CHANNEL = 'power-alerts';

/** id кнопок-действий: их ловит `notification-actions.ts`. */
export const ACTION_SHARE = 'share';
export const ACTION_REFRESH = 'refresh';

/**
 * Android-плашку рисует Notifee: он умеет постоянные уведомления, хронометр и картинку.
 * На iOS таких возможностей нет, поэтому там работает обычное локальное уведомление
 * через `expo-notifications`. Разделение по платформе обязательно: Android-каналы,
 * `smallIcon` и `ongoing` на iOS либо падают, либо игнорируются.
 */
const IS_ANDROID = Platform.OS === 'android';

if (!IS_ANDROID) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

export interface LiveNotificationPayload {
  title: string;
  body: string;
  /** Тон состояния: изумруд / янтарь / рубин / графит. */
  color: string;
  /**
   * Прогресс текущего слота 0…100. Минималистичный свёрнутый вид прогресс-бар больше не
   * показывает — поле оставлено для совместимости с `useLiveNotification` и игнорируется.
   */
  progress: number | null;
  /** Конец слота (мс): по нему ОС сама тикает обратный отсчёт. */
  endsAtMs: number | null;
  /** Данные графической плашки. Без них уведомление остаётся текстовым. */
  banner?: NotificationBanner | null;
}

let channelsReady = false;

async function ensureChannels() {
  if (!IS_ANDROID || channelsReady) return;
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

/** Есть ли у пользователя право показывать уведомления на iOS. */
async function iosNotificationsAllowed(): Promise<boolean> {
  const settings = await Notifications.getPermissionsAsync();
  return (
    settings.granted ||
    settings.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL
  );
}

function canUseIosNotifications(): Promise<boolean> {
  return iosNotificationsAllowed().catch(() => false);
}

async function showIosNotification(
  identifier: string,
  title: string,
  body: string,
  playSound: boolean,
): Promise<void> {
  if (!(await canUseIosNotifications())) return;
  await Notifications.scheduleNotificationAsync({
    identifier,
    content: {
      title,
      body,
      sound: playSound ? 'default' : false,
      data: { svitlo: true },
    },
    trigger: null,
  });
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (IS_ANDROID) {
    const settings = await notifee.requestPermission();
    return settings.authorizationStatus >= 1;
  }

  const settings = await Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: true,
      allowBadge: true,
      allowSound: true,
    },
  });
  return (
    settings.granted ||
    settings.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL
  );
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
 * и без расхода батареи. Текст и картинка обновляются, когда экран пересчитывает состояние.
 */
export async function showLiveNotification(payload: LiveNotificationPayload): Promise<void> {
  // Свёрнутый вид собирает тот же билдер, что и картинку: короткий статус в заголовке и одна
  // строка деталей. Номер очереди appended в тело — Notifee не умеет subText в свёрнутом виде.
  const title = payload.banner?.collapsed?.title ?? payload.title;
  const body = payload.banner?.collapsed?.body ?? payload.body;

  if (!IS_ANDROID) {
    // На iOS постоянных уведомлений нет: показываем актуальный статус обычной плашкой.
    // Идентификатор один и тот же — новое уведомление заменяет предыдущее, а не копится.
    await showIosNotification('svitlo-live', title, body, false);
    return;
  }

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
    if (IS_ANDROID) {
      await notifee.cancelNotification('svitlo-live');
    } else {
      await Notifications.dismissNotificationAsync('svitlo-live');
      await Notifications.cancelScheduledNotificationAsync('svitlo-live');
    }
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
  const title = "Світло з'явилося раніше графіка?";
  const body = offUntil
    ? `За графіком відключення до ${offUntil}, але живлення відновлено!`
    : 'За графіком зараз відключення, але живлення відновлено!';

  if (!IS_ANDROID) {
    await showIosNotification('svitlo-early-power', title, body, true);
    return;
  }

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
    title,
    body,
    android,
  });
}
