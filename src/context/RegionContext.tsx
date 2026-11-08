import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { useRegions } from '@svitlo/core/api/queries';
import {
  DEFAULT_REGION,
  DEFAULT_REGION_NAME_UA,
  getStoredRegion,
  normalizeRegionCpu,
  setStoredRegion,
  type RegionSummary,
} from '@svitlo/core/lib/region';

/**
 * Активная область для всего приложения.
 *
 * Отличие от веба: там область ещё живёт в URL (`?region=`), чтобы ссылку можно было передать.
 * В мобильном ссылок нет, поэтому источник один — key-value хранилище, а состояние дублирует
 * его только для реактивности. Логика выбора и фолбэков (старый код фида в `feedKeys`, область
 * по умолчанию) вынесена в `@svitlo/core/lib/region` и не копируется.
 */
export interface RegionContextValue {
  currentRegion: string;
  setRegion: (cpu: string) => void;
  regions: RegionSummary[];
  currentRegionData: RegionSummary;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => Promise<unknown>;
}

const RegionContext = createContext<RegionContextValue | null>(null);

const DEFAULT_REGION_FALLBACK: RegionSummary = {
  cpu: DEFAULT_REGION,
  nameUa: DEFAULT_REGION_NAME_UA,
  nameEn: null,
  queues: [],
  slots: 0,
  lastDate: null,
};

export function RegionProvider({ children }: { children: ReactNode }) {
  const [currentRegion, setCurrentRegionState] = useState<string>(() => getStoredRegion());
  const { data: regionsResponse, isLoading, isError, error, refetch } = useRegions();

  const regions = useMemo<RegionSummary[]>(() => regionsResponse?.data ?? [], [regionsResponse]);

  const setRegion = useCallback((nextCpu: string) => {
    const clean = normalizeRegionCpu(nextCpu);
    setCurrentRegionState(clean);
    setStoredRegion(clean);
  }, []);

  const currentRegionData = useMemo<RegionSummary>(() => {
    const found = regions.find((region) => region.cpu === currentRegion);
    if (found) return found;
    // Каталог больше не отдаёт старые коды фидов, зато хранит их в `feedKeys` — ищем и там,
    // иначе выбранная из офлайн-пакета область показала бы «Черга:» без кнопок.
    const viaFeedKey = regions.find((region) => (region.feedKeys ?? []).includes(currentRegion));
    if (viaFeedKey) return viaFeedKey;
    if (currentRegion === DEFAULT_REGION) return DEFAULT_REGION_FALLBACK;
    return {
      cpu: currentRegion,
      nameUa: currentRegion,
      nameEn: null,
      queues: [],
      slots: 0,
      lastDate: null,
    };
  }, [regions, currentRegion]);

  const value = useMemo<RegionContextValue>(
    () => ({
      currentRegion,
      setRegion,
      regions,
      currentRegionData,
      isLoading,
      isError,
      error: error instanceof Error ? error : null,
      refetch,
    }),
    [currentRegion, setRegion, regions, currentRegionData, isLoading, isError, error, refetch],
  );

  return <RegionContext.Provider value={value}>{children}</RegionContext.Provider>;
}

export function useRegion(): RegionContextValue {
  const context = useContext(RegionContext);
  if (!context) throw new Error('useRegion must be used inside RegionProvider');
  return context;
}
