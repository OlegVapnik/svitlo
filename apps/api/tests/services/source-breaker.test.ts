import { describe, expect, test } from 'vitest';
import {
  BREAKER_PAUSE_MS,
  RETRY_AFTER_CAP_MS,
  isPaused,
  nextAttemptAt,
  pauseMsFor,
  sanitizeSourceError,
  summarizeSourceHealth,
} from '../../src/services/source-breaker.js';

/** Политика circuit breaker — чистые функции: ни БД, ни сети, ни оператора. */
const NOW = new Date('2026-10-10T12:00:00.000Z');
const MIN = 60_000;

describe('circuit breaker: длительность паузы', () => {
  test('обычная ошибка останавливает источник только с третьей подряд: 30 мин → 1 ч → 3 ч → 6 ч', () => {
    expect(pauseMsFor('other', 1)).toBe(0);
    expect(pauseMsFor('other', 2)).toBe(0);
    expect(pauseMsFor('other', 3)).toBe(30 * MIN);
    expect(pauseMsFor('other', 4)).toBe(60 * MIN);
    expect(pauseMsFor('other', 5)).toBe(180 * MIN);
    expect(pauseMsFor('other', 6)).toBe(360 * MIN);
    expect(pauseMsFor('other', 99)).toBe(360 * MIN);
    expect(BREAKER_PAUSE_MS).toEqual([30 * MIN, 60 * MIN, 180 * MIN, 360 * MIN]);
  });

  test('явный блок (403/429/таймаут/обрыв) ставит на паузу сразу, не дожидаясь трёх неудач', () => {
    for (const kind of ['http_403', 'http_429', 'timeout', 'connection_aborted'] as const) {
      expect(pauseMsFor(kind, 1)).toBe(30 * MIN);
    }
  });

  test('Retry-After соблюдается, если он длиннее нашей паузы, и ограничен сутками', () => {
    expect(pauseMsFor('http_429', 1, 45 * MIN)).toBe(45 * MIN);
    expect(pauseMsFor('http_429', 1, 5 * MIN)).toBe(30 * MIN);
    expect(pauseMsFor('http_429', 1, 10 * 24 * 60 * MIN)).toBe(RETRY_AFTER_CAP_MS);
  });
});

describe('circuit breaker: состояние и /status', () => {
  test('isPaused сравнивает с «сейчас», nextAttemptAt учитывает паузу и выключенный планировщик', () => {
    const pausedUntil = new Date(NOW.getTime() + 10 * MIN);
    expect(isPaused(pausedUntil, NOW)).toBe(true);
    expect(isPaused(new Date(NOW.getTime() - MIN), NOW)).toBe(false);
    expect(isPaused(null, NOW)).toBe(false);

    expect(nextAttemptAt(pausedUntil, NOW, 30, false)?.toISOString()).toBe(pausedUntil.toISOString());
    expect(nextAttemptAt(null, NOW, 30, true)?.toISOString()).toBe(new Date(NOW.getTime() + 30 * MIN).toISOString());
    expect(nextAttemptAt(null, NOW, 30, false)).toBeNull();
  });

  test('показывает худший источник: счётчик, причину и момент следующей попытки', () => {
    const pausedUntil = new Date(NOW.getTime() + 30 * MIN);
    const health = summarizeSourceHealth(
      [
        { name: 'healthy', consecutiveFailures: 0, pausedUntil: null, lastError: null },
        { name: 'blocked', consecutiveFailures: 3, pausedUntil, lastError: '[http_429] Operator ...' },
      ],
      NOW,
      { schedulerEnabled: true, intervalMinutes: 30 },
    );

    expect(health.consecutiveParseFailures).toBe(3);
    expect(health.lastError).toBe('[http_429] Operator ...');
    expect(health.pausedUntil).toBe(pausedUntil.toISOString());
    expect(health.nextAttemptAt).toBe(pausedUntil.toISOString());
  });

  test('пустой список источников — спокойный ответ без выдуманных значений', () => {
    expect(summarizeSourceHealth([], NOW, { schedulerEnabled: false, intervalMinutes: 30 })).toEqual({
      consecutiveParseFailures: 0,
      pausedUntil: null,
      lastError: null,
      nextAttemptAt: null,
    });
  });
});

describe('sanitizeSourceError: логи и /status без персональных данных', () => {
  test('вырезает длинные числовые последовательности и лишние пробелы/переводы строк', () => {
    expect(sanitizeSourceError('Operator /api/list_acc returned HTTP 429\n   (city=7422288601, type=1)')).toBe(
      'Operator /api/list_acc returned HTTP 429 (city=<number>, type=1)',
    );
  });

  test('обрезает слишком длинное сообщение', () => {
    const cut = sanitizeSourceError('x'.repeat(500), 300);
    expect(cut).toHaveLength(301);
    expect(cut.endsWith('…')).toBe(true);
  });
});
