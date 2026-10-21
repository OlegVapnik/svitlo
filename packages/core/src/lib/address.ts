/**
 * Нормализация адресов и сопоставление номеров домов.
 *
 * Порт `cf-worker/src/address.ts` нужен клиенту для поиска по статическим пакам: там нет SQL,
 * но правила сравнения обязаны совпадать с сервером. Иначе «вул. Васильківська» находилась бы
 * в паках и не находилась в онлайне (или наоборот), а дом «100/А» получал бы чужую группу.
 */

/** Разбор числовой части номера дома: «14А» → 14, «12/3» → 12. */
export function parseHouseNumber(raw: string): number | null {
  const match = String(raw ?? '').trim().match(/^(\d{1,5})/u);
  if (!match) return null;
  const value = Number.parseInt(match[1]!, 10);
  return Number.isFinite(value) ? value : null;
}

/** Кириллические омоглифы латинских букв: «100А» и «100A» — один дом. */
const HOUSE_HOMOGLYPHS: Record<string, string> = {
  а: 'a', в: 'b', с: 'c', е: 'e', н: 'h', і: 'i', ї: 'i', к: 'k',
  м: 'm', о: 'o', р: 'p', т: 't', х: 'x', у: 'y',
};

/** Канонический ключ дома: «100/А», «100а», «100 А», «100-А», «100A» → «100a». */
export function normalizeHouseNumber(raw: string): string {
  let value = String(raw ?? '').normalize('NFKC').trim().toLowerCase();
  value = value.replace(/[а-яіїє]/gu, (char) => HOUSE_HOMOGLYPHS[char] ?? char);
  value = value.replace(/\s+/gu, '').replace(/[-–—]+/gu, '');
  value = value.replace(/^(\d+)\/([a-z])$/u, '$1$2');
  return value.replace(/[^0-9a-z/]/gu, '');
}

/**
 * Попадает ли номер дома под шаблон привязки.
 *
 * Шаблоны из реальных выгрузок: `*`, `12`, `2, 4, 6А`, `1-19`. Сравниваются канонические ключи,
 * поэтому раскладка буквы и разделитель не важны. Диапазон проверяем по числу, а не по строке.
 */
export function matchHouseNumber(houseInput: string, pattern: string): boolean {
  const trimmedPattern = String(pattern ?? '').trim();
  if (trimmedPattern === '' || trimmedPattern === '*') return true;

  const house = parseHouseNumber(houseInput);
  if (house === null) return false;
  const houseKey = normalizeHouseNumber(houseInput);

  for (const rawPart of trimmedPattern.split(',')) {
    const part = rawPart.trim();
    if (part === '' || part === '*') return true;

    const range = part.match(/^(\d{1,5})\s*[-–—]\s*(\d{1,5})$/u);
    if (range) {
      const first = Number.parseInt(range[1]!, 10);
      const second = Number.parseInt(range[2]!, 10);
      const [low, high] = first <= second ? [first, second] : [second, first];
      if (house >= low && house <= high) return true;
      continue;
    }

    if (normalizeHouseNumber(part) === houseKey) return true;
  }
  return false;
}

/** Замена «ы э ё ї и» → «и е е і і» одним проходом, как в PostgreSQL-функции. */
const LETTER_MAP: Record<string, string> = { 'ы': 'и', 'э': 'е', 'ё': 'е', 'ї': 'і', 'и': 'і' };

/**
 * Ключ сопоставления адреса: нижний регистр, буквенные варианты, пунктуация, ведущий префикс.
 * Повторяет `energy_normalize_address`; пробелы схлопываются, чтобы «м. Дніпро» и «м Дніпро»
 * давали один ключ.
 */
export function normalizeAddress(raw: string): string {
  let value = String(raw ?? '')
    .toLowerCase()
    .replace(/[ыэёїи]/gu, (char) => LETTER_MAP[char] ?? char);

  value = value.replace(/[[\]{}()<>,.;:"'`«»/\\|!?*_+%$#@~^&=—–-]/gu, ' ');
  value = value.replace(/\s+/gu, ' ').trim();

  value = value.replace(
    /^(вулиця|вул|улица|ул|проспект|просп|провулок|пров|переулок|пер|село|с\.?)\s+/u,
    '',
  );

  return value.trim();
}

/** Код группы из строки пользователя: «2.2», « 2 / 2 », «2-2» → «2/2». */
export function normalizeQueueCode(value: string): string {
  return String(value ?? '')
    .replace(/\s+/gu, '')
    .replace(/[.\-]+/gu, '/')
    .replace(/\/{2,}/gu, '/');
}
