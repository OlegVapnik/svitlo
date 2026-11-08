/**
 * Розбір графіка зеркала: коди півгодинок → інтервали, нормалізація черг.
 *
 * Раніше ці функції жили в `cf-worker/src/schedule-utils.ts` без власних тестів — покривалися
 * лише побічно через `mirror-parser`. Тут вони зафіксовані як контракт домену.
 */
import { test, expect } from 'vitest';

import {
  MIRROR_OFF_CODE,
  cellCode,
  offIntervalsFromCodes,
  queueFromGroupKey,
} from '../src/schedule-utils.ts';
import { halfHourLabels } from '../src/kyiv-time.ts';

test('queueFromGroupKey: «2.2» → «2/2», «3» → «3»', () => {
  expect(queueFromGroupKey('2.2')).toBe('2/2');
  expect(queueFromGroupKey('3')).toBe('3');
  expect(queueFromGroupKey(' 1.10 ')).toBe('1/10');
  expect(queueFromGroupKey('10.1')).toBe('10/1');
});

test('queueFromGroupKey: сміття → null, а не виняток', () => {
  expect(queueFromGroupKey('')).toBeNull();
  expect(queueFromGroupKey('abc')).toBeNull();
  expect(queueFromGroupKey('2.2.3')).toBeNull();
  expect(queueFromGroupKey('2.')).toBeNull();
  expect(queueFromGroupKey('123')).toBeNull();
});

test('cellCode: число або рядок із однієї-двох цифр', () => {
  expect(cellCode(2)).toBe(2);
  expect(cellCode(2.7)).toBe(2);
  expect(cellCode('12')).toBe(12);
  expect(cellCode(' 3 ')).toBe(3);
  expect(cellCode(0)).toBe(0);
});

test('cellCode: усе інше → null', () => {
  expect(cellCode('')).toBeNull();
  expect(cellCode('123')).toBeNull();
  expect(cellCode('x')).toBeNull();
  expect(cellCode(Number.NaN)).toBeNull();
  expect(cellCode(Number.POSITIVE_INFINITY)).toBeNull();
  expect(cellCode(null)).toBeNull();
  expect(cellCode(undefined)).toBeNull();
  expect(cellCode({})).toBeNull();
  expect(cellCode(true)).toBeNull();
});

test('MIRROR_OFF_CODE — код «світла немає»', () => {
  expect(MIRROR_OFF_CODE).toBe(2);
});

test('offIntervalsFromCodes: немає відключень → порожній список', () => {
  expect(offIntervalsFromCodes(halfHourLabels().map(() => 0), halfHourLabels())).toEqual([]);
});

test('offIntervalsFromCodes: суцільне відключення — один інтервал до 00:00', () => {
  const labels = halfHourLabels();
  expect(offIntervalsFromCodes(labels.map(() => MIRROR_OFF_CODE), labels)).toEqual([
    { timeFrom: '00:00', timeTo: '00:00' },
  ]);
});

test('offIntervalsFromCodes: склеює сусідні півгодинки в один відрізок', () => {
  const labels = halfHourLabels();
  const codes = labels.map(() => 0);
  // 20:00–22:00: індекси 40..43
  for (const index of [40, 41, 42, 43]) codes[index] = MIRROR_OFF_CODE;
  expect(offIntervalsFromCodes(codes, labels)).toEqual([{ timeFrom: '20:00', timeTo: '22:00' }]);
});

test('offIntervalsFromCodes: кілька відрізків і відключення в кінці доби', () => {
  const labels = halfHourLabels();
  const codes = labels.map(() => 0);
  codes[2] = MIRROR_OFF_CODE; // 01:00–01:30
  for (let index = 46; index < 48; index += 1) codes[index] = MIRROR_OFF_CODE; // 23:00–00:00
  expect(offIntervalsFromCodes(codes, labels)).toEqual([
    { timeFrom: '01:00', timeTo: '01:30' },
    { timeFrom: '23:00', timeTo: '00:00' },
  ]);
});

test('offIntervalsFromCodes: невідомі коди (null) трактуються як «світло є»', () => {
  const labels = halfHourLabels();
  const codes: Array<number | null> = labels.map(() => null);
  codes[0] = MIRROR_OFF_CODE;
  expect(offIntervalsFromCodes(codes, labels)).toEqual([{ timeFrom: '00:00', timeTo: '00:30' }]);
});
