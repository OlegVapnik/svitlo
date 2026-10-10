import { describe, expect, test } from 'vitest';
import { formatMinutesUk, kyivOffset, minutesOfDay, minutesToHm, scheduleWindow } from './scheduleWindow.js';
import type { ScheduleIntervalUtc } from '@svitlo/shared';

/**
 * Летние сутки: Киев = UTC+3, поэтому местные 07:00–10:00 — это 04:00–07:00Z.
 * Тесты не зависят от часового пояса машины: время передаётся аргументом, зона — Europe/Kyiv.
 */
const summerDay: ScheduleIntervalUtc[] = [
  { startsAt: '2026-10-09T21:00:00.000Z', endsAt: '2026-10-10T04:00:00.000Z', stateCode: 1, stateName: 'Світло є', stateColor: '#63AA18' },
  { startsAt: '2026-10-10T04:00:00.000Z', endsAt: '2026-10-10T07:00:00.000Z', stateCode: 3, stateName: 'Відключення', stateColor: '#E33535' },
  { startsAt: '2026-10-10T07:00:00.000Z', endsAt: '2026-10-10T21:00:00.000Z', stateCode: 1, stateName: 'Світло є', stateColor: '#63AA18' },
];

/** Зимние сутки: Киев = UTC+2 — проверяет вторую ветку смещения (иначе окна уедут на час). */
const winterDay: ScheduleIntervalUtc[] = [
  { startsAt: '2026-01-14T22:00:00.000Z', endsAt: '2026-01-15T05:00:00.000Z', stateCode: 1, stateName: 'Світло є', stateColor: '#63AA18' },
  { startsAt: '2026-01-15T05:00:00.000Z', endsAt: '2026-01-15T08:00:00.000Z', stateCode: 3, stateName: 'Відключення', stateColor: '#E33535' },
];

describe('scheduleWindow: «є світло зараз» и когда следующее отключение', () => {
  test('летом Киев +3, зимой +2 — окна считаются по местным суткам', () => {
    expect(kyivOffset('2026-10-10')).toBe(180);
    expect(kyivOffset('2026-01-15')).toBe(120);
  });

  test('минута суток для 04:00Z летом — 420 (07:00 по Киеву)', () => {
    expect(minutesOfDay('2026-10-10T04:00:00.000Z', '2026-10-10')).toBe(420);
  });

  test('внутри отключения: isOff, «повернеться через» и конец окна', () => {
    const window = scheduleWindow(summerDay, '2026-10-10', new Date('2026-10-10T05:00:00.000Z'));
    expect(window.isOff).toBe(true);
    expect(window.current?.stateCode).toBe(3);
    expect(window.offEndsAt).toBe('2026-10-10T07:00:00.000Z');
    expect(window.backInMinutes).toBe(120);
    expect(window.nextInMinutes).toBeNull();
  });

  test('до отключения: свет есть, показано «через сколько»', () => {
    const window = scheduleWindow(summerDay, '2026-10-10', new Date('2026-10-10T03:00:00.000Z'));
    expect(window.isOff).toBe(false);
    expect(window.current?.stateCode).toBe(1);
    expect(window.backInMinutes).toBeNull();
    expect(window.nextInMinutes).toBe(60);
  });

  test('после отключения: на сутки больше ничего — null, а не 0', () => {
    const window = scheduleWindow(summerDay, '2026-10-10', new Date('2026-10-10T12:00:00.000Z'));
    expect(window.isOff).toBe(false);
    expect(window.nextInMinutes).toBeNull();
    expect(window.offMinutes).toBe(180);
  });

  test('другие сутки (график на завтра): «зараз» неизвестно, отсчёта нет', () => {
    const window = scheduleWindow(summerDay, '2026-10-10', new Date('2026-10-11T05:00:00.000Z'));
    expect(window.nowMinutes).toBeNull();
    expect(window.isOff).toBe(false);
    expect(window.nextInMinutes).toBeNull();
    expect(window.current).toBeNull();
  });

  test('зимнее окно 07:00–10:00 по Киеву = 05:00–08:00Z', () => {
    const window = scheduleWindow(winterDay, '2026-01-15', new Date('2026-01-15T06:00:00.000Z'));
    expect(window.isOff).toBe(true);
    expect(window.backInMinutes).toBe(120);
  });
});

describe('подписи длительности и времени', () => {
  test('formatMinutesUk не пишет «0 год» и «1 год 0 хв»', () => {
    expect(formatMinutesUk(0)).toBe('0 хв');
    expect(formatMinutesUk(45)).toBe('45 хв');
    expect(formatMinutesUk(60)).toBe('1 год');
    expect(formatMinutesUk(80)).toBe('1 год 20 хв');
    expect(formatMinutesUk(-5)).toBe('0 хв');
  });

  test('minutesToHm даёт подписи полосы суток', () => {
    expect(minutesToHm(0)).toBe('00:00');
    expect(minutesToHm(360)).toBe('06:00');
    expect(minutesToHm(1440)).toBe('24:00');
  });
});
