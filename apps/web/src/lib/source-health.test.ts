import { describe, expect, test } from 'vitest';
import { sourceSeverity } from './source-health.js';
import type { StatusResponse } from '@energy-monitor/shared';

const base: StatusResponse = {
  grid: { level: 'stable', message: '' },
  activeOutages: 0,
  scheduledOutages: 0,
  activeIncidents: 0,
  lastUpdatedAt: '2026-10-10T12:00:00.000Z',
  dataStale: false,
};

describe('sourceSeverity: как интерфейс показывает состояние источника', () => {
  test('свежие данные без ошибок — ok', () => {
    expect(sourceSeverity(base)).toBe('ok');
  });

  test('dataStale — stale (последние известные данные, но не выдаём их за живые)', () => {
    expect(sourceSeverity({ ...base, dataStale: true })).toBe('stale');
  });

  test('нет отметки обновления — тоже stale, а не ok', () => {
    expect(sourceSeverity({ ...base, lastUpdatedAt: null })).toBe('stale');
  });

  test('lastError источника важнее флага stale: показываем причину', () => {
    expect(sourceSeverity({ ...base, dataStale: true, lastError: '[http_429] Operator ...' })).toBe('problem');
  });

  test('пока запрос не ответил — ok (не пугаем пользователя до первого ответа)', () => {
    expect(sourceSeverity(undefined)).toBe('ok');
  });
});
