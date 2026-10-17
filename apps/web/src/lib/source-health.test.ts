import { describe, expect, test } from 'vitest';
import { sourceSeverity } from './source-health.js';
import type { StatusResponse } from '@svitlo/shared';

const base: StatusResponse = {
  grid: { level: 'stable', message: '' },
  activeOutages: 0,
  scheduledOutages: 0,
  activeIncidents: 0,
  lastUpdatedAt: '2026-10-10T12:00:00.000Z',
  dataStale: false,
};

/** «Сейчас» для проверок: ровно через 30 минут после отметки обновления. */
const NOW = new Date('2026-10-10T12:30:00.000Z');

describe('sourceSeverity: как интерфейс показывает состояние источника', () => {
  test('свежие данные без ошибок — ok', () => {
    expect(sourceSeverity(base, NOW)).toBe('ok');
  });

  test('флаг сервера не пугает раньше 75 минут: 29 минут — ещё ok', () => {
    const updatedAt = new Date(NOW.getTime() - 29 * 60_000).toISOString();
    expect(sourceSeverity({ ...base, lastUpdatedAt: updatedAt, dataStale: true }, NOW)).toBe('ok');
  });

  test('данные старше 75 минут — stale (последние известные не выдаём за живые)', () => {
    const updatedAt = new Date(NOW.getTime() - 76 * 60_000).toISOString();
    expect(sourceSeverity({ ...base, lastUpdatedAt: updatedAt }, NOW)).toBe('stale');
  });

  test('нет отметки обновления — тоже stale, а не ok', () => {
    expect(sourceSeverity({ ...base, lastUpdatedAt: null }, NOW)).toBe('stale');
  });

  test('lastError источника важнее возраста отметки: показываем причину', () => {
    expect(sourceSeverity({ ...base, dataStale: true, lastError: '[http_429] Operator ...' }, NOW)).toBe('problem');
  });

  test('пока запрос не ответил — ok (не пугаем пользователя до первого ответа)', () => {
    expect(sourceSeverity(undefined, NOW)).toBe('ok');
  });
});
