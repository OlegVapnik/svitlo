import { describe, expect, test } from 'vitest';
import { timingSafeStringEqual } from '../src/utils/timing-safe.js';

/**
 * Юнит-тести утиліти сталочасного порівняння секретів (plugins/auth.ts).
 * Перевіряємо семантику (рівність), а не час — важливо, що довжина не розкривається через SHA-256.
 */
describe('timingSafeStringEqual', () => {
  test('рівні рядки — true', () => {
    expect(timingSafeStringEqual('abc', 'abc')).toBe(true);
  });

  test('різні рядки тієї ж довжини — false', () => {
    expect(timingSafeStringEqual('abc', 'abd')).toBe(false);
  });

  test('порожній рядок проти непустого — false', () => {
    expect(timingSafeStringEqual('', 'x')).toBe(false);
  });

  test('порожні обидва — true', () => {
    expect(timingSafeStringEqual('', '')).toBe(true);
  });

  test('різна довжина — false (не падає, на відміну від прямого timingSafeEqual)', () => {
    expect(timingSafeStringEqual('a', 'ab')).toBe(false);
  });

  test('unicode (кирилиця) не ламає порівняння', () => {
    expect(timingSafeStringEqual('Деснянське', 'Деснянське')).toBe(true);
    expect(timingSafeStringEqual('Деснянське', 'Деснянское')).toBe(false);
  });
});