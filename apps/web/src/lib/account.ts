/**
 * Особовий рахунок: 9–12 цифр.
 *
 * Шаблон — копия ACCOUNT_NUMBER_PATTERN із @svitlo/shared: импортировать значение оттуда нельзя
 * (пакет тянет zod в веб-бандл ради одной строки). Расхождение ловит тест `account.test.ts`.
 */
const ACCOUNT_NUMBER = /^\d{9,12}$/;

/** Убирает пробелы, неразрывные пробелы и дефисы: «987 654 321» → «987654321». */
export function normalizeAccountNumber(value: string): string {
  return value.replace(/[\s\u00a0-]+/gu, '');
}

/** Годится ли строка как особовий рахунок (после удаления разделителей). */
export function isAccountNumber(value: string): boolean {
  return ACCOUNT_NUMBER.test(normalizeAccountNumber(value));
}