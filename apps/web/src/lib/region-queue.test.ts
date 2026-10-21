import { describe, expect, it } from 'vitest';
import {
  getRegionQueuesMap,
  getStoredQueueForRegion,
  LEGACY_MY_QUEUES_KEY,
  REGION_QUEUES_STORAGE_KEY,
  setStoredQueueForRegion,
} from './region-queue.js';

class MockStorage implements Pick<Storage, 'getItem' | 'setItem'> {
  private data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

describe('per-region queue persistence and retrieval', () => {
  it('returns empty map if storage has no data or invalid JSON', () => {
    const storage = new MockStorage();
    expect(getRegionQueuesMap(storage)).toEqual({});

    storage.setItem(REGION_QUEUES_STORAGE_KEY, '{invalid json');
    expect(getRegionQueuesMap(storage)).toEqual({});
  });

  it('selects the first available queue if nothing is remembered (never hardcoding 2/2)', () => {
    const storage = new MockStorage();
    const kyivQueues = ['1/1', '2/1', '3/1'];
    // For Kyiv, should pick '1/1', not '2/2'
    const queue = getStoredQueueForRegion('kyiv', kyivQueues, storage);
    expect(queue).toBe('1/1');
  });

  it('returns null if availableQueues is empty', () => {
    const storage = new MockStorage();
    const queue = getStoredQueueForRegion('ivano-frankivska-oblast', [], storage);
    expect(queue).toBeNull();
  });

  it('persists queue per region and recalls it independently across regions', () => {
    const storage = new MockStorage();
    const chernihivQueues = ['1/1', '1/2', '2/1', '2/2', '3/1'];
    const kyivQueues = ['1/1', '2/1', '3/1', '4/1', '5/1'];

    // Select 3/1 for Chernihiv
    setStoredQueueForRegion('chernihivska-oblast', '3/1', storage);
    // Select 5/1 for Kyiv
    setStoredQueueForRegion('kyiv', '5/1', storage);

    // Verify Chernihiv remembers 3/1
    expect(getStoredQueueForRegion('chernihivska-oblast', chernihivQueues, storage)).toBe('3/1');

    // Verify Kyiv remembers 5/1
    expect(getStoredQueueForRegion('kyiv', kyivQueues, storage)).toBe('5/1');
  });

  it('updates legacy myQueues key for backwards compatibility', () => {
    const storage = new MockStorage();
    setStoredQueueForRegion('chernihivska-oblast', '2/2', storage);

    const legacy = storage.getItem(LEGACY_MY_QUEUES_KEY);
    expect(legacy).toBe(JSON.stringify(['2/2']));
  });

  it('falls back to legacy myQueues if valid for that region', () => {
    const storage = new MockStorage();
    storage.setItem(LEGACY_MY_QUEUES_KEY, JSON.stringify(['2/2']));

    const queues = ['1/1', '2/2', '3/1'];
    expect(getStoredQueueForRegion('chernihivska-oblast', queues, storage)).toBe('2/2');
  });

  /**
   * Київ: живой источник отдаёт плоские «1…6», зеркало — «1/1…60/1». Сохранённый плоский код должен
   * находить свою группу среди канонических, иначе сітка и герой-статус расходились («даних немає»).
   */
  it('matches a stored flat Kyiv code against canonical «N/1» available queues', () => {
    const storage = new MockStorage();
    setStoredQueueForRegion('kyiv', '3', storage);

    expect(getStoredQueueForRegion('kyiv-city', ['2/1', '3/1', '4/1'], storage)).toBe('3/1');
    // Без доступных групп возвращается канонический код — сервер віддасть дані під будь-якою формою.
    expect(getStoredQueueForRegion('kyiv-city', [], storage)).toBe('3/1');
  });

  it('keeps «N» и «N/1» distinct for regions where they are different queues', () => {
    const storage = new MockStorage();
    setStoredQueueForRegion('chernihivska-oblast', '3', storage);

    expect(getStoredQueueForRegion('chernihivska-oblast', ['3', '3/1'], storage)).toBe('3');
  });
});
