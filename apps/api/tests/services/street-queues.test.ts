import { describe, expect, test } from 'vitest';
import { streetQueueInputSchema, type OperatorScheduleResponse } from '@energy-monitor/shared';
import { normalizeAddressQuery } from '../../src/parsers/address-matcher.js';
import { normalizeScheduleResponse } from '../../src/services/schedule-normalizer.js';

/**
 * Воспроизводит естественный ключ таблицы street_queues: пара «улица → очередь»
 * хранится по нормализованному имени (см. street-queues.service.ts / schema.ts).
 */
function buildStreetIndex(pairs: Array<{ street: string; queue: string }>) {
  const index = new Map<string, string>();
  for (const pair of pairs) index.set(normalizeAddressQuery(pair.street), pair.queue);
  return (street: string): string | null => index.get(normalizeAddressQuery(street)) ?? null;
}

const KYIV_TIME = new Intl.DateTimeFormat('uk-UA', { timeZone: 'Europe/Kyiv', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const localTime = (iso: string) => KYIV_TIME.format(new Date(iso));

describe('street → queue mapping', () => {
  const resolveQueue = buildStreetIndex([{ street: 'вул. Зарічна', queue: '3' }]);

  test('resolves a street regardless of prefix/case', () => {
    expect(resolveQueue('вул. Зарічна')).toBe('3');
    expect(resolveQueue('ЗАРІЧНА')).toBe('3');
    expect(resolveQueue('зарічна')).toBe('3');
  });

  test('returns null for an unbound street', () => {
    expect(resolveQueue('вул. Невідома')).toBeNull();
  });

  test('normalization is idempotent so the storage key is stable', () => {
    const key = normalizeAddressQuery('вул. Зарічна');
    expect(normalizeAddressQuery(key)).toBe(key);
  });
});

describe('streetQueueInputSchema', () => {
  test('accepts simple and fractional queues', () => {
    expect(streetQueueInputSchema.parse({ street: 'вул. Зарічна', queue: '3' }).queue).toBe('3');
    expect(streetQueueInputSchema.parse({ street: 'вул. Зарічна', queue: '2/2' }).queue).toBe('2/2');
  });

  test('rejects a too-short street and a malformed queue', () => {
    expect(() => streetQueueInputSchema.parse({ street: 'З', queue: '3' })).toThrow();
    expect(() => streetQueueInputSchema.parse({ street: 'вул. Зарічна', queue: 'черга' })).toThrow();
    expect(() => streetQueueInputSchema.parse({ street: 'вул. Зарічна', queue: '2/2/2' })).toThrow();
  });
});

describe('example: вул. Зарічна, 17:30–21:00 (queue 3)', () => {
  // Уличная очередь 3 = «Відключення»; окно 17:30–21:00 взято из графика оператора.
  const payload: OperatorScheduleResponse = {
    status: 'ok',
    aData: [
      { time_from: '00:00', time_to: '17:30', queue: 1 },
      { time_from: '17:30', time_to: '21:00', queue: 3 },
      { time_from: '21:00', time_to: '00:00', queue: 1 },
    ],
    aState: {
      1: { name: 'Не відключається', color: '#63aa18' },
      3: { name: 'Відключення', color: '#E33535' },
    },
  };

  test('the bound queue exposes the 17:30–21:00 outage window in Kyiv local time', () => {
    const intervals = normalizeScheduleResponse(payload, '2026-07-01');
    const outage = intervals.find((interval) => interval.stateCode === 3);
    expect(outage).toBeDefined();
    expect(`${localTime(outage!.startsAt)}–${localTime(outage!.endsAt)}`).toBe('17:30–21:00');
  });

  test('the outage window is stored as UTC (+3 in summer: 14:30Z–18:00Z)', () => {
    const intervals = normalizeScheduleResponse(payload, '2026-07-01');
    const outage = intervals.find((interval) => interval.stateCode === 3)!;
    expect(outage.startsAt).toBe('2026-07-01T14:30:00.000Z');
    expect(outage.endsAt).toBe('2026-07-01T18:00:00.000Z');
  });
});
