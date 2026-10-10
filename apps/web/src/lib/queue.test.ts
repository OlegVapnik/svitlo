import { describe, expect, test } from 'vitest';
import { QUEUE_CODE_PATTERN } from '@svitlo/shared';
import { isQueueCode, normalizeQueueCode, sanitizeQueueList } from './queue';

/**
 * Веб держит свою копию шаблона очереди (без zod в бандле). Первый тест — сторож расхождения:
 * если формат изменят в @svitlo/shared, тест упадёт и заставит поправить клиент.
 */
describe('queue code format', () => {
  test('клиентский регэксп совпадает с шаблоном @svitlo/shared', () => {
    expect(/^\d+(?:\/\d+)?$/.source).toBe(new RegExp(QUEUE_CODE_PATTERN).source);
    expect(isQueueCode('3')).toBe(new RegExp(QUEUE_CODE_PATTERN).test('3'));
    expect(isQueueCode('черга')).toBe(new RegExp(QUEUE_CODE_PATTERN).test('черга'));
  });

  test('принимает простые и под-очереди, отвергает мусор', () => {
    expect(isQueueCode('3')).toBe(true);
    expect(isQueueCode(' 2/2 ')).toBe(true);
    expect(isQueueCode('черга')).toBe(false);
    expect(isQueueCode('2/2/2')).toBe(false);
    expect(isQueueCode('')).toBe(false);
  });

  test('normalizeQueueCode обрезает пробелы', () => {
    expect(normalizeQueueCode(' 2/2 ')).toBe('2/2');
  });

  test('sanitizeQueueList выкидывает мусор и дубли, сохраняя порядок', () => {
    expect(sanitizeQueueList(['3', '3', 'черга', '', ' 2/2 ', '2/2', 42, null])).toEqual(['3', '2/2']);
    expect(sanitizeQueueList([])).toEqual([]);
  });
});