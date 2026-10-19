import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { configureStorage } from '@svitlo/core';
import type { SyncBundle } from '@svitlo/shared';
import { queryClient } from './query-client.js';
import {
  getSyncState,
  hydrateOfflineStartup,
  hydrateStoredRegion,
  isRegionHydrated,
  mergeRegionCatalog,
  offlineSettlementStats,
  readOfflineBundle,
  searchOfflineSettlements,
  syncNow,
} from './offline-sync.js';
import { readRegionScheduleSnapshot } from './offline-region-schedules.js';

const REGION = 'chernihivska-oblast';
const OTHER_REGION = 'kyivska-oblast';
const BUNDLE_KEY = `svitlo:offline-bundle:v1:${REGION}`;
const CATALOG_KEY = 'svitlo:offline-catalog:v1';
const SYNCED_AT = '2026-10-16T09:00:00.000Z';

/**
 * Хранилище-заглушка: в node-окружении localStorage нет, а логика гидратации без него не работает.
 *
 * Логика лежит в `@svitlo/core` и читает платформенный бэкенд через `configureStorage`, поэтому
 * подменяем не только `localStorage` (на него опирается сам тест), но и это подключение — иначе
 * ядро ходило бы в своё пустое in-memory хранилище и не увидело бы засеянные данные.
 */
function mockStorage(): void {
  const store = new Map<string, string>();
  configureStorage({
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
    keys: () => [...store.keys()],
  });
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });
}

/**
 * Пакет ровно в той форме, что отдаёт /sync: график лежит в `schedulesByRegion`, а не отдельным
 * полем. Форма важна — на ней держится гидратация, и опечатка в имени поля давала бы пустой
 * экран в офлайне при «зелёном» сервере.
 */
function makeBundle(overrides: Record<string, unknown> = {}): SyncBundle {
  return {
    region: REGION,
    syncedAt: SYNCED_AT,
    etag: 'W/"test-1"',
    regions: [
      {
        cpu: REGION,
        nameUa: 'Чернігівська область',
        nameEn: null,
        queues: ['1/1'],
        slots: 8,
        lastDate: '2026-10-16',
      },
    ],
    status: { lastUpdatedAt: SYNCED_AT },
    queues: [{ queue: '1/1', slots: 8, lastDate: '2026-10-16' }],
    settlements: [
      { name: 'Чернігів', kind: 'місто', queues: ['1/1'] },
      { name: 'с. Новоселівка', kind: 'село', queues: [] },
    ],
    settlementsTotal: 1311,
    schedulesByRegion: {
      [REGION]: { days: ['2026-10-16'], buckets: [{ queue: '1/1', date: '2026-10-16', intervals: [] }] },
    },
    news: [{ id: 'n1', title: 'Тестова новина' }],
    contacts: [],
    ...overrides,
  } as unknown as SyncBundle;
}

function seedBundle(payload: SyncBundle = makeBundle(), region = REGION): void {
  localStorage.setItem(
    `svitlo:offline-bundle:v1:${region}`,
    JSON.stringify({ savedAt: SYNCED_AT, syncedAt: payload.syncedAt, etag: payload.etag, bundle: payload }),
  );
}

describe('офлайн-пакет: гидратация кеша до первого рендера', () => {
  beforeEach(() => {
    mockStorage();
    queryClient.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('без записи на диске гидратация ничего не выдумывает', () => {
    expect(hydrateOfflineStartup()).toBe(REGION);
    expect(queryClient.getQueryData(['queues', REGION])).toBeUndefined();
    expect(getSyncState().phase).toBe('idle');
  });

  test('данные пакета раскладываются по тем же ключам, что читают экраны', () => {
    seedBundle();
    hydrateOfflineStartup();

    expect(queryClient.getQueryData<{ data: unknown[] }>(['queues', REGION])?.data).toHaveLength(1);
    expect(queryClient.getQueryData<{ data: unknown[] }>(['regions'])?.data).toHaveLength(1);
    expect(queryClient.getQueryData(['status', REGION])).toBeTruthy();
    // Главная просит график области ровно на два дня — ключ должен совпасть, иначе кеш не тот.
    expect(queryClient.getQueryData<{ data: unknown[] }>(['upcomingGroupOutages', REGION, 2])?.data).toHaveLength(1);
    // Пакет содержит 20 новостей, но кладём их и под ключ страницы новостей (`limit: 50`).
    expect(queryClient.getQueryData<{ data: unknown[] }>(['news', { region: REGION, limit: 50 }])?.data).toHaveLength(1);
    expect(readRegionScheduleSnapshot(REGION)?.at).toBe(SYNCED_AT);
  });

  test('возраст данных берётся из пакета, а не из момента открытия приложения', () => {
    seedBundle();
    hydrateOfflineStartup();

    const updatedAt = queryClient.getQueryState(['queues', REGION])?.dataUpdatedAt ?? 0;
    expect(new Date(updatedAt).toISOString()).toBe(SYNCED_AT);
  });

  test('состояние показывает «з пристрою» и время сборки пакета', () => {
    seedBundle();
    hydrateOfflineStartup();

    const state = getSyncState();
    expect(state.phase).toBe('stored');
    expect(state.region).toBe(REGION);
    expect(state.syncedAt).toBe(SYNCED_AT);
    expect(state.settlements).toBe(2);
    expect(isRegionHydrated(REGION)).toBe(true);
    expect(hydrateStoredRegion(REGION)?.syncedAt).toBe(SYNCED_AT);
  });
});

describe('каталог регионов: /regions авторитетнее пакета /sync', () => {
  const region = (over: Record<string, unknown>) =>
    ({ cpu: '', nameUa: '', nameEn: null, queues: [], slots: 0, lastDate: null, ...over }) as never;

  beforeEach(() => {
    mockStorage();
    queryClient.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('сводки известных областей не перетираются ответом /sync', () => {
    const existing = [
      region({ cpu: 'sumska-oblast', nameUa: 'Сумська область', covered: true, slots: 124 }),
      region({ cpu: 'rivnenska-oblast', nameUa: 'Рівненська область', covered: false, slots: 0 }),
    ];
    const incoming = [
      region({ cpu: 'rivnenska-oblast', nameUa: 'Рівненська область', covered: true, slots: 24 }),
      region({ cpu: 'sumska-oblast', nameUa: 'Сумська область', covered: false, slots: 0 }),
    ];

    const merged = mergeRegionCatalog(existing, incoming);

    // Порядок и значения — из /regions: вторая копия каталога не должна менять метки покрытия.
    expect(merged.map((item) => item.cpu)).toEqual(['sumska-oblast', 'rivnenska-oblast']);
    expect(merged[0]).toMatchObject({ covered: true, slots: 124 });
    expect(merged[1]).toMatchObject({ covered: false, slots: 0 });
  });

  test('области, которых в /regions нет, добавляются из пакета (холодный старт/офлайн)', () => {
    const merged = mergeRegionCatalog(
      [region({ cpu: REGION, nameUa: 'Чернігівська область', covered: true })],
      [
        null,
        region({ cpu: OTHER_REGION, nameUa: 'Київська область', covered: true, slots: 5 }),
        region({ cpu: REGION, nameUa: 'Чернігівська область', covered: false }),
      ] as never,
    );

    expect(merged.map((item) => item.cpu)).toEqual([REGION, OTHER_REGION]);
    expect(merged[0]).toMatchObject({ covered: true });
    expect(merged[1]).toMatchObject({ slots: 5 });
  });

  test('гидратация пакета не затирает уже загруженный /regions', () => {
    seedBundle();
    queryClient.setQueryData(['regions'], {
      data: [{ cpu: REGION, nameUa: 'Чернігівська область', nameEn: null, queues: [], slots: 99, covered: true, lastDate: null }],
    });

    hydrateStoredRegion(REGION);

    const cached = queryClient.getQueryData<{ data: Array<Record<string, unknown>> }>(['regions'])?.data ?? [];
    expect(cached).toHaveLength(1);
    expect(cached[0]).toMatchObject({ cpu: REGION, slots: 99, covered: true });
  });
});

describe('syncNow: что происходит с данными при 200, 304 и ошибке', () => {
  const jsonResponse = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  beforeEach(() => {
    mockStorage();
    queryClient.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('304 — это успех: пакет с диска остаётся, время сборки не подменяется моментом проверки', async () => {
    seedBundle();
    hydrateOfflineStartup();
    // 304 приходит без тела — именно так, как в жизни: сервер подтверждает актуальность пакета,
    // и решение «обновлять или нет» принимает клиент, а не транспорт.
    vi.stubGlobal('fetch', async () => new Response(null, { status: 304, statusText: 'Not Modified' }));

    await syncNow(REGION);

    const state = getSyncState();
    expect(state.phase).toBe('fresh');
    expect(state.syncedAt).toBe(SYNCED_AT);
    expect(state.error).toBeNull();
    expect(state.checkedAt).toBeTruthy();
    expect(readOfflineBundle(REGION)?.syncedAt).toBe(SYNCED_AT);
  });

  test('200 с новым пакетом переписывает диск, кеш и каталог областей', async () => {
    seedBundle();
    hydrateOfflineStartup();
    const fresh = makeBundle({ syncedAt: '2026-10-16T12:00:00.000Z', etag: 'W/"test-2"' });
    vi.stubGlobal('fetch', async () => jsonResponse({ data: fresh }));

    await syncNow(REGION);

    const state = getSyncState();
    expect(state.phase).toBe('fresh');
    expect(state.syncedAt).toBe('2026-10-16T12:00:00.000Z');
    expect(readOfflineBundle(REGION)?.etag).toBe('W/"test-2"');

    const updatedAt = queryClient.getQueryState(['queues', REGION])?.dataUpdatedAt ?? 0;
    expect(new Date(updatedAt).toISOString()).toBe('2026-10-16T12:00:00.000Z');
    // Каталог областей нужен офлайну до первой синхронизации — он пишется вместе с пакетом.
    expect(JSON.parse(localStorage.getItem(CATALOG_KEY) ?? 'null')?.regions).toHaveLength(1);
  });

  test('ответ без пакета не стирает прошлые данные: старый график лучше пустого экрана', async () => {
    seedBundle();
    hydrateOfflineStartup();
    vi.stubGlobal('fetch', async () => jsonResponse({ data: null }));

    await syncNow(REGION);

    const state = getSyncState();
    expect(state.phase).toBe('offline');
    expect(state.error).toBe('empty-bundle');
    expect(state.syncedAt).toBe(SYNCED_AT);
    expect(queryClient.getQueryData(['queues', REGION])).toBeTruthy();
  });

  test('ошибка сети оставляет пакет и показывает причину', async () => {
    seedBundle();
    hydrateOfflineStartup();
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });

    await syncNow(REGION);

    const state = getSyncState();
    expect(state.phase).toBe('offline');
    expect(state.error).toMatch(/Failed to fetch/);
    expect(state.syncedAt).toBe(SYNCED_AT);
  });

  test('без связи запрос вообще не уходит — это экономия трафика, а не замена обработке ошибок', async () => {
    seedBundle();
    hydrateOfflineStartup();
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    vi.stubGlobal('navigator', { onLine: false });

    await syncNow(REGION);

    expect(spy).not.toHaveBeenCalled();
    expect(getSyncState().phase).toBe('offline');
  });

  test('для области без пакета состояние честное: данных нет, и чужой пакет не подставляется', async () => {
    seedBundle();
    hydrateOfflineStartup();
    vi.stubGlobal('fetch', async () => jsonResponse({ data: null }));

    await syncNow(OTHER_REGION);

    expect(getSyncState().region).toBe(OTHER_REGION);
    expect(getSyncState().phase).toBe('idle');
    expect(queryClient.getQueryData(['queues', OTHER_REGION])).toBeUndefined();
  });
});

describe('локальные данные пакета: поиск НП и каталог областей без сети', () => {
  beforeEach(() => {
    mockStorage();
    queryClient.clear();
    seedBundle();
    hydrateOfflineStartup();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('подсказки работают по данным с диска — сеть для них не нужна', () => {
    expect(searchOfflineSettlements(REGION, 'черн').map((item) => item.name)).toEqual(['Чернігів']);
    expect(searchOfflineSettlements(REGION, 'с. нов').map((item) => item.name)).toEqual(['с. Новоселівка']);
  });

  test('одна буква не даёт подсказок, а чужое название не выдумывается', () => {
    expect(searchOfflineSettlements(REGION, 'ч')).toEqual([]);
    expect(searchOfflineSettlements(REGION, 'Львів')).toEqual([]);
  });

  test('для области без пакета подсказок нет', () => {
    expect(searchOfflineSettlements(OTHER_REGION, 'черн')).toEqual([]);
    expect(offlineSettlementStats(OTHER_REGION)).toBeNull();
  });

  test('счётчики честные: сколько НП на устройстве и сколько знает сервер', () => {
    const stats = offlineSettlementStats(REGION);
    expect(stats?.shown).toBe(2);
    expect(stats?.total).toBe(1311);
    expect(stats?.syncedAt).toBe(SYNCED_AT);
  });

  test('битая запись пакета не считается данными', () => {
    localStorage.setItem(BUNDLE_KEY, 'не json');
    expect(readOfflineBundle(REGION)).toBeNull();
    expect(offlineSettlementStats(REGION)).toBeNull();
    expect(searchOfflineSettlements(REGION, 'черн')).toEqual([]);
  });

  test('каталог областей переживает запуск, когда пакета ещё нет', () => {
    localStorage.removeItem(BUNDLE_KEY);
    localStorage.setItem(
      CATALOG_KEY,
      JSON.stringify({
        savedAt: SYNCED_AT,
        regions: [{ cpu: REGION, nameUa: 'Чернігівська область', nameEn: null, queues: [], slots: 0, lastDate: null }],
      }),
    );
    queryClient.clear();

    expect(hydrateOfflineStartup()).toBe(REGION);
    expect(queryClient.getQueryData<{ data: unknown[] }>(['regions'])?.data).toHaveLength(1);
    expect(getSyncState().phase).toBe('idle');
  });
});

