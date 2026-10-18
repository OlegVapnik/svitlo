import { describe, expect, test } from 'vitest';
import { formatQueueLabel } from './queue-label.js';

describe('formatQueueLabel', () => {
  test('Київ називає групою навіть число', () => {
    expect(formatQueueLabel('35', 'kyiv-city')).toBe('Група 35');
  });

  test('київське 35/1 показується як група 35, але код у API не змінюється', () => {
    expect(formatQueueLabel('35/1', 'kyiv-city')).toBe('Група 35');
  });

  test('ДТЕК Дніпро — група', () => {
    expect(formatQueueLabel('2/2', 'dnipro-cek')).toBe('Група 2/2');
  });

  test('облэнерго — черга', () => {
    expect(formatQueueLabel('2/2', 'chernihivska-oblast')).toBe('Черга 2/2');
  });

  test('порожній регіон не ламає підпис', () => {
    expect(formatQueueLabel('2/2')).toBe('Черга 2/2');
  });
});
