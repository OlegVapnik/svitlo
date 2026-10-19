import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { configureCoreApi, configureStorage } from '@svitlo/core';
import { ApiError, api } from './client.js';
import { writeCache } from './offline-cache.js';

const ENDPOINT = '/addresses/settlements?region=kyiv-city&q=%D0%BA%D0%B8&limit=8';

function mockStorage(): void {
  const store = new Map<string, string>();
  configureStorage({
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
    keys: () => [...store.keys()],
  });
}

describe('client: серверный сбой и офлайн-кеш', () => {
  beforeEach(() => {
    mockStorage();
    configureCoreApi({ apiBaseUrl: 'https://example.test/api/v1' });
    writeCache(ENDPOINT, { data: [{ name: 'Київ', queues: ['1/1'] }] });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('5xx на чтение отдаёт последний успешный ответ, а не пустой экран', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'D1_ERROR' } }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await api.fetchAddressSettlements({ region: 'kyiv-city', q: 'ки' });

    expect(result.data).toEqual([{ name: 'Київ', queues: ['1/1'] }]);
  });

  test('4xx остаётся ошибкой: старые данные не маскируют ответ сервера', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify({ error: { code: 'BAD_REQUEST', message: 'bad query' } }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(api.fetchAddressSettlements({ region: 'kyiv-city', q: 'ки' })).rejects.toBeInstanceOf(ApiError);
  });
});
