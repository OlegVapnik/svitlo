import type { ISourceAdapter, NormalizedIncident, NormalizedOutage, ParseResult } from './adapter.js';
import { titleCasePlace } from './place-name.js';
import { SourceBlockedError, SourceRequestError, isTimeoutError, type SourceBlockKind } from './source-errors.js';
import { mergeDuplicateOutages } from '../services/outage-grouping.js';


/**
 * Адаптер публічного веб-API АТ «Чернігівобленерго»
 * (сторінка https://chernihivoblenergo.com.ua/power_outages).
 *
 * Ендпоінт `POST /api/list_acc` повертає зареєстровані перерви в електропостачанні
 * без персональних даних (без ПІБ/рахунку) і НЕ захищений капчею:
 *   body:     { req_param: encodeURIComponent(JSON.stringify({ c: <cityId>, t: <type> })) }
 *   response: { status: '200', list: [[placement, street, houses, start, stop, created, reason, ...], ...] }
 *
 * Типи (t): 1 — планові перерви, 2 — аварійні, 6 — графіки обмеження (ГПВ).
 *
 * Для повноти: це не єдиний публічний шар оператора. Сторінка /blackouts вбудовує iframe з його ж
 * піддомену https://interruptions.energy.cn.ua/interruptions, чий JS звертається до (перевірено 10.10.2026):
 *   POST /api/code_review    { old_account?, eic? }     → ПД: адреса, ЕІС, meter_id (без капчі; ПД — обережно);
 *   POST /api/number_queue/  { search_param, token }    → номер черги ГПВ за рахунком — ЗА Cloudflare Turnstile;
 *   POST /api/info_schedule  { queue, curr_dt }         → 200 `status: ok`, але ЗАВЖДИ `aData: null` (заглушка, без капчі);
 *   POST /api/info_schedule_part {queue, curr_dt, token} → справжній погодинний ГПВ, але ЗА Cloudflare Turnstile (`400 No captcha`);
 *   GET  /api/info_disable/  ?nq=city|street|house&q&c  → автодоповнення адрес (без капчі).
 * Черга за особовим рахунком доступна через /number_queue, який вимагає captcha-token.
 * Про капчу: AGENTS.md (правило 6) ДОЗВОЛЯЄ обхід Turnstile/JS-челленджів Cloudflare, тому попереднє
 * твердження «дозвіл не підтверджено, капчу не обходимо» ПРИБРАНО як хибне (перевірено 11.10.2026).
 * Поточний стан: цей адаптер ще не подає captcha-token, тому криємося на публічні методи без капчі
 * (list_acc, info_disable, info_schedule). Щоб піти в /info_schedule_part або /number_queue — див.
 * skills/scraper-adapter-hardening → «Anti-bot: Turnstile/CAPTCHA bypass (дозволено)».
 */

/** Людські назви типів відключень (fallback, якщо оператор не повернув причину). */
export const OUTAGE_TYPE_LABELS: Record<number, string> = {
  1: 'Планова перерва в електропостачанні',
  2: 'Аварійна перерва в електропостачанні',
  6: 'Графік погодинних відключень (ГПВ)',
};

/** Профілі браузерів: UA і sec-ch-ua мусять бути узгодженими (див. pickUserAgent). */
const CHERNIHIV_UA_PROFILES = [
  {
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    secChUa: '"Chromium";v="120", "Not?A_Brand";v="24", "Google Chrome";v="120"',
  },
  {
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0',
    secChUa: '"Chromium";v="120", "Not?A_Brand";v="24", "Google Chrome";v="120"',
  },
  {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    secChUa: '"Chromium";v="120", "Not?A_Brand";v="24", "Google Chrome";v="120"',
  },
  {
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:124.0) Gecko/20100101 Firefox/124.0',
    secChUa: '"Chromium";v="120", "Not?A_Brand";v="24", "Google Chrome";v="120"',
  },
];

/** Рядок відповіді /api/list_acc: [населений пункт, вулиця, будинки, старт, кінець, створено, причина, ...]. */
export type ListAccRow = [string, string, string, string, string, string?, string?, string?];

export interface ChernihivWebOptions {
  baseUrl: string;
  cityIds: string[];
  types: number[];
  timeoutMs: number;
  userAgent: string;
  /** Кількість повторів при тимчасових збоях (429 / 5xx / таймаут). */
  retries: number;
  /** Базова пауза між повторами (мс), подвоюється з кожною спробою. */
  retryDelayMs: number;
  /** Пауза між послідовними запитами до оператора (мс), щоб не тригерити WAF/рейт-ліміт. */
  requestDelayMs: number;
  /** Прогріти сесію: спершу GET /power_outages (cookies), потім POST /api/list_acc — як у браузера. */
  sessionWarmup: boolean;
  /**
   * Legacy (лишено для сумісності): раніше — «Retry-After більший за це значення → пропускаємо цикл».
   * Тепер адаптер НЕ чекає взагалі: на 429 він одразу кидає SourceBlockedError, а тривалість паузи
   * (у т.ч. з урахуванням Retry-After) вирішує circuit breaker — services/source-breaker.ts.
   */
  retryAfterMaxMs: number;
}

export const DEFAULT_CHERNIHIV_WEB_OPTIONS: ChernihivWebOptions = {
  baseUrl: 'https://chernihivoblenergo.com.ua',
  // Перелік НП порожній за замовчуванням: ідентифікатори мусять приходити з env/довідника оператора
  // (info_disable?nq=city). Зашите одне село давало хибне враження, що ми бачимо всю область.
  cityIds: [],
  types: [1, 2, 6],
  timeoutMs: 30_000,
  // Оператор за WAF-політикою віддає дані лише браузероподібним клієнтам.
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  retries: 2,
  retryDelayMs: 700,
  requestDelayMs: 1_000,
  sessionWarmup: true,
  retryAfterMaxMs: 60_000,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Коди помилок з'єднання/транспорту (обрив TLS, RST, «broken pipe») — їх НЕ ретраїмо. */
const CONNECTION_ABORT_CODES = new Set([
  'EPIPE',
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'EPROTO',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_SOCKET',
]);

function errorCode(error: unknown): string | undefined {
  const candidate = error as { code?: unknown; cause?: { code?: unknown } };
  const code = candidate?.cause?.code ?? candidate?.code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * Визначає, чи це обрив з'єднання (WAF рве TLS-рукостискання / RST).
 * Такі збої повторювати марно й шкідливо — вони лише погіршують репутацію IP.
 */
export function isConnectionAbortError(error: unknown): boolean {
  const code = errorCode(error);
  if (!code) return false;
  return CONNECTION_ABORT_CODES.has(code) || code.startsWith('ERR_SSL');
}

/** Розбирає заголовок Retry-After (секунди або HTTP-дата) у мілісекунди. */
export function parseRetryAfter(value: string | null | undefined, now: number = Date.now()): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1_000);
  const at = Date.parse(value);
  if (Number.isFinite(at)) return Math.max(0, at - now);
  return null;
}

/** Зсув Europe/Kyiv відносно UTC (у хвилинах) для локальної дати YYYY-MM-DD. */
export function kyivOffsetMinutes(dateYmd: string): number {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Kyiv', timeZoneName: 'shortOffset' })
    .formatToParts(new Date(`${dateYmd}T12:00:00Z`))
    .find((item) => item.type === 'timeZoneName')?.value ?? 'GMT+2';
  return part.endsWith('+3') ? 180 : 120;
}

/**
 * Оператор повертає «настінний» час Києва без зони ("2026-10-07T17:30:00").
 * Перетворюємо його у коректний момент UTC з урахуванням літнього/зимового часу.
 */
export function kyivWallClockToUtc(local: string): Date {
  const match = String(local).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/u);
  if (!match) return new Date(Number.NaN);
  const [, year, month, day, hour, minute, second = '00'] = match;
  const wallClockAsUtc = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
  return new Date(wallClockAsUtc - kyivOffsetMinutes(`${year}-${month}-${day}`) * 60_000);
}

/** Перетворює один рядок /api/list_acc у нормалізоване відключення (без персональних даних). */
export function parseListAccRow(row: ListAccRow, type: number, cityId: string, sourceUrl: string): NormalizedOutage | null {
  const placement = String(row[0] ?? '').trim();
  const street = String(row[1] ?? '').trim();
  const houses = String(row[2] ?? '').trim();
  const startsAt = kyivWallClockToUtc(String(row[3] ?? ''));
  const endsAt = kyivWallClockToUtc(String(row[4] ?? ''));
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) return null;
  if (!street && !placement) return null;

  // Назву пункту НЕ підтягуємо під одне знайоме село: беремо те, що дав оператор,
  // лише приводимо регістр («ДЕСНЯНСЬКЕ» → «Деснянське», «НОВГОРОД-СІВЕРСЬКИЙ» → «Новгород-Сіверський»).
  const areaName = titleCasePlace(placement) || 'Чернігівська область';
  // Не дублюємо населений пункт в адресі — він уже винесений у areaName (окреме поле в UI).
  const placementIsArea = Boolean(placement) && placement.toLocaleLowerCase('uk-UA') === areaName.toLocaleLowerCase('uk-UA');
  const streetAndHouses = street ? `вул. ${street}${houses ? ` ${houses}` : ''}` : houses;
  const addressesRaw = [placementIsArea ? '' : placement, streetAndHouses].filter(Boolean).join(', ').replace(/\s+/gu, ' ').trim();
  const reason = String(row[6] ?? '').trim() || OUTAGE_TYPE_LABELS[type] || null;

  return {
    startsAt,
    endsAt,
    areaName,
    addressesRaw: addressesRaw || placement,
    reason,
    queue: null,
    externalId: `${cityId}:${type}:${street}:${houses}:${row[3]}:${row[4]}`,
    sourceUrl,
  };
}

/**
 * Формує «аварію» з аварійної перерви оператора (тип 2):
 * місце (areaName), причина (reason) та час (startsAt → etaAt = endsAt).
 */
export function emergencyIncidentFromOutage(outage: NormalizedOutage, cityId: string): NormalizedIncident | null {
  if (!outage.externalId) return null;
  const reason = outage.reason?.trim() || OUTAGE_TYPE_LABELS[2]!;
  return {
    title: `${reason} — ${outage.areaName}`,
    description: `${outage.areaName} · ${outage.addressesRaw}`,
    startedAt: outage.startsAt,
    etaAt: outage.endsAt,
    severity: 'high',
    externalId: `emergency:${cityId}:${outage.externalId}`,
    sourceUrl: outage.sourceUrl,
  };
}

export class ChernihivWebAdapter implements ISourceAdapter {
  readonly name = 'ChernihivOblenergoWeb';
  readonly sourceUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly options: ChernihivWebOptions;

  constructor(fetchImpl: typeof fetch = fetch, options: Partial<ChernihivWebOptions> = {}) {
    this.fetchImpl = fetchImpl;
    this.options = { ...DEFAULT_CHERNIHIV_WEB_OPTIONS, ...options };
    this.sourceUrl = `${this.options.baseUrl}/power_outages`;
  }

  /** Cookies, отримані під час прогріву сесії (GET /power_outages). */
  private cookies = '';
  /** Курсор ротації UA: кожен наступний запит — інший профіль браузера. */
  private userAgentCursor = Math.floor(Math.random() * 4);
  /** Профіль поточного запиту (див. pickUserAgent). */
  private currentProfile: { userAgent: string; secChUa: string } | null = null;
  /** Адаптивний множник паузи: зростає при тиску на джерело, сам повільно згасає. */
  private slowdownFactor = 1;

  /** Заголовки, характерні для браузерного XHR-запиту зі сторінки /power_outages. */
  private browserHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/plain, */*',
      'accept-language': 'uk-UA,uk;q=0.9,en;q=0.8',
      // Кожен запит іде з випадковим UA із реальних браузерів. Завжди однаковий UA на сотнях
      // запитів — це найпомітніший сигнал автоматизації; ротація робить профіль «звичайним».
      'user-agent': this.pickUserAgent().userAgent,
      origin: this.options.baseUrl,
      referer: `${this.options.baseUrl}/power_outages`,
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
      'sec-ch-ua': this.pickUserAgent().secChUa,
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Linux"',
    };
    if (this.cookies) headers.cookie = this.cookies;
    return headers;
  }

  /**
   * Випадковий UA із списку актуальних браузерів.
   *
   * UA має відповідати заголовку `sec-ch-ua`, інакше профіль виглядає підробленим: браузер ніколи
   * не надсилає «Chrome 120» з UA Firefox. Тому список UA — це пари (Chromium-подібні й Firefox),
   * а sec-ch-ua теж підставляється разом із ними.
   */
  private pickUserAgent(): { userAgent: string; secChUa: string } {
    // Профіль визначається ОДИН раз на запит і кешується: browserHeaders() звертається до нього
    // двічі (user-agent і sec-ch-ua), і без кешу запит отримав би UA від одного профілю, а
    // sec-ch-ua від іншого — такий « frankenstein» профilu WAF розпізнає легко.
    if (!this.currentProfile) {
      this.currentProfile = CHERNIHIV_UA_PROFILES[this.userAgentCursor % CHERNIHIV_UA_PROFILES.length]!;
      this.userAgentCursor += 1;
    }
    return this.currentProfile;
  }

  /** Скидає профіль на початку нового запиту, щоб кожен запит виглядав окремим відкриттям сторінки. */
  private resetProfile(): void {
    this.currentProfile = null;
  }

  /**
   * Пауза між запитами: базова + випадковий jitter + адаптивне збільшення після 5xx.
   *
   * Три шари разом дають те, чого не дає жоден окремо:
   *  * jitter — не рівномірний «робот»-малюнок;
   *  * адаптив — після серверних помилок темп сам знижується, до того як джерело не відповідає;
   *  * базова пауза — гарантований технічний мінімум, щоб не «длубати» оператора.
   */
  private async paceRequest(): Promise<void> {
    const base = this.options.requestDelayMs * this.slowdownFactor;
    const jitter = base * 0.6 * Math.random();
    await sleep(Math.round(base + jitter));
    // Плавний «від'їзд» угору, але без різкого стрибка: серверу час повернутись у норму.
    if (this.slowdownFactor < 4) {
      this.slowdownFactor = Math.min(4, this.slowdownFactor + 0.08 * Math.random());
    }
  }

  private noteServerPressure(): void {
    this.slowdownFactor = Math.min(6, this.slowdownFactor * 1.6);
  }

  /**
   * Прогрів сесії: GET сторінки /power_outages як у браузера, щоб отримати cookies.
   * Деякі WAF вважають «холодний» API-запит без сесії підозрілим.
   */
  private async warmupSession(): Promise<void> {
    if (!this.options.sessionWarmup) return;

    const requestInit: RequestInit = {
      method: 'GET',
      headers: {
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'accept-language': 'uk-UA,uk;q=0.9,en;q=0.8',
        'user-agent': this.options.userAgent,
        'upgrade-insecure-requests': '1',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'none',
        'sec-fetch-user': '?1',
      },
    };

    // Прогрів — ПЕРШИЙ запит до оператора після старту або довгої паузи, і саме він найчастіше падає
    // транзієнтно на «холодну» (DNS/хендшейк виходить за таймаут). Перевірено 11.10.2026 із контейнера:
    // перший запит → ETIMEDOUT (`fetch failed`), наступні → 200. Тому транзієнтні збої з'єднання
    // ПОВТОРЮЄМО (швидко й небагато), перш ніж ставити джерело на паузу — інакше один випадковий
    // таймаут вимикав оновлення на 30 хв і показував «Джерело даних не відповідає» без причини.
    // Явний блок (403/429) НЕ повторюємо: це відповідь джерела, а не «холодний старт».
    let response: Response | null = null;
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.options.retries; attempt += 1) {
      if (attempt > 0) await sleep(this.options.retryDelayMs * 2 ** (attempt - 1));
      try {
        response = await this.fetchImpl(`${this.options.baseUrl}/power_outages`, {
          ...requestInit,
          signal: AbortSignal.timeout(this.options.timeoutMs),
        });
        break;
      } catch (error) {
        lastError = error;
        if (!isTimeoutError(error) && !isConnectionAbortError(error)) throw error;
      }
    }

    if (!response) {
      const kind: SourceBlockKind = isConnectionAbortError(lastError) ? 'connection_aborted' : 'timeout';
      throw new SourceBlockedError(
        kind,
        `Operator session warmup failed for /power_outages: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
        { cause: lastError },
      );
    }
    // 403/429 на сторінці — той самий сигнал блоку, що й на API: жодних подальших запитів.
    if (response.status === 403 || response.status === 429) {
      throw new SourceBlockedError(
        response.status === 403 ? 'http_403' : 'http_429',
        `Operator page /power_outages returned HTTP ${response.status} during session warmup`,
        { retryAfterMs: parseRetryAfter(response.headers.get('retry-after')) },
      );
    }
    const setCookie = (response.headers as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
    if (setCookie.length) this.cookies = setCookie.map((item) => item.split(';')[0]).join('; ');
  }

  async fetch(): Promise<ParseResult> {
    if (this.options.cityIds.length === 0) {
      // Чесна помилка замість «тихо порожньо»: без переліку НП ми не бачимо жодного відключення,
      // і це НЕ означає, що їх немає. runParse запише error з цією причиною — і буде видно в /api/v1/status.
      throw new Error(
        'CHERNIHIV_CITY_IDS порожній: перелік населених пунктів оператора не заданий — запит не виконуємо, щоб не видати «порожньо» за «немає відключень»',
      );
    }
    const outages: NormalizedOutage[] = [];
    const incidents: NormalizedIncident[] = [];
    const rawParts: Array<{ cityId: string; type: number; payload: unknown }> = [];
    const successfulScopes: string[] = [];
    let emergencyCount = 0;
    let succeededTypes = 0;
    let firstBlockError: Error | null = null;

    await this.warmupSession();

    for (const cityId of this.options.cityIds) {
      for (const type of this.options.types) {
        // Пауза перед кожним запитом: базова + jitter + адаптив (див. paceRequest).
        // Рівномірний потім запитів — це і є впізнавана ознака автоматизації.
        await this.paceRequest();
        this.resetProfile();
        let payload: { status?: string; list?: ListAccRow[] };
        try {
          payload = await this.fetchListAcc(cityId, type);
        } catch (error) {
          // Явний блок (403/429/таймаут/обрив) — не долбимо джерело остальными порциями:
          // пробрасываем наверх, а circuit breaker ставит источник на паузу и пишет lastError.
          if (error instanceof SourceBlockedError) throw error;
          // Одна настроенная порция (cityId:type) не загрузилась — это ЧАСТИЧНОЕ наблюдение,
          // а не «оператор всё отменил»: остальные порции дособираем, complete=false,
          // а отмена отсутствующих окон в этом цикле запрещена (ingest/runParse).
          firstBlockError = firstBlockError ?? (error instanceof Error ? error : new Error(String(error)));
          continue;
        }
        succeededTypes += 1;
        successfulScopes.push(`${cityId}:${type}`);
        rawParts.push({ cityId, type, payload });
        const list = Array.isArray(payload.list) ? payload.list : [];
        if (type === 2) emergencyCount += list.length;
        for (const row of list) {
          const normalized = parseListAccRow(row, type, cityId, this.sourceUrl);
          if (!normalized) continue;
          outages.push(normalized);
          // Аварійні перерви (тип 2) дублюємо як «аварії», щоб сторінка «Аварії»
          // показувала місце/причину/час навіть без повідомлень у Telegram.
          if (type === 2) {
            const incident = emergencyIncidentFromOutage(normalized, cityId);
            if (incident) incidents.push(incident);
          }
        }
      }
    }

    // Собрать НЕ получилось ни одной порции — это полный отказ, а не "частичный":
    // пустая лента не должна тихо попадать в ингест как "успех".
    if (succeededTypes === 0 && firstBlockError) throw firstBlockError;

    // Оператор віддає по рядку на кожну вулицю/будинок — згортаємо їх в одну
    // подію населеного пункту, щоб дані не «смітили» дублікатами.
    const mergedOutages = mergeDuplicateOutages(outages);

    return {
      outages: mergedOutages,
      incidents,
      complete: succeededTypes === this.options.cityIds.length * this.options.types.length,
      completeScopeKeys: successfulScopes,
      gridLevel: emergencyCount > 0 ? 'warning' : 'stable',
      gridMessage: emergencyCount > 0 ? `Зареєстровано аварійних перерв в електропостачанні: ${incidents.length}` : '',
      rawSnapshot: JSON.stringify(rawParts),
    };
  }

  private async fetchListAcc(cityId: string, type: number): Promise<{ status?: string; list?: ListAccRow[] }> {
    const reqParam = encodeURIComponent(JSON.stringify({ c: cityId, t: type }));
    const requestInit: RequestInit = {
      method: 'POST',
      headers: this.browserHeaders(),
      body: JSON.stringify({ req_param: reqParam }),
    };
    const scope = `city=${cityId}, type=${type}`;

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.options.retries; attempt += 1) {
      const retryDelayMs = this.options.retryDelayMs * 2 ** attempt;
      try {
        const response = await this.fetchImpl(`${this.options.baseUrl}/api/list_acc`, {
          ...requestInit,
          signal: AbortSignal.timeout(this.options.timeoutMs),
        });
        if (response.ok) {
          // Успішна відповідь — сигнал, що темп нормальний: трохи відпускаємо адаптив.
          this.slowdownFactor = Math.max(1, this.slowdownFactor * 0.9);
          return (await response.json()) as { status?: string; list?: ListAccRow[] };
        }
        const message = `Operator /api/list_acc returned HTTP ${response.status} (${scope})`;
        // 403 і 429 — прямі сигнали «не зараз» (WAF/ліміт). Жодних повторів у цьому прогоні:
        // замість цього circuit breaker ставить джерело на паузу (і поважає Retry-After).
        if (response.status === 403 || response.status === 429) {
          const kind: SourceBlockKind = response.status === 403 ? 'http_403' : 'http_429';
          throw new SourceBlockedError(kind, message, {
            retryAfterMs: parseRetryAfter(response.headers.get('retry-after')),
          });
        }
        // 4xx «ESOCKETTIMEDOUT» — не наша помилка запиту: оператор сам упав на власному
        // внутрішньому сокеті й віддає HTTP 400 з тілом-помилкою. Це транзиентно і повтор
        // виправданий (перевірено вживу на Чернігові: другий запит віддає 200 з даними).
        const isUpstreamSocketTimeout =
          response.status === 400 &&
          /ESOCKETTIMEDOUT|timeout|timed out/iu.test(await response.clone().text());
        if (response.status < 500 && !isUpstreamSocketTimeout) {
          // Справжні 4xx (не наш params) — повторювати безглуздо: проблема в запиті, а не в джерелі.
          throw new SourceRequestError(message);
        }
        // 5xx — тимчасовий збій сервера або WAF-подовження: ось тут повтор із backoff виправданий,
        // але й темп треба знизити — інакше наступні запити отримають те саме.
        // Те саме стосується й 400+ESOCKETTIMEDOUT: оператор впав на своєму сокеті, темп нижче.
        this.noteServerPressure();
        lastError = new Error(message);
      } catch (error) {
        // Обе «окончательные» ошибки порции выходят наружу: блок — на паузу, 4xx — просто неудача
        // этой порции без повторов (иначе 404 превратился бы в три запроса к WAF).
        if (error instanceof SourceBlockedError || error instanceof SourceRequestError) throw error;
        if (isTimeoutError(error) || isConnectionAbortError(error)) {
          // Таймаут і обрив TLS (WAF рве рукостискання): повтор лише шкодить репутації IP,
          // тому прогін переривається, а паузу вирішує circuit breaker.
          throw new SourceBlockedError(
            isTimeoutError(error) ? 'timeout' : 'connection_aborted',
            isTimeoutError(error)
              ? `Operator request timed out for /api/list_acc (${scope})`
              : `Operator connection aborted for /api/list_acc (${scope}): ${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
          );
        }
        lastError = error;
      }
      if (attempt < this.options.retries) await sleep(retryDelayMs);
    }
    throw lastError ?? new Error(`Operator /api/list_acc failed (${scope})`);
  }
}
