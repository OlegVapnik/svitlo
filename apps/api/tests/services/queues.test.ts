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
    expect(result).toEqual([
      { queue: '3', slots: 24, lastDate: '2026-10-10', streets: 5, settlements: [], streetNames: [] },
    ]);
  });

  test('очередь без графика остаётся в списке (только привязки улиц)', () => {
    const result = mergeQueues([], [{ queue: '2/2', streets: 3 }]);
    expect(result).toEqual([
      { queue: '2/2', slots: 0, lastDate: null, streets: 3, settlements: [], streetNames: [] },
    ]);
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

  test('опубликованная «пустая» группа попадает в список с флагом covered', () => {
    // Так выглядит день «графік є, відключень немає»: слотов в БД нет, но оператор группы опубликовал.
    // Без этого списка экран выбора группы писал «графік не імпортовано» про существующий график.
    const result = mergeQueues([], [], [], ['2/1', '4/1']);
    expect(result).toEqual([
      { queue: '2/1', slots: 0, lastDate: null, streets: 0, settlements: [], streetNames: [], covered: true },
      { queue: '4/1', slots: 0, lastDate: null, streets: 0, settlements: [], streetNames: [], covered: true },
    ]);
  });

  test('covered дописывается существующей группе, а не дублирует её', () => {
    const result = mergeQueues(
      [{ queue: '3', slots: 0, lastDate: null }],
      [{ queue: '3', streets: 7 }],
      [],
      ['3'],
    );
    expect(result).toEqual([
      { queue: '3', slots: 0, lastDate: null, streets: 7, settlements: [], streetNames: [], covered: true },
    ]);
  });

  test('без опубликованного графика группа не получает covered (пустой список — честное «не знаем»)', () => {
    const result = mergeQueues([], [{ queue: '2/2', streets: 3 }]);
    expect(result[0]?.covered).toBeUndefined();
  });

  test('сортировка остаётся числовой и среди групп, добавленных из публикации', () => {
    const result = mergeQueues([{ queue: '10', slots: 4, lastDate: null }], [], [], ['2', '1/2']);
    expect(result.map((item) => item.queue)).toEqual(['1/2', '2', '10']);
    // covered — признак опубликованного дня, а не «группа вообще есть в списке»: у '10' слоты есть,
    // но в чистой публикации на дату её нет, поэтому флага нет.
    expect(result.map((item) => item.covered)).toEqual([true, true, undefined]);
  });
});