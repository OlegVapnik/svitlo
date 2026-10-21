import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import {
  SYNC_INTERVAL_MS,
  getSyncState,
  hydrateStoredRegion,
  isRegionHydrated,
  subscribeSyncState,
  syncNow,
  type SyncState,
} from '@svitlo/core/api/offline-sync';

import { useRegion } from '@/context/RegionContext';

/**
 * Фоновая синхронизация офлайн-пакета активной области.
 *
 * Отличие от веба: вместо вкладки (`visibilitychange`) следим за жизненным циклом приложения
 * (`AppState`), а вместо `online`-события — за возвратом в активное состояние, где и проверяем
 * связь запросом. Гидратация области на старте уже прошла в корневом layout.
 */
export function useOfflineSync(): { state: SyncState; region: string; refresh: () => void } {
  const { currentRegion } = useRegion();
  const [state, setState] = useState<SyncState>(getSyncState);

  useEffect(() => {
    // Состояние живёт в ядре и меняется и гидратацией, и фоновыми обновлениями — здесь только
    // подписка, без локальной копии, которая разъезжалась бы с настоящим состоянием.
    return subscribeSyncState(() => setState(getSyncState()));
  }, []);

  useEffect(() => {
    if (!currentRegion) return;
    if (!isRegionHydrated(currentRegion)) hydrateStoredRegion(currentRegion);
    void syncNow(currentRegion);
  }, [currentRegion]);

  useEffect(() => {
    if (!currentRegion) return;

    const handleChange = (status: string) => {
      if (status === 'active') void syncNow(currentRegion);
    };
    const subscription = AppState.addEventListener('change', handleChange);
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void syncNow(currentRegion);
    }, SYNC_INTERVAL_MS);

    return () => {
      subscription.remove();
      clearInterval(timer);
    };
  }, [currentRegion]);

  const refresh = useCallback(() => {
    void syncNow(currentRegion);
  }, [currentRegion]);

  return { state, region: currentRegion, refresh };
}
