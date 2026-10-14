/**
 * Разбор и сопоставление номеров домов с шаблонами привязки к группе ГПВ.
 *
 * Вынесено отдельным файлом без единого импорта БД: логика чистая, её удобно покрыть тестами
 * и переиспользовать в импорте выгрузок, не поднимая соединение с Postgres.
 *
 * Форматы шаблонов взяты из реальных выгрузок обленерго:
 *   `*`             — вся улица (любой дом);
 *   `12`, `14А`     — конкретный дом;
 *   `2, 4, 6А, 8`   — список домов;
 *   `1-19`          — диапазон номеров.
 *
 * Чётность/нечётность внутри диапазона НЕ различается: разбивку вида «чётные до 15-го» из
 * достоверного источника получить нельзя, и вводить её вручную опаснее, чем взять весь диапазон.
 */

/** Разбор числовой части номера дома: «14А» → 14, «12/3» → 12, «5-б» → 5. */
export function parseHouseNumber(raw: string): number | null {
  const match = String(raw ?? '').trim().match(/^(\d{1,5})/u);
  if (!match) return null;
  const value = Number.parseInt(match[1]!, 10);
  return Number.isFinite(value) ? value : null;
}

/**
 * Попадает ли номер дома под шаблон привязки.
 *
 * Регистр не учитывается: «12а» и «12А» — один и тот же дом, буквенный суффикс различает
 * корпуса одного адреса и для определения группы значения не имеет.
 */
export function matchHouseNumber(houseInput: string, pattern: string): boolean {
  const trimmedPattern = String(pattern ?? '').trim();
  // Пустая строка и «*» означают «вся улица» — подходит любой дом, даже нечисловой ввод.
  if (trimmedPattern === '' || trimmedPattern === '*') return true;

  const house = parseHouseNumber(houseInput);
  if (house === null) return false;

  for (const rawPart of trimmedPattern.split(',')) {
    const part = rawPart.trim();
    if (part === '' || part === '*') return true;

    // Дилемеры всех трёх типов (короткое, длинное, тире) — в выгрузках встречаются разные.
    const range = part.match(/^(\d{1,5})\s*[-–—]\s*(\d{1,5})$/u);
    if (range) {
      const first = Number.parseInt(range[1]!, 10);
      const second = Number.parseInt(range[2]!, 10);
      // Диапазон с обратным порядком («19-1») трактуем как переупорядоченный, иначе он молча
      // не совпал бы ни с одним домом и выглядел бы как «привязки нет».
      const [low, high] = first <= second ? [first, second] : [second, first];
      if (house >= low && house <= high) return true;
      continue;
    }

    const exact = parseHouseNumber(part);
    if (exact !== null && exact === house) return true;
  }
  return false;
}

/**
 * Разбирает шаблон на «список одиночных домов» и «диапазоны» — нужно для показа пользователю
 * понятных вариантов, когда на улице несколько групп.
 */
export function describeHousePattern(pattern: string): string {
  const trimmed = String(pattern ?? '').trim();
  if (trimmed === '' || trimmed === '*') return 'вся улица';
  return trimmed;
}