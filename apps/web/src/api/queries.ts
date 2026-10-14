import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ContactListResponse,
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
  AddressResolveInput,
} from '@svitlo/shared';
import type { RegionListResponse } from '../lib/region.js';
import { api } from './client';
import { pickRegionSchedule, writeRegionScheduleSnapshot } from './offline-region-schedules.js';

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

export const useReliability = (region?: string) =>
  useQuery<ReliabilityResponse>({
    // region в ключе: иначе переключение области показывало бы цифры прошлой области из кеша.
    queryKey: ['reliability', region ?? null],
    queryFn: ({ signal }) => api.fetchReliability(region, signal),
    refetchInterval: 300000,
  });

export const useContacts = () =>
  useQuery<ContactListResponse>({
    queryKey: ['contacts'],
    queryFn: api.fetchContacts,
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
    queryFn: ({ signal }) => api.fetchQueues(region, signal),
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
export const useUpcomingGroupOutages = (region?: string, days = 2) =>
  useQuery<{ data: GroupOutageSummary[] }>({
    queryKey: ['upcomingGroupOutages', region, days],
    queryFn: async ({ signal }) => {
      const response = await api.fetchUpcomingGroupOutages(region, days, signal);
      // Пишемо лише успішну відповідь: невдача чи порожня відповідь не мають затерти вчорашній
      // робочий графік, бо інакше після однієї помилки офлайн стане порожнім назавжди.
      if (region && Array.isArray(response?.data)) {
        writeRegionScheduleSnapshot(region, response.data);
      }
      return response;
    },
    enabled: Boolean(region),
    staleTime: 60_000,
    refetchInterval: OUTAGE_POLL_MS,
  });

/**
 * Каталог областей з дзеркала (GET /api/v1/regions, контракт /tmp/API-CONTRACT-regions.md).
 * Кеш 5 хвилин (Cache-Control: public, max-age=300).
 */
export const useRegions = () =>
  useQuery<RegionListResponse>({
    queryKey: ['regions'],
    queryFn: ({ signal }) => api.fetchRegions(signal),
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

/** Джерела збору новин: скільки їх і чи не сиплються (lastError видно в UI). */
export const useNewsSources = () =>
  useQuery<NewsSourcesResponse>({
    queryKey: ['newsSources'],
    staleTime: NEWS_STALE_MS,
    queryFn: () => api.fetchNewsSources(),
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
    mutationFn: (params: AddressResolveInput) => api.resolveAddressQueue(params),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['addressSettlements'] });
      void queryClient.invalidateQueries({ queryKey: ['addressStreets'] });
      void queryClient.invalidateQueries({ queryKey: ['queueSchedule'] });
    },
  });
};

/**
 * Народная привязка очереди к адресу (POST /api/v1/addresses/contribute).
 *
 * После успеха инвалидируем `upcomingSchedules`, чтобы график новой группы подтянулся в офлайн-
 * снимок: человек только что помог соседям, и его вклад должен работать и без сети.
 */
export const useContributeAddress = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { region: string; settlement: string; street?: string; house?: string; queue: string }) =>
      api.contributeAddressQueue(params),
    onSuccess: (queue) => {
      if (!queue) return;
      void queryClient.invalidateQueries({ queryKey: ['upcomingGroupOutages'] });
      void queryClient.invalidateQueries({ queryKey: ['upcomingSchedules'] });
      void queryClient.invalidateQueries({ queryKey: ['queueSchedule'] });
    },
  });
};
