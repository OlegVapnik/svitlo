import type { AddressConfirmResult, AddressHousesResponse, AddressResolveResult, AddressStreetsResponse, AppVersionInfo, HealthResponse } from '@svitlo/shared';
import { getApiBaseUrl } from '../config';
import { noteServedFromCache, noteServedOnline, readCache, writeCache } from './offline-cache';

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

/**
 * `useOfflineCache = false` — не писать этот ответ в кеш по URL.
 *
 * Нужно ровно для `/sync`: пакет (~170 КБ) хранит сам offline-sync, и вторая копия в общем
 * кеше только съедала бы квоту localStorage и вытесняла оттуда полезные ответы.
 */
async function fetcher(endpoint: string, options?: RequestInit, useOfflineCache = true) {
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
    res = await fetch(`${getApiBaseUrl()}${endpoint}`, { cache: 'no-store', ...options });
  } catch (error) {
    // Сеть недоступна — отдаём последний успешный ответ по этому эндпоинту, если он есть.
    // Это ровно тот случай, когда в районе без связи человек должен видеть график отключений.
    if (isRead && useOfflineCache) {
      const cached = readCache(endpoint);
      if (cached) {
        noteServedFromCache(cached);
        return cached.data;
      }
    }
    throw error;
  }

  if (!res.ok) {
    // 5xx — сервер не смог ответить (упал, исчерпал квоту БД). Для чтения это тот же случай,
    // что и пропажа сети: последний успешный ответ полезнее пустого экрана. 4xx не подменяем —
    // это ответ по существу (валидация, «не найдено»), и старые данные там были бы враньём.
    if (isRead && useOfflineCache && res.status >= 500) {
      const cached = readCache(endpoint);
      if (cached) {
        noteServedFromCache(cached);
        return cached.data;
      }
    }
    const body = (await res.json().catch(() => null)) as
      | { error?: { code?: string; message?: string; details?: Array<{ path: string; message: string }> } }
      | null;
    const error = body?.error;
    throw new ApiError(res.status, error?.code ?? 'HTTP_ERROR', error?.message ?? res.statusText, error?.details);
  }

  const data = await res.json();
  // Сеть снова доступна — снимаем баннер офлайна и обновляем кеш свежим ответом.
  noteServedOnline();
  if (isRead && useOfflineCache) writeCache(endpoint, data);
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
  /**
   * Надёжность за текущий месяц. `queue` сужает отчёт до одной черты — так «Моя черга» в
   * статистике главной показывает те же бакеты по днях, что и область, но посчитанные по её слотам
   * (бэкенд поддерживает `?queue=2/2` и в Node API, и в воркере).
   */
  fetchReliability: (region?: string, queue?: string, signal?: AbortSignal) => {
    const params = new URLSearchParams();
    if (region) params.set('region', region);
    if (queue) params.set('queue', queue);
    const query = params.size > 0 ? `?${params.toString()}` : '';
    return fetcher(`/reliability${query}`, { signal });
  },
  /** Статус сети и счётчики: `region` определяет, по какой области считать группы и статистику. */
  fetchStatus: (region?: string, signal?: AbortSignal) => {
    const query = region ? `?${new URLSearchParams({ region }).toString()}` : '';
    return fetcher(`/status${query}`, { signal });
  },
  /**
   * Диагностика воркера. Ответ приходит без конверта `{ data }` — см. `HealthResponse`.
   *
   * `useOfflineCache = false`: старый «здоровый» ответ из кеша здесь опаснее пустоты, потому
   * что по нему решают, виноват ли телефон в устаревших данных.
   */
  fetchHealth: () => fetcher('/health', undefined, false) as Promise<HealthResponse>,
  /**
   * Офлайн-пакет области (GET /api/v1/sync) — один ответ вместо пяти запросов на старте.
   *
   * `etag` уходит в `If-None-Match`: сервер отвечает `304 Not Modified`, если содержимое не
   * изменилось. Это не ошибка, а нормальный результат, поэтому вызывающая сторона
   * (api/offline-sync.ts) отличает его по `ApiError.status === 304`. Отдаём 304 сюда, а не
   * глушим внутри: решать, «обновлять или нет», должна логика синхронизации, а не транспорт.
   *
   * В общий кеш по URL ответ не пишется (`useOfflineCache = false`): пакет хранит offline-sync,
   * и его копия здесь только занимала бы квоту localStorage.
   */
  fetchSync: (region?: string, etag?: string | null, signal?: AbortSignal) => {
    const params = new URLSearchParams();
    // `v` меняет ключ CDN-кеша: 24.10 Cloudflare держал 24-часовой кеш `/sync?region=…`,
    // записанный без CORS-заголовков, и браузер отвечал «Failed to fetch» на живой бэкенд.
    params.set('v', '2');
    if (region) params.set('region', region);
    const query = params.toString();
    const headers: Record<string, string> = {};
    if (etag) headers['if-none-match'] = etag;
    return fetcher(`/sync${query ? `?${query}` : ''}`, { signal, headers }, false);
  },
  /**
   * Поиск своей группы ГПВ по адресу (область → НП → улица → дом).
   *
   * Пустые street/house не отправляем: бэкенд трактует их как «уточните адрес» и отвечает
   * либо группой на всё село, либо списком вариантов по улице.
   */
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
  /** Подсказки населённых пунктов области (в облаке — справочник + OSM). */
  fetchAddressSettlements: (
    params: { region: string; q: string; limit?: number },
    signal?: AbortSignal,
  ): Promise<{ data: Array<{ name: string; normalized?: string }> }> => {
    const query = new URLSearchParams({
      region: params.region,
      q: params.q,
      limit: String(params.limit ?? 8),
    });
    return fetcher(`/addresses/settlements?${query}`, { signal }) as Promise<{
      // `defaultQueue` заполнен, когда весь населённый пункт обслуживает одна очередь.
      // `queues` — все очереди НП; длина 1 означает, что различать улицы не нужно.
      data: Array<{
        name: string;
        normalized?: string;
        defaultQueue?: string | null;
        queues?: string[];
        wholeSettlementQueue?: string | null;
        streetsCount?: number;
      }>;
    }>;
  },
  /** Улицы выбранного населённого пункта: быстрые чипы в мастере адреса. */
  fetchAddressStreets: (
    params: { region: string; settlement: string; q?: string; limit?: number },
    signal?: AbortSignal,
  ): Promise<AddressStreetsResponse> => {
    const query = new URLSearchParams({
      region: params.region,
      settlement: params.settlement,
      q: params.q ?? '',
      limit: String(params.limit ?? 24),
    });
    return fetcher(`/addresses/streets?${query}`, { signal }) as Promise<AddressStreetsResponse>;
  },
  /** Дома выбранной улицы с группами — чипы «12 → 2/2», чтобы не печатать номер. */
  fetchAddressHouses: (
    params: { region: string; settlement: string; street: string },
    signal?: AbortSignal,
  ): Promise<AddressHousesResponse> => {
    const query = new URLSearchParams({
      region: params.region,
      settlement: params.settlement,
      street: params.street,
    });
    return fetcher(`/addresses/houses?${query}`, { signal }) as Promise<AddressHousesResponse>;
  },
  fetchQueueSchedule: (queue: string, date: string, region?: string) => {
    // `v` — сброс ключа CDN-кеша, см. комментарий в fetchSync.
    const params = new URLSearchParams({ queue, date, v: '2' });
    if (region) params.set('region', region);
    return fetcher(`/schedules?${params.toString()}`);
  },
  /** Ближні відключення по ГРУПАХ усієї області (GET /api/v1/schedules/upcoming) — блок «Найближчі відключення». */
  fetchUpcomingGroupOutages: (region?: string, days = 2, signal?: AbortSignal) => {
    // `v` — сброс ключа CDN-кеша, см. комментарий в fetchSync.
    const params = new URLSearchParams({ days: String(days), v: '2' });
    if (region) params.set('region', region);
    return fetcher(`/schedules/upcoming?${params.toString()}`, { signal });
  },
  fetchStreetQueues: (signal?: AbortSignal) => fetcher('/street-queues', { signal }),
  /** Реальный список очередей (GET /api/v1/queues?region=...). */
  fetchQueues: (region?: string, signal?: AbortSignal) => {
    // `v` — сброс ключа CDN-кеша, см. комментарий в fetchSync.
    const params = new URLSearchParams({ v: '2' });
    if (region) params.set('region', region);
    return fetcher(`/queues?${params.toString()}`, { signal });
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
  /** Последняя опубликованная сборка: версия, SHA-256 и ссылка на APK. */
  fetchVersion: (signal?: AbortSignal) =>
    fetcher('/version', { signal }) as Promise<{ data: AppVersionInfo }>,
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