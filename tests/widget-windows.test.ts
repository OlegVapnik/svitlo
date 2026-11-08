import { describe, expect, it } from 'vitest';

import { buildWidgetWindows } from '../src/lib/widget-windows';
import type { ScheduleIntervalUtc } from '@svitlo/shared';

/**
 * Окна суток для виджета считаются только из фактов расписания.
 *
 * Тесты держат три вещи, которые ломаются незаметно: границу киевских суток (интервал через
 * полночь), склейку пересекающихся интервалов и отбрасывание «світло»/«можливе» — в виджет
 * должны попадать только реальные отключения.
 */

const interval = (
  startsAt: string,
  endsAt: string,
  stateCode = 3,
): ScheduleIntervalUtc => ({
  startsAt,
  endsAt,
  stateCode: stateCode as ScheduleIntervalUtc['stateCode'],
  stateName: '',
  stateColor: '',
});

// 30–31 октября Киев живёт по зимнему времени (UTC+2), поэтому смещение фиксируем как +02:00:
// тест про границы суток не должен зависеть от перехода на летнее время.
const Kyiv = (date: string, time: string): string => `${date}T${time}:00+02:00`;

describe('buildWidgetWindows', () => {
  it('собирает окна отключений на киевские сутки', () => {
    const windows = buildWidgetWindows(
      [
        interval(Kyiv('2026-10-30', '09:30'), Kyiv('2026-10-30', '11:00')),
        interval(Kyiv('2026-10-30', '16:00'), Kyiv('2026-10-30', '18:00')),
      ],
      '2026-10-30',
    );
    expect(windows).toHaveLength(2);
    expect(new Date(windows[0]![0]).toISOString()).toBe('2026-10-30T07:30:00.000Z');
    expect(new Date(windows[1]![1]).toISOString()).toBe('2026-10-30T16:00:00.000Z');
  });

  it('склеивает пересекающиеся интервалы в одно окно', () => {
    const windows = buildWidgetWindows(
      [
        interval(Kyiv('2026-10-30', '09:30'), Kyiv('2026-10-30', '11:00')),
        interval(Kyiv('2026-10-30', '10:30'), Kyiv('2026-10-30', '12:00')),
      ],
      '2026-10-30',
    );
    expect(windows).toHaveLength(1);
    expect(new Date(windows[0]![0]).toISOString()).toBe('2026-10-30T07:30:00.000Z');
    expect(new Date(windows[0]![1]).toISOString()).toBe('2026-10-30T10:00:00.000Z');
  });

  it('обрезает интервал через полночь по границе суток', () => {
    const windows = buildWidgetWindows(
      [interval(Kyiv('2026-10-30', '23:30'), Kyiv('2026-10-31', '00:30'))],
      '2026-10-30',
    );
    expect(windows).toHaveLength(1);
    expect(new Date(windows[0]![0]).toISOString()).toBe('2026-10-30T21:30:00.000Z');
    // Полночь 31 октября по Киеву (UTC+2) — 22:00 UTC 30 октября.
    expect(new Date(windows[0]![1]).toISOString()).toBe('2026-10-30T22:00:00.000Z');
  });

  it('тот же интервал попадает в «завтра» своей второй половиной', () => {
    const windows = buildWidgetWindows(
      [interval(Kyiv('2026-10-30', '23:30'), Kyiv('2026-10-31', '00:30'))],
      '2026-10-31',
    );
    expect(windows).toHaveLength(1);
    expect(new Date(windows[0]![0]).toISOString()).toBe('2026-10-30T22:00:00.000Z');
    expect(new Date(windows[0]![1]).toISOString()).toBe('2026-10-30T22:30:00.000Z');
  });

  it('не считает отключением «світло» и «можливе»', () => {
    const windows = buildWidgetWindows(
      [
        interval(Kyiv('2026-10-30', '08:00'), Kyiv('2026-10-30', '09:00'), 1),
        interval(Kyiv('2026-10-30', '10:00'), Kyiv('2026-10-30', '11:00'), 2),
      ],
      '2026-10-30',
    );
    expect(windows).toEqual([]);
  });

  it('игнорирует битые интервалы и пустой график', () => {
    expect(buildWidgetWindows([], '2026-10-30')).toEqual([]);
    expect(
      buildWidgetWindows(
        [
          interval('не дата', '2026-10-30T10:00:00+03:00'),
          interval(Kyiv('2026-10-30', '12:00'), Kyiv('2026-10-30', '11:00')),
        ],
        '2026-10-30',
      ),
    ).toEqual([]);
  });
});
