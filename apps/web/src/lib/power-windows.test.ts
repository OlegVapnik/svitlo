import { describe, expect, test } from 'vitest';
import type { OperatorStateCode, ScheduleIntervalUtc } from '@svitlo/shared';
import { lightWindows, planPowerWindow, windowStartMs, type DaySchedule } from './power-windows.js';

/**
 * Летние сутки: Киев = UTC+3. Местные 12:00–14:00 — это 09:00–11:00Z.
 * Тесты не зависят от пояса машины: время и дата передаются аргументами.
 */
const on = (from: string, to: string): ScheduleIntervalUtc => ({
  startsAt: from,
  endsAt: to,
  stateCode: 1,
  stateName: 'Світло є',
  stateColor: '#10B981',
});
const off = (from: string, to: string, stateCode: OperatorStateCode = 3): ScheduleIntervalUtc => ({
  startsAt: from,
  endsAt: to,
  stateCode,
  stateName: stateCode === 3 ? 'Відключення' : 'Можливо вимкнуть',
  stateColor: stateCode === 3 ? '#F43F5E' : '#F59E0B',
});

/** Полные сутки 10.10.2026 с отключением 12:00–14:00 по Киеву. */
const day: DaySchedule = {
  date: '2026-10-10',
  intervals: [
    on('2026-10-09T21:00:00.000Z', '2026-10-10T09:00:00.000Z'),
    off('2026-10-10T09:00:00.000Z', '2026-10-10T11:00:00.000Z'),
    on('2026-10-10T11:00:00.000Z', '2026-10-10T21:00:00.000Z'),
  ],
};

describe('lightWindows: окна со светом по киевским суткам', () => {
  test('сегодня окно обрезается по «сейчас»: прошлое не предлагается', () => {
    // 10:00 по Киеву (07:00Z) — до отключения ещё два часа.
    const windows = lightWindows([day], new Date('2026-10-10T07:00:00.000Z'));
    expect(windows.map((window) => [window.start, window.end])).toEqual([
      [600, 720],
      [840, 1440],
    ]);
    expect(windows[0].minutes).toBe(120);
  });

  test('утром окно начинается с текущего момента', () => {
    const windows = lightWindows([day], new Date('2026-10-10T02:00:00.000Z'));
    expect(windows.map((window) => [window.start, window.end])).toEqual([
      [300, 720],
      [840, 1440],
    ]);
  });

  test('завтра считается целиком, без обрезки по текущему времени', () => {
    const tomorrow: DaySchedule = {
      date: '2026-10-11',
      intervals: [
        on('2026-10-10T21:00:00.000Z', '2026-10-11T09:00:00.000Z'),
        off('2026-10-11T09:00:00.000Z', '2026-10-11T11:00:00.000Z'),
        on('2026-10-11T11:00:00.000Z', '2026-10-11T21:00:00.000Z'),
      ],
    };
    const windows = lightWindows([tomorrow], new Date('2026-10-10T19:00:00.000Z'));
    expect(windows.map((window) => [window.date, window.start, window.end])).toEqual([
      ['2026-10-11', 0, 720],
      ['2026-10-11', 840, 1440],
    ]);
  });

  test('код 2 «можливо вимкнуть» тоже разрывает окно — свет не гарантирован', () => {
    const risky: DaySchedule = {
      date: '2026-10-11',
      intervals: [
        on('2026-10-10T21:00:00.000Z', '2026-10-11T09:00:00.000Z'),
        off('2026-10-11T09:00:00.000Z', '2026-10-11T10:00:00.000Z', 2),
        on('2026-10-11T10:00:00.000Z', '2026-10-11T21:00:00.000Z'),
      ],
    };
    const windows = lightWindows([risky], new Date('2026-10-10T19:00:00.000Z'));
    expect(windows.map((window) => [window.start, window.end])).toEqual([
      [0, 720],
      [780, 1440],
    ]);
  });

  test('пустые интервалы без покрытия — не «светло целые сутки», а «нет данных»', () => {
    expect(lightWindows([{ date: '2026-10-10', intervals: [] }], new Date('2026-10-10T02:00:00.000Z'))).toEqual([]);
    expect(
      lightWindows([{ date: '2026-10-10', intervals: [], covered: true }], new Date('2026-10-10T02:00:00.000Z')),
    ).toEqual([{ date: '2026-10-10', start: 300, end: 1440, minutes: 1140 }]);
  });

  test('прошедшие сутки не попадают в расчёт', () => {
    const past: DaySchedule = { ...day, date: '2026-10-09' };
    expect(lightWindows([past], new Date('2026-10-10T02:00:00.000Z'))).toEqual([]);
  });
});

describe('planPowerWindow: «когда включить прибор»', () => {
  test('свет уже есть и его хватает — «текущее окно», а не «лучшее»', () => {
    const plan = planPowerWindow([day], 120, new Date('2026-10-10T07:00:00.000Z'));
    expect(plan.kind).toBe('now');
    expect(plan.remaining).toBe(120);
    expect(plan.slack).toBe(0);
    expect(plan.window?.start).toBe(600);
  });

  test('на прибор не хватает текущего окна — выбирается лучшее впереди с запасом', () => {
    // 10:00 по Киеву, стирка 4 часа: до 12:00 не успеваем, лучшее окно — 14:00–24:00 (600 мин).
    const plan = planPowerWindow([day], 240, new Date('2026-10-10T07:00:00.000Z'));
    expect(plan.kind).toBe('best');
    expect(plan.window?.start).toBe(840);
    expect(plan.window?.end).toBe(1440);
    expect(plan.slack).toBe(360);
  });

  test('завтрашние сутки с большим запасом важнее сегодняшнего окна', () => {
    const tomorrow: DaySchedule = { date: '2026-10-11', intervals: [], covered: true };
    const plan = planPowerWindow([day, tomorrow], 240, new Date('2026-10-10T07:00:00.000Z'));
    expect(plan.kind).toBe('best');
    expect(plan.window?.date).toBe('2026-10-11');
    expect(plan.slack).toBe(1440 - 240);
  });

  test('не встигаемо ніде — честно возвращается самое длинное окно', () => {
    const plan = planPowerWindow([day], 900, new Date('2026-10-10T07:00:00.000Z'));
    expect(plan.kind).toBe('none');
    expect(plan.window?.minutes).toBe(600);
  });

  test('нет графика — нет и окна (никаких выдуманных суток)', () => {
    const plan = planPowerWindow([], 120, new Date('2026-10-10T07:00:00.000Z'));
    expect(plan.kind).toBe('none');
    expect(plan.window).toBeNull();
  });

  test('начало окна переводится в реальное UTC-время', () => {
    // 14:00 по Киеву 10.10.2026 (лето, +3) — это 11:00Z.
    expect(windowStartMs({ date: '2026-10-10', start: 840, end: 1440, minutes: 600 })).toBe(
      Date.parse('2026-10-10T11:00:00.000Z'),
    );
  });
});
