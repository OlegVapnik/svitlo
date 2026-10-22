import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  IncidentListResponse,
  OutageListResponse,
  OutageStatsResponse,
  OutageDetailResponse,
  OutageStatus,
  QueueScheduleData,
  QueueSummary,
  GroupOutageSummary,
  ReliabilityResponse,
  StatusResponse,
  StreetQueuePair,
  StreetScheduleData,
  NewsListResponse,
  NewsSourcesResponse,
  ChangelogFile,
  AppVersionInfo,
  AddressResolveInput,
  AddressHousesResponse,
  AddressStreetsResponse,
} from '@svitlo/shared';
import type { RegionListResponse, RegionSummary } from '../lib/region';
import { canonicalQueueCode, canonicalQueueListForRegion } from '../lib/queue';
import { api } from './client';
import { fetchPackHouses, fetchPackStreets, resolvePackAddress, searchPackSettlements } from './address-packs';
import { pickRegionSchedule, writeRegionScheduleSnapshot } from './offline-region-schedules';
import { useDebouncedValue } from '../lib/use-debounced-value';

type OutageFilters = {
  query?: string;
  status?: OutageStatus;
  queue?: number;
  area?: string;
  region?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
};

/**
 * staleTime: бэкенд опрашивает оператора раз в ~30 минут, поэтому дёргать API на каждый переход
 * между страницами незачем (skills/frontend-ui-change: 30–60 с для данных об отключениях).
 * Данные статуса обновляются чаще — по ним видно, что источник жив (или что он на паузе).
 */
const OUTAGE_STALE_MS = 30_000;
const STATUS_POLL_MS = 30_000;
/**
 * Авто-обновление списков, пока вкладка открыта: планировщик ходит к оператору раз в ~30–60 минут,
 * но человек не должен обновлять страницу руками, чтобы увидеть изменение графика.
 * Отдельно есть кнопка ручного обновления (см. `useParseNow` и главную страницу).
 */
const OUTAGE_POLL_MS = 60_000;

export const useOutages = (filters?: OutageFilters) =>
  useQuery<OutageListResponse>({
    queryKey: ['outages', filters],
    staleTime: OUTAGE_STALE_MS,
    refetchInterval: OUTAGE_POLL_MS,
    queryFn: () => {
      const params =
        filters &&
        Object.fromEntries(
          Object.entries(filters)
            .filter(([, value]) => value !== undefined)
            .map(([key, value]) => [key, String(value)]),
        );
      return api.fetchOutages(params);
    },
  });

export const useOutage = (id: string) =>
  useQuery<OutageDetailResponse>({
    queryKey: ['outage', id],
    queryFn: () => api.fetchOutage(id),
    enabled: !!id,
  });

export const useOutageStats = (params?: Record<string, string>) =>
  useQuery<OutageStatsResponse>({
    queryKey: ['outagesStats', params],
    staleTime: OUTAGE_STALE_MS,
    queryFn: () => api.fetchOutageStats(params),
  });

export const useIncidents = () =>
  useQuery<IncidentListResponse>({
    queryKey: ['incidents'],
    queryFn: api.fetchIncidents,
    staleTime: OUTAGE_STALE_MS,
    refetchInterval: 60000,
  });

/**
 * Статус сети и счётчики отключений.
 *
 * `region` обязателен по смыслу: «активні/заплановані» и статистика считаются по области —
 * у человека она одна активная. Без области API считал бы область по умолчанию, и цифры
 * в шапке не совпадали бы с тем, что показано на главной для выбранной области.
 */
export const useStatus = (region?: string) =>
  useQuery<{ data: StatusResponse }>({
    queryKey: ['status', region ?? null],
    queryFn: ({ signal }) => api.fetchStatus(region, signal),
    // Свежесть данных и пауза источника видны в шапке на каждой странице: короткий интервал обязателен.
    staleTime: STATUS_POLL_MS / 2,
    refetchInterval: STATUS_POLL_MS,
  });

export const useReliability = (region?: string, queue?: string) =>
  useQuery<ReliabilityResponse>({
    // region и queue в ключе: иначе переключение области или «Моєї черги» показывало бы цифры
    // прошлого запроса из кеша.
    queryKey: ['reliability', region ?? null, queue ?? null],
    queryFn: ({ signal }) => api.fetchReliability(region, queue, signal),
    refetchInterval: 300000,
  });

export const useHealth = () =>
  useQuery({
    queryKey: ['health'],
    queryFn: api.fetchHealth,
  });

export const useStreetQueues = () =>
  useQuery<{ data: StreetQueuePair[] }>({
    queryKey: ['streetQueues'],
    queryFn: () => api.fetchStreetQueues(),
  });

/**
 * Список очередей для страницы «Мої черги». Источник — реальные данные (GET /api/v1/queues?region=...),
 * а не зашитый в веб массив: если импорта не было, список пустой и страница это признаёт.
 */
export const useQueues = (region?: string) =>
  useQuery<{ data: QueueSummary[] }>({
    queryKey: ['queues', region],
    queryFn: async ({ signal }) => {
      const response = await api.fetchQueues(region, signal);
      // Коды групп области приводим к канонической форме: у Києва источник может отдать «3», а
      // каталог и график — «3/1». Без единой формы строка матрицы не находила свои отключения.
      return {
        ...response,
        data: (response?.data ?? []).map((item: QueueSummary) => ({
          ...item,
          queue: canonicalQueueCode(region, item.queue),
        })),
      };
    },
    staleTime: 60_000,
  });

/**
 * Ближні відключення по групах усієї області (GET /api/v1/schedules/upcoming).
 *
 * Джерело — `schedule_slots` оператора, а не `outage_events`: останні містять лише точкові
 * ремонтні записи одного села й не відповідають на запитання «які групи гасять сьогодні».
 *
 * Тут же відповідь пишеться в офлайн-снимок области (offline-region-schedules.ts). Снимок
 * приходить одним запитом на область, тому достатньо одного візиту зі зв'язкою, щоб в офлайні
 * працювали ВСІ кнопки груп (1/1…6/2), а не лише та, яку натиснули востаннє.
 */
export const upcomingGroupOutagesQueryOptions = (region?: string, days = 2) => ({
  queryKey: ['upcomingGroupOutages', region, days],
  queryFn: async ({ signal }: { signal?: AbortSignal }) => {
    const response = await api.fetchUpcomingGroupOutages(region, days, signal);
    // Коды груп зводимо до канонічної форми області (Київ: «3» → «3/1»): інакше активна група
    // в сітці не знаходила свої інтервали, а офлайн-снимок писався під іншою кодировкою.
    const data = (response?.data ?? []).map((item: GroupOutageSummary) => ({
      ...item,
      queue: canonicalQueueCode(region, item.queue),
    }));
    // Пишемо лише успішну непорожню відповідь: невдача чи порожня відповідь не мають затерти
    // вчорашній робочий графік, бо інакше після однієї помилки офлайн стане порожнім назавжди.
    if (region && data.length > 0) {
      writeRegionScheduleSnapshot(region, data);
    }
    return { ...response, data };
  },
  enabled: Boolean(region),
  staleTime: 60_000,
  refetchInterval: OUTAGE_POLL_MS,
});

export const useUpcomingGroupOutages = (region?: string, days = 2) =>
  useQuery<{ data: GroupOutageSummary[] }>(upcomingGroupOutagesQueryOptions(region, days));

/**
 * Каталог областей з дзеркала (GET /api/v1/regions, контракт /tmp/API-CONTRACT-regions.md).
 * Кеш 5 хвилин (Cache-Control: public, max-age=300).
 */
export const useRegions = () =>
  useQuery<RegionListResponse>({
    queryKey: ['regions'],
    queryFn: async ({ signal }) => {
      const response = await api.fetchRegions(signal);
      // Список групп каталога — единственный источник для сетки выбора. Приводим к каноническим
      // кодам области, чтобы кнопка группы совпадала с выбранной и с кодом запроса графика.
      return {
        ...response,
        data: (response?.data ?? []).map((region: RegionSummary) => ({
          ...region,
          queues: canonicalQueueListForRegion(region.cpu, region.queues ?? []),
        })),
      };
    },
    staleTime: 300_000,
  });

export const useStreetSchedule = (street: string, date: string) =>
  useQuery<{ data: StreetScheduleData }>({
    queryKey: ['streetSchedule', street, date],
    queryFn: () => api.fetchStreetSchedule(street, date),
    enabled: street.trim().length >= 2,
  });

/**
 * График очереди на дату и область. Раньше страница «Головна» ходила в сеть своим fetch-ем — теперь
 * единственный путь (api/client.ts), а кэш общий с остальными экранами.
 *
 * Тип — конверт `{ data: ... }`, как у остальных хуков: fetcher() возвращает тело ответа целиком,
 * а API отдаёт график внутри `data`. Без `.data` на экране была пустая главная.
 *
 * ОФЛАЙН-ФОЛБЭК. Пока идёт запрос, при ошибке и при отсутствии сети берём интервалы этой группы
 * из снимка области (useUpcomingGroupOutages). Без этого каждая кнопка группы в офлайне работала
 * бы только после нажатия со связью — то есть на телефоне почти никогда.
 */
export const useQueueSchedule = (queue: string | undefined, date: string, region?: string) => {
  const query = useQuery<{ data: QueueScheduleData }>({
    queryKey: ['queueSchedule', queue, date, region],
    queryFn: () => api.fetchQueueSchedule(queue as string, date, region),
    enabled: Boolean(queue),
    staleTime: 60_000,
    refetchInterval: OUTAGE_POLL_MS,
  });

  // Снимок берём только когда реального ответа нет: успешный сетевой ответ всегда важнее
  // вчерашнего офлайна, иначе приложение застряло бы на старом графике.
  const fallback = useMemo(() => {
    if (query.isSuccess || !region) return null;
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    if (!offline && !query.isError && !query.isLoading) return null;
    return pickRegionSchedule(region, queue, date);
  }, [query.isSuccess, query.isError, query.isLoading, region, queue, date]);

  // Ошибку сети при этом НЕ маскируем: query.isError остаётся, и человек видит баннер офлайна.
  // `isFallback` добавлен, чтобы экран мог показать, что график взят из снимка, а не свежий.
  if (fallback && !query.isSuccess) {
    return { ...query, data: { data: fallback }, isFallback: true };
  }
  return { ...query, isFallback: false };
};

/**
 * Ручной запуск парсинга джерел оператора (нужен админ-токен). После успеха инвалидирует всё,
 * что показывает отключения и статус, — человек сразу видит свежий снимок, не дожидаясь планировщика.
 */
export const useParseNow = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (token: string) => api.parseNow(token),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['outages'] });
      void queryClient.invalidateQueries({ queryKey: ['outagesStats'] });
      void queryClient.invalidateQueries({ queryKey: ['status'] });
      void queryClient.invalidateQueries({ queryKey: ['incidents'] });
      void queryClient.invalidateQueries({ queryKey: ['reliability'] });
      void queryClient.invalidateQueries({ queryKey: ['queueSchedule'] });
    },
  });
};

/**
 * Автозавантаження погодинного графіка ГПВ з оператора (потрібен адмін-токен).
 * Капчі на ендпоінті оператора немає, персональних даних він не містить — у запиті лише черга й дата.
 * Після успіху інвалідирує графік черги та список черг: новий імпорт видно одразу.
 */
export const useFetchScheduleNow = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { queue: string; date: string; token: string }) =>
      api.fetchScheduleNow(input.queue, input.date, input.token),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['queueSchedule'] });
      void queryClient.invalidateQueries({ queryKey: ['queues'] });
      void queryClient.invalidateQueries({ queryKey: ['streetSchedule'] });
    },
  });
};

/**
 * Імпорт ГПВ з публічного Telegram-каналу оператора (потрібен адмін-токен).
 * Без капчі й без персональних даних: бекенд бере вже збережені пости каналу. Після успіху
 * інвалідирує графік черги та список черг — нові слоти видно одразу.
 */
export const useImportTelegramSchedule = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (token: string) => api.importTelegramSchedule(token),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['queueSchedule'] });
      void queryClient.invalidateQueries({ queryKey: ['queues'] });
      void queryClient.invalidateQueries({ queryKey: ['streetSchedule'] });
    },
  });
};

/**
 * Новини області: пости Telegram-каналів (оператор, Укренерго) + RSS місцевих ЗМІ.
 * Збір іде фоново (раз на NEWS_COLLECT_INTERVAL_MIN хв), тому 5 хв кешу й опитування раз на
 * 10 хв: свіже з'являється саме собою, без ручного оновлення сторінки.
 */
const NEWS_STALE_MS = 5 * 60_000;
const NEWS_POLL_MS = 10 * 60_000;

export const useNews = (filters?: {
  region?: string;
  kind?: string;
  excludeKind?: string;
  ukraineWide?: boolean;
  limit?: number;
  /** Не выполнять запрос, пока условие не выполнено (например, ждём пустую региональную выдачу). */
  enabled?: boolean;
}) =>
  useQuery<NewsListResponse>({
    enabled: filters?.enabled ?? true,
    queryKey: ['news', filters],
    staleTime: NEWS_STALE_MS,
    refetchInterval: NEWS_POLL_MS,
    queryFn: () => {
      const params: Record<string, string> = {};
      if (filters?.region) params.region = filters.region;
      if (filters?.kind) params.kind = filters.kind;
      if (filters?.excludeKind) params.excludeKind = filters.excludeKind;
      if (filters?.ukraineWide) params.ukraineWide = 'true';
      if (filters?.limit) params.limit = String(filters.limit);
      return api.fetchNews(Object.keys(params).length > 0 ? params : undefined);
    },
  });

/**
 * Чейджлог приложения с сервера.
 *
 * Раньше список жил внутри бандла, поэтому о серверных фиксах пользователь узнавал только
 * после следующей пересборки APK. Теперь он приходит по сети; при обрыве связи сработает
 * общий офлайн-кеш (api/offline-cache.ts), а если кеша нет — встроенная копия из бандла.
 */
export const useChangelog = () =>
  useQuery<{ data: ChangelogFile }>({
    queryKey: ['changelog'],
    queryFn: ({ signal }) => api.fetchChangelog(signal),
    staleTime: 10 * 60_000,
    refetchInterval: 30 * 60_000,
    retry: 1,
  });

/**
 * Последняя серверная сборка. Опрашиваем при запуске и раз в 6 часов, пока приложение открыто.
 * Ошибку сети наружу не показываем: отсутствие связи — не повод рисовать красную плашку, окно
 * обновления просто появится при следующем успешном запуске.
 */
export const useAppVersion = () =>
  useQuery<{ data: AppVersionInfo }>({
    queryKey: ['appVersion'],
    queryFn: ({ signal }) => api.fetchVersion(signal),
    staleTime: 6 * 60 * 60_000,
    refetchInterval: 6 * 60 * 60_000,
    refetchOnWindowFocus: true,
    retry: 0,
  });

/** Джерела збору новин: скільки їх і чи не сиплються (lastError видно в UI). */
export const useNewsSources = () =>
  useQuery<NewsSourcesResponse>({
    queryKey: ['newsSources'],
    staleTime: NEWS_STALE_MS,
    queryFn: () => api.fetchNewsSources(),
  });

/**
 * Подсказки НП области: сначала статический пак с CDN, затем серверный справочник.
 *
 * Статический пак — не кеш, а замена D1-поиску: пока он есть, ввод символов не тратит
 * `rows_read`. Сервер остаётся фолбэком для областей без паков и на время обновления сборки.
 */
export const useAddressSettlements = (region: string, query: string) => {
  const debouncedQuery = useDebouncedValue(query);
  return useQuery<{
    data: Array<{
      name: string;
      normalized?: string;
      defaultQueue?: string | null;
      queues?: string[];
      wholeSettlementQueue?: string | null;
      streetsCount?: number;
    }>;
  }>({
    queryKey: ['addressSettlements', region, debouncedQuery],
    queryFn: async ({ signal }) => {
      const pack = await searchPackSettlements(region, debouncedQuery);
      if (pack) {
        return {
          data: pack.map((item) => ({
            name: item.name,
            normalized: item.normalized,
            queues: item.queues,
            wholeSettlementQueue: item.wholeSettlementQueue ?? null,
            streetsCount: item.streetsCount,
          })),
        };
      }
      return api.fetchAddressSettlements({ region, q: debouncedQuery }, signal);
    },
    // Пустой запрос не ищем: справочник НП большой, а подсказки всё равно начинаются с 2 символов.
    enabled: region.length > 0 && debouncedQuery.trim().length >= 2,
    staleTime: 10 * 60_000,
  });
};

/**
 * Улицы выбранного НП: быстрые чипы под полем поиска.
 *
 * Это query, а не part of resolve: улицы нужны ещё до ввода дома, и один запрос покрывает
 * весь экран. Кэш 5 минут — справочник меняется при импорте, а не каждую минуту.
 */
export const useAddressStreets = (region: string, settlement: string, query: string) => {
  const debouncedQuery = useDebouncedValue(query);
  return useQuery<AddressStreetsResponse>({
    queryKey: ['addressStreets', region, settlement, debouncedQuery],
    queryFn: async ({ signal }) => {
      const pack = await fetchPackStreets(region, settlement, debouncedQuery);
      if (pack) return pack;
      return api.fetchAddressStreets({ region, settlement, q: debouncedQuery }, signal);
    },
    // Без введённой улицы запрос не нужен: для Києва он читает шард на 2 400 вулиць,
    // а серверный фолбэк — до 4 000 строк D1 на каждый символ.
    enabled: region.length > 0 && settlement.trim().length >= 2 && debouncedQuery.trim().length >= 2,
    staleTime: 5 * 60_000,
  });
};

/** Дома выбранной улицы с группами — чипы номеров и их очередь. */
export const useAddressHouses = (region: string, settlement: string, street: string) =>
  useQuery<AddressHousesResponse>({
    queryKey: ['addressHouses', region, settlement, street],
    queryFn: async ({ signal }) => {
      const pack = await fetchPackHouses(region, settlement, street);
      if (pack) return pack;
      return api.fetchAddressHouses({ region, settlement, street }, signal);
    },
    enabled: region.length > 0 && settlement.trim().length >= 2 && street.trim().length >= 2,
    staleTime: 5 * 60_000,
  });

/**
 * Поиск своей группы ГПВ по адресу (мастер «область → НП → улица → дом»).
 *
 * Это mutation, а не query: у него есть конкретный ввод и побочный эффект (бэкенд мог дозагрузить
 * привязку у провайдера). Результат кэшировать нельзя — привязка может появиться после первого
 * запроса, и человек должен иметь возможность спросить заново.
 */
export const useAddressLookup = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: AddressResolveInput) => {
      const pack = await resolvePackAddress(params.region, params);
      if (pack) return pack;
      return api.resolveAddressQueue(params);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['addressSettlements'] });
      void queryClient.invalidateQueries({ queryKey: ['addressStreets'] });
      void queryClient.invalidateQueries({ queryKey: ['queueSchedule'] });
    },
  });
};


