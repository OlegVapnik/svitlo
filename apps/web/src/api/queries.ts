import { useQuery } from '@tanstack/react-query';
import type {
  ContactListResponse,
  IncidentListResponse,
  OutageListResponse,
  OutageStatsResponse,
  OutageDetailResponse,
  OutageStatus,
  QueueScheduleData,
  ReliabilityResponse,
  StatusResponse,
  StreetQueuePair,
  StreetScheduleData,
} from '@svitlo/shared';
import { api } from './client';

type OutageFilters = {
  query?: string;
  status?: OutageStatus;
  queue?: number;
  area?: string;
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

export const useOutages = (filters?: OutageFilters) => useQuery<OutageListResponse>({
  queryKey: ['outages', filters],
  staleTime: OUTAGE_STALE_MS,
  queryFn: () => {
    const params = filters && Object.fromEntries(
      Object.entries(filters).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]),
    );
    return api.fetchOutages(params);
  },
});

export const useOutage = (id: string) => useQuery<OutageDetailResponse>({
  queryKey: ['outage', id],
  queryFn: () => api.fetchOutage(id),
  enabled: !!id,
});

export const useOutageStats = (params?: Record<string, string>) => useQuery<OutageStatsResponse>({
  queryKey: ['outagesStats', params],
  staleTime: OUTAGE_STALE_MS,
  queryFn: () => api.fetchOutageStats(params),
});

export const useIncidents = () => useQuery<IncidentListResponse>({
  queryKey: ['incidents'],
  queryFn: api.fetchIncidents,
  staleTime: OUTAGE_STALE_MS,
  refetchInterval: 60000,
});

export const useStatus = () => useQuery<{ data: StatusResponse }>({
  queryKey: ['status'],
  queryFn: api.fetchStatus,
  // Свежесть данных и пауза источника видны в шапке на каждой странице: короткий интервал обязателен.
  staleTime: STATUS_POLL_MS / 2,
  refetchInterval: STATUS_POLL_MS,
});

export const useReliability = () => useQuery<ReliabilityResponse>({
  queryKey: ['reliability'],
  queryFn: api.fetchReliability,
  refetchInterval: 300000,
});

export const useContacts = () => useQuery<ContactListResponse>({
  queryKey: ['contacts'],
  queryFn: api.fetchContacts,
});

export const useHealth = () => useQuery({
  queryKey: ['health'],
  queryFn: api.fetchHealth,
});

export const useStreetQueues = () => useQuery<{ data: StreetQueuePair[] }>({
  queryKey: ['streetQueues'],
  queryFn: () => api.fetchStreetQueues(),
});

export const useStreetSchedule = (street: string, date: string) => useQuery<{ data: StreetScheduleData }>({
  queryKey: ['streetSchedule', street, date],
  queryFn: () => api.fetchStreetSchedule(street, date),
  enabled: street.trim().length >= 2,
});

/**
 * График очереди на дату. Раньше страница «Головна» ходила в сеть своим fetch-ем — теперь
 * единственный путь (api/client.ts), а кэш общий с остальными экранами.
 */
export const useQueueSchedule = (queue: string | undefined, date: string) => useQuery<{ data: QueueScheduleData }>({
  queryKey: ['queueSchedule', queue, date],
  queryFn: () => api.fetchQueueSchedule(queue as string, date),
  enabled: Boolean(queue),
  staleTime: 60_000,
});
