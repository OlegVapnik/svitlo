import { describe, expect, test } from 'vitest';
import { matchHouseNumber, normalizeHouseNumber } from '../../src/services/house-number.js';

describe('normalizeHouseNumber', () => {
  test.each([
    '100/А',
    '100а',
    '100 А',
    '100-А',
    '100A',
    '  100 / а  ',
  ])('«%s» — це один і той самий дім 100А', (value) => {
    expect(normalizeHouseNumber(value)).toBe('100a');
  });

  test.each([
    ['В', 'b'],
    ['С', 'c'],
    ['Е', 'e'],
    ['К', 'k'],
    ['М', 'm'],
    ['Н', 'h'],
    ['О', 'o'],
    ['Р', 'p'],
    ['Т', 't'],
  ])('кирилична «%s» дорівнює латинській «%s»', (cyrillic, latin) => {
    expect(normalizeHouseNumber(`12${cyrillic}`)).toBe(normalizeHouseNumber(`12${latin}`));
  });

  test('різні літери суфікса не злипаються', () => {
    expect(normalizeHouseNumber('100А')).not.toBe(normalizeHouseNumber('100Б'));
  });

  test('дробовий корпус не перетворюється на чотиризначний номер', () => {
    expect(normalizeHouseNumber('100/1')).toBe('100/1');
  });
});

describe('matchHouseNumber', () => {
  test('усі написання 100А знаходять привʼязку 100/А', () => {
    for (const input of ['100/А', '100а', '100 А', '100-А', '100A']) {
      expect(matchHouseNumber(input, '100/А')).toBe(true);
    }
  });

  test('100Б не підходить під 100А', () => {
    expect(matchHouseNumber('100Б', '100/А')).toBe(false);
  });

  test('числовий діапазон працює як раніше', () => {
    expect(matchHouseNumber('17', '1-19')).toBe(true);
    expect(matchHouseNumber('20', '1-19')).toBe(false);
  });

  test('список домів приймає будь-який з елементів', () => {
    expect(matchHouseNumber('6А', '2, 4, 6А, 8')).toBe(true);
    expect(matchHouseNumber('7', '2, 4, 6А, 8')).toBe(false);
  });
});
