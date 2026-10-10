import React, { createContext, useContext, useMemo, useState } from 'react';
import { useRegions } from '../api/queries.js';
import {
  DEFAULT_REGION,
  DEFAULT_REGION_NAME_UA,
  getStoredRegion,
  normalizeRegionCpu,
  setStoredRegion,
  type RegionSummary,
} from '../lib/region.js';

export interface RegionContextValue {
  /** Поточний активний cpu області (наприклад, 'chernihivska-oblast'). */
  currentRegion: string;
  /** Змінити активну область (зберігається в localStorage). */
  setRegion: (cpu: string) => void;
  /** Список доступних областей з API (GET /api/v1/regions). */
  regions: RegionSummary[];
  /** Дані поточної обраної області або дефолтний об'єкт. */
  currentRegionData: RegionSummary;
  /** Ознака завантаження каталогу областей. */
  isLoading: boolean;
  /** Ознака помилки запиту каталогу областей. */
  isError: boolean;
}

const RegionContext = createContext<RegionContextValue | null>(null);

/** Фолбек-об'єкт області за замовчуванням, якщо API недоступний або ще завантажується. */
const DEFAULT_REGION_FALLBACK: RegionSummary = {
  cpu: DEFAULT_REGION,
  nameUa: DEFAULT_REGION_NAME_UA,
  nameEn: null,
  queues: [],
  slots: 0,
  lastDate: null,
};

export const RegionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentRegion, setCurrentRegionState] = useState<string>(() => getStoredRegion());
  const { data: regionsResponse, isLoading, isError } = useRegions();

  const regions = useMemo<RegionSummary[]>(
    () => regionsResponse?.data ?? [],
    [regionsResponse],
  );

  const setRegion = (nextCpu: string) => {
    const clean = normalizeRegionCpu(nextCpu);
    setCurrentRegionState(clean);
    setStoredRegion(clean);
  };

  const currentRegionData = useMemo<RegionSummary>(() => {
    const found = regions.find((r) => r.cpu === currentRegion);
    if (found) return found;
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
    }),
    [currentRegion, regions, currentRegionData, isLoading, isError],
  );

  return <RegionContext.Provider value={value}>{children}</RegionContext.Provider>;
};

export function useRegion(): RegionContextValue {
  const context = useContext(RegionContext);
  if (!context) {
    throw new Error('useRegion must be used within a RegionProvider');
  }
  return context;
}
