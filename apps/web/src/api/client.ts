const API_BASE = import.meta.env['VITE_API_BASE_URL'] || '/api/v1';

/**
 * Ошибка API с разобранным конвертом `{ error: { code, message, details } }`.
 * Нужна, чтобы страницы показывали человеческое сообщение и детали валидации,
 * а не «Not Found» из statusText (skills/api-endpoint-change, golden rule #10).
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Array<{ path: string; message: string }>;

  constructor(status: number, code: string, message: string, details?: Array<{ path: string; message: string }>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function fetcher(endpoint: string, options?: RequestInit) {
  // cache: 'no-store' — график групп меняется у оператора каждые полчаса, а обычный HTTP disk
  // cache в браузере отдавал по /api/v1/schedules устаревший (в том числе пустой) ответ: главная
  // показывала «Даних графіка немає», хотя бэкенд отдавал интервалы. Кэширование данных решает
  // React Query (staleTime/refetchInterval), дублировать его в HTTP-кэше бессмысленно.
  const res = await fetch(`${API_BASE}${endpoint}`, { cache: 'no-store', ...options });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as
      | { error?: { code?: string; message?: string; details?: Array<{ path: string; message: string }> } }
      | null;
    const error = body?.error;
    throw new ApiError(res.status, error?.code ?? 'HTTP_ERROR', error?.message ?? res.statusText, error?.details);
  }
  return res.json();
}

export const api = {
  fetchOutages: (params?: Record<string, string>) => {
    const q = params ? '?' + new URLSearchParams(params) : '';
    return fetcher(`/outages${q}`);
  },
  fetchOutage: (id: string) => fetcher(`/outages/${id}`),
  fetchOutageStats: (params?: Record<string, string>) => {
    const q = params ? '?' + new URLSearchParams(params) : '';
    return fetcher(`/outages/stats${q}`);
  },
  fetchIncidents: () => fetcher('/incidents'),
  fetchReliability: () => fetcher('/reliability'),
  fetchStatus: () => fetcher('/status'),
  fetchContacts: () => fetcher('/contacts'),
  fetchHealth: () => fetcher('/health'),
  suggestAddresses: (query: string, limit = 8, signal?: AbortSignal) =>
    fetcher(`/addresses/suggest?q=${encodeURIComponent(query)}&limit=${limit}`, { signal }),
  fetchQueueSchedule: (queue: string, date: string, region?: string) => {
    const params = new URLSearchParams({ queue, date });
    if (region) params.set('region', region);
    return fetcher(`/schedules?${params.toString()}`);
  },
  /** Ближні відключення по ГРУПАХ усієї області (GET /api/v1/schedules/upcoming) — блок «Найближчі відключення». */
  fetchUpcomingGroupOutages: (region?: string, days = 2, signal?: AbortSignal) => {
    const params = new URLSearchParams({ days: String(days) });
    if (region) params.set('region', region);
    return fetcher(`/schedules/upcoming?${params.toString()}`, { signal });
  },
  fetchStreetQueues: (signal?: AbortSignal) => fetcher('/street-queues', { signal }),
  /** Реальный список очередей (GET /api/v1/queues?region=...). */
  fetchQueues: (region?: string, signal?: AbortSignal) => {
    const q = region ? `?${new URLSearchParams({ region }).toString()}` : '';
    return fetcher(`/queues${q}`, { signal });
  },
  /** Каталог областей (GET /api/v1/regions, контракт /tmp/API-CONTRACT-regions.md). */
  fetchRegions: (signal?: AbortSignal) => fetcher('/regions', { signal }),
  /**
   * Новини (GET /api/v1/news): публічні пости Telegram-каналів операторів/Укренерго та RSS
   * місцевих ЗМІ. Персональних даних немає — лише текст публікації й посилання на першоджерело.
   */
  fetchNews: (params?: Record<string, string>, signal?: AbortSignal) => {
    const q = params ? '?' + new URLSearchParams(params) : '';
    return fetcher(`/news${q}`, { signal });
  },
  /** Джерела новин і стан збору (GET /api/v1/news/sources) — щоб було видно, кого саме читаємо. */
  fetchNewsSources: (signal?: AbortSignal) => fetcher('/news/sources', { signal }),
  /**
   * Перевірка за особовим рахунком: повертає вулицю та чергу з довідника (GET /places/:account).
   * 404 = номера немає в довіднику (див. ApiError.code === 'PLACE_NOT_FOUND').
   */
  fetchPlace: (account: string, signal?: AbortSignal) =>
    fetcher(`/places/${encodeURIComponent(account)}`, { signal }),
  fetchStreetSchedule: (street: string, date?: string, signal?: AbortSignal) => {
    const params = new URLSearchParams({ street });
    if (date) params.set('date', date);
    return fetcher(`/street-queues/schedule?${params.toString()}`, { signal });
  },
  /**
   * Ручной запуск парсинга реальных источников (admin). Ответ: `{ data: [{ sourceId, name, recordsFound }] }`.
   * Токен вводит человек и он не сохраняется. Публичного триггера парсинга нет намеренно: иначе
   * кто угодно мог бы заставлять бекенд ходить к оператору.
   */
  parseNow: (token: string) =>
    fetcher('/admin/parse', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    }),
  upsertStreetQueue: (street: string, queue: string, token: string) =>
    fetcher('/admin/street-queues', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ street, queue }),
    }),
  deleteStreetQueue: (street: string, token: string) =>
    fetcher(`/admin/street-queues/${encodeURIComponent(street)}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    }),
  /**
   * Ручний імпорт графіка оператора (admin). Раніше сторінка «Імпорт графіка» робила
   * голий fetch('/api/v1/…') в обхід цього файла — golden rule #9.
   */
  importSchedule: (queue: string, date: string, payload: unknown, token: string) =>
    fetcher('/admin/schedules/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ queue, date, payload }),
    }),
  /**
   * Автозавантаження погодинного ГПВ прямо з оператора (admin). Ендпоінт оператора
   * (`POST /api/info_schedule`) віддає графік за номером черги БЕЗ капчі й без персональних
   * даних, тому тут не потрібні ні браузер, ні Turnstile-токен — лише черга, дата й адмін-токен.
   */
  fetchScheduleNow: (queue: string, date: string, token: string) =>
    fetcher('/admin/schedules/fetch', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ queue, date }),
    }),
  /**
   * Імпорт ГПВ з ПУБЛІЧНОГО Telegram-каналу оператора (admin). Мережа для цього не потрібна:
   * бекенд читає вже збережені пости каналу (`telegram_posts`) і пише `schedule_slots`.
   * Капчі й персональних даних у цих постах немає.
   */
  importTelegramSchedule: (token: string) =>
    fetcher('/admin/schedules/import-telegram', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({}),
    }),
};