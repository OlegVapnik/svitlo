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
  const res = await fetch(`${API_BASE}${endpoint}`, options);
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
  fetchQueueSchedule: (queue: string, date: string) =>
    fetcher(`/schedules?${new URLSearchParams({ queue, date }).toString()}`),
  fetchStreetQueues: (signal?: AbortSignal) => fetcher('/street-queues', { signal }),
  /** Реальный список очередей (только то, что есть в БД: слоты графика и привязки улиц). */
  fetchQueues: (signal?: AbortSignal) => fetcher('/queues', { signal }),
  fetchStreetSchedule: (street: string, date?: string, signal?: AbortSignal) => {
    const params = new URLSearchParams({ street });
    if (date) params.set('date', date);
    return fetcher(`/street-queues/schedule?${params.toString()}`, { signal });
  },
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
};