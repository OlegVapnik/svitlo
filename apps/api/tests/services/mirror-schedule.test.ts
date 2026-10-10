/**
 * Погодинний ГПВ із публічного «дзеркала» (`MIRROR_SCHEDULE_URL`) — те саме джерело, що читає
 * Java-ядро `core/` (`BlackoutScheduleProvider`).
 *
 * Зачем тест: це єдине джерело ПОВНОГО добового ГПВ по області (48 півгодинних значень на кожну
 * чергу), бо `info_schedule_part` за Cloudflare Turnstile, а Telegram-канал пише лише «зміни»
 * (HANDOFF §18.9). Ціна помилки в перетворенні — або порожній графік, або години відключень,
 * зсунуті на півгодини. Тому фікстури тут повторюють реальну живу відповідь, а не вигадані дані.
 *
 * Формат (перевірено 10.10.2026): `{body: "<json string>", timestamp}`, усередині
 * `regions[].schedule[<groupKey>][<YYYY-MM-DD>][<HH:MM>] = <code>`, де `2` = відключення.
 */
import { beforeAll, describe, expect, test } from 'vitest';

type Service = typeof import('../../src/services/mirror-schedule.service.js');
type TelegramService = typeof import('../../src/services/telegram-schedule.service.js');
let service: Service;

// config.ts читає process.env на імпорті, а DATABASE_URL обов'язковий — підставляємо фікстуру.
process.env['DATABASE_URL'] ??= 'postgresql://test:test@localhost:5432/test'; // scan:allow: фікстура теста
// Шум від pino у виводі тестів не потрібен (як в інтеграційних тестах).
process.env['LOG_LEVEL'] ??= 'silent';

/** Внутрішній JSON дзеркала: дві черги, обидві дати, коди 0/1/2/3 — як у живих даних. */
function innerPayload(): Record<string, unknown> {
  return {
    date_today: '2026-10-10',
    date_tomorrow: '2026-10-11',
    regions: [
      { cpu: 'kyivska-oblast', name_ua: 'Київська область', schedule: { '1.1': { '2026-10-10': { '00:00': 2 } } } },
      {
        cpu: 'chernihivska-oblast',
        name_ua: 'Чернігівська область',
        schedule: {
          '2.2': {
            // Ранкове вікно 08:00–09:30 (3 півгодини кодом 2), далі код 3 (можливе відключення) і 1.
            '2026-10-10': { '00:00': 1, '07:30': 1, '08:00': 2, '08:30': 2, '09:00': 2, '09:30': 3, '10:00': 1 },
            // Відключення без перерви до кінця доби → timeTo = '00:00'.
            '2026-10-11': { '20:30': 2, '21:00': 2, '21:30': 2, '22:00': 2, '22:30': 2, '23:00': 2, '23:30': 2 },
          },
          '3': { '2026-10-10': { '06:00': 2, '06:30': 1 } },
          notagroup: { '2026-10-10': { '00:00': 2 } },
        },
      },
    ],
  };
}

beforeAll(async () => {
  service = await import('../../src/services/mirror-schedule.service.js');
});
describe('halfHourLabels / queueFromGroupKey', () => {
  test('48 півгодинних підписів доби, як у core/', () => {
    const labels = service.halfHourLabels();
    expect(labels).toHaveLength(48);
    expect(labels[0]).toBe('00:00');
    expect(labels[17]).toBe('08:30');
    expect(labels[47]).toBe('23:30');
  });

  test('ключ групи дзеркала → код черги застосунку', () => {
    expect(service.queueFromGroupKey('2.2')).toBe('2/2');
    expect(service.queueFromGroupKey('3')).toBe('3');
    expect(service.queueFromGroupKey('12.10')).toBe('12/10');
    expect(service.queueFromGroupKey('2.2.2')).toBeNull();
    expect(service.queueFromGroupKey('черга')).toBeNull();
  });
});

describe('offIntervalsFromCodes', () => {
  test('зливає суміжні півгодини в один інтервал і не чіпає код 3', () => {
    const labels = service.halfHourLabels();
    const codes = labels.map(() => null as number | null);
    codes[16] = 2; // 08:00
    codes[17] = 2; // 08:30
    codes[18] = 2; // 09:00
    codes[19] = 3; // 09:30 — «можливе відключення», у ГПВ не пишемо
    codes[20] = 1; // 10:00
    expect(service.offIntervalsFromCodes(codes, labels)).toEqual([{ timeFrom: '08:00', timeTo: '09:30' }]);
  });

  test('відключення до кінця доби закривається як 00:00', () => {
    const labels = service.halfHourLabels();
    expect(service.offIntervalsFromCodes(labels.map(() => 2 as number | null), labels)).toEqual([
      { timeFrom: '00:00', timeTo: '00:00' },
    ]);
    expect(service.offIntervalsFromCodes(labels.map((_, index) => (index < 47 ? null : 2)), labels)).toEqual([
      { timeFrom: '23:30', timeTo: '00:00' },
    ]);
  });

  test('порожній день і день із самих кодів 3 не дають слотів', () => {
    const labels = service.halfHourLabels();
    expect(service.offIntervalsFromCodes(labels.map(() => null), labels)).toEqual([]);
    expect(service.offIntervalsFromCodes(labels.map(() => 3), labels)).toEqual([]);
  });
});


describe('extractMirrorSlots на живому форматі', () => {
  test('розгортає body-рядок, бере свою область і мапит усі черги/дати', () => {
    const raw = { body: JSON.stringify(innerPayload()), timestamp: '2026-10-10T12:00:00.000Z' };
    const schedule = service.parseMirrorSchedule(raw, 'chernihivska-oblast', 1_700_000_000_000);

    expect(schedule.sourceTimestamp).toBe('2026-10-10T12:00:00.000Z');
    expect(schedule.regionCpu).toBe('chernihivska-oblast');

    // Київська область у фікстурі є, але ми беремо лише свою — слота черги '1' тут бути не має.
    expect(schedule.slots.map((slot) => `${slot.queue}|${slot.date}`).sort()).toEqual([
      '2/2|2026-10-10',
      '2/2|2026-10-11',
      '3|2026-10-10',
    ]);

    const morning = schedule.slots.find((slot) => slot.queue === '2/2' && slot.date === '2026-10-10');
    expect(morning).toMatchObject({ timeFrom: '08:00', timeTo: '09:30' });

    const overnight = schedule.slots.find((slot) => slot.queue === '2/2' && slot.date === '2026-10-11');
    expect(overnight).toMatchObject({ timeFrom: '20:30', timeTo: '00:00' });

    // Кожен слот несе стан «відключення» — той самий, що й telegram-імпорт.
    for (const slot of schedule.slots) {
      expect(slot.stateCode).toBe(service.MIRROR_OFF_STATE.code);
      expect(slot.stateName).toBe('Відключення');
      expect(slot.stateColor).toBe('#E33535');
    }
  });

  test('невідома область — це 0 слотів, а не помилка', () => {
    const raw = { body: JSON.stringify(innerPayload()) };
    expect(service.parseMirrorSchedule(raw, 'lvivska-oblast').slots).toEqual([]);
  });

  test('працює і без обгортки body, і з data.regions', () => {
    expect(service.parseMirrorSchedule(innerPayload(), 'chernihivska-oblast').slots).toHaveLength(3);
    const nested = service.parseMirrorSchedule({ data: { regions: innerPayload()['regions'] } }, 'chernihivska-oblast');
    expect(nested.slots).toHaveLength(3);
  });

  test('чужий формат і битий JSON у body — зрозуміла помилка', () => {
    expect(() => service.parseMirrorSchedule('рядок')).toThrow(/неочікуваний формат/u);
    expect(() => service.parseMirrorSchedule({ body: '{не json' })).toThrow(/неочікуваний формат/u);
    expect(() => service.parseMirrorSchedule({ body: JSON.stringify({ timestamp: 'x' }) })).toThrow(/regions/u);
  });

  test('коди рядками приймаються нарівні з числами (джерела віддають по-різному)', () => {
    const payload = {
      regions: [{ cpu: 'chernihivska-oblast', schedule: { '2.2': { '2026-10-10': { '08:00': '2', '08:30': '2', '09:00': '1' } } } }],
    };
    expect(service.parseMirrorSchedule(payload, 'chernihivska-oblast').slots).toEqual([
      expect.objectContaining({ queue: '2/2', date: '2026-10-10', timeFrom: '08:00', timeTo: '09:00' }),
    ]);
  });
});

describe('стан «відключення» не розходиться з telegram-імпортом', () => {
  test('MIRROR_OFF_STATE === TELEGRAM_OFF_STATE, джерело = mirror', async () => {
    const telegram: TelegramService = await import('../../src/services/telegram-schedule.service.js');
    expect(service.MIRROR_OFF_STATE).toEqual(telegram.TELEGRAM_OFF_STATE);
    expect(service.MIRROR_SCHEDULE_SOURCE).toBe('mirror');
  });
});

describe('кеш payload: TTL, дедуплікація, stale-while-revalidate', () => {
  /** fetch із лічильником: жодного реального запиту в мережу. */
  const countingFetch = () => {
    const calls: number[] = [];
    const impl = (async () => {
      calls.push(calls.length + 1);
      return new Response(JSON.stringify({ body: JSON.stringify(innerPayload()) }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;
    return { impl, calls };
  };

  test('два виклики в межах TTL смикають дзеркало один раз', async () => {
    service.resetMirrorCache();
    const { impl, calls } = countingFetch();
    const t0 = Date.now();
    const first = await service.loadMirrorSchedule({ fetchImpl: impl, nowMs: t0 });
    const second = await service.loadMirrorSchedule({ fetchImpl: impl, nowMs: t0 + 1000 });
    expect(calls).toHaveLength(1);
    expect(second).toBe(first);
  });

  test('після TTL віддає знімок одразу і оновлює його у фоні', async () => {
    service.resetMirrorCache();
    const { impl, calls } = countingFetch();
    const warm = await service.loadMirrorSchedule({ fetchImpl: impl });
    expect(calls).toHaveLength(1);
    // `nowMs` на добу вперед гарантовано перевищує будь-який TTL: кеш прострочений.
    const stale = await service.loadMirrorSchedule({ fetchImpl: impl, nowMs: Date.now() + 24 * 60 * 60 * 1000 });
    // Прострочений знімок віддано негайно, а свіжий запит пішов у фон (не чекаючи мережі).
    expect(stale).toBe(warm);
    expect(calls).toHaveLength(2);
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Кеш справді замінився свіжим знімком, а не лишився старим.
    const refreshed = await service.loadMirrorSchedule({ fetchImpl: impl });
    expect(refreshed).not.toBe(warm);
    expect(refreshed.slots).toHaveLength(3);
  });

  test('дзеркало недоступне і кешу немає — честна помилка, а не порожній графік', async () => {
    service.resetMirrorCache();
    const failing = (async () => {
      throw new Error('ETIMEDOUT');
    }) as unknown as typeof fetch;
    await expect(service.loadMirrorSchedule({ fetchImpl: failing })).rejects.toThrow(/збереженого знімка немає/u);
  });

  test('після збою є пауза: наступний запит не чекає на мережу', async () => {
    service.resetMirrorCache();
    let calls = 0;
    const failing = (async () => {
      calls += 1;
      throw new Error('ETIMEDOUT');
    }) as unknown as typeof fetch;
    await expect(service.loadMirrorSchedule({ fetchImpl: failing })).rejects.toThrow(/недоступне/u);
    await expect(service.loadMirrorSchedule({ fetchImpl: failing })).rejects.toThrow(/пауза після збою/u);
    expect(calls).toBe(1);
    // Коли пауза спливла — пробуємо знову (і, якщо дзеркало ожило, кеш прогрівається).
    const { impl } = countingFetch();
    const recovered = await service.loadMirrorSchedule({
      fetchImpl: impl,
      nowMs: Date.now() + service.MIRROR_FAILURE_BACKOFF_MS + 1,
    });
    expect(recovered.slots).toHaveLength(3);
  });

  test('дзеркало впало після прогріву — віддається збережений знімок (сторінка не падає)', async () => {
    service.resetMirrorCache();
    const { impl } = countingFetch();
    await service.loadMirrorSchedule({ fetchImpl: impl, nowMs: 1_700_000_000_000 });
    const failing = (async () => {
      throw new Error('ETIMEDOUT');
    }) as unknown as typeof fetch;
    const schedule = await service.loadMirrorSchedule({ fetchImpl: failing, force: true });
    expect(schedule.slots).toHaveLength(3);
  });
});

