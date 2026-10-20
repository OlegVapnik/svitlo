import notifee, { AndroidImportance, AndroidVisibility } from '@notifee/react-native';

export const LIVE_CHANNEL = 'power-status';
export const ALERT_CHANNEL = 'power-alerts';

export interface LiveNotificationPayload {
  title: string;
  body: string;
  /** Тон состояния: изумруд / янтарь / рубин / графит. */
  color: string;
  /** 0…100 прогресс текущего слота; null — прогресс неизвестен. */
  progress: number | null;
  /** Конец слота (мс): по нему ОС сама тикает обратный отсчёт. */
  endsAtMs: number | null;
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
 * Постоянная плашка в шторке: статус, прогресс-бар и системный хронометр.
 *
 * `showChronometer` + `chronometerDirection: 'down'` — секунды тикает сама ОС, без
 * JS-таймера и без расхода батареи. Прогресс обновляется, когда экран пересчитывает
 * состояние (раз в 30 с), а не каждую секунду.
 */
export async function showLiveNotification(payload: LiveNotificationPayload): Promise<void> {
  await ensureChannels();
  const android: Parameters<typeof notifee.displayNotification>[0]['android'] = {
    channelId: LIVE_CHANNEL,
    smallIcon: 'ic_stat_svitlo',
    color: payload.color,
    ongoing: true,
    onlyAlertOnce: true,
    importance: AndroidImportance.LOW,
    visibility: AndroidVisibility.PUBLIC,
    pressAction: { id: 'default' },
    showTimestamp: false,
  };

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
 * Высокий приоритет и вибрация — это не шум, а редкое хорошее событие.
 */
export async function notifyEarlyPower(offUntil: string | null): Promise<void> {
  await ensureChannels();
  await notifee.displayNotification({
    id: 'svitlo-early-power',
    title: "⚡ Світло з'явилося раніше графіка?",
    body: offUntil
      ? `За графіком відключення до ${offUntil}, але живлення відновлено!`
      : 'За графіком зараз відключення, але живлення відновлено!',
    android: {
      channelId: ALERT_CHANNEL,
      smallIcon: 'ic_stat_svitlo',
      color: '#10B981',
      pressAction: { id: 'default' },
      importance: AndroidImportance.HIGH,
      visibility: AndroidVisibility.PUBLIC,
    },
  });
}
