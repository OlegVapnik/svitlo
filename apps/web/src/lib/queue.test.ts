import { describe, expect, test } from 'vitest';
import { QUEUE_CODE_PATTERN } from '@svitlo/shared';
import {
  canonicalQueueCode,
  canonicalQueueListForRegion,
  DEFAULT_QUEUE_CODES,
  isQueueCode,
  normalizeQueueCode,
  queueCodeMatches,
  queueOptionsForGrid,
  sanitizeQueueList,
} from './queue';

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

  test('queueOptionsForGrid никогда не отдаёт пустой список кнопок', () => {
    // ЧОМУ: пустой ответ `/queues` (холодный кеш, старый офлайн-пакет, ошибка сети) раніше
    // превращал селектор групп в пустую дыру — человек вообще не видел сетки и не мог выбрать свою
    // группу. Теперь на пустом списке показывается стандартная сетка ГПВ.
    expect(queueOptionsForGrid([])).toEqual([...DEFAULT_QUEUE_CODES]);
    expect(queueOptionsForGrid(undefined)).toEqual([...DEFAULT_QUEUE_CODES]);
    expect(queueOptionsForGrid(null)).toEqual([...DEFAULT_QUEUE_CODES]);
    // Список с сервера остаётся списком с сервера — фолбэк его не подменяет.
    expect(queueOptionsForGrid(['3', '2/2'])).toEqual(['3', '2/2']);
    // Мусор из ответа в сетку кнопок не попадает; если валидных кодов не осталось — снова фолбэк.
    expect(queueOptionsForGrid(['черга', ''])).toEqual([...DEFAULT_QUEUE_CODES]);
  });

  test('стандартная сетка — настоящие коды групп (6 черг × 2 підгрупи), без выдумок', () => {
    expect(DEFAULT_QUEUE_CODES).toHaveLength(12);
    expect(DEFAULT_QUEUE_CODES.every((code) => isQueueCode(code))).toBe(true);
    expect(new Set(DEFAULT_QUEUE_CODES).size).toBe(12);
    expect(DEFAULT_QUEUE_CODES[0]).toBe('1/1');
    expect(DEFAULT_QUEUE_CODES[DEFAULT_QUEUE_CODES.length - 1]).toBe('6/2');
  });
});

/**
 * Київ: живой источник отдаёт «1…6», зеркало — «1/1…60/1». Для человека это одна группа, поэтому
 * сравнение кодов должно сводить обе формы. Для остальных областей «1» и «1/1» — разные черги.
 */
describe('region-aware queue code canonicalization', () => {
  test('для Києва плоский код и «N/1» — один код', () => {
    expect(canonicalQueueCode('kyiv-city', '3')).toBe('3/1');
    expect(canonicalQueueCode('kyiv', '3')).toBe('3/1');
    expect(canonicalQueueCode('kyiv-city', '3/1')).toBe('3/1');
    expect(canonicalQueueCode('kyiv-city', '3/2')).toBe('3/2');
    expect(queueCodeMatches('kyiv-city', '3', '3/1')).toBe(true);
  });

  test('для остальных областей «N» и «N/1» — разные черги', () => {
    expect(canonicalQueueCode('chernihivska-oblast', '3')).toBe('3');
    expect(queueCodeMatches('chernihivska-oblast', '3', '3/1')).toBe(false);
    expect(queueCodeMatches('chernihivska-oblast', '3/1', '3/1')).toBe(true);
  });

  test('canonicalQueueListForRegion сводит дубли и мусор', () => {
    expect(canonicalQueueListForRegion('kyiv-city', ['1', '2', '1', 'черга', '1/1'])).toEqual(['1/1', '2/1']);
    expect(canonicalQueueListForRegion('lvivska-oblast', ['1', '1/1', '1'])).toEqual(['1', '1/1']);
  });

  test('Рівне: коди з PDF (1.1…6.2) після парсера — канонічні 1/1…6/2', () => {
    const pdfCodes = [
      '1.1', '1.2', '2.1', '2.2', '3.1', '3.2',
      '4.1', '4.2', '5.1', '5.2', '6.1', '6.2',
    ];
    const parsedFromPdf = pdfCodes.map((code) => code.replace('.', '/'));
    expect(canonicalQueueListForRegion('rivnenska-oblast', parsedFromPdf)).toEqual([
      ...DEFAULT_QUEUE_CODES,
    ]);
  });
});
