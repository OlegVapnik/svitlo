import type { QueueScheduleData, ScheduleIntervalUtc } from '@svitlo/shared';
import type { DaySchedule } from './day-schedule';
import { queueCodeMatches } from './queue';

/**
 * Приводит ответ графика к одному виду.
 *
 * API отдаёт конверт `{ data: QueueScheduleData }`, но в кеше/офлайн-снимке и в старых ответах
 * встречается «сырой» объект. Раньше каждый компонент разбирал это по-своему, и один из них
 * показывал «Даних графіка немає» при непустом ответе. Здесь правило одно: сначала ищем массив
 * `intervals` на верхнем уровне, потом — в `data`.
 */
export function unwrapSchedule(payload: unknown): QueueScheduleData | null {
  if (!payload || typeof payload !== 'object') return null;
  const direct = payload as QueueScheduleData;
  if (Array.isArray(direct.intervals)) return direct;
  const nested = (payload as { data?: QueueScheduleData }).data;
  if (nested && Array.isArray(nested.intervals)) return nested;
  return null;
}

/**
 * Ответ графика → сутки для расчётов (окна, перетин). `null` — ответа нет вовсе.
 *
 * `covered` считается выставленным и при непустых интервалах: полный график оператора уже
 * описывает сутки, и «дірка» в нём — світло, а не невідомість.
 */
export function toDaySchedule(date: string, payload: unknown): DaySchedule | null {
  const schedule = unwrapSchedule(payload);
  if (!schedule) return null;
  const intervals = schedule.intervals ?? [];
  return {
    date,
    intervals,
    covered: schedule.covered === true || schedule.allClear === true || intervals.length > 0,
  };
}

/** Минимальный вид элемента `/upcoming`, из которого можно собрать расписание. */
export interface ScheduleFallbackItem {
  date: string;
  queue: string;
  intervals: ScheduleIntervalUtc[];
  source?: string | null;
}

/**
 * Расписание на дату: прямой ответ `/schedules`, а если он пуст — тот же график из `/upcoming`.
 *
 * Застосунок синтезировал этот fallback трижды (сегодня/выбранная/завтра), копируя объект
 * вручную. Один пропущенный `covered`/`allClear` — и экран показывал «график не загружен»
 * при живых интервалах. Правило теперь одно и то же для всех трёх дат.
 */
export function scheduleWithFallback(
  direct: QueueScheduleData | null | undefined,
  upcoming: readonly ScheduleFallbackItem[],
  input: {
    regionCpu?: string | null;
    queue: string | null | undefined;
    date: string;
    now?: Date;
  },
): QueueScheduleData | null | undefined {
  if (direct && direct.intervals.length > 0) return direct;
  if (!input.queue) return direct;

  const matched = upcoming.find(
    (item) =>
      item.date === input.date &&
      queueCodeMatches(input.regionCpu, item.queue, input.queue!) &&
      item.intervals.length > 0,
  );
  if (!matched) return direct;

  return {
    queue: input.queue,
    date: input.date,
    intervals: matched.intervals,
    source: matched.source ?? 'mirror',
    lastImportedAt: (input.now ?? new Date()).toISOString(),
    allClear: false,
  };
}
