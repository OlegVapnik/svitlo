import { describe, expect, test } from 'vitest';
import { normalizeAddress } from '@svitlo/core/lib/address';

interface Case {
  source: 'Рівне' | 'Чернігів';
  raw: string;
  expected: string;
}

const cases: Case[] = [
  { source: 'Рівне', raw: 'Обарів', expected: 'обарів' },
  { source: 'Рівне', raw: 'Б.Криниця', expected: 'б крініця' },
  { source: 'Рівне', raw: 'Млинівська', expected: 'млінівська' },
  { source: 'Рівне', raw: 'Городище', expected: 'городіще' },
  { source: 'Рівне', raw: 'Б.Хмельницького', expected: 'б хмельніцького' },
  { source: 'Рівне', raw: 'Володимирець', expected: 'володімірець' },
  { source: 'Рівне', raw: 'Уїздці', expected: 'уіздці' },
  { source: 'Рівне', raw: 'Масив «Зоряний» 59 Д', expected: 'масів зоряній 59 д' },
  { source: 'Рівне', raw: 'Набережне', expected: 'набережне' },
  { source: 'Рівне', raw: 'Пересопниця', expected: 'пересопніця' },
  { source: 'Рівне', raw: 'С.Петлюри', expected: 'петлюрі' },
  { source: 'Рівне', raw: 'с. Деснянське', expected: 'деснянське' },
  { source: 'Чернігів', raw: 'ПРИЛУКИ', expected: 'прілукі' },
  { source: 'Чернігів', raw: 'Стара Басань', expected: 'стара басань' },
  { source: 'Чернігів', raw: 'Іллінська', expected: 'іллінська' },
  { source: 'Чернігів', raw: 'Народного руху', expected: 'народного руху' },
  { source: 'Чернігів', raw: 'І.Козловського', expected: 'і козловського' },
  { source: 'Чернігів', raw: 'Набережна', expected: 'набережна' },
  { source: 'Чернігів', raw: 'ПЛЬОХІВ', expected: 'пльохів' },
  { source: 'Чернігів', raw: 'ЖЕВЕДЬ', expected: 'жеведь' },
];

describe('normalizeAddress parity with PDF importers', () => {
  test.each(cases)('$source: $raw', ({ raw, expected }) => {
    expect(normalizeAddress(raw)).toBe(expected);
  });
});
