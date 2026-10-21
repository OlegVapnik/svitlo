/**
 * Спільні чисті хелпери провайдерів графіків. Один спільний модуль — щоб YASNO/DTEK/e-svitlo
 * не вигадували кожен власний формат черг і годин (розходження тут = хибні дані в UI).
 *
 * Усі функції чисті й тестуються без мережі.
 */

/** '4.1' → '4/1', '4_1' → '4/1', '4/1' → '4/1'. Невідомий формат → null (краще пропустити рядок). */
export function normalizeQueueCode(raw: string): string | null {
  const value = raw.trim().replace(/[_.,]/g, '/').replace(/\s+/g, '');
  if (!/^\d{1,3}(\/\d{1,3})?$/.test(value)) return null;
  return value;
}

/**
 * Десяткові години YASNO ('18.5', 19) → '18:30' / '19:00'.
 * 24 → '00:00' (кінець доби), 24.5 → '00:30' не буває: джерело так не робить, тому обрізаємо до 24.
 */
export function decimalHourToHhmm(value: number): string | null {
  if (!Number.isFinite(value) || value < 0) return null;
  const capped = Math.min(value, 24);
  const hours = Math.floor(capped);
  const minutes = Math.round((capped - hours) * 60);
  return `${String(hours === 24 ? 0 : hours).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * Інтервал у форматі застосунку з двох десяткових годин: {start: 18, end: 18.5} → 18:00–18:30.
 * Повертає null, якщо інтервал некоректний (end <= start без переходу через добу).
 */
export function intervalFromDecimalHours(start: number, end: number): { timeFrom: string; timeTo: string } | null {
  const timeFrom = decimalHourToHhmm(start);
  const timeTo = decimalHourToHhmm(end);
  if (!timeFrom || !timeTo) return null;
  if (start >= end) return null;
  return { timeFrom, timeTo };
}

/** Скільки разів стан `stateCode` повторюється у півгодинному масиві (коди дзеркала). */
export function isOffSlot(stateCode: number): boolean {
  return stateCode === 3 || stateCode === 2;
}

/** Колір і назва стану за легендою оператора — щоб усі провайдери писали те саме. */
export const SLOT_STATE: Record<3 | 2, { name: string; color: string }> = {
  3: { name: 'Відключення', color: '#E33535' },
  2: { name: 'Можливе відключення', color: '#F0A202' },
};
