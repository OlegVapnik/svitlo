/**
 * Адреси й номери будинків — для клієнта.
 *
 * Самі правила живуть у `@svitlo/domain` (`address.ts`): вони мусять збігатися з тим, що
 * виконує Worker і SQL-функція `energy_normalize_address`, інакше адреса знаходиться в
 * онлайні й не знаходиться в статичних паках. Тут лишається реекспорт, щоб наявні імпорти
 * `@svitlo/core/lib/address` не змінювалися.
 */
import type { AddressHouseOption } from '@svitlo/shared';

export {
  matchHouseNumber,
  normalizeAddress,
  normalizeHouseNumber,
  parseHouseNumber,
} from '@svitlo/domain';

import { normalizeAddress } from '@svitlo/domain';

/**
 * Номер дома из начала строки: «12», «12а», «12/3» → 12. Без числа — null.
 * Сортировка «соседних домов» должна идти по числу, иначе «10» встаёт раньше «9».
 */
export function houseNumberValue(value: string): number | null {
  const match = String(value ?? '').trim().match(/^(\d{1,5})/u);
  if (!match) return null;
  const parsed = Number.parseInt(match[1]!, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Одиночный номер дома, а не диапазон/список: только такие показываем чипами. */
export function isSingleHousePattern(value: string): boolean {
  return /^\d{1,5}(?:\s*[a-zа-яіїє])?(?:(?:\s*[\/\\]\s*\d{1,5}(?:[a-zа-яіїє])?)|(?:\s+к\.?\s*\d{1,5}))?$/iu.test(
    String(value ?? '').trim(),
  );
}

/** Начало диапазона домов: «12-18» → «12»; одиночный номер — null. */
export function housePatternStart(pattern: string): string | null {
  const match = String(pattern ?? '').trim().match(/^(\d{1,5})\s*[-–—]\s*\d{1,5}$/u);
  return match?.[1] ?? null;
}

/**
 * Фильтр известных домов по введённому тексту.
 *
 * Совпадение по подстроке покрывает «12» → «12а», а числовое сравнение — попадание внутрь
 * диапазона «10-20». Без второго правила ввод «15» не находил диапазон и человек видел
 * «дом не найден» при живых данных.
 */
export function filterHousesByQuery(
  options: readonly AddressHouseOption[],
  query: string,
): AddressHouseOption[] {
  const needle = query.trim().toLocaleLowerCase('uk-UA');
  if (!needle) return [...options];
  return options.filter((option) => {
    if (option.housePattern.toLocaleLowerCase('uk-UA').includes(needle)) return true;
    const range = option.housePattern.match(/^(\d{1,5})\s*[-–—]\s*(\d{1,5})$/u);
    const numeric = Number.parseInt(needle, 10);
    if (!range || !Number.isFinite(numeric) || String(numeric) !== needle) return false;
    const start = Number.parseInt(range[1]!, 10);
    const end = Number.parseInt(range[2]!, 10);
    return numeric >= Math.min(start, end) && numeric <= Math.max(start, end);
  });
}

/**
 * Ближайшие известные дома улицы: до `limit`, по разнице номера.
 *
 * Нужно, когда точного дома нет в справочнике: человек видит соседние подтверждённые дома и
 * может выбрать свой, а не гадает группу.
 */
export function nearbyHouseOptions(
  options: readonly AddressHouseOption[],
  house: string,
  limit = 4,
): AddressHouseOption[] {
  const known = options.filter((item) => item.queue && isSingleHousePattern(item.housePattern));
  if (known.length === 0) return [];
  const wanted = houseNumberValue(house);
  return [...known]
    .sort((left, right) => {
      if (wanted === null) {
        return left.housePattern.localeCompare(right.housePattern, 'uk', { numeric: true });
      }
      const a = houseNumberValue(left.housePattern);
      const b = houseNumberValue(right.housePattern);
      return (
        Math.abs((a ?? Number.MAX_SAFE_INTEGER) - wanted) -
        Math.abs((b ?? Number.MAX_SAFE_INTEGER) - wanted)
      );
    })
    .slice(0, Math.max(0, limit));
}

/**
 * Точное имя улицы из справочника по введённому тексту.
 *
 * Сравнение идёт по нормализованной форме, а не по строке: «Шевченка» и «шевченко» — разные
 * написания одной улицы, и запрос домов должен уходить с каноническим именем.
 */
export function matchExactStreetName(
  streets: ReadonlyArray<{ name: string; normalized: string }>,
  input: string,
): string {
  const needle = normalizeAddress(input);
  if (needle.length < 2) return '';
  const match = streets.find(
    (item) => item.normalized === needle || normalizeAddress(item.name) === needle,
  );
  return match?.name ?? '';
}

/** Дедупликация строк без учёта регистра и пробелов по краям; порядок первого появления. */
export function dedupeStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = value.trim().toLocaleLowerCase('uk-UA');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

/**
 * Населенные пункты для подсказок: сначала офлайн-пак (мгновенно), затем сервер.
 * Лимит применяется после склейки, поэтому сервер не вытесняет уже показанные локальные.
 */
export function mergeSettlementOptions(
  offline: readonly string[],
  server: readonly string[],
  limit: number,
): string[] {
  return dedupeStrings([...offline, ...server]).slice(0, Math.max(0, limit));
}

/** Поиск НП по имени или нормализованной форме («Камʼянське» = «Кам'янське»). */
export function findSettlementByName<T extends { name: string }>(
  settlements: readonly T[],
  name: string,
): T | undefined {
  const needle = normalizeAddress(name);
  return settlements.find(
    (item) => item.name === name || normalizeAddress(item.name) === needle,
  );
}


/** Подсказки НП: квадралифицированные имена разворачиваются, дубли и ввод отбрасываются. */
export function settlementSuggestions(
  names: readonly string[],
  query: string,
  limit = 6,
): Array<{ label: string; value: string }> {
  const baseName = (value: string): string => {
    const parts = value.split(' · ');
    return parts[parts.length - 1]!.trim();
  };
  const qualifiedCounts = new Map<string, number>();
  for (const name of names) {
    if (!name.includes(' · ')) continue;
    const base = baseName(name).toLocaleLowerCase('uk-UA');
    qualifiedCounts.set(base, (qualifiedCounts.get(base) ?? 0) + 1);
  }

  const seen = new Set<string>();
  const result: Array<{ label: string; value: string }> = [];
  const needle = query.trim().toLocaleLowerCase('uk-UA');
  for (const item of names) {
    const base = baseName(item);
    const key = base.toLocaleLowerCase('uk-UA');
    const isQualified = item.includes(' · ');
    const isAmbiguous = (qualifiedCounts.get(key) ?? 0) > 1;
    if (isAmbiguous && !isQualified) continue;
    const label =
      isAmbiguous && isQualified
        ? item
        : base.includes('(')
          ? base
          : base.charAt(0).toLocaleUpperCase('uk-UA') + base.slice(1).toLocaleLowerCase('uk-UA');
    const value = isAmbiguous && isQualified ? item : base;
    const labelKey = label.toLocaleLowerCase('uk-UA');
    if (labelKey === needle || seen.has(labelKey)) continue;
    seen.add(labelKey);
    result.push({ label, value });
    if (result.length >= Math.max(0, limit)) break;
  }
  return result;
}
