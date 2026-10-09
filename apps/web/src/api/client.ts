const API_BASE = import.meta.env['VITE_API_BASE_URL'] || '/api/v1';

async function fetcher(endpoint: string, options?: RequestInit) {
  const res = await fetch(`${API_BASE}${endpoint}`, options);
  if (!res.ok) throw new Error(res.statusText);
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
};