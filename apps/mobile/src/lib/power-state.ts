import { dayPowerState } from '@svitlo/core/lib/day-status';
import type { ScheduleWindow } from '@svitlo/core/lib/scheduleWindow';
import type { QueueScheduleData } from '@svitlo/shared';

import type { PowerState } from '@/theme/ThemeProvider';

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
 * Считает ядро (`dayPowerState`), а не этот файл: правило «пустой график ≠ свет есть» и его
 * исключение «опубликованный день без отключений = allClear» обязаны быть в одном месте, иначе
 * веб и приложение разъедутся в трактовке одного и того же пустого ответа.
 */
export function powerStateFromSchedule(
  schedule: QueueScheduleData | undefined,
  today: string,
): { state: PowerState; summary: ScheduleWindow | null } {
  return dayPowerState(schedule, today);
}
