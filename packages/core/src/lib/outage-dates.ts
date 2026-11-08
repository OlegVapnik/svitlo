/**
 * Київські дати для клієнтів.
 *
 * Самі правила живуть у `@svitlo/domain` (там же їх використовує Worker). Тут —
 * лише сигнатури, до яких звикли компоненти: вони приймають `Date`, а не epoch-мс.
 * Раніше кожна з цих функцій мала власну копію `Intl.DateTimeFormat` — і кожна
 * рахувала «київську добу» трохи інакше.
 */
import { kyivDateKeyFromMs, shiftYmd } from '@svitlo/domain';

export { kyivDayStart, kyivNextDayStart, outageOverlapsKyivDay } from '@svitlo/domain';

/** Дата за Києвом (`YYYY-MM-DD`) для моменту `date`. */
export function kyivDateKey(date: Date): string {
  return kyivDateKeyFromMs(date.getTime());
}

/** Дата за Києвом зі зсувом на `offsetDays` діб від `base`. */
export function kyivDateOffsetKey(offsetDays = 0, base: Date = new Date()): string {
  return shiftYmd(kyivDateKeyFromMs(base.getTime()), offsetDays);
}
