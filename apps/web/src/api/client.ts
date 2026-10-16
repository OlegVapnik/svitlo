import type { AddressResolveResult } from '@svitlo/shared';
import { noteServedFromCache, noteServedOnline, readCache, writeCache } from './offline-cache.js';

const API_BASE = import.meta.env['VITE_API_BASE_URL'] || '/api/v1';

/**
 * Адрес API показывается в диагностике соединения.
 *
 * Зачем: когда каталог областей не загрузился, приложение молча откатывается на область по
 * умолчанию и выглядит как «выбрать нечего» — непонятно, это данные или проблема со связью.
 * С самим адресом и текстом ошибки человек (и мы) сразу видит, куда приложение ходит и почему
 * не доходит. В PWA это, как правило, `/api/v1`; в нативном приложении — абсолютный адрес,
 * зашитый при сборке.
 */
export const API_BASE_URL: string = API_BASE;

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
  //
  // Свой кеш в localStorage (offline-cache.ts) тут другой: он переживает пропажу сети, и при
  // недоступности сервера мы отдаём последний известный ответ, а не пустой экран.
  const isRead = (options?.method ?? 'GET').toUpperCase() === 'GET';
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${endpoint}`, { cache: 'no-store', ...options });
  } catch (error) {
    // Сеть недоступна — отдаём последний успешный ответ по этому эндпоинту, если он есть.
    // Это ровно тот случай, когда в районе без связи человек должен видеть график отключений.
    if (isRead) {
      const cached = readCache(endpoint);
      if (cached) {
        noteServedFromCache(cached);
        return cached.data;
      }
    }
    throw error;
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as
      | { error?: { code?: string; message?: string; details?: Array<{ path: string; message: string }> } }
      | null;
    const error = body?.error;
    throw new ApiError(res.status, error?.code ?? 'HTTP_ERROR', error?.message ?? res.statusText, error?.details);
  }

  const data = await res.json();
  // Сеть снова доступна — снимаем баннер офлайна и обновляем кеш свежим ответом.
  noteServedOnline();
  if (isRead) writeCache(endpoint, data);
  return data;
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
  // Статистика — по области: без region бэкенд рахує область за замовчуванням (Чернігівщину),
  // і цифри в картці не збігалися б з областю, вибраною в шапці.
  fetchReliability: (region?: string, signal?: AbortSignal) => {
    const query = region ? `?${new URLSearchParams({ region }).toString()}` : '';
    return fetcher(`/reliability${query}`, { signal });
  },
  /** Статус сети и счётчики: `region` определяет, по какой области считать группы и статистику. */
  fetchStatus: (region?: string, signal?: AbortSignal) => {
    const query = region ? `?${new URLSearchParams({ region }).toString()}` : '';
    return fetcher(`/status${query}`, { signal });
  },
  fetchHealth: () => fetcher('/health'),
  /**
   * Поиск своей группы ГПВ по адресу (область → НП → улица → дом).
   *
   * Пустые street/house не отправляем: бэкенд трактует их как «уточните адрес» и отвечает
   * либо группой на всё село, либо списком вариантов по улице.
   */
  /**
   * Народная привязка: человек называет очередь своего адреса, если её нет в базе.
   *
   * Имя и телефон не передаём — для привязки они не нужны, а личные данные собирать не должны.
   */
  contributeAddressQueue: async (
    params: { region: string; settlement: string; street?: string; house?: string; queue: string },
  ): Promise<string | null> => {
    const body: Record<string, string> = {
      region: params.region,
      settlement: params.settlement,
      queue: params.queue,
    };
    if (params.street?.trim()) body['street'] = params.street.trim();
    if (params.house?.trim()) body['house'] = params.house.trim();
    const res = (await fetcher('/addresses/contribute', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })) as { data: { saved: boolean; queue: string } | null };
    return res.data?.saved ? res.data.queue : null;
  },

  resolveAddressQueue: async (
    params: { region: string; settlement: string; street?: string; house?: string },
    signal?: AbortSignal,
  ): Promise<AddressResolveResult> => {
    const query = new URLSearchParams({ region: params.region, settlement: params.settlement });
    if (params.street?.trim()) query.set('street', params.street.trim());
    if (params.house?.trim()) query.set('house', params.house.trim());
    const res = (await fetcher(`/addresses/resolve?${query}`, { signal })) as { data: AddressResolveResult };
    return res.data;
  },
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
  /** Чейджлог с сервера: серверный фикс виден без пересборки приложения. */
  fetchChangelog: (signal?: AbortSignal) => fetcher('/changelog', { signal }),
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