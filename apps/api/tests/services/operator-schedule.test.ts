import { beforeAll, describe, expect, test, vi } from 'vitest';

/**
 * Живий графік ГПВ оператора (POST /api/info_schedule, піддомен interruptions.energy.cn.ua).
 *
 * Зачем тест: оператор віддає `aData: null`, коли на цю чергу/дату погодинного ГПВ немає
 * (перевірено 10.10.2026 на живому ендпоінті без капчі). Раніше схема вимагала масив, тож
 * таку відповідь не можна було ні вставити вручну, ні імпортувати. Тепер це «0 слотів».
 */
type Service = typeof import('../../src/services/operator-schedule.service.js');
let service: Service;

// config.ts читає process.env на імпорті, а DATABASE_URL обовʼязковий — підставляємо фікстуру.
process.env['DATABASE_URL'] ??= 'postgresql://test:test@localhost:5432/test'; // scan:allow: фікстура теста

const stateLegend = {
  1: { name: 'Не відключається', color: '#63aa18' },
  2: { name: 'Розмін черги/підчерги', color: '#AFAFAF' },
  3: { name: 'Відключення', color: '#E33535' },
};

const jsonFetch = (payload: unknown, status = 200): typeof fetch =>
  vi.fn(async () =>
    new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } }),
  ) as unknown as typeof fetch;

beforeAll(async () => {
  service = await import('../../src/services/operator-schedule.service.js');
});

describe('normalizeOperatorSchedulePayload', () => {
  test('aData: null — це «графіка немає», а не помилка (жива відповідь оператора)', () => {
    const payload = service.normalizeOperatorSchedulePayload({ status: 'ok', aData: null, aState: stateLegend });
    expect(payload.aData).toEqual([]);
    expect(payload.aState[1]?.name).toBe('Не відключається');
  });

  test('код черги рядком приводиться до числа, час лишається як є', () => {
    const payload = service.normalizeOperatorSchedulePayload({
      status: 'ok',
      aData: [
        { time_from: '00:00', time_to: '03:00', queue: '3' },
        { time_from: '03:00', time_to: '00:00', queue: 1 },
      ],
      aState: stateLegend,
    });
    expect(payload.aData).toEqual([
      { time_from: '00:00', time_to: '03:00', queue: 3 },
      { time_from: '03:00', time_to: '00:00', queue: 1 },
    ]);
  });

  test('неочікуваний формат — зрозуміла помилка, а не ZodError назовні', () => {
    expect(() => service.normalizeOperatorSchedulePayload({ status: 'ok' })).toThrow(service.OperatorScheduleFetchError);
    expect(() =>
      service.normalizeOperatorSchedulePayload({ status: 'ok', aData: [{ time_from: '24:00', time_to: '00:00', queue: 1 }], aState: stateLegend }),
    ).toThrow(/неочікуваний формат/u);
  });
});

describe('fetchOperatorSchedule', () => {
  test('надсилає лише чергу й дату і приймає порожній aData', async () => {
    const fetchImpl = jsonFetch({ status: 'ok', aData: null, aState: stateLegend });
    const payload = await service.fetchOperatorSchedule('2/2', '2026-10-10', fetchImpl);

    expect(payload.aData).toEqual([]);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(String(url)).toContain('/api/info_schedule');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ queue: '2/2', curr_dt: '2026-10-10' });
    // Персональні дані в запиті не надсилаються — тільки черга й дата.
    expect(Object.keys(JSON.parse(init.body))).toHaveLength(2);
  });

  test('HTTP 500 віддає OperatorScheduleFetchError зі статусом', async () => {
    const fetchImpl = jsonFetch({ status: 'error' }, 500);
    await expect(service.fetchOperatorSchedule('1', '2026-10-10', fetchImpl)).rejects.toThrow(service.OperatorScheduleFetchError);
    await expect(service.fetchOperatorSchedule('1', '2026-10-10', fetchImpl)).rejects.toMatchObject({ httpStatus: 500 });
  });

  test('мережевий збій перетворюється на зрозумілу помилку без тіла відповіді', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ETIMEDOUT');
    }) as unknown as typeof fetch;
    await expect(service.fetchOperatorSchedule('1', '2026-10-10', fetchImpl)).rejects.toThrow(/ETIMEDOUT/u);
  });
});

describe('mergeRawScheduleSlots на живій відповіді', () => {
  test('aData: null дає порожній список слотів', async () => {
    const { mergeRawScheduleSlots } = await import('../../src/services/schedule-import.service.js');
    expect(mergeRawScheduleSlots({ status: 'ok', aData: null, aState: stateLegend })).toEqual([]);
  });
});
