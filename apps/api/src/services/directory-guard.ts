/**
 * Защита справочника от тестовых записей.
 *
 * Маркеры `тест/test` в начале названия и отдельные слова `демо/demo/xxx` означают,
 * что в прод попали данные стенда. Совпадение проверяется до записи в D1.
 */
export const FORBIDDEN_DIRECTORY_TOKENS = ['тест', 'test', 'демо', 'demo', 'xxx'] as const;

export interface DirectoryNameRow {
  region?: unknown;
  name?: unknown;
  settlement_name?: unknown;
  street_name?: unknown;
}

export interface ForbiddenDirectoryRow {
  region: string;
  name: string;
  field: 'name' | 'settlement_name' | 'street_name';
}

export function directoryNameHasTestMarker(value: unknown): boolean {
  const text = String(value ?? '').trim().toLocaleLowerCase('uk-UA');
  if (!text) return false;
  // «Демократична» — реальное название улицы: совпадение «демо» внутри слова ложно блокирует
  // импорт. «Тестова» остаётся маркером фикстуры, а «демо/demo/xxx» считаются только целыми словами.
  if (text.includes('тест') || text.includes('test')) return true;
  return /(?:^|[^а-яіїєґa-z0-9])(?:демо|demo|xxx)(?:$|[^а-яіїєґa-z0-9])/u.test(text);
}

export function findForbiddenDirectoryRows(rows: readonly DirectoryNameRow[]): ForbiddenDirectoryRow[] {
  const found: ForbiddenDirectoryRow[] = [];
  for (const row of rows) {
    for (const field of ['name', 'settlement_name', 'street_name'] as const) {
      if (directoryNameHasTestMarker(row[field])) {
        found.push({
          region: String(row.region ?? '').trim(),
          name: String(row[field] ?? '').trim(),
          field,
        });
      }
    }
  }
  return found;
}

export function assertDirectoryNamesClean(rows: readonly DirectoryNameRow[], source: string): void {
  const found = findForbiddenDirectoryRows(rows);
  if (found.length === 0) return;
  const examples = found
    .slice(0, 5)
    .map((row) => `${row.region || '?'}: ${row.name}`)
    .join('; ');
  throw new Error(
    `${source}: найдены тестовые записи (${found.length}): ${examples}. ` +
      'Удалите их из источника и повторите синхронизацию.',
  );
}
