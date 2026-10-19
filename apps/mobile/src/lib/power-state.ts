import { scheduleWindow, type ScheduleWindow } from '@svitlo/core/lib/scheduleWindow';
import type { QueueScheduleData } from '@svitlo/shared';

import type { PowerState } from '@/theme/ThemeProvider';

/** Порог «скоро вимкнуть», в минутах. Синхронизирован с вебом (HeroStatus/usePowerState). */
const SOON_MINUTES = 60;

/**
 * Разворачивает ответ графика. Живой ответ приходит конвертом `{ data: … }`, а офлайн-пакет
 * кладёт в кэш развёрнутый `QueueScheduleData` — без этой развязки статус считался бы по undefined
 * и всегда показывал «не знаем».
 */
export function unwrapSchedule(
  response: { data?: QueueScheduleData } | QueueScheduleData | undefined,
): QueueScheduleData | undefined {
  if (!response) return undefined;
  if (Array.isArray((response as { intervals?: unknown }).intervals)) {
    return response as QueueScheduleData;
  }
  return (response as { data?: QueueScheduleData }).data;
}

/**
 * Состояние сети по графику группы на сегодня.
 *
 * Пустой график — «не знаем», а не «свет есть»: зелёный при отсутствии данных означал бы, что
 * оператор подтвердил отсутствие отключений, а это разные вещи (главный инвариант продукта).
 */
export function powerStateFromSchedule(
  schedule: QueueScheduleData | undefined,
  today: string,
): { state: PowerState; summary: ScheduleWindow | null } {
  const intervals = schedule?.intervals ?? [];
  if (intervals.length === 0) return { state: 'unknown', summary: null };

  const summary = scheduleWindow(intervals, today);
  if (summary.isOff) return { state: 'off', summary };
  if (summary.nextInMinutes != null && summary.nextInMinutes <= SOON_MINUTES) {
    return { state: 'warning', summary };
  }
  return { state: 'on', summary };
}
