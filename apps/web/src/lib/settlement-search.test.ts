import { describe, expect, test } from 'vitest';
import { foldSettlementName, rankSettlements, type SettlementCandidate } from './settlement-search.js';

const settlement = (name: string, kind: string | null = null, queues: string[] = []): SettlementCandidate => ({
  name,
  kind,
  queues,
});

describe('foldSettlementName', () => {
  test('приводит регистр и обрезает пробелы', () => {
    expect(foldSettlementName('  Деснянське ')).toBe('деснянське');
    expect(foldSettlementName('НОВОСІЛКА')).toBe('новосілка');
  });

  test('снимает тип НП в начале: «с. Х» и «Х» ищутся одинаково', () => {
    expect(foldSettlementName('с. Деснянське')).toBe('деснянське');
    expect(foldSettlementName('смт. Сосниця')).toBe('сосниця');
    expect(foldSettlementName('смт Сосниця')).toBe('сосниця');
    expect(foldSettlementName('місто Чернігів')).toBe('чернігів');
    expect(foldSettlementName('село Ольбин')).toBe('ольбин');
  });

  test('тип в середине названия не трогает — это не шум, а часть имени', () => {
    expect(foldSettlementName('Красне Село')).toBe('красне село');
  });

  test('устойчив к пустому значению', () => {
    expect(foldSettlementName('')).toBe('');
    expect(foldSettlementName(undefined as unknown as string)).toBe('');
  });
});

describe('rankSettlements', () => {
  const list = [
    settlement('Чернігівська область'),
    settlement('Чернігів', 'місто', ['1/1']),
    settlement('Черняхівка', 'село'),
    settlement('Новгород-Сіверський'),
    settlement('с. Червона Гірка'),
  ];

  test('не ищет по одному символу: подсказка на запрос из буквы — это шум', () => {
    expect(rankSettlements(list, '')).toEqual([]);
    expect(rankSettlements(list, 'ч')).toEqual([]);
    expect(rankSettlements(list, 'Ч')).toEqual([]);
  });

  test('совпадение с начала весит больше, чем совпадение в середине названия', () => {
    const found = rankSettlements(list, 'сівер');
    expect(found.map((item) => item.name)).toEqual(['Новгород-Сіверський']);
  });

  test('короткое название обгоняет длинное при общем начале', () => {
    const found = rankSettlements(list, 'чер');
    // «Чернігів» короче остальных, поэтому идёт первым, хотя совпадение с начала есть у всех
    // четырёх. «Чернігівська область» — самая длинная и потому последняя: это область целиком,
    // а не НП, и первой подсказкой она быть не должна.
    expect(found.map((item) => item.name)).toEqual([
      'Чернігів',
      'Черняхівка',
      'с. Червона Гірка',
      'Чернігівська область',
    ]);
  });

  test('запрос с типом НП находит запись без типа в базе', () => {
    expect(rankSettlements(list, 'с. черв').map((item) => item.name)).toEqual(['с. Червона Гірка']);
  });

  test('регистр запроса не важен', () => {
    expect(rankSettlements(list, 'ЧЕРН')).toEqual(rankSettlements(list, 'черн'));
  });

  test('ограничивает число подсказок', () => {
    expect(rankSettlements(list, 'чер', 2).map((item) => item.name)).toEqual(['Чернігів', 'Черняхівка']);
    expect(rankSettlements(list, 'чер', 0)).toEqual([]);
  });

  test('несуществующее название не подставляется и не «угадывается»', () => {
    expect(rankSettlements(list, 'Житомир')).toEqual([]);
  });

  test('терпит пустые и битые записи в списке', () => {
    const dirty = [settlement(''), null as unknown as SettlementCandidate, settlement('Остер')];
    expect(rankSettlements(dirty, 'ост').map((item) => item.name)).toEqual(['Остер']);
  });

  test('возвращает исходные объекты, а не копии: вызывающий код ждёт те же записи', () => {
    const found = rankSettlements(list, 'новгород');
    expect(found[0]).toBe(list[3]);
  });
});
