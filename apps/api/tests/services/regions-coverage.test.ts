process.env['DATABASE_URL'] ??= 'postgresql://test:test@localhost:5432/test'; // scan:allow: фікстура теста
process.env['LOG_LEVEL'] ??= 'silent';

import { beforeAll, describe, expect, it } from 'vitest';

let calculateRegionFreshness: typeof import('../../src/services/regions.service.js').calculateRegionFreshness;

beforeAll(async () => {
  const mod = await import('../../src/services/regions.service.js');
  calculateRegionFreshness = mod.calculateRegionFreshness;
});

describe('calculateRegionFreshness (чиста функція свіжості даних)', () => {
  // Фіксований момент: 2026-10-11T12:00:00+03:00 (Kyiv wall-clock)
  const now = new Date('2026-10-11T09:00:00.000Z');

  it('null: відсутність даних дає covered: false, freshnessHours: null, stale: true', () => {
    const result = calculateRegionFreshness(null, now);
    expect(result).toEqual({
      freshnessHours: null,
      stale: true,
      covered: false,
    });
  });

  it('порожній рядок: так само як null', () => {
    const result = calculateRegionFreshness('', now);
    expect(result).toEqual({
      freshnessHours: null,
      stale: true,
      covered: false,
    });
  });

  it('сьогоднішня дата (2026-10-11): свіжі дані (0 годин, не застарілі)', () => {
    const result = calculateRegionFreshness('2026-10-11', now);
    expect(result).toEqual({
      freshnessHours: 0,
      stale: false,
      covered: true,
    });
  });

  it('будуща дата (2026-10-12, завтра): свіжі дані (0 годин, не застарілі)', () => {
    const result = calculateRegionFreshness('2026-10-12', now);
    expect(result).toEqual({
      freshnessHours: 0,
      stale: false,
      covered: true,
    });
  });

  it('вчорашня дата (2026-10-10, 24 години): ще не застаріла (> 48 год)', () => {
    const result = calculateRegionFreshness('2026-10-10', now);
    expect(result).toEqual({
      freshnessHours: 24,
      stale: false,
      covered: true,
    });
  });

  it('межа: рівно 48 годин (2026-10-09, 2 доби тому) — межове значення, ще не старше 48ч', () => {
    const result = calculateRegionFreshness('2026-10-09', now);
    expect(result).toEqual({
      freshnessHours: 48,
      stale: false,
      covered: true,
    });
  });

  it('старше 48 годин (2026-10-08, 72 години тому) — застарілі дані (stale: true)', () => {
    const result = calculateRegionFreshness('2026-10-08', now);
    expect(result).toEqual({
      freshnessHours: 72,
      stale: true,
      covered: true,
    });
  });

  it('дата тижневої давності (2026-10-04, 7 діб = 168 годин тому): stale: true', () => {
    const result = calculateRegionFreshness('2026-10-04', now);
    expect(result).toEqual({
      freshnessHours: 168,
      stale: true,
      covered: true,
    });
  });
});
