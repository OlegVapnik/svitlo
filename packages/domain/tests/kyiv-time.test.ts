/**
 * Київська дата, перехід на зимовий/літній час і локальні слоти.
 *
 * 25 жовтня 2026 о 04:00 за Києвом (01:00 UTC) Україна переходить з UTC+3 на UTC+2.
 * Найнебезпечніше вікно — 00:00–03:00: якщо рахувати дату через `toISOString()`, «сьогодні»
 * й «завтра» можуть стрибнути на добу назад. Тести фіксують саме ці межі.
 *
 * Тести перенесені з `cf-worker/tests/kyiv-time.test.ts` (шаг 2 міграції); значення, які
 * залежать від алгоритму сходимості, зафіксовані як характеристика поточної поведінки —
 * щоб перенесення коду не змінило вже віддані клієнтам інтервали.
 */
import { afterEach, test, expect, vi } from 'vitest';

import {
  halfHourLabels,
  kyivDateKeyFromMs,
  kyivOffsetMinutesAt,
  kyivToday,
  kyivWallClockMs,
  localSlotToUtc,
  shiftYmd,
} from '../src/kyiv-time.ts';

const at = (iso: string): number => Date.parse(iso);

afterEach(() => {
  vi.useRealTimers();
});

test("київська дата не з'їжджає на добу в ніч переходу 25 жовтня", () => {
  // 02:30 за Києвом (ще літній час) — це вже 25 жовтня.
  expect(kyivDateKeyFromMs(at('2026-10-24T23:30:00Z'))).toBe('2026-10-25');
  // 03:30 за Києвом (уже зимовий час) — та сама дата.
  expect(kyivDateKeyFromMs(at('2026-10-25T00:30:00Z'))).toBe('2026-10-25');
  expect(kyivDateKeyFromMs(at('2026-10-25T01:30:00Z'))).toBe('2026-10-25');
  // 23:30 за Києвом — ще 25 жовтня.
  expect(kyivDateKeyFromMs(at('2026-10-25T21:30:00Z'))).toBe('2026-10-25');
  // 00:30 наступного дня — вже 26 жовтня.
  expect(kyivDateKeyFromMs(at('2026-10-25T22:30:00Z'))).toBe('2026-10-26');
});

test('перехід на літній час у березні так само не зсуває дату', () => {
  expect(kyivDateKeyFromMs(at('2026-03-28T22:30:00Z'))).toBe('2026-03-29');
  expect(kyivDateKeyFromMs(at('2026-03-29T00:30:00Z'))).toBe('2026-03-29');
  expect(kyivDateKeyFromMs(at('2026-03-29T22:30:00Z'))).toBe('2026-03-30');
});

test('сдвиг +3 години діє до 01:00 UTC 25 жовтня, далі +2', () => {
  expect(kyivOffsetMinutesAt(at('2026-10-25T00:59:00Z'))).toBe(180);
  expect(kyivOffsetMinutesAt(at('2026-10-25T01:00:00Z'))).toBe(120);
  expect(kyivOffsetMinutesAt(at('2026-10-24T12:00:00Z'))).toBe(180);
  expect(kyivOffsetMinutesAt(at('2026-10-26T12:00:00Z'))).toBe(120);
});

test('межа літнього часу в березні: +2 до 01:00 UTC, далі +3', () => {
  expect(kyivOffsetMinutesAt(at('2026-03-29T00:59:00Z'))).toBe(120);
  expect(kyivOffsetMinutesAt(at('2026-03-29T01:00:00Z'))).toBe(180);
});

test('shiftYmd переходить через місяць, рік і 29 лютого', () => {
  expect(shiftYmd('2026-10-25', 1)).toBe('2026-10-26');
  expect(shiftYmd('2026-10-25', -1)).toBe('2026-10-24');
  expect(shiftYmd('2026-12-31', 1)).toBe('2027-01-01');
  expect(shiftYmd('2024-02-28', 1)).toBe('2024-02-29');
  expect(shiftYmd('2024-03-01', -1)).toBe('2024-02-29');
  expect(shiftYmd('2026-03-29', -1)).toBe('2026-03-28');
  expect(shiftYmd('2026-01-01', -1)).toBe('2025-12-31');
  expect(shiftYmd('2026-10-25', 0)).toBe('2026-10-25');
});

test('кінець доби «00:00» — це північ наступного дня, зокрема в ніч переходу', () => {
  // 26 жовтня вже зимовий час: 00:00 за Києвом = 22:00 UTC 25 жовтня.
  expect(localSlotToUtc('2026-10-25', '00:00', true)).toBe('2026-10-25T22:00:00.000Z');
  // 25 жовтня ще літній час до 04:00: 00:00 за Києвом = 21:00 UTC 24 жовтня.
  expect(localSlotToUtc('2026-10-24', '00:00', true)).toBe('2026-10-24T21:00:00.000Z');
  // 29 березня до 03:00 ще зимовий: 00:00 = 22:00 UTC 28 березня.
  expect(localSlotToUtc('2026-03-28', '00:00', true)).toBe('2026-03-28T22:00:00.000Z');
});

test('початок доби без прапорця end — та сама мить, що кінець попередньої доби', () => {
  expect(localSlotToUtc('2026-10-25', '00:00', false)).toBe(
    localSlotToUtc('2026-10-24', '00:00', true),
  );
  expect(localSlotToUtc('2026-10-26', '00:00', false)).toBe(
    localSlotToUtc('2026-10-25', '00:00', true),
  );
});

test('kyivWallClockMs і localSlotToUtc дають один момент', () => {
  for (const [date, time, end] of [
    ['2026-10-24', '20:00', false],
    ['2026-10-25', '00:00', true],
    ['2026-10-25', '03:30', false],
    ['2026-10-26', '00:00', true],
    ['2026-03-29', '03:30', false],
    ['2026-12-31', '23:30', false],
  ] as const) {
    expect(kyivWallClockMs(date, time, end), `${date} ${time} end=${end}`).toBe(
      at(localSlotToUtc(date, time, end)),
    );
  }
});

test('неоднозначні години переходу: поведінка зафіксована (перенос не має її змінити)', () => {
  // 25 жовтня 02:30 існує двічі; алгоритм сходимості дає перше входження (літній час).
  expect(localSlotToUtc('2026-10-25', '02:30', false)).toBe('2026-10-24T23:30:00.000Z');
  // 03:30 існує один раз, уже за зимовим часом.
  expect(localSlotToUtc('2026-10-25', '03:30', false)).toBe('2026-10-25T01:30:00.000Z');
  // 29 березня 03:30 не існує; алгоритм віддає момент, що відповідає зимовому зсуву.
  expect(localSlotToUtc('2026-03-29', '03:30', false)).toBe('2026-03-29T00:30:00.000Z');
});

test('halfHourLabels: 48 підписів від 00:00 до 23:30', () => {
  const labels = halfHourLabels();
  expect(labels).toHaveLength(48);
  expect(labels[0]).toBe('00:00');
  expect(labels[1]).toBe('00:30');
  expect(labels[47]).toBe('23:30');
  expect(new Set(labels).size).toBe(48);
});

test('kyivToday бере дату з годинника, а не з UTC', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-24T23:30:00Z')); // 02:30 за Києвом 25 жовтня (ще літній час)
  expect(kyivToday()).toBe('2026-10-25');
  vi.setSystemTime(new Date('2026-10-25T21:59:00Z')); // 23:59 за Києвом
  expect(kyivToday()).toBe('2026-10-25');
  vi.setSystemTime(new Date('2026-10-25T22:00:00Z')); // 00:00 наступного дня
  expect(kyivToday()).toBe('2026-10-26');
});
