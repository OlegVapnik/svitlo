import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { configureAddressPacks } from '@svitlo/core';
import { configureStorage } from '@svitlo/core';
import {
  fetchPackHouses,
  fetchPackStreets,
  resolvePackAddress,
  searchPackSettlements,
} from '@svitlo/core/api/address-packs';

const BASE = 'https://cdn.test/data/address';
const REGION = 'chernihivska-oblast';

const settlements = {
  region: REGION,
  settlements: [
    { name: 'Чернігів', normalized: 'чернігів', queues: ['1/1', '1/2', '2/1', '2/2'], streetsCount: 3 },
    { name: 'Бахмач', normalized: 'бахмач', queues: ['2/1'], streetsCount: 1 },
    {
      name: 'Чернігівка',
      normalized: 'чернігівка',
      queues: ['2/1'],
      wholeSettlementQueue: '2/1',
      streetsCount: 1,
    },
  ],
};
const housesShard = {
  region: REGION,
  shard: 0,
  streets: {
    'чернігів|васільківська': [
      ['1-14', '1/1'],
      ['100/А', '1/1'],
    ],
    'чернігів|кандідатська': [
      ['1', '2/1'],
      ['2', null, ['1/2', '2/2']],
    ],
  },
};
const shard = {
  region: REGION,
  shard: 'ч',
  settlements: {
    'чернігів': {
      settlement: 'Чернігів',
      settlementNormalized: 'чернігів',
      streets: [
        ['вул. Васильківська', 'васільківська', null, ['1/1'], 0],
        ['вул. Кандидатська', 'кандідатська', null, ['1/2', '2/2'], 0],
        ['вул. Перемоги', 'перемогі', '2/2', ['2/2'], 0],
      ],
    },
    'чернігівка': {
      settlement: 'Чернігівка',
      settlementNormalized: 'чернігівка',
      streets: [['вул. Центральна', 'центральна', '2/1', ['2/1'], 0]],
    },
  },
};

function mockStorage(): void {
  const store = new Map<string, string>();
  configureStorage({
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
    keys: () => [...store.keys()],
  });
}

let fetchCalls: string[] = [];

function stubPacks(): void {
  fetchCalls = [];
  const manifest = {
    version: 2,
    generatedAt: '2026-10-19T00:00:00Z',
    regions: {
      [REGION]: {
        settlements: { url: `${REGION}/settlements.aaa.json`, hash: 'aaa', count: 2 },
        shards: { ч: { url: `${REGION}/streets-ч.bbb.json`, hash: 'bbb', count: 2 } },
        houses: { 0: { url: `${REGION}/houses-0.ccc.json`, hash: 'ccc', count: 2 } },
      },
    },
  };
  const bodies: Record<string, unknown> = {
    [`${BASE}/manifest.json`]: manifest,
    [`${BASE}/${REGION}/settlements.aaa.json`]: settlements,
    [`${BASE}/${REGION}/streets-ч.bbb.json`]: shard,
    [`${BASE}/${REGION}/houses-0.ccc.json`]: housesShard,
  };
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = String(input);
    fetchCalls.push(url);
    const body = bodies[url];
    return body
      ? new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
      : new Response('not found', { status: 404 });
  });
}

describe('address packs: локальный поиск без D1', () => {
  beforeEach(() => {
    mockStorage();
    configureAddressPacks({ baseUrl: BASE });
    stubPacks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('подсказки НП ищутся по подстроке', async () => {
    const found = await searchPackSettlements(REGION, 'черн');
    expect(found?.map((item) => item.name)).toEqual(['Чернігів', 'Чернігівка']);
  });

  test('улицы и дома приходят из пака, дом с буквой находит группу', async () => {
    const streets = await fetchPackStreets(REGION, 'Чернігів', 'василь');
    expect(streets?.data.map((item) => item.name)).toEqual(['вул. Васильківська']);

    expect(fetchCalls.some((url) => url.includes('/houses-'))).toBe(false);

    const houses = await fetchPackHouses(REGION, 'Чернігів', 'Васильківська');
    expect(houses?.data.map((item) => item.housePattern)).toEqual(['1-14', '100/А']);

    const resolved = await resolvePackAddress(REGION, {
      settlement: 'Чернігів',
      street: 'вул. Васильківська',
      house: '100/А',
    });
    expect(resolved).toMatchObject({ queue: '1/1', reason: 'exact-house', schedule: null });
  });

  test('дом с конфликтом отдаёт кандидатов, а не чужую чергу', async () => {
    const houses = await fetchPackHouses(REGION, 'Чернігів', 'Кандидатська');
    expect(houses?.wholeStreetQueue).toBeNull();
    expect(houses?.streetQueues).toEqual(['1/2', '2/2']);
    expect(houses?.data).toEqual([
      { housePattern: '1', queue: '2/1' },
      { housePattern: '2', queue: null, queues: ['1/2', '2/2'] },
    ]);

    const exact = await resolvePackAddress(REGION, {
      settlement: 'Чернігів',
      street: 'Кандидатська',
      house: '1',
    });
    expect(exact).toMatchObject({ queue: '2/1', reason: 'exact-house' });

    const ambiguous = await resolvePackAddress(REGION, {
      settlement: 'Чернігів',
      street: 'Кандидатська',
      house: '2',
    });
    expect(ambiguous).toMatchObject({
      queue: null,
      queueOptions: ['1/2', '2/2'],
      reason: 'not-found',
      source: 'operator',
    });

    const streetOnly = await resolvePackAddress(REGION, {
      settlement: 'Чернігів',
      street: 'Кандидатська',
    });
    expect(streetOnly).toMatchObject({ queue: null, queueOptions: ['1/2', '2/2'] });
  });

  test('единая черга вулиці повертається без кроку з будинком', async () => {
    const resolved = await resolvePackAddress(REGION, {
      settlement: 'Чернігів',
      street: 'Перемоги',
    });
    expect(resolved).toMatchObject({ queue: '2/2', reason: 'whole-street' });
  });

  test('явна єдина черга НП працює навіть без вулиці', async () => {
    const streets = await fetchPackStreets(REGION, 'Чернігівка', '');
    expect(streets?.wholeSettlementQueue).toBe('2/1');

    const resolved = await resolvePackAddress(REGION, { settlement: 'Чернігівка' });
    expect(resolved).toMatchObject({ queue: '2/1', reason: 'whole-settlement' });
  });

  test('диапазон домов тоже попадает в группу', async () => {
    const resolved = await resolvePackAddress(REGION, {
      settlement: 'Чернігів',
      street: 'Васильківська',
      house: '7',
    });
    expect(resolved?.queue).toBe('1/1');
  });

  test('пустой запрос отдаёт не больше 20 улиц и не тянет дома', async () => {
    const streets = await fetchPackStreets(REGION, 'Чернігів', '');
    expect(streets?.data.length).toBeLessThanOrEqual(20);
  });

  test('области без пака отдают null — остаётся серверный фолбэк', async () => {
    expect(await searchPackSettlements('lvivska-oblast', 'льві')).toBeNull();
    expect(
      await resolvePackAddress('lvivska-oblast', { settlement: 'Львів', street: 'Ринок', house: '1' }),
    ).toBeNull();
  });
});
