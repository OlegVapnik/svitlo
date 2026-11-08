import { dayPowerState } from '@svitlo/core/lib/day-status';
import type { ScheduleWindow } from '@svitlo/core/lib/scheduleWindow';
import { unwrapSchedule as unwrapSchedulePayload } from '@svitlo/core/lib/schedule-payload';
import type { QueueScheduleData } from '@svitlo/shared';

import type { PowerState } from '@/theme/ThemeProvider';

/**
 * Разворачивает ответ графика. Живой ответ приходит конвертом `{ data: … }`, а офлайн-пакет
 * кладёт в кэш развёрнутый `QueueScheduleData` — без этой развязки статус считался бы по undefined
 * и всегда показывал «не знаем».
 *
 * Сама развязка живёт в `@svitlo/core/lib/schedule-payload` (`unwrapSchedule`): её же используют
 * веб-герой и офлайн-кэш. Здесь остаётся только привычный для застосунка `undefined` вместо `null`.
 */
export function unwrapSchedule(
  response: { data?: QueueScheduleData } | QueueScheduleData | undefined,
): QueueScheduleData | undefined {
  return unwrapSchedulePayload(response) ?? undefined;
}

/**
 * Состояние сети по графику группы на сегодня.
 *
 * Считает ядро (`dayPowerState`), а не этот файл: правило «пустой график ≠ свет есть» и его
 * исключение «опубликованный день без отключений = allClear» обязаны быть в одном месте, иначе
 * веб и приложение разъедутся в трактовке одного и того же пустого ответа.
 */
export function powerStateFromSchedule(
  schedule: QueueScheduleData | null | undefined,
  today: string,
): { state: PowerState; summary: ScheduleWindow | null } {
  return dayPowerState(schedule ?? undefined, today);
}
