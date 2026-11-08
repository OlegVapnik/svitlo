import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  FAMILY_BY_WEIGHT,
  familyForWeight,
  normalizeWeight,
  resolveTypography,
  stripWeightClasses,
  weightFromClassName,
} from '../src/lib/typography';

const ROOT = path.resolve(import.meta.dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const SOURCES = [...walk(path.join(ROOT, 'app')), ...walk(path.join(ROOT, 'src'))].filter(
  (file) => file.endsWith('.tsx') || file.endsWith('.ts'),
);

const APP_TEXT = path.join(ROOT, 'src/components/ui/AppText.tsx');

describe('typography: вага → реальна родина шрифту', () => {
  it('читає вагу з класів Tailwind', () => {
    expect(weightFromClassName('text-xs font-semibold')).toBe('600');
    expect(weightFromClassName('font-bold text-sm')).toBe('700');
    expect(weightFromClassName('font-extrabold')).toBe('800');
    expect(weightFromClassName('text-xs')).toBeUndefined();
  });

  it('нормалізує fontWeight', () => {
    expect(normalizeWeight('bold')).toBe('700');
    expect(normalizeWeight('normal')).toBe('400');
    expect(normalizeWeight(600)).toBe('600');
    expect(normalizeWeight('950')).toBe('400');
    expect(normalizeWeight(undefined)).toBe('400');
  });

  it('кожна вага має файл шрифту в assets/fonts', () => {
    for (const family of new Set(Object.values(FAMILY_BY_WEIGHT))) {
      expect(existsSync(path.join(ROOT, 'assets/fonts', `${family}.ttf`)), family).toBe(true);
    }
  });

  it('вагові класи прибираються, інші лишаються', () => {
    expect(stripWeightClasses('text-xs font-semibold text-foreground')).toBe(
      'text-xs text-foreground',
    );
    expect(stripWeightClasses('font-bold')).toBe('');
    expect(stripWeightClasses(undefined)).toBeUndefined();
  });

  it('явна родина (monospace) має пріоритет над вагою', () => {
    const result = resolveTypography({ className: 'font-bold', fontFamily: 'monospace' });
    expect(result.fontFamily).toBe('monospace');
    expect(result.className).toBe('');
  });

  it('вага зі style перекриває клас', () => {
    const result = resolveTypography({ className: 'font-medium', fontWeight: '700' });
    expect(result.fontFamily).toBe('Inter-Bold');
  });

  it('familyForWeight не падає на невідомій вазі', () => {
    expect(familyForWeight('123')).toBe('Inter-Regular');
  });
});

describe('typography: захист від регресій у коді', () => {
  it('жоден файл не імпортує Text з react-native напряму', () => {
    const offenders = SOURCES.filter((file) => {
      if (file === APP_TEXT || file === path.join(ROOT, 'src/lib/typography.ts')) return false;
      const source = readFileSync(file, 'utf8');
      return /import\s*\{[^}]*\bText\b[^}]*\}\s*from\s*'react-native'/.test(source);
    }).map((file) => path.relative(ROOT, file));

    expect(offenders).toEqual([]);
  });

  it('глобальне вимкнення масштабування шрифту заборонене', () => {
    const offenders = SOURCES.filter((file) =>
      readFileSync(file, 'utf8').includes('allowFontScaling={false}'),
    ).map((file) => path.relative(ROOT, file));

    expect(offenders).toEqual([]);
  });

  it('Text.defaultProps не перевизначається', () => {
    const offenders = SOURCES.filter((file) =>
      /Text\.defaultProps/.test(readFileSync(file, 'utf8')),
    ).map((file) => path.relative(ROOT, file));

    expect(offenders).toEqual([]);
  });

  it('усі п’ять накреслень Inter підключені через expo-font', () => {
    const appJson = JSON.parse(readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
    const plugin = (appJson.expo.plugins as unknown[]).find(
      (item) => Array.isArray(item) && item[0] === 'expo-font',
    ) as [string, { fonts?: string[] }] | undefined;

    const fonts = plugin?.[1]?.fonts ?? [];
    expect(fonts).toHaveLength(5);
    for (const file of fonts) {
      expect(existsSync(path.join(ROOT, file)), file).toBe(true);
    }
  });
});
