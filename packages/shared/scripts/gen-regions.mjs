#!/usr/bin/env node
/**
 * Генерирует каталог областей для Cloudflare Worker из единственного источника правды.
 *
 * Зачем: `cf-worker` не импортирует `@svitlo/shared` (там zod), поэтому каталог в
 * `cf-worker/src/regions.ts` был ручной копией. Копии расходились — и появлялись области,
 * которых нет в одном из каталогов. Скрипт перезаписывает только блок `REGION_CATALOG` между
 * маркерами, остальную часть файла не трогает.
 *
 * Режимы:
 *   node packages/shared/scripts/gen-regions.mjs          — записать блок;
 *   node packages/shared/scripts/gen-regions.mjs --check  — только проверить (exit 1 при дрейфе).
 *
 * Идемпотентность обязательна: повторный запуск без изменений в источнике не даёт диффа,
 * иначе `pnpm gen:regions && git diff --exit-code` не может быть гейтом (ADR-0008).
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const sourcePath = join(root, 'packages/shared/src/regions-catalog.ts');
const targetPath = join(root, 'cf-worker/src/regions.ts');
const START = '// <generated-regions>';
const END = '// </generated-regions>';
const EXEMPT_VALUES = new Set(['occupied', 'frontline_emergency']);
const checkOnly = process.argv.includes('--check');

const source = await import(pathToFileURL(sourcePath).href);
const catalog = source.REGION_CATALOG;
if (!Array.isArray(catalog) || catalog.length === 0) {
  throw new Error('REGION_CATALOG порожній або не експортований');
}

const quote = (value) => `'${String(value).replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
const lines = catalog.map((entry) => {
  if (entry.exempt !== undefined && !EXEMPT_VALUES.has(entry.exempt)) {
    throw new Error(`Невідоме значення exempt у ${entry.cpu}: ${entry.exempt}`);
  }
  const exempt = entry.exempt ? `, exempt: ${quote(entry.exempt)}` : '';
  const known = entry.knownQueues?.length
    ? `, knownQueues: [${entry.knownQueues.map(quote).join(', ')}]`
    : '';
  return `  { cpu: ${quote(entry.cpu)}, nameUa: ${quote(entry.nameUa)}, feedKeys: [${entry.feedKeys
    .map(quote)
    .join(', ')}]${exempt}${known} },`;
});

const block = [
  START,
  '/** Каталог: 24 області + Київ. Згенеровано з packages/shared/src/regions-catalog.ts, не правити руками. */',
  'export const REGION_CATALOG: RegionCatalogEntry[] = [',
  ...lines,
  '];',
  END,
].join('\n');

const target = await readFile(targetPath, 'utf8');
const startIndex = target.indexOf(START);
const endIndex = target.indexOf(END);
if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
  throw new Error(`У ${targetPath} немає маркерів ${START} … ${END}`);
}
const next = `${target.slice(0, startIndex)}${block}${target.slice(endIndex + END.length)}`;

if (checkOnly) {
  if (next !== target) {
    console.error(
      `regions: ${targetPath} расходится с ${sourcePath} — запустите \`pnpm gen:regions\` и закоммитьте результат`,
    );
    process.exit(1);
  }
  console.log(`regions: ${catalog.length} записей, дрейфа нет`);
} else {
  await writeFile(targetPath, next);
  console.log(`regions: ${catalog.length} записей → ${targetPath}`);
}
