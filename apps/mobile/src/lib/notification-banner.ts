import type { PowerState } from '@/theme/ThemeProvider';

/**
 * Содержимое графической плашки в шторке.
 *
 * Плашка рисуется обычными RN-компонентами (как карточка шеринга), снимается через
 * `react-native-view-shot` и уезжает в `BigPictureStyle`. Почему не нативный layout: Notifee не
 * умеет кастомные RemoteViews, а рисовать текст в Canvas шрифтом системы — значит потерять
 * типографику приложения и не попасть в макет.
 */
export interface NotificationBanner {
  state: PowerState;
  /** Пилюля статуса: «За графіком», «Скоро відключення». */
  pill: string;
  /** Крупный заголовок: «Світло є», «Світла немає». */
  headline: string;
  /** Строка под заголовком. */
  detail: string;
  /** Крупный остаток: «9 год 57 хв». */
  timer: { prefix: string; value: string } | null;
  queue: string | null;
  /** 48 получасовых слотов: 3 — відключення, 2 — можливе, 1 — світло, null — немає даних. */
  slots: (number | null)[];
  /** Позиция «сейчас» 0…1; null — на шкале нет сегодняшнего дня. */
  nowFraction: number | null;
  /** Минуты без света за сутки по графику. */
  offMinutes: number;
  date: string;
}

export type BannerRenderer = (banner: NotificationBanner) => Promise<string | null>;

let renderer: BannerRenderer | null = null;

/**
 * Регистрирует рендерер плашки.
 *
 * Плашка живёт в дереве React (`NotificationBannerHost` в корневом layout), а зовут её из
 * `notifications.ts` — вне React. Реестр из одного слота позволяет обойтись без контекста и
 * не тащить React в модуль уведомлений.
 */
export function setBannerRenderer(next: BannerRenderer | null): void {
  renderer = next;
}

/** PNG-файл плашки или `null`, если снимок снять не удалось. */
export async function renderNotificationBanner(
  banner: NotificationBanner,
): Promise<string | null> {
  if (!renderer) return null;
  try {
    return await renderer(banner);
  } catch {
    // Плашка — украшение: без неё уведомление всё равно должно показаться.
    return null;
  }
}

/**
 * Фирменный цвет уведомления по состоянию сети.
 *
 * Те же значения, что у главного экрана: изумруд «світло є», янтарь «скоро вимкнуть», рубин
 * «світла немає». Совпадение с тоном Hero-карточки обязательно — уведомление и приложение
 * не должны спорить о цвете одного и того же факта.
 */
export function notificationColor(state: PowerState): string {
  switch (state) {
    case 'on':
    case 'allClear':
      return '#10B981';
    case 'warning':
      return '#F59E0B';
    case 'off':
      return '#F43F5E';
    default:
      return '#71717A';
  }
}

/** Пилюля статуса — те же подписи, что на Hero-карточке. */
export const NOTIFICATION_PILL: Record<PowerState, string> = {
  on: 'За графіком',
  warning: 'Скоро відключення',
  off: 'За графіком',
  allClear: 'Перевірено',
  unknown: 'Немає даних',
};
