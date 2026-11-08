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
  warning: 'Світло є',
  off: 'Відключення',
  allClear: 'Відключень немає',
  unknown: 'Немає даних',
};

/** Максимум диапазонов отключений в строке сводки, дальше «…». */
const MAX_OFF_RANGES = 2;

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
 * Текст свёрнутого уведомления: короткий статус и одна строка деталей.
 *
 * Формат: «Вимкнуть о 09:30 · через 8 год 6 хв» (on/warning) либо «Увімкнуть о 13:00 · через
 * 5 год 12 хв» (off). Если «через» недоступно — остаётся только событие о времени. Номер очереди
 * идет в конец строки: Notifee не умеет subText в свёрнутом виде (проверено по типам 9.1.8).
 */
export function buildCollapsedText(
  state: PowerState,
  summary: ScheduleWindow | null,
  queue: string | null,
  date: string,
): { title: string; body: string } {
  let body: string;
  if (state === 'unknown' || !summary) {
    body = 'Графік ще не опубліковано';
  } else if (state === 'allClear') {
    body = 'Відключень на добу немає';
  } else if (state === 'off') {
    const at = summary.offEndsAt ? `Увімкнуть о ${minutesToHm(minutesOfDay(summary.offEndsAt, date))}` : null;
    if (at && summary.backInMinutes != null) {
      body = `${at} · через ${formatMinutesUk(summary.backInMinutes)}`;
    } else if (at) {
      body = at;
    } else if (summary.backInMinutes != null) {
      body = `Увімкнуть через ${formatMinutesUk(summary.backInMinutes)}`;
    } else {
      body = 'Зараз відключення за графіком';
    }
  } else {
    const at = summary.nextStartsAt ? `Вимкнуть о ${minutesToHm(minutesOfDay(summary.nextStartsAt, date))}` : null;
    if (at && summary.nextInMinutes != null) {
      body = `${at} · через ${formatMinutesUk(summary.nextInMinutes)}`;
    } else if (at) {
      body = at;
    } else if (summary.nextInMinutes != null) {
      body = `Вимкнуть через ${formatMinutesUk(summary.nextInMinutes)}`;
    } else {
      body = 'Відключень на добу немає';
    }
  }

  return {
    title: HEADLINES[state],
    body: queue ? `${body} · Черга ${queue}` : body,
  };
}

/** Непрерывные серии code===3 в «09:30–13:00»; серия до края добы — «з 09:30». */
function buildOffRanges(slots: (number | null)[]): string[] {
  const ranges: string[] = [];
  let start: number | null = null;

  for (let index = 0; index <= slots.length; index += 1) {
    const isOff = index < slots.length && slots[index] === 3;
    if (isOff && start == null) start = index * 30;
    if (!isOff && start != null) {
      const end = index * 30;
      ranges.push(end >= 24 * 60 ? `з ${minutesToHm(start)}` : `${minutesToHm(start)}–${minutesToHm(end)}`);
      start = null;
    }
  }

  if (ranges.length <= MAX_OFF_RANGES) return ranges;
  return [...ranges.slice(0, MAX_OFF_RANGES), '…'];
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
      return { prefix: 'до увімкнення', value: formatMinutesUk(summary.backInMinutes) };
    }
    if ((state === 'warning' || state === 'on') && summary.nextInMinutes != null) {
      return { prefix: 'до відключення', value: formatMinutesUk(summary.nextInMinutes) };
    }
    return null;
  })();

  /**
   * Событие графика — точный момент следующего переключения. Это подпись под крупным таймером
   * («до відключення · вимкнуть о 09:30»), а не второй отсчёт.
   */
  const event = (() => {
    if (state === 'off' && summary?.offEndsAt) {
      return { verb: 'буде', time: `о ${minutesToHm(minutesOfDay(summary.offEndsAt, date))}` };
    }
    if ((state === 'on' || state === 'warning') && summary?.nextStartsAt) {
      return { verb: 'вимкнуть', time: `о ${minutesToHm(minutesOfDay(summary.nextStartsAt, date))}` };
    }
    return null;
  })();

  /**
   * Строка деталей — тот же момент события словами: «Вимкнуть о 09:30» / «Увімкнуть о 13:00».
   * В карточке она не рисуется (там подпись «до увімкнення · буде о 13:00»), но виджет читает
   * её из плашки.
   */
  const detailText = (() => {
    if (detail) return detail;
    if (!summary) return 'Графік ще не опубліковано';
    if (state === 'off') {
      if (summary.offEndsAt) {
        return `Увімкнуть о ${minutesToHm(minutesOfDay(summary.offEndsAt, date))}`;
      }
      if (summary.backInMinutes != null) {
        return `Увімкнуть через ${formatMinutesUk(summary.backInMinutes)}`;
      }
      return 'Зараз відключення за графіком';
    }
    if (state === 'unknown') return 'Графік ще не опубліковано';
    if (summary.nextStartsAt) {
      return `Вимкнуть о ${minutesToHm(minutesOfDay(summary.nextStartsAt, date))}`;
    }
    if (summary.nextInMinutes != null) {
      return `Вимкнуть через ${formatMinutesUk(summary.nextInMinutes)}`;
    }
    return 'Відключень на добу немає';
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
    clockTime: marker?.timeFormatted ?? null,
    offRanges: buildOffRanges(slots),
    event,
    collapsed: buildCollapsedText(state, summary, queue, date),
  };
}
