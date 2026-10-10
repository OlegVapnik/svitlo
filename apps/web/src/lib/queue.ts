/**
 * Код очереди в приложении: «3» или «2/2».
 *
 * Шаблон НЕ импортируется из @svitlo/shared: пакет тянет zod (~13 kB gzip) в веб-бандл ради
 * одной строки. Совпадение с API гарантирует тест `queue.test.ts`, который сверяет этот регэксп
 * с `QUEUE_CODE_PATTERN` (там же живёт zod-схема `queueCodeSchema` для сервера).
 */
const QUEUE_CODE = /^\d+(?:\/\d+)?$/;

/** Обрезает пробелы — код всегда сравнивается в нормализованном виде. */
export function normalizeQueueCode(value: string): string {
  return value.trim();
}

/** Годится ли строка как код очереди («3», «2/2»); «черга», «2/2/2», пусто — нет. */
export function isQueueCode(value: string): boolean {
  return QUEUE_CODE.test(value.trim());
}

/**
 * Приводит сохранённый список к валидным кодам: выкидывает мусор, дубли и пустые строки,
 * сохраняя порядок. Нужно при чтении localStorage — там могут лежать значения старых версий.
 */
export function sanitizeQueueList(values: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const code = normalizeQueueCode(typeof value === 'string' ? value : '');
    if (!isQueueCode(code) || seen.has(code)) continue;
    seen.add(code);
    result.push(code);
  }
  return result;
}