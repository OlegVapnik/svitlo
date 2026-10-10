import { expect, test } from 'vitest';
import { extractSettlementName, titleCasePlace } from '../../src/parsers/place-name.js';

test('titleCasePlace приводить регістр назви, але не чіпає змішаний', () => {
  expect(titleCasePlace('ДЕСНЯНСЬКЕ')).toBe('Деснянське');
  expect(titleCasePlace('НОВГОРОД-СІВЕРСЬКИЙ')).toBe('Новгород-Сіверський');
  expect(titleCasePlace('нова басань')).toBe('Нова Басань');
  expect(titleCasePlace('Лубʼяни')).toBe('Лубʼяни');
  expect(titleCasePlace('   ')).toBe('');
});

test('extractSettlementName не вважає район/область/вулицю населеним пунктом', () => {
  expect(extractSettlementName('Деснянський район')).toBeNull();
  expect(extractSettlementName('Чернігівська область')).toBeNull();
  expect(extractSettlementName('вул. Зарічна, 43')).toBeNull();
  expect(extractSettlementName('')).toBeNull();
});

test('extractSettlementName дістає НП і з префіксом, і без нього', () => {
  expect(extractSettlementName('с. Сохачі, вул. Центральна, 1')).toBe('Сохачі');
  expect(extractSettlementName('смт Короп')).toBe('Короп');
  expect(extractSettlementName('ДЕСНЯНСЬКЕ')).toBe('Деснянське');
});
