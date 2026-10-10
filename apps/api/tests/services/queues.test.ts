import { describe, expect, test } from 'vitest';
import { compareQueueCodes, mergeQueues } from '../../src/services/queues.service.js';

/**
 * Список очередей строится только из реальных источников. Тесты фиксируют два свойства:
 * очередь не выдумывается из воздуха и не исчезает, если есть улицы, но нет графика.
 */
describe('mergeQueues', () => {
  test('объединяет слоты графика и привязки улиц по коду очереди', () => {
    const result = mergeQueues(
      [{ queue: '3', slots: 24, lastDate: '2026-10-10' }],
      [{ queue: '3', streets: 5 }],
    );
    expect(result).toEqual([{ queue: '3', slots: 24, lastDate: '2026-10-10', streets: 5 }]);
  });

  test('очередь без графика остаётся в списке (только привязки улиц)', () => {
    const result = mergeQueues([], [{ queue: '2/2', streets: 3 }]);
    expect(result).toEqual([{ queue: '2/2', slots: 0, lastDate: null, streets: 3 }]);
  });

  test('пустые источники дают пустой список — очереди не выдумываются', () => {
    expect(mergeQueues([], [])).toEqual([]);
  });

  test('порядок — числовой: 1, 1/2, 2, 2/2, 10 (а не строковый)', () => {
    const codes = ['10', '2/2', '1/2', '2', '1'];
    const result = mergeQueues(
      codes.map((queue) => ({ queue, slots: 1, lastDate: null })),
      [],
    );
    expect(result.map((item) => item.queue)).toEqual(['1', '1/2', '2', '2/2', '10']);
    expect([...codes].sort(compareQueueCodes)).toEqual(['1', '1/2', '2', '2/2', '10']);
  });
});