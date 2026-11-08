import { describe, expect, it } from 'vitest';

import { powerStateFromSchedule, unwrapSchedule } from '../src/lib/power-state';
import type { QueueScheduleData } from '@svitlo/shared';

/**
 * Состояние света на главной и в уведомлении: fresh / stale / offline / no-data.
 *
 * Правило живёт в домене (`dayPowerState`), но именно мобильный слой решает, что считать
 * графиком: живой ответ приходит конвертом `{ data }`, офлайн-пакет — развёрнутым объектом.
 * Если развернуть неправильно, приложение покажет «не знаем» при живом графике — это и
 * проверяем: развёртку и границы состояний.
 */

const day = (overrides: Partial<QueueScheduleData> = {}): QueueScheduleData =>
  ({ date: '2026-10-29', intervals: [], allClear: false, ...overrides }) as QueueScheduleData;

describe('unwrapSchedule', () => {
  it('разворачивает живой ответ-конверт', () => {
    const data = day({ allClear: true });
    expect(unwrapSchedule({ data })).toBe(data);
  });

  it('офлайн-пакет уже развёрнут — возвращает его как есть', () => {
    const data = day();
    expect(unwrapSchedule(data)).toBe(data);
  });

  it('пустое значение — undefined, а не исключение', () => {
    expect(unwrapSchedule(undefined)).toBeUndefined();
    expect(unwrapSchedule({})).toBeUndefined();
  });
});

describe('powerStateFromSchedule', () => {
  it('нет графика — no-data', () => {
    expect(powerStateFromSchedule(undefined, '2026-10-29')).toEqual({ state: 'unknown', summary: null });
    expect(powerStateFromSchedule(null, '2026-10-29')).toEqual({ state: 'unknown', summary: null });
  });

  it('пустой график без покрытия — тоже no-data, а не «светло»', () => {
    const result = powerStateFromSchedule(day({ intervals: [] }), '2026-10-29');
    expect(result.state).toBe('unknown');
    expect(result.summary).toBeNull();
  });

  it('опубликованный день без отключений — allClear', () => {
    const result = powerStateFromSchedule(day({ intervals: [], allClear: true }), '2026-10-29');
    expect(result.state).toBe('allClear');
    expect(result.summary).toBeNull();
  });

  it('график на другую дату не считается текущим отключением', () => {
    // Прошлый день: интервал уже не «сейчас», но день опубликован — значит свет по графику.
    const result = powerStateFromSchedule(
      day({ date: '2020-01-01', intervals: [{ from: '09:00', to: '12:00' }] as never }),
      '2026-10-29',
    );
    expect(result.state).toBe('on');
  });

  it('состояние уходит вместе с окном: экран не считает summary сам', () => {
    const result = powerStateFromSchedule(
      day({ date: '2020-01-01', intervals: [{ from: '09:00', to: '12:00' }] as never }),
      '2026-10-29',
    );
    expect(result.summary).not.toBeNull();
    expect(result.summary?.isOff).toBe(false);
  });
});
