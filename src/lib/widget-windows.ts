// Мобильное приложение не зависит от `@svitlo/domain` напрямую: те же правила
// реэкспортирует `@svitlo/core`, и одна точка импорта держит один экземпляр `Intl`.
import { kyivDayStart, kyivNextDayStart } from '@svitlo/core/lib/outage-dates';
import type { ScheduleIntervalUtc } from '@svitlo/shared';

/**
 * Окна отключений суток в epoch-миллисекундах — топливо для нативного виджета.
 *
 * Зачем отдельный чистый модуль: Kotlin не умеет читать расписание (это делает JS), но обязан
 * сам считать «сколько осталось до конца окна» каждую секунду — иначе таймер на виджете
 * замирает между обновлениями приложения. Поэтому JS отдаёт только факты (начало/конец
 * интервалов), а обратный отсчёт и текст плиток считаются нативной логикой `WidgetLive`.
 *
 * Границы суток — киевские: интервал, начавшийся в 23:30 и закончившийся в 00:30, попадает в
 * оба дня обрезанным, иначе «завтра» показывало бы чужой вечер.
 */

/** Пара `[начало, конец]` в epoch-ms. Массив пар, а не объект: короче JSON в SharedPreferences. */
export type WidgetWindowRange = [start: number, end: number];

/** Код «відключення» в 48 получасовых слотах (`3` — світла немає, `2` — можливе). */
const OUTAGE_STATE_CODE = 3;

/**
 * Собирает окна отключений на киевские сутки `date` (`YYYY-MM-DD`).
 *
 * Пересекающиеся интервалы склеиваются: два события 09:30–11:00 и 10:30–12:00 — это одно окно
 * 09:30–12:00, и человек в виджете видит одну строку, а не две с наполовину наложенным временем.
 */
export function buildWidgetWindows(
  intervals: readonly ScheduleIntervalUtc[],
  date: string,
  stateCode: number = OUTAGE_STATE_CODE,
): WidgetWindowRange[] {
  // Полдень UTC гарантированно попадает в нужную киевскую дату при любом смещении (+02/+03).
  const anchor = new Date(`${date}T12:00:00Z`);
  const dayStart = kyivDayStart(anchor).getTime();
  const dayEnd = kyivNextDayStart(anchor).getTime();

  const windows: WidgetWindowRange[] = [];
  for (const interval of intervals) {
    if (Number(interval.stateCode) !== stateCode) continue;
    const start = Date.parse(interval.startsAt);
    const end = Date.parse(interval.endsAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const from = Math.max(start, dayStart);
    const to = Math.min(end, dayEnd);
    if (to <= from) continue;
    windows.push([from, to]);
  }

  windows.sort((left, right) => left[0] - right[0]);
  const merged: WidgetWindowRange[] = [];
  for (const window of windows) {
    const last = merged[merged.length - 1];
    if (last && window[0] <= last[1]) {
      last[1] = Math.max(last[1], window[1]);
    } else {
      merged.push([window[0], window[1]]);
    }
  }
  return merged;
}
