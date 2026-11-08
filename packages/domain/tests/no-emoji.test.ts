import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Заборона емодзі в текстах.
 *
 * Тон в інтерфейсі задають векторні іконки Lucide та типографіка. Юнікод-емодзі
 * по-різному виглядають на Android, iOS і Windows і ламають охайну верстку, тому їх
 * не має бути ні в банерах режимів, ні в текстах змін графіка, ні в підказках
 * офіційних джерел, ні в чейнджлозі.
 */
const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = existsSync(resolve(THIS_DIR, '../../../package.json'))
  ? resolve(THIS_DIR, '../../..')
  : resolve(THIS_DIR, '../..');

const FILES = [
  'packages/domain/src/grid-regime.ts',
  'packages/domain/src/schedule-diff.ts',
  'packages/domain/src/region-sources.ts',
  'apps/mobile/src/lib/schedule-change-view.ts',
  'apps/web/src/data/changelog.json',
  'cf-worker/src/data/changelog.json',
  'src/data/changelog.json',
];

const EMOJI = /\p{Extended_Pictographic}/u;

/** Значення всіх полів `bypassHintUk: '…'` з реєстру. */
function bypassHints(text: string): string[] {
  return [...text.matchAll(/bypassHintUk:\s*'([^']*)'/gu)].map((match) => match[1]);
}

describe('немає юнікод-емодзі в текстах', () => {
  it.each(FILES)('%s', (relative) => {
    const fullPath = join(ROOT, relative);
    if (!existsSync(fullPath)) return;
    const text = readFileSync(fullPath, 'utf8');
    for (const [index, line] of text.split('\n').entries()) {
      expect(EMOJI.test(line), `${relative}:${index + 1}: ${line.trim()}`).toBe(false);
    }
  });

  it('Android-рядки сповіщень і живого статусу без емодзі', () => {
    const valuesDir = join(ROOT, 'apps/mobile/native-android/res/values');
    if (!existsSync(valuesDir)) return;
    const xmlFiles = readdirSync(valuesDir).filter((name) => name.endsWith('.xml'));
    expect(xmlFiles.length).toBeGreaterThan(0);
    for (const name of xmlFiles) {
      const text = readFileSync(join(valuesDir, name), 'utf8');
      for (const [index, line] of text.split('\n').entries()) {
        // Коментарі теж перевіряємо: зайвий емодзі в коментарі легко скопіювати в рядок.
        expect(EMOJI.test(line), `${name}:${index + 1}: ${line.trim()}`).toBe(false);
      }
    }
  });

  it('підказки безрахункового пошуку адреси без емодзі', () => {
    const rel = existsSync(join(ROOT, 'packages/domain/src/region-sources.ts'))
      ? 'packages/domain/src/region-sources.ts'
      : 'src/region-sources.ts';
    if (!existsSync(join(ROOT, rel))) return;
    const text = readFileSync(join(ROOT, rel), 'utf8');
    const hints = bypassHints(text);
    expect(hints.length).toBeGreaterThan(20);
    for (const hint of hints) {
      expect(EMOJI.test(hint), hint).toBe(false);
    }
  });

  it('README без емодзі: вітрина репозиторію теж інтерфейс', () => {
    const readmePath = join(ROOT, 'README.md');
    if (!existsSync(readmePath)) return;
    const text = readFileSync(readmePath, 'utf8');
    for (const [index, line] of text.split('\n').entries()) {
      expect(EMOJI.test(line), `README.md:${index + 1}: ${line.trim()}`).toBe(false);
    }
  });
});
