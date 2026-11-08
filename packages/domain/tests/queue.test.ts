/**
 * Нормалізація коду черги.
 *
 * Раніше ця функція існувала двома копіями: `normalizeQueue` в `cf-worker/src/address.ts`
 * і така сама локальна копія в `osr-direct.ts`. Тепер вона одна — у домені.
 */
import { describe, expect, it } from 'vitest';

import { normalizeQueue } from '../src/queue.ts';

describe('normalizeQueue', () => {
  it('крапку, дефіс і пробіли зводить до одного слеша', () => {
    expect(normalizeQueue('1.1')).toBe('1/1');
    expect(normalizeQueue('1-1')).toBe('1/1');
    expect(normalizeQueue(' 1 . 1 ')).toBe('1/1');
    expect(normalizeQueue('6.2')).toBe('6/2');
  });

  it('не чіпає вже нормалізований код', () => {
    expect(normalizeQueue('1/1')).toBe('1/1');
    expect(normalizeQueue('12/3')).toBe('12/3');
  });

  it('двозначні черги не розрізає на дві цифри', () => {
    // Київ публікує плоскі черги до 60: «35» — це група 35, а не 3/5.
    expect(normalizeQueue('35')).toBe('35');
    expect(normalizeQueue('44')).toBe('44');
    expect(normalizeQueue('10')).toBe('10');
    expect(normalizeQueue('60')).toBe('60');
    expect(normalizeQueue('35/1')).toBe('35/1');
    expect(normalizeQueue('44/1')).toBe('44/1');
    expect(normalizeQueue('29/1')).toBe('29/1');
  });

  it('склеює повторні слеши й серії розділювачів', () => {
    expect(normalizeQueue('1//1')).toBe('1/1');
    expect(normalizeQueue('1.-/1')).toBe('1/1');
  });

  it('порожнє й сміття не кидає винятків', () => {
    expect(normalizeQueue('')).toBe('');
    expect(normalizeQueue('   ')).toBe('');
    // Кирилиця/латиниця не є розділювачами — функція не «вгадує» код, а лише чистить запис.
    expect(normalizeQueue('черга 1')).toBe('черга1');
  });

  it('терпить null/undefined, як і виклики з необовʼязкових полів', () => {
    expect(normalizeQueue(null as unknown as string)).toBe('');
    expect(normalizeQueue(undefined as unknown as string)).toBe('');
  });
});
