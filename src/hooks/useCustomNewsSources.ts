import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import type { NewsItem } from '@svitlo/shared';

import { triggerSoftHaptic } from '@/lib/haptics';
import {
  createCustomSource,
  CUSTOM_NEWS_CACHE_TTL_MS,
  fetchCustomSource,
  loadCustomNewsCache,
  loadCustomSources,
  normalizeSourceUrl,
  saveCustomNewsCache,
  saveCustomSources,
  type CustomNewsSource,
} from '@/lib/custom-news';

/** Загальний ліміт зшитої стрічки власних джерел — щоб лента не розривалася від одного каналу. */
const MAX_COMBINED_ITEMS = 60;

const SOURCES_KEY = ['customSources'] as const;
const NEWS_KEY = ['customNews'] as const;

/**
 * Власні джерела новин: список у локальному kv-store, пости фетчаться клієнтсько
 * через react-query (клієнт глобальний від @svitlo/core) і підмішуються в загальну ленту.
 *
 * Список джерел живе в запиті ['customSources'] (початкові дані одразу з kv-store), тому
 * всі екземпляри хука на різних екранах бачать той самий список: додали джерело в
 * налаштуваннях — «Інфо» оновилось автоматично (таби лишаються змонтованими).
 */
export function useCustomNewsSources(): {
  sources: CustomNewsSource[];
  items: NewsItem[];
  loading: boolean;
  errors: Record<string, string>;
  isRefetching: boolean;
  addSource: (input: string) => { ok: boolean; error?: string };
  removeSource: (id: string) => void;
  refetchCustom: () => void;
} {
  const queryClient = useQueryClient();

  // Список джерел як запит: initialData читає kv-store синхронно, тож перший кадр уже з даними.
  const { data: sources = [] } = useQuery({
    queryKey: SOURCES_KEY,
    queryFn: loadCustomSources,
    staleTime: Infinity,
    initialData: () => loadCustomSources(),
  });

  // Ключ містить ідентифікатори: змінився набір джерел → новий запит, без стопки станів.
  const ids = useMemo(() => sources.map((source) => source.id).join(','), [sources]);

  const {
    data,
    isPending,
    isRefetching,
    refetch,
  } = useQuery({
    queryKey: [...NEWS_KEY, ids],
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
      // Вдала збірка оновлює локальний кеш — він стане initialData на наступному холодному старті.
      saveCustomNewsCache(items);
      return { items, errors };
    },
    initialData: () => {
      // Кеш читаємо лише коли джерела є: без них показувати пости видалених каналів не треба.
      if (sources.length === 0) return undefined;
      const cache = loadCustomNewsCache();
      if (cache && Date.now() - cache.savedAt < CUSTOM_NEWS_CACHE_TTL_MS) {
        return { items: cache.items, errors: {} };
      }
      return undefined;
    },
    staleTime: 5 * 60_000,
    gcTime: 60 * 60_000,
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

  /** Єдиний спосіб змінити список: кеш запиту (усі екрани) + kv-store + перечитання постів. */
  const commitSources = useCallback(
    (next: CustomNewsSource[]) => {
      queryClient.setQueryData<CustomNewsSource[]>(SOURCES_KEY, next);
      saveCustomSources(next);
      // Набір джерел змінився — постові запити перечитуємо (ключ ['customNews'] покриває всі ids).
      void queryClient.invalidateQueries({ queryKey: NEWS_KEY });
    },
    [queryClient],
  );

  const addSource = useCallback(
    (input: string): { ok: boolean; error?: string } => {
      const normalized = normalizeSourceUrl(input);
      if (!normalized) return { ok: false, error: 'Це не схоже на RSS-посилання або Telegram-канал' };
      if (sources.some((source) => source.url === normalized.url)) {
        return { ok: false, error: 'Це джерело вже додано' };
      }
      commitSources([...sources, createCustomSource(normalized)]);
      triggerSoftHaptic();
      return { ok: true };
    },
    [sources, commitSources],
  );

  const removeSource = useCallback(
    (id: string) => {
      commitSources(sources.filter((source) => source.id !== id));
      triggerSoftHaptic();
    },
    [sources, commitSources],
  );

  const refetchCustom = useCallback(() => {
    void refetch();
  }, [refetch]);

  return {
    sources,
    items,
    loading: sources.length > 0 && isPending,
    errors: data?.errors ?? {},
    isRefetching,
    addSource,
    removeSource,
    refetchCustom,
  };
}
