import { expect, test } from 'vitest';
import { normalizeAddress, normalizeAreaName, normalizeOutageLocation } from '../../src/parsers/normalizer.js';

test('normalizeAddress', () => {
  expect(normalizeAddress('вулиця Шевченка')).toBe('вул. Шевченка');
});

test('normalizeAreaName keeps district distinct from the city', () => {
  expect(normalizeAreaName('Чернігівський')).toBe('Чернігівський район');
});

test('normalizeOutageLocation resolves village from operator addresses', () => {
  expect(normalizeOutageLocation('Чернігівський', 'с. Деснянське, вул. Зарічна, 43')).toBe('Деснянське');
});
