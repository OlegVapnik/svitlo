import { describe, expect, it } from 'vitest';

import {
  buildAddressPack,
  searchAddressInPack,
  type AddressPack,
  type AddressPackInput,
} from '../src/address-pack.ts';

const input: AddressPackInput = {
  region: 'chernihivska-oblast',
  settlements: [
    {
      name: 'Чернігів',
      defaultQueue: '1/1',
      streets: [
        { name: 'вул. Шевченка', queues: ['1/1', '1/2'] },
        { name: 'Вулиця Шевченка', queues: ['1/1', '1/2'] },
        { name: 'просп. Перемоги', queues: ['2/1'] },
      ],
    },
    {
      name: 'Чернігівка',
      defaultQueue: '3/2',
      streets: [{ name: 'вул. Шевченка', queues: ['3/2'] }],
    },
    { name: 'Десна', defaultQueue: '4/1', streets: [] },
  ],
};

describe('buildAddressPack', () => {
  it('словник без дублікатів, індекси у межах', () => {
    const pack = buildAddressPack(input);
    expect(pack.version).toBe(2);
    expect(pack.region).toBe('chernihivska-oblast');
    expect(new Set(pack.dict).size).toBe(pack.dict.length);
    expect(pack.dict).toContain('Чернігів');
    expect(pack.dict).toContain('вул. Шевченка');
    // «Вулиця Шевченка» — інший ключ, дублікатом не злипався, але „вул. Шевченка“ двох НП — один.
    expect(pack.dict.filter((value) => value === 'вул. Шевченка')).toHaveLength(1);

    for (const settlement of pack.settlements) {
      expect(pack.dict[settlement.name]).toBeTruthy();
      expect(pack.queues[settlement.defaultQueue]).toBeTruthy();
    }
    for (const street of pack.streets) {
      expect(street.settlement).toBeGreaterThanOrEqual(0);
      expect(street.settlement).toBeLessThan(pack.settlements.length);
      expect(pack.dict[street.name]).toBeTruthy();
      for (const queue of street.queues) {
        expect(queue).toBeGreaterThanOrEqual(0);
        expect(queue).toBeLessThan(pack.queues.length);
      }
    }
  });

  it('roundtrip: черги не губляться, порядок пріоритету збережено', () => {
    const pack = buildAddressPack(input);
    expect(pack.queues).toEqual(['1/1', '1/2', '2/1', '3/2', '4/1']);
    const [shevchenko] = searchAddressInPack(pack, 'Шевченка', 1);
    expect(shevchenko!.queues).toEqual(['1/1', '1/2']);
  });
});

describe('searchAddressInPack', () => {
  const pack: AddressPack = buildAddressPack(input);

  it('порожній запит → нічого', () => {
    expect(searchAddressInPack(pack, '')).toEqual([]);
    expect(searchAddressInPack(pack, '   ')).toEqual([]);
  });

  it('точний НП → сам НП із чергою за замовчуванням або його вулиці', () => {
    const hits = searchAddressInPack(pack, 'Десна');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.settlement).toBe('Десна');
    expect(hits[0]!.street).toBeNull();
    expect(hits[0]!.queues).toEqual(['4/1']);
  });

  it('вулиця в обраному (точному) НП рангує вище за вулиці інших НП', () => {
    const hits = searchAddressInPack(pack, 'Перемоги');
    expect(hits[0]!.settlement).toBe('Чернігів');
    expect(hits[0]!.street).toBe('просп. Перемоги');
    expect(hits[0]!.queues).toEqual(['2/1']);
    // Точний НП + точна вулиця: один кандидат, ліміт 1 — саме він.
    const top = searchAddressInPack(pack, 'Шевченка', 1);
    expect(top).toHaveLength(1);
    expect(top[0]!.settlement).toBe('Чернігів');
    expect(top[0]!.queues).toEqual(['1/1', '1/2']);
  });

  it('префікс «черн» знаходить усі НП-кандидати і не далі ліміту', () => {
    const hits = searchAddressInPack(pack, 'черн');
    expect(hits.length).toBeLessThanOrEqual(8);
    const settlements = new Set(hits.map((hit) => hit.settlement));
    expect(settlements.has('Чернігів')).toBe(true);
    expect(settlements.has('Чернігівка')).toBe(true);
  });

  it('вулиця без НП «з тим самим префіксом» шукається по всіх НП', () => {
    const hits = searchAddressInPack(pack, 'Шевченка', 8);
    // Дві НП з «Шевченка»: обидва кандидати мають прийти.
    const pairs = hits.map((hit) => `${hit.settlement}|${hit.street}`);
    expect(pairs).toContain('Чернігів|вул. Шевченка');
    expect(pairs).toContain('Чернігівка|вул. Шевченка');
  });

  it('ліміт обрізає видачу', () => {
    expect(searchAddressInPack(pack, 'Шевченка', 1)).toHaveLength(1);
    expect(searchAddressInPack(pack, 'Шевченка', 0)).toEqual([]);
  });
});
