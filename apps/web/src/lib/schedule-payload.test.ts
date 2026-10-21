import { describe, expect, test } from 'vitest';
import { toDaySchedule, unwrapSchedule } from './schedule-payload.js';

/**
 * Ответ графика приходит в двух формах: «сырой» объект и конверт `{ data }`. Раньше каждый
 * компонент разбирал это сам, и расхождение давало «Даних графіка немає» при непустом ответе.
 */
describe('unwrapSchedule', () => {
  test('прямой объект с интервалами', () => {
    const payload = { queue: '2/2', date: '2026-10-10', intervals: [], source: null, lastImportedAt: null };
    expect(unwrapSchedule(payload)).toBe(payload);
  });

  test('конверт { data }', () => {
    const data = { queue: '2/2', date: '2026-10-10', intervals: [], source: 'mirror', lastImportedAt: null };
    expect(unwrapSchedule({ data })).toBe(data);
  });

  test('null, мусор и ответ без intervals — null', () => {
    expect(unwrapSchedule(null)).toBeNull();
    expect(unwrapSchedule('oops')).toBeNull();
    expect(unwrapSchedule({ data: { queue: '2/2' } })).toBeNull();
  });
});

describe('toDaySchedule', () => {
  test('интервалы уже описывают покрытие — «дірка» в них означает свет', () => {
    const day = toDaySchedule('2026-10-10', {
      data: {
        queue: '2/2',
        date: '2026-10-10',
        intervals: [{ startsAt: '2026-10-10T09:00:00.000Z', endsAt: '2026-10-10T10:00:00.000Z', stateCode: 3, stateName: 'Відключення', stateColor: '#F43F5E' }],
        source: 'mirror',
        lastImportedAt: null,
      },
    });
    expect(day?.intervals).toHaveLength(1);
    expect(day?.covered).toBe(true);
  });

  test('пустой ответ без allClear — нет данных, а не «светло целые сутки»', () => {
    const day = toDaySchedule('2026-10-10', {
      data: { queue: '2/2', date: '2026-10-10', intervals: [], source: null, lastImportedAt: null },
    });
    expect(day?.covered).toBe(false);
  });

  test('allClear из API выставляет покрытие', () => {
    const day = toDaySchedule('2026-10-10', {
      data: { queue: '2/2', date: '2026-10-10', intervals: [], source: 'mirror', lastImportedAt: null, allClear: true },
    });
    expect(day?.covered).toBe(true);
  });
});
