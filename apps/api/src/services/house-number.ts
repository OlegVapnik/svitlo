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
 * Кириллические буквы, которые визуально совпадают с латинскими.
 *
 * Пользователь может набрать «100А» кириллицей или «100A» латиницей — с точки зрения дома это
 * один адрес. Без приведения один и тот же номер искался бы только при точном совпадении
 * раскладки, а человек видел бы «привʼязки немає».
 */
const HOUSE_HOMOGLYPHS: Record<string, string> = {
  а: 'a', в: 'b', с: 'c', е: 'e', н: 'h', і: 'i', ї: 'i', к: 'k',
  м: 'm', о: 'o', р: 'p', т: 't', х: 'x', у: 'y',
};

/**
 * Канонический ключ дома: «100/А», «100а», «100 А», «100-А», «100A» → «100a».
 *
 * Разделитель перед буквенным суффиксом не важен, а буква-омоглиф приводится к латинице.
 * Дробные корпуса («100/1») сохраняют косую черту: это отдельный дом, а не «1001».
 */
export function normalizeHouseNumber(raw: string): string {
  let value = String(raw ?? '').normalize('NFKC').trim().toLowerCase();
  value = value.replace(/[а-яіїє]/gu, (char) => HOUSE_HOMOGLYPHS[char] ?? char);
  value = value.replace(/\s+/gu, '').replace(/[-–—]+/gu, '');
  // «100/А» — буквенный суффикс: косую черту убираем. «100/1» — корпус: оставляем.
  value = value.replace(/^(\d+)\/([a-z])$/u, '$1$2');
  return value.replace(/[^0-9a-z/]/gu, '');
}

/**
 * Попадает ли номер дома под шаблон привязки.
 *
 * Сравниваются канонические ключи, поэтому «12а» и «12А» — один дом, а «100А» и «100Б» —
 * разные. Числовые диапазоны («1-19») по-прежнему сравниваются по числу.
 */
export function matchHouseNumber(houseInput: string, pattern: string): boolean {
  const trimmedPattern = String(pattern ?? '').trim();
  // Пустая строка и «*» означают «вся улица» — подходит любой дом, даже нечисловой ввод.
  if (trimmedPattern === '' || trimmedPattern === '*') return true;

  const house = parseHouseNumber(houseInput);
  if (house === null) return false;
  const houseKey = normalizeHouseNumber(houseInput);

  for (const rawPart of trimmedPattern.split(',')) {
    const part = rawPart.trim();
    if (part === '' || part === '*') return true;

    // Разделители всех трёх типов (короткое, длинное, тире) — в выгрузках встречаются разные.
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

    if (normalizeHouseNumber(part) === houseKey) return true;
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