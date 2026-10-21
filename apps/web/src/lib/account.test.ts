import { describe, expect, test } from 'vitest';
import { ACCOUNT_NUMBER_PATTERN } from '@svitlo/shared';
import { isAccountNumber, normalizeAccountNumber } from './account';

/** Сторож расхождения: клиентская копия шаблона должна совпадать с серверной. */
describe('account number', () => {
  test('клиентский регэксп совпадает с шаблоном @svitlo/shared', () => {
    expect(/^\d{9,12}$/.source).toBe(new RegExp(ACCOUNT_NUMBER_PATTERN).source);
  });

  test('normalizeAccountNumber убирает разделители (в т.ч. неразрывный пробел)', () => {
    expect(normalizeAccountNumber('987 654 321')).toBe('987654321');
    expect(normalizeAccountNumber('987-654-321')).toBe('987654321');
    expect(normalizeAccountNumber('987\u00a0654321')).toBe('987654321');
  });

  test('принимает 9–12 цифр и отвергает всё остальное', () => {
    expect(isAccountNumber('123456789')).toBe(true);
    expect(isAccountNumber('123456789012')).toBe(true); // scan:allow: синтетический фикстур-номер
    expect(isAccountNumber('12345678')).toBe(false); // scan:allow: синтетический фикстур-номер
    expect(isAccountNumber('1234567890123')).toBe(false);
    expect(isAccountNumber('')).toBe(false);
  });
});