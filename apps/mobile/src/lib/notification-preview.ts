import { generateTimelineSlots, getCurrentTimeMarker } from '@svitlo/core/lib/timeline';
import {
  formatMinutesUk,
  minutesOfDay,
  minutesToHm,
  type ScheduleWindow,
} from '@svitlo/core/lib/scheduleWindow';
import type { ScheduleIntervalUtc } from '@svitlo/shared';

import { NOTIFICATION_PILL, type NotificationBanner } from '@/lib/notification-banner';
import type { PowerState } from '@/theme/ThemeProvider';

const HEADLINES: Record<PowerState, string> = {
  on: 'Світло є',
  warning: 'Скоро вимкнуть',
  off: 'Світла немає',
  allClear: 'Відключень немає',
  unknown: 'Немає даних',
};

interface BannerInput {
  state: PowerState;
  summary: ScheduleWindow | null;
  intervals: ScheduleIntervalUtc[];
  date: string;
  now: Date;
  queue: string | null;
  /** Строка под заголовком; по умолчанию собирается из окна графика. */
  detail?: string;
  headline?: string;
  pill?: string;
  /** Принудительно спрятать таймер (раннее включение). */
  hideTimer?: boolean;
}

/**
 * Собирает данные плашки из тех же значений, что рисует Hero-карточка.
 *
 * Один билдер на оба уведомления: живая плашка и «світло раніше графіка» не могут разойтись
 * в цифрах или в цвете шкалы — они просто читают одно окно графика.
 */
export function buildNotificationBanner({
  state,
  summary,
  intervals,
  date,
  now,
  queue,
  detail,
  headline,
  pill,
  hideTimer,
}: BannerInput): NotificationBanner {
  const slots = generateTimelineSlots(intervals, date, now).map((slot) => slot.stateCode);
  const marker = getCurrentTimeMarker(date, now);

  const timer = (() => {
    if (hideTimer || !summary) return null;
    if (state === 'off' && summary.backInMinutes != null) {
      return { prefix: 'До включення', value: formatMinutesUk(summary.backInMinutes) };
    }
    if (state === 'warning' && summary.nextInMinutes != null) {
      return { prefix: 'До відключення', value: formatMinutesUk(summary.nextInMinutes) };
    }
    if (state === 'on' && summary.nextInMinutes != null) {
      return { prefix: 'До відключення', value: formatMinutesUk(summary.nextInMinutes) };
    }
    return null;
  })();

  /**
   * Строка под заголовком — точный момент следующего события, а не второй отсчёт.
   *
   * Рядом уже стоит крупный таймер («До відключення 6 год 33 хв»), поэтому «Вимкнуть через
   * 393 хв» показывало то же самое число второй раз и в других единицах. На главной человек
   * ищет в этой строке время по часам: «Наступне: о 08:30» / «Увімкнуть о 12:00».
   */
  const detailText = (() => {
    if (detail) return detail;
    if (state === 'allClear') return 'Відключень за графіком на сьогодні немає';
    if (!summary) return 'Оператор не опублікував графік на сьогодні';
    if (state === 'off' && summary.offEndsAt) {
      return `Увімкнуть о ${minutesToHm(minutesOfDay(summary.offEndsAt, date))}`;
    }
    if (state === 'off' && summary.backInMinutes != null) {
      return `Увімкнуть через ${formatMinutesUk(summary.backInMinutes)}`;
    }
    if (summary.nextStartsAt) {
      return `Наступне: о ${minutesToHm(minutesOfDay(summary.nextStartsAt, date))}`;
    }
    if (summary.nextInMinutes != null) {
      return `Вимкнуть через ${formatMinutesUk(summary.nextInMinutes)}`;
    }
    return 'Відключень за графіком на сьогодні немає';
  })();

  return {
    state,
    pill: pill ?? NOTIFICATION_PILL[state],
    headline: headline ?? HEADLINES[state],
    detail: detailText,
    timer,
    queue,
    slots,
    nowFraction: marker ? marker.percent / 100 : null,
    offMinutes: summary?.offMinutes ?? 0,
    date,
  };
}
