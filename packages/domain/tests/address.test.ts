import { describe, expect, it } from 'vitest';

import {
  matchHouseNumber,
  normalizeAddress,
  normalizeHouseNumber,
  parseHouseNumber,
} from '../src/address.ts';

describe('parseHouseNumber', () => {
  it('бере числову частину', () => {
    expect(parseHouseNumber('14А')).toBe(14);
    expect(parseHouseNumber('12/3')).toBe(12);
    expect(parseHouseNumber(' 7 ')).toBe(7);
  });

  it('на не-числі повертає null', () => {
    expect(parseHouseNumber('')).toBeNull();
    expect(parseHouseNumber('буд. А')).toBeNull();
  });

  it('обрізає номер до пʼяти цифр (поведінка PG-версії)', () => {
    // Не «виправляємо» тут: номер будинку довший за пʼять цифр у вигрузках не трапляється,
    // а міняти поведінку означало б розійтися з `energy_normalize_address`.
    expect(parseHouseNumber('123456')).toBe(12345);
  });
});

describe('normalizeHouseNumber', () => {
  it('зводить варіанти написання до одного ключа', () => {
    for (const variant of ['100/А', '100а', '100 А', '100-А', '100A']) {
      expect(normalizeHouseNumber(variant)).toBe('100a');
    }
  });

  it('кириличні омоглифи стають латиницею', () => {
    expect(normalizeHouseNumber('14В')).toBe('14b');
    expect(normalizeHouseNumber('3С')).toBe('3c');
  });
});

describe('matchHouseNumber', () => {
  it('порожній шаблон і «*» означають усю вулицю', () => {
    expect(matchHouseNumber('14', '')).toBe(true);
    expect(matchHouseNumber('14', '*')).toBe(true);
  });

  it('точний збіг не залежить від регістру й роздільника', () => {
    expect(matchHouseNumber('100а', '100/А')).toBe(true);
    expect(matchHouseNumber('100A', '100-а')).toBe(true);
    expect(matchHouseNumber('100б', '100/А')).toBe(false);
  });

  it('розуміє перелік і діапазон, зокрема перевпорядкований', () => {
    expect(matchHouseNumber('6А', '2, 4, 6А')).toBe(true);
    expect(matchHouseNumber('5', '2, 4, 6А')).toBe(false);
    expect(matchHouseNumber('12', '1-19')).toBe(true);
    expect(matchHouseNumber('12', '19-1')).toBe(true);
    expect(matchHouseNumber('20', '1-19')).toBe(false);
  });
});

describe('normalizeAddress', () => {
  it('знімає префікс вулиці й пунктуацію', () => {
    // «и» замінюється на «і» — так робить `energy_normalize_address` у PostgreSQL.
    expect(normalizeAddress('вул. Васильківська, 12')).toBe('васільківська 12');
    expect(normalizeAddress('проспект Перемоги')).toBe('перемогі');
  });

  it('замінює ы/э/ё/ї/и одночасно, як PostgreSQL', () => {
    // Заміна одночасна: «ы» → «и» не потрапляє під правило «и» → «і».
    expect(normalizeAddress('улица Ы')).toBe('уліца и');
    expect(normalizeAddress('місто')).toBe('місто');
  });

  it('схлопує пробіли й не чіпає регістр', () => {
    expect(normalizeAddress('  м.   Дніпро  ')).toBe('м дніпро');
  });
});
