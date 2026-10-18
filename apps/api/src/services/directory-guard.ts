/**
 * Защита справочника от тестовых записей.
 *
 * Слова `тест/test/demo/xxx` в названии населённого пункта или улицы означают, что в прод
 * попали данные стенда. Один такой адрес выглядит как настоящий, поэтому синхронизация должна
 * остановиться ДО записи в D1, а не «предупредить и продолжить».
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
  return FORBIDDEN_DIRECTORY_TOKENS.some((token) => text.includes(token));
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
