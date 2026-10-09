import { describe, expect, test } from 'vitest';
import {
  ChernihivWebAdapter,
  isConnectionAbortError,
  kyivWallClockToUtc,
  parseListAccRow,
  parseRetryAfter,
  type ListAccRow,
} from '../../src/parsers/chernihiv-web.adapter.js';
import { SourceBlockedError } from '../../src/parsers/source-errors.js';

const CITY_ID = '7422288601';

// Реальна форма відповіді /api/list_acc: [пункт, вулиця, будинки, старт, кінець, створено, причина, ...].
const SAMPLE: Record<number, { status: string; list: ListAccRow[] }> = {
  1: {
    status: '200',
    list: [
      ['ДЕСНЯНСЬКЕ', 'Деснянська', '115А', '2026-10-14T08:00:00', '2026-10-14T19:00:00', '17-09-2026', 'Виконання ремонтних робіт на повітряній лінії електропередачі', ''],
      ['ДЕСНЯНСЬКЕ', 'Зарічна', '19, 20, 43', '2026-10-16T08:00:00', '2026-10-16T17:00:00', '07-10-2026', 'Виконання ремонтних робіт на обладнанні підстанції (ПС, РП, ТП, КТП)', ''],
    ],
  },
  2: { status: '200', list: [] },
  6: {
    status: '200',
    list: [
      ['ДЕСНЯНСЬКЕ', 'Зарічна', '1, 2, 3, 43', '2026-10-07T17:30:00', '2026-10-07T21:00:00', '07-10-2026', 'Графік погодинних відключень (ГПВ)', ''],
    ],
  },
};

type StubCall = { method: string; url: string; headers: Record<string, string> };

// Імітує оператора: GET /power_outages віддає HTML + Set-Cookie, POST /api/list_acc — дані.
function makeStub(): { fetchImpl: typeof fetch; calls: StubCall[] } {
  const calls: StubCall[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push({ method, url: String(input), headers: (init?.headers ?? {}) as Record<string, string> });
    if (method === 'GET') {
      return new Response('<html></html>', {
        status: 200,
        headers: { 'content-type': 'text/html', 'set-cookie': 'waf_session=abc123; Path=/' },
      });
    }
    const body = JSON.parse(String(init?.body)) as { req_param: string };
    const params = JSON.parse(decodeURIComponent(body.req_param)) as { c: string; t: number };
    const payload = SAMPLE[params.t] ?? { status: '200', list: [] };
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe('анти-бот хелпери', () => {
  test('parseRetryAfter розуміє секунди, HTTP-дату та відсутність заголовка', () => {
    expect(parseRetryAfter('5')).toBe(5000);
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter('not-a-delay')).toBeNull();
    expect(parseRetryAfter(new Date(Date.now() + 3000).toUTCString())).toBeGreaterThan(0);
  });

  test('isConnectionAbortError розпізнає обрив з’єднання, але не загальний збій мережі', () => {
    expect(isConnectionAbortError(Object.assign(new TypeError('fetch failed'), { cause: { code: 'EPIPE' } }))).toBe(true);
    expect(isConnectionAbortError(Object.assign(new TypeError('fetch failed'), { cause: { code: 'UND_ERR_SOCKET' } }))).toBe(true);
    expect(isConnectionAbortError(Object.assign(new Error('ssl'), { code: 'ERR_SSL_WRONG_VERSION_NUMBER' }))).toBe(true);
    expect(isConnectionAbortError(new TypeError('fetch failed'))).toBe(false);
  });
});

describe('kyivWallClockToUtc', () => {
  test('treats the operator timestamp as Kyiv wall clock (DST-aware)', () => {
    // 2026-10-07 — літній час (EEST, UTC+3): 17:30 -> 14:30Z
    expect(kyivWallClockToUtc('2026-10-07T17:30:00').toISOString()).toBe('2026-10-07T14:30:00.000Z');
    // 2026-01-15 — зимовий час (EET, UTC+2): 08:00 -> 06:00Z
    expect(kyivWallClockToUtc('2026-01-15T08:00:00').toISOString()).toBe('2026-01-15T06:00:00.000Z');
  });

  test('returns Invalid Date for malformed input', () => {
    expect(Number.isNaN(kyivWallClockToUtc('не дата').getTime())).toBe(true);
  });
});

describe('parseListAccRow', () => {
  test('builds a normalized outage with reason, houses and UTC window', () => {
    const row = SAMPLE[6]!.list[0]!;
    const outage = parseListAccRow(row, 6, CITY_ID, 'https://example.test/power_outages');
    expect(outage).not.toBeNull();
    expect(outage!.startsAt.toISOString()).toBe('2026-10-07T14:30:00.000Z');
    expect(outage!.endsAt.toISOString()).toBe('2026-10-07T18:00:00.000Z');
    expect(outage!.areaName).toBe('Деснянське');
    expect(outage!.addressesRaw).toBe('вул. Зарічна 1, 2, 3, 43');
    expect(outage!.reason).toBe('Графік погодинних відключень (ГПВ)');
    expect(outage!.queue).toBeNull();
    expect(outage!.externalId).toContain(`${CITY_ID}:6:Зарічна`);
  });

  test('falls back to the type label when the operator omits a reason', () => {
    const outage = parseListAccRow(['ДЕСНЯНСЬКЕ', 'Миру', '5', '2026-10-07T09:00:00', '2026-10-07T12:00:00', '', ''], 1, CITY_ID, 'u');
    expect(outage!.reason).toBe('Планова перерва в електропостачанні');
  });

  test('skips rows without a parseable window', () => {
    expect(parseListAccRow(['ДЕСНЯНСЬКЕ', 'Миру', '5', '', ''], 1, CITY_ID, 'u')).toBeNull();
  });
});

describe('ChernihivWebAdapter', () => {
  const base = { baseUrl: 'https://example.test', cityIds: [CITY_ID] };

  test('fetches all configured city/type combinations and normalizes every row', async () => {
    const { fetchImpl } = makeStub();
    const adapter = new ChernihivWebAdapter(fetchImpl, { ...base, types: [1, 2, 6], requestDelayMs: 0 });
    const result = await adapter.fetch();
    expect(adapter.sourceUrl).toBe('https://example.test/power_outages');
    expect(result.gridLevel).toBe('stable');
    expect(result.outages).toHaveLength(3);

    const zarichnaGpv = result.outages.find((item) => item.reason === 'Графік погодинних відключень (ГПВ)');
    expect(zarichnaGpv).toBeDefined();
    expect(zarichnaGpv!.startsAt.toISOString()).toBe('2026-10-07T14:30:00.000Z');
    expect(zarichnaGpv!.endsAt.toISOString()).toBe('2026-10-07T18:00:00.000Z');
  });

  test('прогріває сесію (GET /power_outages) і перевикористовує cookie в API-запитах', async () => {
    const { fetchImpl, calls } = makeStub();
    const adapter = new ChernihivWebAdapter(fetchImpl, { ...base, types: [1], requestDelayMs: 0 });
    await adapter.fetch();

    expect(calls[0]!.method).toBe('GET');
    expect(calls[0]!.url).toBe('https://example.test/power_outages');
    const post = calls.find((call) => call.method === 'POST');
    expect(post).toBeDefined();
    expect(post!.headers.cookie).toBe('waf_session=abc123');
  });

  test('надсилає браузероподібні заголовки на API-запит', async () => {
    const { fetchImpl, calls } = makeStub();
    const adapter = new ChernihivWebAdapter(fetchImpl, { ...base, types: [1], requestDelayMs: 0 });
    await adapter.fetch();

    const post = calls.find((call) => call.method === 'POST')!;
    expect(post.headers.origin).toBe('https://example.test');
    expect(post.headers.referer).toBe('https://example.test/power_outages');
    expect(post.headers['sec-fetch-site']).toBe('same-origin');
    expect(post.headers['accept-language']).toContain('uk');
  });

  test('тримає паузу між запитами, щоб не «бомбити» оператора', async () => {
    const { fetchImpl, calls } = makeStub();
    const adapter = new ChernihivWebAdapter(fetchImpl, { ...base, types: [1, 6], requestDelayMs: 40 });
    const startedAt = Date.now();
    await adapter.fetch();
    const elapsed = Date.now() - startedAt;
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(2);
    expect(elapsed).toBeGreaterThanOrEqual(60);
  });

  test('reports warning grid level when emergency rows exist', async () => {
    const emergencyFetch = (async () =>
      new Response(JSON.stringify({ status: '200', list: [['ДЕСНЯНСЬКЕ', 'Миру', '1', '2026-10-07T09:00:00', '2026-10-07T12:00:00', '', 'Аварія', '']] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;
    const adapter = new ChernihivWebAdapter(emergencyFetch, { ...base, types: [2], requestDelayMs: 0, sessionWarmup: false });
    const result = await adapter.fetch();
    expect(result.gridLevel).toBe('warning');
  });

  test('перетворює аварійні перерви (type 2) на «аварії» з місцем, причиною та часом', async () => {
    const emergencyFetch = (async () =>
      new Response(
        JSON.stringify({
          status: '200',
          list: [['ДЕСНЯНСЬКЕ', 'Зарічна', '43', '2026-10-07T17:30:00', '2026-10-07T21:00:00', '07-10-2026', 'Аварійна перерва: пошкодження кабелю', '']],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as typeof fetch;
    const adapter = new ChernihivWebAdapter(emergencyFetch, { ...base, types: [2], requestDelayMs: 0, sessionWarmup: false });
    const result = await adapter.fetch();

    expect(result.incidents).toHaveLength(1);
    const incident = result.incidents[0]!;
    expect(incident.title).toContain('Аварійна перерва: пошкодження кабелю');
    expect(incident.title).toContain('Деснянське');
    expect(incident.description).toContain('вул. Зарічна');
    expect(incident.startedAt.toISOString()).toBe('2026-10-07T14:30:00.000Z');
    expect(incident.etaAt?.toISOString()).toBe('2026-10-07T18:00:00.000Z');
    expect(incident.severity).toBe('high');
    expect(incident.externalId).toContain('emergency:');
    expect(result.gridMessage).toContain('1');
  });

  test('throws when the operator returns a non-2xx status', async () => {
    const failing = (async () => new Response('nope', { status: 502 })) as typeof fetch;
    const adapter = new ChernihivWebAdapter(failing, { ...base, types: [1], retries: 0, requestDelayMs: 0, sessionWarmup: false });
    await expect(adapter.fetch()).rejects.toThrow(/HTTP 502/u);
  });

  test('retries transient network failures before succeeding', async () => {
    let calls = 0;
    const flaky = (async () => {
      calls += 1;
      if (calls === 1) throw new TypeError('fetch failed');
      return new Response(
        JSON.stringify({ status: '200', list: [['ДЕСНЯНСЬКЕ', 'Зарічна', '43', '2026-10-07T17:30:00', '2026-10-07T21:00:00', '', 'Графік погодинних відключень (ГПВ)', '']] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;
    const adapter = new ChernihivWebAdapter(flaky, { ...base, types: [6], retries: 2, retryDelayMs: 1, requestDelayMs: 0, sessionWarmup: false });
    const result = await adapter.fetch();
    expect(calls).toBe(2);
    expect(result.outages).toHaveLength(1);
  });

  test('НЕ ретраїтиме обрив з’єднання (WAF/TLS reset), щоб не погіршувати', async () => {
    let calls = 0;
    const aborted = (async () => {
      calls += 1;
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'UND_ERR_SOCKET' } });
    }) as typeof fetch;
    const adapter = new ChernihivWebAdapter(aborted, { ...base, types: [1], retries: 2, retryDelayMs: 1, requestDelayMs: 0, sessionWarmup: false });
    await expect(adapter.fetch()).rejects.toThrow(/connection aborted/u);
    expect(calls).toBe(1);
  });

  test('на 429 з Retry-After не чекає і не повторює: прогон зупиняється', async () => {
    let calls = 0;
    const limited = (async () => {
      calls += 1;
      return new Response('slow down', { status: 429, headers: { 'retry-after': '600' } });
    }) as typeof fetch;
    const adapter = new ChernihivWebAdapter(limited, { ...base, types: [1], retries: 2, retryDelayMs: 1, requestDelayMs: 0, sessionWarmup: false });
    const error = await adapter.fetch().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SourceBlockedError);
    expect((error as SourceBlockedError).kind).toBe('http_429');
    // Пауза из Retry-After уезжает наверх — её применяет circuit breaker, а не адаптер.
    expect((error as SourceBlockedError).retryAfterMs).toBe(600_000);
    expect(calls).toBe(1);
  });

  test('на 403 не повторює запрос и помечает источник как заблокированный', async () => {
    let calls = 0;
    const forbidden = (async () => {
      calls += 1;
      return new Response('forbidden', { status: 403 });
    }) as typeof fetch;
    const adapter = new ChernihivWebAdapter(forbidden, { ...base, types: [1], retries: 2, retryDelayMs: 1, requestDelayMs: 0, sessionWarmup: false });
    const error = await adapter.fetch().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SourceBlockedError);
    expect((error as SourceBlockedError).kind).toBe('http_403');
    expect((error as SourceBlockedError).retryAfterMs).toBeNull();
    expect(calls).toBe(1);
  });

  test('429 без Retry-After тоже не ретраится (раньше бил по WAF снова)', async () => {
    let calls = 0;
    const limited = (async () => {
      calls += 1;
      return new Response('slow down', { status: 429 });
    }) as typeof fetch;
    const adapter = new ChernihivWebAdapter(limited, { ...base, types: [1], retries: 2, retryDelayMs: 1, requestDelayMs: 0, sessionWarmup: false });
    const error = await adapter.fetch().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SourceBlockedError);
    expect((error as SourceBlockedError).kind).toBe('http_429');
    expect(calls).toBe(1);
  });

  test('таймаут не ретраится и классифицируется как таймаут', async () => {
    let calls = 0;
    const timingOut = (async () => {
      calls += 1;
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    }) as typeof fetch;
    const adapter = new ChernihivWebAdapter(timingOut, { ...base, types: [1], retries: 2, retryDelayMs: 1, requestDelayMs: 0, sessionWarmup: false });
    const error = await adapter.fetch().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SourceBlockedError);
    expect((error as SourceBlockedError).kind).toBe('timeout');
    expect(calls).toBe(1);
  });

  test('блок на первой порции останавливает прогон: остальные порции не запрашиваются', async () => {
    let calls = 0;
    const blocked = (async () => {
      calls += 1;
      return new Response('nope', { status: 403 });
    }) as typeof fetch;
    const adapter = new ChernihivWebAdapter(blocked, { ...base, types: [1, 2, 6], retries: 2, retryDelayMs: 1, requestDelayMs: 0, sessionWarmup: false });

    await expect(adapter.fetch()).rejects.toBeInstanceOf(SourceBlockedError);
    // 3 настроенные порции, но после блока — ни одного дополнительного запроса к оператору.
    expect(calls).toBe(1);
  });

  test('404 (не блок) не ретраится, но и не выдаёт себя за блок', async () => {
    let calls = 0;
    const notFound = (async () => {
      calls += 1;
      return new Response('gone', { status: 404 });
    }) as typeof fetch;
    const adapter = new ChernihivWebAdapter(notFound, { ...base, types: [1], retries: 2, retryDelayMs: 1, requestDelayMs: 0, sessionWarmup: false });

    await expect(adapter.fetch()).rejects.toThrow(/HTTP 404/u);
    expect(calls).toBe(1);
  });
});
