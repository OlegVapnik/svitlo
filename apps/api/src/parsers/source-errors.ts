/**
 * Одна класифікація збоїв ДЖЕРЕЛА — спільна для адаптера і circuit breaker.
 *
 * Навіщо окремий тип: retry-політика адаптера і пауза планувальника мусять бачити ОДИН і той самий
 * висновок («нас блокують» / «це таймаут» / «це наш баг»), інакше два місця в коді розійдуться
 * (invariant «одне джерело правди», skills/outage-data-core).
 *
 * Раніше 429 без Retry-After і таймаут ретраїлись усередині прогону — саме те «бовтання» джерела,
 * якого забороняє skills/scraper-adapter-hardening. Тепер такі збої переривають прогін, а джерело
 * стає на паузу (services/source-breaker.ts).
 */

/** Види блоків: сигнали джерела «зачекай», а не наші помилки коду чи даних. */
export type SourceBlockKind = 'http_403' | 'http_429' | 'timeout' | 'connection_aborted';

/** Ширший тип для показу в /status: до блоків додаються збій формату і «все інше». */
export type SourceFailureKind = SourceBlockKind | 'format' | 'other';

export interface SourceFailure {
  kind: SourceFailureKind;
  /** Скільки мс джерело просить зачекати (Retry-After); null — не просило. */
  retryAfterMs: number | null;
  /** true — джерело явно відмовляє (бан/ліміт/таймаут): у цьому прогоні до нього більше не стукаємо. */
  blocked: boolean;
}

/** Помилка-сигнал «джерело відмовляє»: несе вид блоку і (за наявності) Retry-After. */
export class SourceBlockedError extends Error {
  readonly kind: SourceBlockKind;
  readonly retryAfterMs: number | null;

  constructor(
    kind: SourceBlockKind,
    message: string,
    options: { retryAfterMs?: number | null; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'SourceBlockedError';
    this.kind = kind;
    this.retryAfterMs = options.retryAfterMs ?? null;
  }
}

/**
 * Ошибка запроса к источнику, которую повторять бессмысленно, но это и НЕ блок: 4xx кроме 403/429
 * (неверный параметр, переехавший эндпоинт, 404). Порция помечается неудачной один раз, остальные
 * порции всё равно собираются (complete=false), а circuit breaker считает это обычной неудачей.
 */
export class SourceRequestError extends Error {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'SourceRequestError';
  }
}

function errorCode(error: unknown): string | undefined {
  const candidate = error as { code?: unknown; cause?: { code?: unknown } };
  const code = candidate?.cause?.code ?? candidate?.code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * Таймаут запиту: `AbortSignal.timeout` віддає DOMException із name=TimeoutError (undici),
 * у деяких шляхах — AbortError, плюс коди ETIMEDOUT/UND_ERR_*_TIMEOUT.
 */
export function isTimeoutError(error: unknown): boolean {
  const name = (error as { name?: unknown } | null | undefined)?.name;
  if (name === 'TimeoutError' || name === 'AbortError') return true;
  const code = errorCode(error);
  return code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'UND_ERR_HEADERS_TIMEOUT';
}

/** true, якщо це відмова джерела (бан/ліміт/таймаут/обрив), а не збій формату чи наш баг. */
export function isBlockKind(kind: SourceFailureKind): boolean {
  return kind !== 'other' && kind !== 'format';
}

/**
 * Зводить будь-яку помилку джерела до нашого типу. Джерел правди два: явний `SourceBlockedError`
 * (адаптер бачив HTTP-статус і Retry-After) і «схоже на таймаут» за іменем/кодом помилки.
 */
export function classifySourceFailure(error: unknown): SourceFailure {
  if (error instanceof SourceBlockedError) {
    return { kind: error.kind, retryAfterMs: error.retryAfterMs, blocked: true };
  }
  if (isTimeoutError(error)) return { kind: 'timeout', retryAfterMs: null, blocked: true };
  return { kind: 'other', retryAfterMs: null, blocked: false };
}
