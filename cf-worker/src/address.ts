/**
 * Нормализация адресов и сопоставление номеров домов для Cloudflare Worker.
 *
 * Это прямой порт `apps/api/src/services/house-number.ts` и SQL-функции
 * `energy_normalize_address` (миграция 0004). Дублирование здесь вынужденное: воркер не должен
 * тянуть ни Fastify, ни PostgreSQL, а нормализация обязана совпадать с бэкендом до буквы —
 * иначе один и тот же адрес находился бы в облаке и не находился бы на своей базе.
 *
 * Совпадение поведения с PG-версией проверяется тестом `address-normalize.test.ts`.
 */

/** Разбор числовой части номера дома: «14А» → 14, «12/3» → 12. */
export function parseHouseNumber(raw: string): number | null {
  const match = String(raw ?? '').trim().match(/^(\d{1,5})/u);
  if (!match) return null;
  const value = Number.parseInt(match[1]!, 10);
  return Number.isFinite(value) ? value : null;
}

/**
 * Попадает ли номер дома под шаблон привязки.
 *
 * Шаблоны взяты из реальных выгрузок: `*` (вся улица), `12`, `2, 4, 6А`, `1-19`.
 * Чётность внутри диапазона не различается: достоверного источника для разбивки «нечётные до
 * 15» нет, а вводить её вручную опаснее, чем взять весь диапазон.
 */
export function matchHouseNumber(houseInput: string, pattern: string): boolean {
  const trimmedPattern = String(pattern ?? '').trim();
  if (trimmedPattern === '' || trimmedPattern === '*') return true;

  const house = parseHouseNumber(houseInput);
  if (house === null) return false;

  for (const rawPart of trimmedPattern.split(',')) {
    const part = rawPart.trim();
    if (part === '' || part === '*') return true;

    // Дилемеры всех трёх типов: в выгрузках встречаются разные.
    const range = part.match(/^(\d{1,5})\s*[-–—]\s*(\d{1,5})$/u);
    if (range) {
      const first = Number.parseInt(range[1]!, 10);
      const second = Number.parseInt(range[2]!, 10);
      // «19-1» трактуем как переупорядоченный диапазон, иначе он молча не совпал бы ни с одним
      // домом и выглядел бы как «привязки нет».
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
 * Одновременная замена кириллических букв — точный аналог `translate(..., 'ыэёїи', 'иееіі')`.
 *
 * Именно одновременная: если делать `.replace()` пять раз подряд, то `ы` → `и` на первом шаге
 * превратится в `і` на последнем, и результат разойдётся с PostgreSQL. Таблица заменяется
 * одним проходом по регулярке.
 */
const LETTER_MAP: Record<string, string> = { 'ы': 'и', 'э': 'е', 'ё': 'е', 'ї': 'і', 'и': 'і' };

/**
 * Приводит адрес к ключу сопоставления. Повторяет `energy_normalize_address` из PostgreSQL:
 *
 *   1. lower + одновременная замена «ы э ё ї и» → «и е е і і»;
 *   2. вырезание пунктуации;
 *   3. снятие ведущего префикса вида «вул.», «проспект», «с.» и т. п.
 *
 * Порядок шагов важен: префикс снимается уже без точки, иначе «с. Деснянське» не совпало бы
 * с «с. Деснянское».
 *
 * ОТЛИЧИЕ ОТ PG (намеренное): оригинал после замены пунктуации на пробел оставляет двойные
 * пробелы («м. Дніпро» → «м  дніпро»), здесь они схлопываются в один. Сравнения внутри воркера
 * всегда идут «JS-нормализация против JS-нормализации», поэтому схлопывание не ломает поиск,
 * зато ключи читаемее и не плодят дубликаты вида «деснянское» / «деснянское  вул».
 * Сверено с живой функцией PostgreSQL на 13 вариантах написания — других расхождений нет.
 */
export function normalizeAddress(raw: string): string {
  let value = String(raw ?? '')
    .toLowerCase()
    .replace(/[ыэёїи]/gu, (char) => LETTER_MAP[char] ?? char);

  value = value.replace(/[[\]{}()<>,.;:"'`«»/\\|!?*_+%$#@~^&=—–-]/gu, ' ');
  // Схлопываем пробелы до снятия префикса: пунктуация уже стала пробелами, и «с. Деснянське»
  // превратилось в «с   деснянское» — иначе префикс с точкой не распознался бы.
  value = value.replace(/\s+/gu, ' ').trim();

  // Префиксы из PG-функции: «вулиця|вул|улица|ул|проспект|просп|провулок|пров|переулок|пер|село|с\.?»
  // Точка здесь опциональна: выше она уже заменена пробелом, но класс оставлен как в оригинале.
  value = value.replace(
    /^(вулиця|вул|улица|ул|проспект|просп|провулок|пров|переулок|пер|село|с\.?)\s+/u,
    '',
  );

  return value.trim();
}

/**
 * Код группы приложения из строки пользователя: «2.2», « 2 / 2 », «2-2» → «2/2».
 *
 * Пробелы сначала удаляются целиком, а уже потом точки и тире превращаются в разделитель.
 * Если делать в обратном порядке, «2 / 2» превратится в «2///2»: класс `[.\s]+` захватил бы
 * и пробелы по бокам от уже стоящей косой черты.
 */
export function normalizeQueue(value: string): string {
  return String(value ?? '')
    .replace(/\s+/gu, '')
    .replace(/[.\-]+/gu, '/')
    .replace(/\/{2,}/gu, '/');
}

/** Годится ли строка как код группы (1/1…6/2). Мусор в базу не пускаем. */
export function isQueueCode(value: string): boolean {
  return /^\d{1,2}(?:\/\d{1,2})?$/u.test(String(value ?? '').trim());
}
