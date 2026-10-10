import { describe, expect, test } from 'vitest';
import {
  DEFAULT_REGION,
  DEFAULT_REGION_NAME_UA,
  REGION_STORAGE_KEY,
  formatRegionOption,
  getStoredRegion,
  isRegionCpu,
  normalizeRegionCpu,
  setStoredRegion,
  type RegionSummary,
} from './region';

describe('multi-region helper', () => {
  test('константи відповідають замороженому контракту /tmp/API-CONTRACT-regions.md', () => {
    expect(DEFAULT_REGION).toBe('chernihivska-oblast');
    expect(DEFAULT_REGION_NAME_UA).toBe('Чернігівська область');
    expect(REGION_STORAGE_KEY).toBe('svitlo_region');
  });

  test('isRegionCpu валідує kebab-case ідентифікатори', () => {
    expect(isRegionCpu('chernihivska-oblast')).toBe(true);
    expect(isRegionCpu('kyiv-city')).toBe(true);
    expect(isRegionCpu('lvivska-oblast')).toBe(true);
    expect(isRegionCpu('')).toBe(false);
    expect(isRegionCpu('Чернігів')).toBe(false);
    expect(isRegionCpu('kyiv_city')).toBe(false);
    expect(isRegionCpu(null)).toBe(false);
  });

  test('normalizeRegionCpu повертає очищений cpu або дефолт', () => {
    expect(normalizeRegionCpu('  KYIV-CITY  ')).toBe('kyiv-city');
    expect(normalizeRegionCpu('invalid cpu!')).toBe('chernihivska-oblast');
    expect(normalizeRegionCpu(undefined)).toBe('chernihivska-oblast');
  });

  test('getStoredRegion та setStoredRegion коректно взаємодіють зі сховищем', () => {
    const store = new Map<string, string>();
    const mockStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, val: string) => store.set(key, val),
    };

    // Початково порожнє сховище повертає DEFAULT_REGION
    expect(getStoredRegion(mockStorage)).toBe('chernihivska-oblast');

    // Запис валідного регіону
    setStoredRegion('kyiv-city', mockStorage);
    expect(store.get(REGION_STORAGE_KEY)).toBe('kyiv-city');
    expect(getStoredRegion(mockStorage)).toBe('kyiv-city');

    // Запис невалідного значення фолбечить на DEFAULT_REGION
    setStoredRegion('невідома область', mockStorage);
    expect(getStoredRegion(mockStorage)).toBe('chernihivska-oblast');
  });

  test('formatRegionOption формує зрозумілий підпис', () => {
    const regionWithQueues: RegionSummary = {
      cpu: 'chernihivska-oblast',
      nameUa: 'Чернігівська область',
      nameEn: null,
      queues: ['1/1', '2/2'],
      slots: 96,
      lastDate: '2026-10-11',
    };
    expect(formatRegionOption(regionWithQueues)).toBe('Чернігівська область (2)');

    const regionNoQueues: RegionSummary = {
      cpu: 'lvivska-oblast',
      nameUa: 'Львівська область',
      nameEn: null,
      queues: [],
      slots: 0,
      lastDate: null,
    };
    expect(formatRegionOption(regionNoQueues)).toBe('Львівська область');
  });
});
