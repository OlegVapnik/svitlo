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
  /** Текущее время «ЧЧ:ММ» — рядом с «Svitlo» в шапке плашки. */
  clockTime: string | null;
  /** Непрерывные диапазоны отключений за добу: «09:30–13:00»; максимум два, дальше «…». */
  offRanges: string[];
  /** Событие графика для подписи под таймером: «вимкнуть о 09:30» / «буде о 13:00». */
  event: { verb: string; time: string } | null;
  /**
   * Свёрнутый вид уведомления: короткий статус в заголовке и одна строка деталей.
   * Собирается тем же билдером, чтобы шторка и карточка не разошлись в цифрах.
   */
  collapsed: { title: string; body: string };
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
 * Палитра намеренно минимальная: зелёный «світло є» (включая «скоро вимкнуть» — предупреждение
 * тоже про свет, который пока есть), красный «відключення», серый «немає даних». Янтарный из
 * палитры уведомления убран: два статуса в шторке читаются быстрее трёх.
 */
export function notificationColor(state: PowerState): string {
  switch (state) {
    case 'on':
    case 'allClear':
    case 'warning':
      return '#10B981';
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
