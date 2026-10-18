import { describe, expect, test } from 'vitest';
import {
  assertDirectoryNamesClean,
  directoryNameHasTestMarker,
  findForbiddenDirectoryRows,
} from '../../src/services/directory-guard.js';

describe('directory guard', () => {
  test.each(['Тестова', 'test street', 'DEMO village', 'xxx', 'с. Демо'])(
    '«%s» считается тестовой записью',
    (name) => {
      expect(directoryNameHasTestMarker(name)).toBe(true);
    },
  );

  test.each(['Шевченка', 'Деснянське', 'Тернопіль', ''])('«%s» — нормальное название', (name) => {
    expect(directoryNameHasTestMarker(name)).toBe(false);
  });

  test('находит тестовую улицу в строке привязки', () => {
    expect(
      findForbiddenDirectoryRows([
        { region: 'chernihivska-oblast', settlement_name: 'Деснянське', street_name: 'вул. Тестова' },
      ]),
    ).toEqual([{ region: 'chernihivska-oblast', name: 'вул. Тестова', field: 'street_name' }]);
  });

  test('синхронизация падает до записи, если в справочнике есть тестовая запись', () => {
    expect(() =>
      assertDirectoryNamesClean([{ region: 'kyiv-city', name: 'Тестове' }], 'test-sync'),
    ).toThrow(/test-sync.*тестовые записи/u);
  });
});
