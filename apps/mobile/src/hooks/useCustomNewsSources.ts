import { useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import type { NewsItem } from '@svitlo/shared';

import { triggerSoftHaptic } from '@/lib/haptics';
import {
  createCustomSource,
  fetchCustomSource,
  loadCustomSources,
  normalizeSourceUrl,
  saveCustomSources,
  type CustomNewsSource,
} from '@/lib/custom-news';

/** Загальний ліміт зшитої стрічки власних джерел — щоб лента не розривалася від одного каналу. */
const MAX_COMBINED_ITEMS = 60;

/**
 * Власні джерела новин: список у локальному kv-store, пости фетчаться клієнтськи
 * через react-query (клієнт глобальний від @svitlo/core) і підмішуються в загальну ленту.
 */
export function useCustomNewsSources(): {
  sources: CustomNewsSource[];
  items: NewsItem[];
  loading: boolean;
  errors: Record<string, string>;
  addSource: (input: string) => { ok: boolean; error?: string };
  removeSource: (id: string) => void;
  refetchCustom: () => void;
} {
  const [sources, setSources] = useState<CustomNewsSource[]>(() => loadCustomSources());
  const queryClient = useQueryClient();

  // Ключ містить ідентифікатори: змінився набір джерел → новий запит, без стопки станів.
  const ids = useMemo(() => sources.map((source) => source.id).join(','), [sources]);

  const { data, isPending, refetch } = useQuery({
    queryKey: ['customNews', ids],
    queryFn: async (): Promise<{ items: NewsItem[]; errors: Record<string, string> }> => {
      const results = await Promise.allSettled(sources.map((source) => fetchCustomSource(source)));
      const items: NewsItem[] = [];
      const errors: Record<string, string> = {};
      sources.forEach((source, index) => {
        const result = results[index];
        if (!result) return;
        if (result.status === 'fulfilled') {
          items.push(...result.value);
        } else {
          errors[source.id] =
            result.reason instanceof Error ? result.reason.message : 'Не вдалося прочитати джерело';
        }
      });
      return { items, errors };
    },
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
    enabled: sources.length > 0,
  });

  // Свіжіші вище, пости без дати — у кінець; обрізаємо до ліміту.
  const items = useMemo(() => {
    const list = data?.items ?? [];
    return [...list]
      .sort((a, b) => {
        if (a.publishedAt === null && b.publishedAt === null) return 0;
        if (a.publishedAt === null) return 1;
        if (b.publishedAt === null) return -1;
        return Date.parse(b.publishedAt) - Date.parse(a.publishedAt);
      })
      .slice(0, MAX_COMBINED_ITEMS);
  }, [data]);

  const addSource = useCallback(
    (input: string): { ok: boolean; error?: string } => {
      const normalized = normalizeSourceUrl(input);
      if (!normalized) return { ok: false, error: 'Це не схоже на RSS-посилання або Telegram-канал' };
      if (sources.some((source) => source.url === normalized.url)) {
        return { ok: false, error: 'Це джерело вже додано' };
      }
      const next = [...sources, createCustomSource(normalized)];
      setSources(next);
      saveCustomSources(next);
      triggerSoftHaptic();
      void queryClient.invalidateQueries({ queryKey: ['customNews'] });
      return { ok: true };
    },
    [sources, queryClient],
  );

  const removeSource = useCallback(
    (id: string) => {
      const next = sources.filter((source) => source.id !== id);
      setSources(next);
      saveCustomSources(next);
      triggerSoftHaptic();
    },
    [sources],
  );

  const refetchCustom = useCallback(() => {
    void refetch();
  }, [refetch]);

  return {
    sources,
    items,
    loading: sources.length > 0 && isPending,
    errors: data?.errors ?? {},
    addSource,
    removeSource,
    refetchCustom,
  };
}
