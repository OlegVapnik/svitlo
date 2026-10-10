/**
 * Юніт-тести для мультирегіонального дзеркала ГПВ (без мережі, без БД).
 *
 * Перевіряють інваріанти роботи сервісу mirror-schedule.service з кількома областями:
 * 1. Один мережевий запит (payload) обслуговує запити до різних областей без змішування черг.
 * 2. regionsFromPayload коректно зберігає cpu та name_ua, дедуплікує cpu, підставляє fallback та ігнорує сміття.
 * 3. queueCodesOfRegion правильно сортує коди ('1/1', '2/2'), включає черги без відключень (коди 0/1) та підтримує компактний формат.
 * 4. loadMirrorSchedule для невідомої області повертає порожній знімок (без throw та без підміни графіка іншої області).
 * 5. Область за замовчуванням (без options.region) бере графік для env.MIRROR_SCHEDULE_REGION.
 * 6. resetMirrorCache очищає кеш та мемоізацію по областях, змушуючи наступний виклик робити новий запит.
 */
// config.ts читає process.env на імпорті, а DATABASE_URL обов'язковий — підставляємо фікстуру.
process.env['DATABASE_URL'] ??= 'postgresql://test:test@localhost:5432/test'; // scan:allow: фікстура теста
// Шум від pino у виводі тестів не потрібен.
process.env['LOG_LEVEL'] ??= 'silent';

import { beforeAll, beforeEach, describe, expect, test } from 'vitest';

type Service = typeof import('../../src/services/mirror-schedule.service.js');
type Config = typeof import('../../src/config.js');

let service: Service;
let config: Config;

/**
 * Власна фікстура тестового payload дзеркала з двома областями.
 * Чернігівська: черги 2.2 (відключення 09:00-10:00) та 3 (відключення 12:00-12:30).
 * Київська: черги 1.1 (відключення 14:00-15:00) та 4.2 (відключення 18:00-18:30).
 */
function createMultiRegionFixture(): Record<string, unknown> {
  return {
    date_today: '2026-10-11',
    date_tomorrow: '2026-10-12',
    regions: [
      {
        cpu: 'chernihivska-oblast',
        name_ua: 'Чернігівська область',
        schedule: {
          '2.2': {
            '2026-10-11': {
              '09:00': 2,
              '09:30': 2,
              '10:00': 1,
            },
          },
          '3': {
            '2026-10-11': {
              '12:00': 2,
              '12:30': 1,
            },
          },
        },
      },
      {
        cpu: 'kyivska-oblast',
        name_ua: 'Київська область',
        schedule: {
          '1.1': {
            '2026-10-11': {
              '14:00': 2,
              '14:30': 2,
              '15:00': 1,
            },
          },
          '4.2': {
            '2026-10-11': {
              '18:00': 2,
              '18:30': 1,
            },
          },
        },
      },
    ],
  };
}

/** Створює моковий fetch із підрахунком викликів, який повертає заданий payload. */
function createCountingFetch(payload: unknown = createMultiRegionFixture()): {
  fetchImpl: typeof fetch;
  getCallsCount: () => number;
} {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ body: JSON.stringify(payload), timestamp: '2026-10-11T08:00:00.000Z' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;

  return { fetchImpl, getCallsCount: () => calls };
}

beforeAll(async () => {
  service = await import('../../src/services/mirror-schedule.service.js');
  config = await import('../../src/config.js');
});

beforeEach(() => {
  service.resetMirrorCache();
});

describe('Мультирегіональне дзеркало ГПВ (mirror-regions)', () => {
  /**
   * WHY 1:
   * Дзеркало віддає один спільний знімок (220+ КБ) на всю Україну. Робити окремий HTTP-запит
   * на кожну область або на кожен перегляд сторінки неприпустимо (навантаження, Cloudflare WAF).
   * Кеш зобов'язаний за один виклик fetchImpl зберігати весь payload і задовольняти запити
   * для різних областей без нових HTTP-запитів. При цьому графіки областей мають бути строго
   * ізольовані: слоти Київської області ні за яких умов не повинні потрапляти в Чернігівську (no queue mixing).
   */
  test('1. two regions in one payload: один fetchImpl обслуговує обидві області без змішування черг', async () => {
    const { fetchImpl, getCallsCount } = createCountingFetch();

    // Перший виклик завантажує спільний payload і повертає графік Чернігівської області
    const chernihiv = await service.loadMirrorSchedule({ fetchImpl, region: 'chernihivska-oblast' });
    // Другий виклик для Київської області бере дані з уже закешованого payload
    const kyiv = await service.loadMirrorSchedule({ fetchImpl, region: 'kyivska-oblast' });

    // Інваріант: рівно один виклик мережі на обидві області
    expect(getCallsCount()).toBe(1);

    // Інваріант: Чернігівська область має виключно власні черги (2/2 та 3)
    expect(chernihiv.regionCpu).toBe('chernihivska-oblast');
    const chernihivQueues = chernihiv.slots.map((s) => s.queue);
    expect(chernihivQueues).toContain('2/2');
    expect(chernihivQueues).toContain('3');
    expect(chernihivQueues).not.toContain('1/1');
    expect(chernihivQueues).not.toContain('4/2');

    // Інваріант: Київська область має виключно власні черги (1/1 та 4/2)
    expect(kyiv.regionCpu).toBe('kyivska-oblast');
    const kyivQueues = kyiv.slots.map((s) => s.queue);
    expect(kyivQueues).toContain('1/1');
    expect(kyivQueues).toContain('4/2');
    expect(kyivQueues).not.toContain('2/2');
    expect(kyivQueues).not.toContain('3');

    // Перевіряємо деталі інтервалів для ізольованих черг
    expect(chernihiv.slots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ queue: '2/2', timeFrom: '09:00', timeTo: '10:00' }),
        expect.objectContaining({ queue: '3', timeFrom: '12:00', timeTo: '12:30' }),
      ]),
    );
    expect(kyiv.slots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ queue: '1/1', timeFrom: '14:00', timeTo: '15:00' }),
        expect.objectContaining({ queue: '4/2', timeFrom: '18:00', timeTo: '18:30' }),
      ]),
    );
  });

  /**
   * WHY 2:
   * Ендпоінт GET /api/v1/regions формує каталог доступних областей на основі regionsFromPayload.
   * Зовнішнє дзеркало може надсилати брудні дані: не-об'єкти, записи без cpu, дублікати областей
   * або записи з відсутнім чи порожнім name_ua. API не має падати чи вигадувати назви:
   * валідні cpu+name_ua зберігаються, дублікати дедуплікуються, відсутній name_ua замінюється на cpu,
   * а все сміття відсікається.
   */
  test('2. regionsFromPayload: зберігає cpu + name_ua, fallback на cpu, дедуплікація та ігнорування сміття', () => {
    const dirtyPayload: Record<string, unknown> = {
      regions: [
        // Валідний запис
        { cpu: 'chernihivska-oblast', name_ua: 'Чернігівська область' },
        // name_ua відсутній -> fallback на cpu
        { cpu: 'poltavska-oblast' },
        // name_ua порожній або з пробілів -> fallback на cpu
        { cpu: 'odeska-oblast', name_ua: '   ' },
        // name_ua null або не рядок -> fallback на cpu
        { cpu: 'sumska-oblast', name_ua: null },
        { cpu: 'kharkivska-oblast', name_ua: 12345 },
        // Дублікат cpu -> дедуплікується
        { cpu: 'chernihivska-oblast', name_ua: 'Чернігівська область (оновлена)' },
        // Сміття, яке має бути проігнороване:
        null,
        undefined,
        'не об`єкт',
        100,
        [],
        { name_ua: 'Запис без cpu' },
        { cpu: '', name_ua: 'Порожній cpu' },
        { cpu: '   ', name_ua: 'cpu лише з пробілів' },
        { cpu: 999, name_ua: 'Числовий cpu' },
      ],
    };

    const regions = service.regionsFromPayload(dirtyPayload);

    expect(regions).toEqual([
      { cpu: 'chernihivska-oblast', nameUa: 'Чернігівська область (оновлена)' },
      { cpu: 'poltavska-oblast', nameUa: 'poltavska-oblast' },
      { cpu: 'odeska-oblast', nameUa: 'odeska-oblast' },
      { cpu: 'sumska-oblast', nameUa: 'sumska-oblast' },
      { cpu: 'kharkivska-oblast', nameUa: 'kharkivska-oblast' },
    ]);
  });

  /**
   * WHY 3:
   * Користувач обирає чергу в інтерфейсі зі списку черг області (GET /api/v1/queues?region=...).
   * Список має бути відсортований за правилами черг ('1/1', '1/2', '2/1', '2/2', '10/1').
   * Критично: якщо в певний день у черги взагалі НЕМАЄ відключень (коди лише 0 або 1),
   * функція extractMirrorSlots повертає для неї 0 слотів. Але черга існує в енергосистемі,
   * і користувач мусить бачити її в списку!
   * Також перевіряємо компактний формат (масиви group + today), який підтримує Java-ядро.
   */
  test('3. queueCodesOfRegion: сортування черг, наявність черг без відключень (тільки 0/1) та компактний формат', () => {
    // 3.1. Формат із розкладом: черга 2.1 має лише світло (коди 0 і 1), але мусить бути у списку; сортування '1/1', '2/1', '2/2', '10/1'
    const schedulePayload: Record<string, unknown> = {
      regions: [
        {
          cpu: 'dnipropetrovska-oblast',
          name_ua: 'Дніпропетровська область',
          schedule: {
            // Ключі не по порядку
            '10.1': {
              '2026-10-11': { '08:00': 2, '08:30': 1 },
            },
            '2.2': {
              '2026-10-11': { '09:00': 2, '09:30': 1 },
            },
            // Черга з самими 0 та 1 — жодного відключення немає!
            '2.1': {
              '2026-10-11': { '00:00': 1, '06:00': 0, '12:00': 1, '18:00': 0 },
            },
            '1.1': {
              '2026-10-11': { '10:00': 2, '10:30': 1 },
            },
            // Некоректний ключ черги — ігнорується
            invalid_queue: {
              '2026-10-11': { '00:00': 2 },
            },
          },
        },
      ],
    };

    const queues = service.queueCodesOfRegion(schedulePayload, 'dnipropetrovska-oblast');
    // Відсортовано за логікою compareQueueCodes ('1/1', '2/1', '2/2', '10/1'), включаючи чергу без відключень '2/1'
    expect(queues).toEqual(['1/1', '2/1', '2/2', '10/1']);

    // 3.2. Компактний формат: масив today (48 півгодинних значень) та ключ group
    const compactPayload: Record<string, unknown> = {
      date_today: '2026-10-11',
      regions: [
        {
          cpu: 'lvivska-oblast',
          name_ua: 'Львівська область',
          group: '3.2',
          today: Array.from({ length: 48 }, () => 1), // Всі 48 комірок — світло є (код 1)
        },
      ],
    };

    const compactQueues = service.queueCodesOfRegion(compactPayload, 'lvivska-oblast');
    expect(compactQueues).toEqual(['3/2']);
  });

  /**
   * WHY 4:
   * Згідно з контрактом /tmp/API-CONTRACT-regions.md:
   * «невідома область НЕ 400: віддаємо порожній графік (intervals: [], source: null) — так само,
   * як зараз поводиться невідома черга (нагадування: вигаданого графіка не існує)».
   * loadMirrorSchedule для невідомої області зобов'язаний повернути валідний MirrorSchedule
   * з порожнім масивом слотів, а НЕ викидати виключення і НЕ підсовувати графік іншої області.
   */
  test('4. loadMirrorSchedule({region}) для невідомої області повертає порожній знімок (без помилки чи підміни)', async () => {
    const { fetchImpl, getCallsCount } = createCountingFetch();

    const snapshot = await service.loadMirrorSchedule({ fetchImpl, region: 'non-existent-oblast' });

    expect(getCallsCount()).toBe(1);
    expect(snapshot).toMatchObject({
      regionCpu: 'non-existent-oblast',
      slots: [],
    });
    expect(snapshot.slots).toHaveLength(0);
  });

  /**
   * WHY 5:
   * Зворотна сумісність: існуючі виклики та старі клієнти API не передають параметр region.
   * За контрактом, якщо region не вказано, сервіс повинен за замовчуванням повертати графік
   * для env.MIRROR_SCHEDULE_REGION (типово chernihivska-oblast).
   */
  test('5. default region: виклик без region повертає слоти для env.MIRROR_SCHEDULE_REGION', async () => {
    const { fetchImpl } = createCountingFetch();

    const defaultRegion = config.env.MIRROR_SCHEDULE_REGION;
    const defaultSchedule = await service.loadMirrorSchedule({ fetchImpl });

    expect(defaultSchedule.regionCpu).toBe(defaultRegion);
    expect(defaultSchedule.slots.length).toBeGreaterThan(0);
    // У нашій фікстурі chernihivska-oblast має черги 2/2 та 3, і не має черг з Київської області
    const queues = defaultSchedule.slots.map((s) => s.queue);
    expect(queues).toContain('2/2');
    expect(queues).not.toContain('1/1');
  });

  /**
   * WHY 6:
   * Сервіс тримає в пам'яті кеш загального payload та мемоізовані графіки для кожної області (scheduleByRegion).
   * resetMirrorCache повинен повністю очищати як payload, так і мемо по областях.
   * Наступний виклик після resetMirrorCache зобов'язаний знову звертатися до джерела через fetchImpl
   * та повертати новий об'єкт знімка, а не старий закешований екземпляр.
   */
  test('6. resetMirrorCache очищає кеш та мемоізацію по областях (наступний виклик знову виконує fetch)', async () => {
    const { fetchImpl, getCallsCount } = createCountingFetch();

    // 1. Первинне завантаження для Київської області
    const firstKyiv = await service.loadMirrorSchedule({ fetchImpl, region: 'kyivska-oblast' });
    expect(getCallsCount()).toBe(1);

    // 2. Повторний виклик у межах кешу повертає той самий об'єкт (memo) без додаткового HTTP-запиту
    const memoKyiv = await service.loadMirrorSchedule({ fetchImpl, region: 'kyivska-oblast' });
    expect(getCallsCount()).toBe(1);
    expect(memoKyiv).toBe(firstKyiv);

    // 3. Скидаємо кеш
    service.resetMirrorCache();

    // 4. Наступний виклик для Київської області зобов'язаний знову викликати fetchImpl
    const refreshedKyiv = await service.loadMirrorSchedule({ fetchImpl, region: 'kyivska-oblast' });
    expect(getCallsCount()).toBe(2);
    // Новий знімок є новим об'єктом за посиланням
    expect(refreshedKyiv).not.toBe(firstKyiv);
    expect(refreshedKyiv.slots).toEqual(firstKyiv.slots);

    // 5. Перевірка, що мемо скинуто і для іншої області: Чернігівська бере дані з нового кешу
    const refreshedChernihiv = await service.loadMirrorSchedule({ fetchImpl, region: 'chernihivska-oblast' });
    // fetchImpl не викликається втретє, оскільки кеш уже оновлено на кроці 4
    expect(getCallsCount()).toBe(2);
    expect(refreshedChernihiv.regionCpu).toBe('chernihivska-oblast');
  });
});
