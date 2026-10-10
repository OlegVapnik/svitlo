import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useRegions } from '../api/queries.js';
import {
  DEFAULT_REGION,
  DEFAULT_REGION_NAME_UA,
  getStoredRegion,
  isRegionCpu,
  normalizeRegionCpu,
  setStoredRegion,
  type RegionSummary,
} from '../lib/region.js';

export interface RegionContextValue {
  /** Поточний активний cpu області (наприклад, 'chernihivska-oblast'). */
  currentRegion: string;
  /** Змінити активну область (зберігається в localStorage та відображається в URL). */
  setRegion: (cpu: string) => void;
  /** Список доступних областей з API (GET /api/v1/regions). */
  regions: RegionSummary[];
  /** Дані поточної обраної області або дефолтний об'єкт. */
  currentRegionData: RegionSummary;
  /** Ознака завантаження каталогу областей. */
  isLoading: boolean;
  /** Ознака помилки запиту каталогу областей. */
  isError: boolean;
  /** Функція повторного запиту каталогу областей (для кнопки retry). */
  refetch: () => Promise<unknown>;
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

function readRegionFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get('region');
    if (fromUrl && isRegionCpu(fromUrl)) {
      return normalizeRegionCpu(fromUrl);
    }
  } catch {
    // ігноруємо
  }
  return null;
}

function syncUrlRegion(cpu: string): void {
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get('region') !== cpu) {
      url.searchParams.set('region', cpu);
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    }
  } catch {
    // ігноруємо
  }
}

export const RegionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentRegion, setCurrentRegionState] = useState<string>(() => {
    const fromUrl = readRegionFromUrl();
    if (fromUrl) {
      setStoredRegion(fromUrl);
      return fromUrl;
    }
    return getStoredRegion();
  });

  const { data: regionsResponse, isLoading, isError, refetch } = useRegions();

  const regions = useMemo<RegionSummary[]>(
    () => regionsResponse?.data ?? [],
    [regionsResponse],
  );

  const setRegion = (nextCpu: string) => {
    const clean = normalizeRegionCpu(nextCpu);
    setCurrentRegionState(clean);
    setStoredRegion(clean);
    syncUrlRegion(clean);
  };

  // Синхронізуємо URL при зміні стану або монтуванні
  useEffect(() => {
    syncUrlRegion(currentRegion);
  }, [currentRegion]);

  // Слухаємо переходи назад/вперед у браузері
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handlePopState = () => {
      const fromUrl = readRegionFromUrl();
      if (fromUrl && fromUrl !== currentRegion) {
        setCurrentRegionState(fromUrl);
        setStoredRegion(fromUrl);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [currentRegion]);

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
      refetch,
    }),
    [currentRegion, regions, currentRegionData, isLoading, isError, refetch],
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
