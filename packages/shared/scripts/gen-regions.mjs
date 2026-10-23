#!/usr/bin/env node
/**
 * Генерує каталог областей для Cloudflare Worker з єдиного джерела правди.
 *
 * Навіщо: `cf-worker` не імпортує `@svitlo/shared` (там zod), тому каталог у
 * `cf-worker/src/regions.ts` був ручною копією. Копії розходились — і з'являлись
 * області, яких немає в одному з каталогів. Скрипт перезаписує лише блок
 * `REGION_CATALOG` між маркерами, решту файлу не чіпає.
 *
 * Запуск: node tools/gen-regions.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const sourcePath = join(root, 'packages/shared/src/regions-catalog.ts');
const targetPath = join(root, 'cf-worker/src/regions.ts');
const START = '// <generated-regions>';
const END = '// </generated-regions>';

const source = await import(pathToFileURL(sourcePath).href);
const catalog = source.REGION_CATALOG;
if (!Array.isArray(catalog) || catalog.length === 0) {
  throw new Error('REGION_CATALOG порожній або не експортований');
}

const quote = (value) => `'${String(value).replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
const lines = catalog.map(
  (entry) =>
    `  { cpu: ${quote(entry.cpu)}, nameUa: ${quote(entry.nameUa)}, feedKeys: [${entry.feedKeys
      .map(quote)
      .join(', ')}] },`,
);

const block = [
  START,
  '/** Каталог: 24 області + Київ. Згенеровано з packages/shared/src/regions-catalog.ts. */',
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
await writeFile(targetPath, next);
console.log(`regions: ${catalog.length} записів → ${targetPath}`);
