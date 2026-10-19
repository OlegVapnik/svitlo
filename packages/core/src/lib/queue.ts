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
 * Канонический набор групп ГПВ Украины: 6 очередей × 2 подгруппы.
 *
 * Нужен как фолбэк: если API вернул пустой список групп (холодный кеш, старый пакет офлайн-синка,
 * ошибка сети), селектор групп не должен превращаться в пустую дыру без кнопок. Раньше на пустом
 * списке человек вообще не видел сетки и не мог выбрать свою группу — хотя нумерация «1/1…6/2»
 * стандартная для ГПВ. Значения здесь — настоящие коды групп (`QUEUE_CODE`-совместимые), не выдумка:
 * выдуманных кодов вроде «7/1» тут нет.
 */
export const DEFAULT_QUEUE_CODES: readonly string[] = [
  '1/1', '1/2', '2/1', '2/2', '3/1', '3/2', '4/1', '4/2', '5/1', '5/2', '6/1', '6/2',
];

/**
 * Список групп для сетки выбора: то, что вернул API, а если он пуст — стандартные 12 подгрупп.
 * Возвращаются только валидные коды и без дублей: в сетку кнопок не должен попасть мусор.
 */
export function queueOptionsForGrid(queues: readonly string[] | undefined | null): string[] {
  const clean = sanitizeQueueList(queues ?? []);
  return clean.length > 0 ? clean : [...DEFAULT_QUEUE_CODES];
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