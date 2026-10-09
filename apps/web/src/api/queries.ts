import { useQuery } from '@tanstack/react-query';
import type {
  ContactListResponse,
  IncidentListResponse,
  OutageListResponse,
  OutageStatsResponse,
  OutageDetailResponse,
  OutageStatus,
  ReliabilityResponse,
  StatusResponse,
  StreetQueuePair,
  StreetScheduleData,
} from '@energy-monitor/shared';
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

export const useOutages = (filters?: OutageFilters) => useQuery<OutageListResponse>({
  queryKey: ['outages', filters],
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
  queryFn: () => api.fetchOutageStats(params),
});

export const useIncidents = () => useQuery<IncidentListResponse>({
  queryKey: ['incidents'],
  queryFn: api.fetchIncidents,
  refetchInterval: 60000,
});

export const useStatus = () => useQuery<{ data: StatusResponse }>({
  queryKey: ['status'],
  queryFn: api.fetchStatus,
  refetchInterval: 30000,
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