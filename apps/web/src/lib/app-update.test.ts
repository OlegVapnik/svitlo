import { describe, expect, test } from 'vitest';
import type { ChangelogRelease } from '@svitlo/shared';
import { compareVersions, isNewerVersion, parseVersion, summarizeUpdate } from './app-update.js';

const release = (
  version: string,
  date: string,
  features: string[] = [],
  fixes: string[] = [],
  optimizations: string[] = [],
): ChangelogRelease => ({ version, date, tag: version.endsWith('.0') ? 'Release' : 'Update', features, fixes, optimizations });

const releases: ChangelogRelease[] = [
  release('2.15.0', '2026-10-18', ['Планувальник'], [], ['Швидший старт']),
  release('2.14.2', '2026-10-17', ['Іконка'], ['Таймер']),
  release('2.14.0', '2026-10-16', ['Матриця'], ['Час']),
];

describe('parseVersion', () => {
  test('приймає v-префікс і відхиляє сміття', () => {
    expect(parseVersion('v2.15.0')).toEqual([2, 15, 0]);
    expect(parseVersion('2.15')).toBeNull();
    expect(parseVersion('')).toBeNull();
  });
});

describe('compareVersions', () => {
  test('порівнює числа, а не рядки', () => {
    expect(compareVersions('2.15.0', '2.9.9')).toBeGreaterThan(0);
    expect(compareVersions('2.15.0', '2.15.0')).toBe(0);
    expect(isNewerVersion('2.14.2', '2.15.0')).toBe(false);
  });
});

describe('summarizeUpdate', () => {
  test('для нового серверного релізу показує зміни від встановленої версії', () => {
    const summary = summarizeUpdate(releases, '2.14.2', '2.15.0', '2.14.2');
    expect(summary.hasUpdate).toBe(true);
    expect(summary.fromVersion).toBe('2.14.2');
    expect(summary.toVersion).toBe('2.15.0');
    expect(summary.releases.map((item) => item.version)).toEqual(['2.15.0']);
    expect(summary.features).toBe(1);
    expect(summary.optimizations).toBe(1);
  });

  test('перший показ без lastSeen бере відлік від попереднього релізу', () => {
    const summary = summarizeUpdate(releases, '2.15.0', '2.15.0', null);
    expect(summary.hasUpdate).toBe(false);
    expect(summary.fromVersion).toBe('2.14.2');
    expect(summary.releases.map((item) => item.version)).toEqual(['2.15.0']);
  });

  test('кілька пропущених релізів сумуються', () => {
    const summary = summarizeUpdate(releases, '2.14.0', '2.15.0', '2.14.0');
    expect(summary.releases.map((item) => item.version)).toEqual(['2.15.0', '2.14.2']);
    expect(summary.features).toBe(2);
    expect(summary.fixes).toBe(1);
  });

  test('коли все переглянуто, показує останній реліз, а не порожню історію', () => {
    const summary = summarizeUpdate(releases, '2.15.0', '2.15.0', '2.15.0');
    expect(summary.hasUpdate).toBe(false);
    expect(summary.releases).toHaveLength(1);
    expect(summary.releases[0]!.version).toBe('2.15.0');
  });
});
