/**
 * Утилиты разбора графика зеркала: коды получасовок → интервалы, нормализация очередей.
 *
 * Модуль намеренно без I/O: его использует только `mirror-parser.ts`, а сам он ничего не знает
 * ни про D1, ни про Env — значит, его можно проверять на сохранённом payload.
 */

/** Код группы зеркала → код группы приложения: `2.2` → `2/2`, `3` → `3`. */
export function queueFromGroupKey(groupKey: string): string | null {
  const match = /^(\d{1,2})(?:\.(\d{1,2}))?$/u.exec(groupKey.trim());
  if (!match) return null;
  return match[2] ? `${match[1]}/${match[2]}` : match[1]!;
}

/** Код получасовки из JSON: число или строка из одной-двух цифр. */
export function cellCode(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string' && /^\d{1,2}$/u.test(value.trim())) return Number(value.trim());
  return null;
}

/** Зеркало отдаёт код 2 = «света нет»; остальные коды — свет есть. */
export const MIRROR_OFF_CODE = 2;

/**
 * Последовательность получасовых кодов → интервалы отключений (код 2), со склейкой соседних
 * ячеек в один отрезок. Склейка нужна, чтобы «с 00:00 по 04:00» показалось одним интервалом,
 * а не двумястами получасовками. Конец суток отдаём как `00:00` — так же делает оператор.
 */
export function offIntervalsFromCodes(
  codes: Array<number | null>,
  labels: string[],
): Array<{ timeFrom: string; timeTo: string }> {
  const intervals: Array<{ timeFrom: string; timeTo: string }> = [];
  let start: number | null = null;
  for (let index = 0; index <= codes.length; index += 1) {
    const isOff = index < codes.length && codes[index] === MIRROR_OFF_CODE;
    if (isOff && start === null) start = index;
    if (!isOff && start !== null) {
      intervals.push({
        timeFrom: labels[start]!,
        timeTo: index === codes.length ? '00:00' : labels[index]!,
      });
      start = null;
    }
  }
  return intervals;
}
