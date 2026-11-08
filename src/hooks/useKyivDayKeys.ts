import { useMemo } from 'react';

import { kyivDateOffsetKey } from '@svitlo/core/lib/outage-dates';

/**
 * «Сьогодні»/«завтра» за Києвом, які переживають північ.
 *
 * Раніше екрани рахували `kyivDateOffsetKey(0)` всередині `useMemo(..., [])`. Застосунок
 * живе у фоні добами, тому після 00:00 вкладка «Сьогодні» показувала вчорашній графік,
 * а справжня доба відкривалась лише під «Завтра». Ключі рахуємо від того ж тика, що й
 * годинники на екрані (`useMinuteTicker`).
 *
 * Об'єкт повертаємо стабільним, поки не змінилась сама доба: інакше кожні 30 секунд
 * змінювалась би ідентичність значення і запити перезапускались би без причини.
 */
export function useKyivDayKeys(now: Date): { today: string; tomorrow: string } {
  const today = kyivDateOffsetKey(0, now);
  const tomorrow = kyivDateOffsetKey(1, now);
  return useMemo(() => ({ today, tomorrow }), [today, tomorrow]);
}
