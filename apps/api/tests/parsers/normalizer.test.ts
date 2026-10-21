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

test('normalizeOutageLocation розпізнає БУДЬ-ЯКЕ село, а не лише «Деснянське»', () => {
  // Раніше тут було зашите одне село: будь-який інший населений пункт не мав шансу.
  expect(normalizeOutageLocation('Коропський', 'с. Сохачі, вул. Центральна, 1')).toBe('Сохачі');
  // Адреса конкретніша за поле «місце», тому вона має приоритет; поле «місце» теж працює для будь-якого НП.
  expect(normalizeOutageLocation('НОВГОРОД-СІВЕРСЬКИЙ', 'вул. Миру, 5')).toBe('Новгород-Сіверський');
  expect(normalizeOutageLocation('Новгород-Сіверський', 'ДЕСНЯНСЬКЕ')).toBe('Деснянське');
});

test('«Деснянський район» — це район міста, а не село «Деснянське»', () => {
  expect(normalizeOutageLocation('Чернігівська область', 'Деснянський район')).toBe('Чернігівська область');
  // А коли в адресі є саме місто — повертаємо місто, а не область.
  expect(normalizeOutageLocation('Чернігівська область', 'м. Чернігів, Деснянський район, вул. Козацька, 5')).toBe('Чернігів');
});
