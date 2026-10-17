import type { QueueScheduleData } from '@svitlo/shared';
import type { DaySchedule } from './day-schedule.js';

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
