/**
 * Локальный поиск населённых пунктов по пакету синхронизации (мастер адреса в офлайне).
 *
 * Логика чистая и вынесена из api/offline-sync.ts сознательно: её проверяет тест
 * (settlement-search.test.ts), а файлы с доступом к localStorage тестами не покрываются.
 */

/** Что приходит из пакета: подмножество `SyncSettlement` — только то, по чему ищем и что показываем. */
export interface SettlementCandidate {
  name: string;
  kind: string | null;
  queues: string[];
}

/**
 * Приводит название к виду, по которому ищем.
 *
 * Регистр не важен («деснян» должно находить «Деснянське»), а тип НП в начале названия —
 * это шум: «с. Деснянське» и «Деснянське» для человека одно и то же, и по запросу «деснян»
 * должны находиться оба.
 */
export function foldSettlementName(value: string): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^(?:с\.|смт\.?|м\.|місто|село)\s+/u, '');
}

/**
 * Отбирает НП по подстроке и сортирует так, как их ждёт человек.
 *
 * Порядок: сначала совпадения с начала названия, затем — короткие названия. Без второго
 * правила по запросу «Чер» первой подсказкой шла бы «Чернігівська область» (совпадение с начала,
 * но это не населённый пункт, а область целиком), и город «Чернігів» оказывался бы ниже.
 * Совпадения в середине названия идут после всех, кто совпал с начала.
 *
 * Возвращаются только реально найденные записи: ничего не достраиваем и не угадываем.
 */
export function rankSettlements<T extends SettlementCandidate>(
  settlements: readonly T[],
  query: string,
  limit = 6,
): T[] {
  const needle = foldSettlementName(query);
  if (needle.length < 2) return [];

  const scored: Array<{ item: T; rank: number }> = [];
  for (const item of settlements) {
    const name = foldSettlementName(item?.name ?? '');
    const at = name.indexOf(needle);
    if (at < 0) continue;
    // Совпадение с начала (at === 0) весит меньше тысячи позиций: короткое название выигрывает
    // у длинного, но никакое совпадение в середине не обгонит совпадение с начала.
    scored.push({ item, rank: at * 1000 + name.length });
  }

  scored.sort(
    (left, right) =>
      left.rank - right.rank || foldSettlementName(left.item.name).localeCompare(foldSettlementName(right.item.name), 'uk'),
  );

  return scored.slice(0, Math.max(0, limit)).map((entry) => entry.item);
}
