import { describe, expect, test } from 'vitest';
import { syncLabelKey } from './sync-label.js';

/**
 * Подпись в шапке не должна врать о причине.
 *
 * Реальный случай: квота D1 исчерпана, `/sync` отвечает ошибкой, на телефоне лежит пакет
 * четырнадцатичасовой давности — и шапка писала «Без зв’язку, близько 14 годин тому». Интернет
 * при этом работал. Тесты фиксируют: «без зв’язку» — только когда виновата сеть.
 */
const base = { phase: 'offline' as const, syncedAt: '2026-10-20T00:30:00.000Z', errorKind: null };

describe('syncLabelKey', () => {
  test('серверная ошибка с пакетом на диске называет сервер, а не связь', () => {
    expect(syncLabelKey({ ...base, errorKind: 'server' })).toBe('offline.syncServerError');
  });

  test('серверная ошибка без пакета — «сервер не оновив дані»', () => {
    expect(syncLabelKey({ phase: 'offline', syncedAt: null, errorKind: 'server' })).toBe(
      'offline.syncServerErrorNoData',
    );
  });

  test('сеть недоступна — прежняя подпись «без зв’язку»', () => {
    expect(syncLabelKey({ ...base, errorKind: 'network' })).toBe('offline.syncOffline');
    expect(syncLabelKey({ phase: 'offline', syncedAt: null, errorKind: 'network' })).toBe(
      'offline.syncOfflineNoData',
    );
  });

  test('успешная синхронизация и данные с диска', () => {
    expect(syncLabelKey({ ...base, phase: 'fresh', errorKind: null })).toBe('offline.syncFresh');
    expect(syncLabelKey({ ...base, phase: 'stored', errorKind: null })).toBe('offline.syncStored');
    expect(syncLabelKey({ ...base, phase: 'syncing' })).toBe('offline.syncSyncing');
    expect(syncLabelKey({ phase: 'idle', syncedAt: null, errorKind: null })).toBe('offline.syncIdle');
  });
});
