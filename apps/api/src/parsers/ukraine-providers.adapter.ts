import { z } from 'zod';

// ============================================================================
// 1. ЕДИНЫЕ ТИПЫ ДАННЫХ SVITLO (Совместимые с outage_events и schedule_slots)
// ============================================================================

export type OutageCategory = 'emergency' | 'repair' | 'regime' | 'planned' | 'other';
export type SlotStateCode = 1 | 2 | 3; // 1 = свет есть, 2 = возможно отключение, 3 = отключение

export interface ParsedOutageRecord {
  provider: 'chernihiv' | 'dtek-kem' | 'yasno';
  regionCpu: string;
  externalId: string;
  settlement: string;
  street: string;
  houseNumbers: string;
  startsAt: Date;
  endsAt: Date | null;
  reason: string;
  category: OutageCategory;
  queue: string | null;
}

export interface ParsedScheduleSlot {
  provider: 'chernihiv' | 'dtek-kem' | 'yasno';
  regionCpu: string;
  queue: string;       // Формат Svitlo: "1/1" ... "6/2" или "1" ... "6"
  date: string;        // YYYY-MM-DD (Europe/Kyiv)
  timeFrom: string;    // HH:MM
  timeTo: string;      // HH:MM
  stateCode: SlotStateCode;
  stateName: string;
  stateColor: string;
}

export interface StreetQueueMapping {
  provider: 'chernihiv' | 'dtek-kem' | 'yasno';
  regionCpu: string;
  settlement: string;
  street: string;
  houseNumber?: string;
  queue: string;
  activeOutage?: {
    reason: string;
    startsAt?: string;
    endsAt?: string;
  } | null;
}

export interface ProviderFetchResult {
  provider: string;
  regionCpu: string;
  outages: ParsedOutageRecord[];
  scheduleSlots: ParsedScheduleSlot[];
  gridMessage?: string;
  fetchedAt: Date;
}

// ============================================================================
// 2. ОБЩИЕ УТИЛИТЫ (Время Киева, User-Agent, Ретраи, Нормализация очередей)
// ============================================================================

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export function normalizeQueueCode(raw: string): string {
  const cleaned = raw.trim().replace(/^черга\s*/i, '').replace(/^група\s*/i, '');
  // Приводим "2.2" или "2-2" к каноническому формату Svitlo "2/2"
  return cleaned.replace(/[.-]/g, '/');
}

export function classifyReason(reason: string, rawType?: number): OutageCategory {
  if (rawType === 2 || /аварійн/i.test(reason)) return 'emergency';
  if (rawType === 6 || /заходи обмеження|гпв|гав|стабілізаційн/i.test(reason)) return 'regime';
  if (rawType === 1 || /ремонт|технічн|обслуговуван|планов/i.test(reason)) return 'repair';
  return 'other';
}

export function parseKyivDateTime(raw: string): Date {
  // Поддержка "YYYY-MM-DD HH:mm(:ss)" и "DD.MM.YYYY HH:mm" в часовом поясе Europe/Kyiv
  const trimmed = raw.trim();
  let isoBase = trimmed;

  const dmyMatch = /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}:\d{2})(?::(\d{2}))?/.exec(trimmed);
  if (dmyMatch) {
    const [, dd, mm, yyyy, hhmm, ss] = dmyMatch;
    isoBase = `${yyyy}-${mm}-${dd}T${hhmm}:${ss ?? '00'}`;
  } else if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(trimmed)) {
    isoBase = trimmed.replace(/\s+/, 'T');
    if (isoBase.length === 16) isoBase += ':00';
  }

  // Вычисляем смещение Europe/Kyiv для конкретной даты (учёт зимнего +02:00 и летнего +03:00 времени)
  const probe = new Date(`${isoBase}Z`);
  const kyivString = probe.toLocaleString('en-US', { timeZone: 'Europe/Kyiv', hour12: false });
  const kyivDate = new Date(`${kyivString} GMT`);
  const offsetMinutes = Math.round((kyivDate.getTime() - probe.getTime()) / 60000);
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absH = String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(2, '0');
  const absM = String(Math.abs(offsetMinutes) % 60).padStart(2, '0');

  return new Date(`${isoBase}${sign}${absH}:${absM}`);
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options: { retries?: number; timeoutMs?: number } = {},
): Promise<Response> {
  const retries = options.retries ?? 2;
  const timeoutMs = options.timeoutMs ?? 15000;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);
      // 403 / 429 (WAF блок) не ретраим, чтобы не усугублять бан
      if (response.status === 403 || response.status === 429) {
        return response;
      }
      if (response.status >= 500 && attempt < retries) {
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        continue;
      }
      return response;
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Fetch failed for ${url}`);
}

function extractCookies(headers: Headers): string {
  const rawCookies =
    typeof (headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === 'function'
      ? (headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
      : [headers.get('set-cookie') ?? ''].filter(Boolean);

  return rawCookies
    .map((c) => c.split(';')[0]?.trim())
    .filter(Boolean)
    .join('; ');
}

// ============================================================================
// 3. ПАРСЕР 1: YASNO (https://yasno.ua/) — Графики ГПВ и поиск групп по улицам
// ============================================================================

const yasnoSlotSchema = z.object({
  start: z.number(), // часы, например 8 или 8.5 (8:30)
  end: z.number(),   // часы, например 12 или 24
  type: z.string(),  // 'DEFINITE_OUTAGE' | 'POSSIBLE_OUTAGE' | ...
});

export interface YasnoAdapterOptions {
  scheduleApiUrl?: string;
  regions?: Array<{ yasnoRegionKey: string; regionCpu: string }>;
}

export class YasnoScheduleAdapter {
  private readonly apiUrl: string;
  private readonly regions: Array<{ yasnoRegionKey: string; regionCpu: string }>;

  constructor(opts: YasnoAdapterOptions = {}) {
    this.apiUrl =
      opts.scheduleApiUrl ??
      'https://api.yasno.com.ua/api/v1/pages/home/schedule-turn-off-electricity';
    this.regions = opts.regions ?? [
      { yasnoRegionKey: 'kiev', regionCpu: 'kyiv-city' },
      { yasnoRegionKey: 'dnipro', regionCpu: 'dnipropetrovska-oblast' },
    ];
  }

  private hoursToHHMM(val: number): string {
    if (val >= 24) return '00:00';
    const whole = Math.floor(val);
    const mins = Math.round((val - whole) * 60);
    return `${String(whole).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  }

  async fetchSchedules(): Promise<ParsedScheduleSlot[]> {
    const res = await fetchWithRetry(this.apiUrl, {
      method: 'GET',
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'application/json, text/plain, */*',
        Referer: 'https://yasno.ua/',
      },
    });

    if (!res.ok) {
      throw new Error(`[yasno] HTTP ${res.status} from ${this.apiUrl}`);
    }

    const payload = (await res.json()) as Record<string, unknown>;
    const components = Array.isArray(payload?.components) ? payload.components : [];
    const scheduleComp = components.find(
      (c: Record<string, unknown>) =>
        c?.template_name === 'electricity-outages-daily-schedule' ||
        c?.template_name === 'electricity-outages-schedule' ||
        c?.dailySchedule != null ||
        c?.schedule != null,
    ) as Record<string, unknown> | undefined;

    if (!scheduleComp) {
      return [];
    }

    const dailyRoot = (scheduleComp.dailySchedule ?? scheduleComp.schedule ?? {}) as Record<
      string,
      unknown
    >;
    const results: ParsedScheduleSlot[] = [];

    for (const { yasnoRegionKey, regionCpu } of this.regions) {
      const regionBlock = dailyRoot[yasnoRegionKey] as Record<string, unknown> | undefined;
      if (!regionBlock) continue;

      // В YASNO внутри региона лежат ключи today / tomorrow с датой и группами (group_1.1 ... group_6.2)
      for (const dayBucketKey of ['today', 'tomorrow']) {
        const dayObj = regionBlock[dayBucketKey] as Record<string, unknown> | undefined;
        if (!dayObj) continue;

        const rawDate = typeof dayObj.date === 'string' ? dayObj.date.slice(0, 10) : null;
        const groupsObj = (dayObj.groups ?? dayObj) as Record<string, unknown>;
        if (!rawDate || !groupsObj || typeof groupsObj !== 'object') continue;

        for (const [groupKey, rawSlots] of Object.entries(groupsObj)) {
          if (!Array.isArray(rawSlots)) continue;
          const queue = normalizeQueueCode(groupKey.replace(/^group_/i, ''));

          for (const rawSlot of rawSlots) {
            const parsed = yasnoSlotSchema.safeParse(rawSlot);
            if (!parsed.success) continue;

            const isDefinite = parsed.data.type === 'DEFINITE_OUTAGE';
            const isPossible = parsed.data.type === 'POSSIBLE_OUTAGE';
            if (!isDefinite && !isPossible) continue;

            results.push({
              provider: 'yasno',
              regionCpu,
              queue,
              date: rawDate,
              timeFrom: this.hoursToHHMM(parsed.data.start),
              timeTo: this.hoursToHHMM(parsed.data.end),
              stateCode: isDefinite ? 3 : 2,
              stateName: isDefinite ? 'Відключення' : 'Можливе відключення',
              stateColor: isDefinite ? '#E33535' : '#F59E0B',
            });
          }
        }
      }
    }

    return results;
  }
}

// ============================================================================
// 4. ПАРСЕР 2: ДТЕК КЕМ (https://www.dtek-kem.com.ua/ua)
//    Парсит встроенный DisconSchedule.fact/preset + AJAX по улицам и домам
// ============================================================================

export interface DtekKemOptions {
  baseUrl?: string;
  regionCpu?: string;
  cookieHeader?: string; // Опционально: куки сессии (Incapsula/Cloudflare), если заданы в .env
}

interface DtekAjaxHomeInfo {
  sub_type?: string;   // Причина/тип отключения ("Екстрені відключення", "Планові роботи" и т.д.)
  start_date?: string; // Время начала
  end_date?: string;   // Время завершения
  type?: string;       // Код типа
  sub_type_reason?: string[]; // Массив кодов групп ГПВ, например ["GPV2.1"]
}

export class DtekKemAdapter {
  private readonly baseUrl: string;
  private readonly regionCpu: string;
  private cookieJar: string;
  private csrfToken: string | null = null;

  constructor(opts: DtekKemOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? 'https://www.dtek-kem.com.ua').replace(/\/$/, '');
    this.regionCpu = opts.regionCpu ?? 'kyiv-city';
    this.cookieJar = opts.cookieHeader ?? process.env.DTEK_KEM_COOKIES ?? '';
  }

  /**
   * Загружает /ua/shutdowns, обновляет CSRF-токен и куки, а также вытаскивает
   * DisconSchedule.fact (реальные графики на сегодня/завтра) из <script>
   */
  async fetchShutdownsPageAndSchedules(): Promise<{
    slots: ParsedScheduleSlot[];
    streetsDictionary: Record<string, string[]>;
  }> {
    const url = `${this.baseUrl}/ua/shutdowns`;
    const res = await fetchWithRetry(url, {
      method: 'GET',
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'uk-UA,uk;q=0.9',
        ...(this.cookieJar ? { Cookie: this.cookieJar } : {}),
      },
    });

    const newCookies = extractCookies(res.headers);
    if (newCookies) {
      this.cookieJar = [this.cookieJar, newCookies].filter(Boolean).join('; ');
    }

    if (!res.ok) {
      throw new Error(`[dtek-kem] HTTP ${res.status} on GET /ua/shutdowns`);
    }

    const html = await res.text();

    // 1. Вытаскиваем <meta name="csrf-token" content="..."> для последующих POST /ua/ajax
    const csrfMatch =
      /<meta\s+name=["']csrf-token["']\s+content=["']([^"']+)["']/i.exec(html) ??
      /<meta\s+content=["']([^"']+)["']\s+name=["']csrf-token["']/i.exec(html);
    if (csrfMatch?.[1]) {
      this.csrfToken = csrfMatch[1];
    }

    // 2. Извлекаем DisconSchedule.fact = {...} (реальное расписание на сегодня и завтра по группам)
    const slots: ParsedScheduleSlot[] = [];
    const factMatch = /DisconSchedule\.fact\s*=\s*(\{[\s\S]*?\})\s*(?:;|<\/script>|DisconSchedule\.)/.exec(
      html,
    );

    if (factMatch?.[1]) {
      try {
        const factJson = JSON.parse(factMatch[1]) as {
          data?: Record<string, Record<string, Record<string, string>>>;
        };
        const dataByTimestamp = factJson.data ?? {};

        for (const [unixTsStr, groupsMap] of Object.entries(dataByTimestamp)) {
          const tsSec = Number(unixTsStr);
          if (!Number.isFinite(tsSec) || !groupsMap || typeof groupsMap !== 'object') continue;

          // Переводим unix timestamp начала суток в дату YYYY-MM-DD по Киеву
          const dateKyiv = new Date(tsSec * 1000).toLocaleDateString('en-CA', {
            timeZone: 'Europe/Kyiv',
          });

          for (const [rawGroupKey, hoursMap] of Object.entries(groupsMap)) {
            const queue = normalizeQueueCode(rawGroupKey.replace(/^GPV/i, ''));
            slots.push(...this.convertDtekHoursToSlots(queue, dateKyiv, hoursMap));
          }
        }
      } catch {
        // Если формат JSON внутри тега изменился — не роняем весь парсер
      }
    }

    // 3. Извлекаем DisconSchedule.streets (справочник улиц, если встроен в страницу)
    let streetsDictionary: Record<string, string[]> = {};
    const streetsMatch =
      /DisconSchedule\.streets\s*=\s*(\{[\s\S]*?\})\s*(?:;|<\/script>|DisconSchedule\.)/.exec(html);
    if (streetsMatch?.[1]) {
      try {
        streetsDictionary = JSON.parse(streetsMatch[1]);
      } catch {
        streetsDictionary = {};
      }
    }

    return { slots, streetsDictionary };
  }

  /**
   * Конвертирует почасовую сетку ДТЕК (ключи "1".."24", значения:
   * "yes" = свет есть, "no" = отключение весь час, "first" = первые 30 мин,
   * "second" = вторые 30 мин, "maybe" / "mfirst" / "msecond" = возможное)
   */
  private convertDtekHoursToSlots(
    queue: string,
    date: string,
    hoursMap: Record<string, string>,
  ): ParsedScheduleSlot[] {
    // Строим массив из 48 получасовых ячеек (0 = свет есть, 3 = отключение, 2 = возможно)
    const halfHours: Array<0 | 2 | 3> = new Array(48).fill(0);

    for (let hourIndex = 1; hourIndex <= 24; hourIndex++) {
      const state = (hoursMap[String(hourIndex)] ?? 'yes').toLowerCase();
      const firstHalfIdx = (hourIndex - 1) * 2;
      const secondHalfIdx = firstHalfIdx + 1;

      if (state === 'no') {
        halfHours[firstHalfIdx] = 3;
        halfHours[secondHalfIdx] = 3;
      } else if (state === 'first') {
        halfHours[firstHalfIdx] = 3;
      } else if (state === 'second') {
        halfHours[secondHalfIdx] = 3;
      } else if (state === 'maybe') {
        halfHours[firstHalfIdx] = 2;
        halfHours[secondHalfIdx] = 2;
      } else if (state === 'mfirst') {
        halfHours[firstHalfIdx] = 2;
      } else if (state === 'msecond') {
        halfHours[secondHalfIdx] = 2;
      }
    }

    // Склеиваем соседние получасовки одинакового состояния в интервалы
    const merged: ParsedScheduleSlot[] = [];
    let i = 0;
    while (i < 48) {
      const code = halfHours[i];
      if (code === 0) {
        i++;
        continue;
      }
      let j = i + 1;
      while (j < 48 && halfHours[j] === code) {
        j++;
      }

      const fromHH = String(Math.floor(i / 2)).padStart(2, '0');
      const fromMM = i % 2 === 0 ? '00' : '30';
      const toHH = j === 48 ? '00' : String(Math.floor(j / 2)).padStart(2, '0');
      const toMM = j === 48 ? '00' : j % 2 === 0 ? '00' : '30';

      merged.push({
        provider: 'dtek-kem',
        regionCpu: this.regionCpu,
        queue,
        date,
        timeFrom: `${fromHH}:${fromMM}`,
        timeTo: `${toHH}:${toMM}`,
        stateCode: code,
        stateName: code === 3 ? 'Відключення' : 'Можливе відключення',
        stateColor: code === 3 ? '#E33535' : '#F59E0B',
      });

      i = j;
    }

    return merged;
  }

  /**
   * Запрос к POST /ua/ajax (method: getHomeNum) для получения групп ГПВ и текущих аварий
   * по всем домам конкретной улицы (для наполнения street_queues и outage_events)
   */
  async fetchStreetHousesAndOutages(
    streetName: string,
    settlementName = 'м. Київ',
  ): Promise<{ mappings: StreetQueueMapping[]; outages: ParsedOutageRecord[] }> {
    if (!this.csrfToken) {
      await this.fetchShutdownsPageAndSchedules();
    }

    const body = new URLSearchParams();
    body.set('method', 'getHomeNum');
    body.set('data[0][name]', 'street');
    body.set('data[0][value]', streetName);

    const res = await fetchWithRetry(`${this.baseUrl}/ua/ajax`, {
      method: 'POST',
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        ...(this.csrfToken ? { 'X-CSRF-Token': this.csrfToken } : {}),
        ...(this.cookieJar ? { Cookie: this.cookieJar } : {}),
        Referer: `${this.baseUrl}/ua/shutdowns`,
      },
      body: body.toString(),
    });

    if (!res.ok) {
      throw new Error(`[dtek-kem] POST /ua/ajax failed with HTTP ${res.status}`);
    }

    const json = (await res.json()) as {
      result?: boolean;
      data?: Record<string, DtekAjaxHomeInfo>;
    };

    const housesMap = json?.data ?? {};
    const mappings: StreetQueueMapping[] = [];
    const outages: ParsedOutageRecord[] = [];

    for (const [houseNum, info] of Object.entries(housesMap)) {
      const rawGroup = info.sub_type_reason?.[0];
      const queue = rawGroup ? normalizeQueueCode(rawGroup.replace(/^GPV/i, '')) : null;

      if (queue) {
        mappings.push({
          provider: 'dtek-kem',
          regionCpu: this.regionCpu,
          settlement: settlementName,
          street: streetName,
          houseNumber: houseNum,
          queue,
          activeOutage:
            info.sub_type && info.start_date
              ? {
                  reason: info.sub_type,
                  startsAt: info.start_date,
                  endsAt: info.end_date,
                }
              : null,
        });
      }

      if (info.sub_type && info.start_date) {
        const startsAt = parseKyivDateTime(info.start_date);
        const endsAt = info.end_date ? parseKyivDateTime(info.end_date) : null;
        outages.push({
          provider: 'dtek-kem',
          regionCpu: this.regionCpu,
          externalId: `dtek-kem:${streetName}:${houseNum}:${startsAt.toISOString()}`,
          settlement: settlementName,
          street: streetName,
          houseNumbers: houseNum,
          startsAt,
          endsAt,
          reason: info.sub_type,
          category: classifyReason(info.sub_type),
          queue,
        });
      }
    }

    return { mappings, outages };
  }
}

// ============================================================================
// 5. ПАРСЕР 3: ЧЕРНІГІВОБЛЕНЕРГО (https://chernihivoblenergo.com.ua/)
//    Полный сбор: сёла/города (list_acc типы 1,2,6), графики ГПВ и очереди
// ============================================================================

export interface ChernihivFullAdapterOptions {
  baseUrl?: string;
  cityIds: string[];          // Коды населённых пунктов (КАТОТТГ/ID оператора, напр. ['7422288601', ...])
  outageTypes?: number[];     // По умолчанию [1, 2, 6] (1=плановые, 2=аварийные, 6=ГПВ)
  requestDelayMs?: number;    // Задержка между запросами для WAF-friendly работы
  turnstileToken?: string;    // Опциональный токен капчи для info_schedule_part / number_queue
}

export class ChernihivOblenergoFullAdapter {
  private readonly baseUrl: string;
  private readonly cityIds: string[];
  private readonly outageTypes: number[];
  private readonly requestDelayMs: number;
  private readonly turnstileToken?: string;
  private cookieJar = '';

  constructor(opts: ChernihivFullAdapterOptions) {
    if (!opts.cityIds || opts.cityIds.length === 0) {
      throw new Error(
        '[chernihiv] CHERNIHIV_CITY_IDS is empty! Specify at least one settlement ID.',
      );
    }
    this.baseUrl = (opts.baseUrl ?? 'https://chernihivoblenergo.com.ua').replace(/\/$/, '');
    this.cityIds = opts.cityIds;
    this.outageTypes = opts.outageTypes ?? [1, 2, 6];
    this.requestDelayMs = opts.requestDelayMs ?? 1200;
    this.turnstileToken = opts.turnstileToken ?? process.env.CHERNIHIV_TURNSTILE_TOKEN;
  }

  /**
   * Прогрев сессии на /power_outages с ретраем транзиентных ETIMEDOUT
   */
  async warmupSession(): Promise<void> {
    const res = await fetchWithRetry(
      `${this.baseUrl}/power_outages`,
      {
        method: 'GET',
        headers: {
          'User-Agent': BROWSER_UA,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'uk-UA,uk;q=0.9',
        },
      },
      { retries: 2, timeoutMs: 15000 },
    );

    if (res.status === 403 || res.status === 429) {
      throw new Error(`[chernihiv] Blocked by WAF during warmup: HTTP ${res.status}`);
    }

    const cookies = extractCookies(res.headers);
    if (cookies) {
      this.cookieJar = cookies;
    }
  }

  /**
   * Выгружает все плановые, аварийные и режимные отключения по сёлам и городам
   * через POST /api/list_acc
   */
  async fetchOutagesBySettlements(): Promise<ParsedOutageRecord[]> {
    await this.warmupSession();
    const records: ParsedOutageRecord[] = [];

    for (const cityId of this.cityIds) {
      for (const typeId of this.outageTypes) {
        if (this.requestDelayMs > 0) {
          await new Promise((r) => setTimeout(r, this.requestDelayMs));
        }

        const res = await fetchWithRetry(`${this.baseUrl}/api/list_acc`, {
          method: 'POST',
          headers: {
            'User-Agent': BROWSER_UA,
            Accept: 'application/json, text/javascript, */*; q=0.01',
            'Content-Type': 'application/json; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
            Referer: `${this.baseUrl}/power_outages`,
            ...(this.cookieJar ? { Cookie: this.cookieJar } : {}),
          },
          body: JSON.stringify({ city_id: cityId, type: typeId }),
        });

        if (res.status === 403 || res.status === 429) {
          throw new Error(
            `[chernihiv] WAF blocked POST /api/list_acc (HTTP ${res.status}) on cityId=${cityId}`,
          );
        }
        if (!res.ok) continue;

        const payload = (await res.json()) as {
          status?: string;
          aData?: unknown[][] | null;
        };

        const rows = Array.isArray(payload?.aData) ? payload.aData : [];
        for (const row of rows) {
          if (!Array.isArray(row) || row.length < 7) continue;

          // Структура строки list_acc: [0: НП/Село, 1: Вулиця, 2: Будинки, 3: Старт, 4: Кінець, 5: Створено, 6: Причина]
          const settlement = String(row[0] ?? '').trim();
          const street = String(row[1] ?? '').trim();
          const houseNumbers = String(row[2] ?? '').trim();
          const startRaw = String(row[3] ?? '').trim();
          const endRaw = String(row[4] ?? '').trim();
          const reason = String(row[6] ?? '').trim() || 'Відключення електроенергії';

          if (!startRaw) continue;
          const startsAt = parseKyivDateTime(startRaw);
          const endsAt = endRaw ? parseKyivDateTime(endRaw) : null;

          records.push({
            provider: 'chernihiv',
            regionCpu: 'chernihivska-oblast',
            externalId: `${cityId}:${typeId}:${street}:${houseNumbers}:${startsAt.toISOString()}:${endsAt?.toISOString() ?? 'open'}`,
            settlement,
            street,
            houseNumbers,
            startsAt,
            endsAt,
            reason,
            category: classifyReason(reason, typeId),
            queue: null,
          });
        }
      }
    }

    return records;
  }

  /**
   * Загружает почасовой график очереди (напр. "2/2") на дату YYYY-MM-DD.
   * Если передан turnstileToken — вызывает закрытый /api/info_schedule_part (реальные интервалы),
   * иначе пробует открытый /api/info_schedule.
   */
  async fetchQueueSchedule(
    queue: string,
    dateKyiv: string,
    turnstileToken = this.turnstileToken,
  ): Promise<ParsedScheduleSlot[]> {
    const endpoint = turnstileToken
      ? `${this.baseUrl}/api/info_schedule_part`
      : `${this.baseUrl}/api/info_schedule`;

    const res = await fetchWithRetry(endpoint, {
      method: 'POST',
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'application/json',
        'Content-Type': 'application/json; charset=UTF-8',
        Referer: `${this.baseUrl}/interruptions`,
        ...(this.cookieJar ? { Cookie: this.cookieJar } : {}),
      },
      body: JSON.stringify({
        queue,
        curr_dt: dateKyiv,
        ...(turnstileToken ? { token: turnstileToken } : {}),
      }),
    });

    if (!res.ok) {
      throw new Error(`[chernihiv] Schedule fetch HTTP ${res.status} on ${endpoint}`);
    }

    const payload = (await res.json()) as {
      status?: string;
      aData?: Array<{ from?: string; to?: string; state?: number | string }> | null;
      aState?: Record<string, { name?: string; bg?: string }>;
    };

    if (!Array.isArray(payload?.aData) || payload.aData.length === 0) {
      return [];
    }

    const stateDict = payload.aState ?? {};
    const slots: ParsedScheduleSlot[] = [];

    for (const item of payload.aData) {
      const timeFrom = String(item.from ?? '').trim();
      const timeTo = String(item.to ?? '').trim();
      const rawCode = Number(item.state ?? 3);
      if (!timeFrom || !timeTo) continue;

      const stateCode: SlotStateCode = rawCode === 1 ? 1 : rawCode === 2 ? 2 : 3;
      const meta = stateDict[String(rawCode)];

      slots.push({
        provider: 'chernihiv',
        regionCpu: 'chernihivska-oblast',
        queue: normalizeQueueCode(queue),
        date: dateKyiv,
        timeFrom,
        timeTo,
        stateCode,
        stateName:
          meta?.name ??
          (stateCode === 3
            ? 'Відключення'
            : stateCode === 2
              ? 'Можливе відключення'
              : 'Світло є'),
        stateColor: meta?.bg ?? (stateCode === 3 ? '#E33535' : stateCode === 2 ? '#F59E0B' : '#10B981'),
      });
    }

    return slots;
  }
}

// ============================================================================
// 6. ЕДИНЫЙ ОРКЕСТРАТОР ПАРСИНГА ВСЕХ ТРЁХ ИСТОЧНИКОВ
// ============================================================================

export async function runAllUkraineProviders(config: {
  chernihivCityIds: string[];
  dtekStreetsToProbe?: string[];
  chernihivTurnstileToken?: string;
  dtekCookies?: string;
}): Promise<{
  outages: ParsedOutageRecord[];
  scheduleSlots: ParsedScheduleSlot[];
  streetQueues: StreetQueueMapping[];
  errors: Array<{ provider: string; error: string }>;
}> {
  const outages: ParsedOutageRecord[] = [];
  const scheduleSlots: ParsedScheduleSlot[] = [];
  const streetQueues: StreetQueueMapping[] = [];
  const errors: Array<{ provider: string; error: string }> = [];

  // 1. YASNO (Графики ГПВ по областям присутствия)
  try {
    const yasno = new YasnoScheduleAdapter();
    const yasnoSlots = await yasno.fetchSchedules();
    scheduleSlots.push(...yasnoSlots);
  } catch (err) {
    errors.push({
      provider: 'yasno',
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // 2. ДТЕК КЕМ (Графики из DisconSchedule.fact + улицы/дома через AJAX)
  try {
    const dtek = new DtekKemAdapter({ cookieHeader: config.dtekCookies });
    const { slots: dtekSlots } = await dtek.fetchShutdownsPageAndSchedules();
    scheduleSlots.push(...dtekSlots);

    for (const street of config.dtekStreetsToProbe ?? []) {
      const { mappings, outages: streetOutages } = await dtek.fetchStreetHousesAndOutages(street);
      streetQueues.push(...mappings);
      outages.push(...streetOutages);
    }
  } catch (err) {
    errors.push({
      provider: 'dtek-kem',
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // 3. Чернігівобленерго (Сёла/города по list_acc типы 1, 2, 6 + ГПВ)
  try {
    const chernihiv = new ChernihivOblenergoFullAdapter({
      cityIds: config.chernihivCityIds,
      turnstileToken: config.chernihivTurnstileToken,
    });
    const chOutages = await chernihiv.fetchOutagesBySettlements();
    outages.push(...chOutages);
  } catch (err) {
    errors.push({
      provider: 'chernihiv',
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { outages, scheduleSlots, streetQueues, errors };
}