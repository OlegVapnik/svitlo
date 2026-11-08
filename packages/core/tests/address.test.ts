import { describe, expect, it } from 'vitest';

import {
  dedupeStrings,
  filterHousesByQuery,
  findSettlementByName,
  houseNumberValue,
  housePatternStart,
  isSingleHousePattern,
  matchExactStreetName,
  mergeSettlementOptions,
  nearbyHouseOptions,
  settlementSuggestions,
} from '../src/lib/address.ts';

const house = (housePattern: string, queue: string | null = '2/2') => ({ housePattern, queue });

describe('houseNumberValue', () => {
  it('берёт число из начала строки', () => {
    expect(houseNumberValue('12')).toBe(12);
    expect(houseNumberValue('12а')).toBe(12);
    expect(houseNumberValue(' 7/2 ')).toBe(7);
  });

  it('без числа — null', () => {
    expect(houseNumberValue('')).toBeNull();
    expect(houseNumberValue('буд. 12')).toBeNull();
  });
});

describe('isSingleHousePattern', () => {
  it('одиночные номера — да', () => {
    for (const value of ['12', '12а', '12/3', '12 к. 2', '12\\3']) {
      expect(isSingleHousePattern(value), value).toBe(true);
    }
  });

  it('диапазоны и списки — нет', () => {
    for (const value of ['10-20', '10–20', '10, 12', '', '12 14']) {
      expect(isSingleHousePattern(value), value).toBe(false);
    }
  });
});

describe('housePatternStart', () => {
  it('возвращает начало диапазона', () => {
    expect(housePatternStart('10-20')).toBe('10');
    expect(housePatternStart('10–20')).toBe('10');
    expect(housePatternStart('12')).toBeNull();
  });
});

describe('filterHousesByQuery', () => {
  const options = [house('12'), house('12а'), house('10-20'), house('7')];

  it('пустой запрос — весь список', () => {
    expect(filterHousesByQuery(options, '  ')).toHaveLength(4);
  });

  it('подстрока и число внутри диапазона', () => {
    expect(filterHousesByQuery(options, '12а').map((item) => item.housePattern)).toEqual(['12а']);
    expect(filterHousesByQuery(options, '15').map((item) => item.housePattern)).toEqual(['10-20']);
  });

  it('число вне диапазона не проходит', () => {
    expect(filterHousesByQuery(options, '25')).toEqual([]);
  });
});

describe('nearbyHouseOptions', () => {
  const options = [house('2'), house('8'), house('12'), house('12/2'), house('20'), house('10-20')];

  it('сортирует по близости номера и ограничивает', () => {
    expect(nearbyHouseOptions(options, '11', 3).map((item) => item.housePattern)).toEqual(['12', '12/2', '8']);
  });

  it('без числа — натуральная сортировка', () => {
    expect(nearbyHouseOptions(options, '', 3).map((item) => item.housePattern)).toEqual(['2', '8', '12']);
  });

  it('исключает диапазоны и дома без группы', () => {
    const result = nearbyHouseOptions([house('10-20'), house('5', null), house('7')], '6');
    expect(result.map((item) => item.housePattern)).toEqual(['7']);
  });
});

describe('matchExactStreetName', () => {
  const streets = [
    { name: 'Тараса Шевченка', normalized: 'тараса шевченка' },
    { name: 'Соборна', normalized: 'соборна' },
  ];

  it('находит по нормализованной форме', () => {
    expect(matchExactStreetName(streets, 'соборна')).toBe('Соборна');
    expect(matchExactStreetName(streets, 'Тараса  Шевченка')).toBe('Тараса Шевченка');
  });

  it('слишком короткий ввод или промах — пусто', () => {
    expect(matchExactStreetName(streets, 'с')).toBe('');
    expect(matchExactStreetName(streets, 'не та вулиця')).toBe('');
  });
});

describe('dedupeStrings', () => {
  it('убирает дубли без учёта регистра и порядок сохраняет', () => {
    expect(dedupeStrings(['Київ', ' київ ', 'Львів', '', 'КИЇВ'])).toEqual(['Київ', 'Львів']);
  });
});

describe('mergeSettlementOptions', () => {
  it('офлайн идёт первым, лимит после склейки', () => {
    expect(mergeSettlementOptions(['Чернігів', 'Ніжин'], ['ніжин', 'Прилуки'], 3)).toEqual([
      'Чернігів',
      'Ніжин',
      'Прилуки',
    ]);
  });
});

describe('findSettlementByName', () => {
  const settlements = [
    { name: 'Камʼянське', wholeSettlementQueue: '1/1' },
    { name: 'Дніпро', wholeSettlementQueue: null },
  ];

  it('находит по точному имени и по нормализации', () => {
    expect(findSettlementByName(settlements, 'Дніпро')?.name).toBe('Дніпро');
    expect(findSettlementByName(settlements, 'дніпро')?.name).toBe('Дніпро');
  });

  it('неизвестное имя — undefined', () => {
    expect(findSettlementByName(settlements, 'Львів')).toBeUndefined();
  });
});

describe('settlementSuggestions', () => {
  it('убирает дубли, нормализует регистр и лимитирует', () => {
    expect(
      settlementSuggestions(['ЧЕРНІГІВ', 'чернігів', 'Ніжин', 'Прилуки'], ''),
    ).toEqual([
      { label: 'Чернігів', value: 'ЧЕРНІГІВ' },
      { label: 'Ніжин', value: 'Ніжин' },
      { label: 'Прилуки', value: 'Прилуки' },
    ]);
  });

  it('неоднозначные имена остаются с уточнением', () => {
    const result = settlementSuggestions(
      ['Іванівка · Ніжинський', 'Іванівка · Прилуцький', 'Іванівка'],
      '',
    );
    expect(result).toEqual([
      { label: 'Ніжинський', value: 'Ніжинський' },
      { label: 'Прилуцький', value: 'Прилуцький' },
      { label: 'Іванівка', value: 'Іванівка' },
    ]);
  });

  it('введённый текст не дублируется в подсказках', () => {
    expect(settlementSuggestions(['Ніжин'], 'ніжин')).toEqual([]);
  });
});
