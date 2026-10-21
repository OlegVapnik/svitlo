import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useRegion } from '../context/RegionContext.js';
import {
  SYNC_INTERVAL_MS,
  getSyncState,
  hydrateStoredRegion,
  isRegionHydrated,
  subscribeSyncState,
  syncNow,
  type SyncState,
} from '../api/offline-sync.js';

/**
 * Состояние синхронизации для интерфейса.
 *
 * `useSyncExternalStore`, а не `useState` + `useEffect`: состояние живёт в api/offline-sync.ts
 * (его меняет и гидратация до первого рендера, и фоновые обновления), и хук здесь — только
 * подписка. Копия в локальном состоянии разъезжалась бы с настоящим состоянием.
 */
export function useSyncStatus(): SyncState {
  return useSyncExternalStore(subscribeSyncState, getSyncState, getSyncState);
}

export interface OfflineSyncApi {
  state: SyncState;
  /** Область, к которой относится состояние. */
  region: string;
  /** Ручная синхронизация: кнопка «Оновити» в индикаторе шапки. */
  refresh: () => void;
}

/**
 * Фоновая синхронизация активной области.
 *
 * Когда ходим в сеть:
 *   - сразу после старта — чтобы офлайн-пакет был актуален уже на главной;
 *   - при появлении связи (`online`) — это самый частый случай в дороге: связь то пропадает,
 *     то возвращается;
 *   - при возврате во вкладку, но не чаще интервала — иначе каждое переключение вкладки
 *     превращалось бы в запрос;
 *   - раз в `SYNC_INTERVAL_MS`, пока вкладка видима.
 *
 * При смене области пакет новой области сначала берём с диска и только потом обновляем из сети:
 * между выбором области в шапке и ответом сервера экран уже показывает то, что знает.
 */
export function useOfflineSync(): OfflineSyncApi {
  const { currentRegion } = useRegion();

  useEffect(() => {
    if (!currentRegion) return;
    // На старте приложения пакет уже разложен в main.tsx (hydrateOfflineStartup) — повторять
    // гидратацию не нужно; здесь она нужна только для области, выбранной уже в сессии.
    if (!isRegionHydrated(currentRegion)) hydrateStoredRegion(currentRegion);
    void syncNow(currentRegion);
  }, [currentRegion]);

  useEffect(() => {
    if (typeof window === 'undefined' || !currentRegion) return;

    const handleOnline = () => void syncNow(currentRegion);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void syncNow(currentRegion);
    };

    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibility);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void syncNow(currentRegion);
    }, SYNC_INTERVAL_MS);

    return () => {
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.clearInterval(timer);
    };
  }, [currentRegion]);

  const refresh = useCallback(() => {
    void syncNow(currentRegion);
  }, [currentRegion]);

  return { state: useSyncStatus(), region: currentRegion, refresh };
}
