import { createContext, useContext, useMemo, type ReactNode } from 'react';

import type { SyncState } from '@svitlo/core/api/offline-sync';

import { useOfflineSync } from '@/hooks/useOfflineSync';

interface SyncContextValue {
  state: SyncState;
  refresh: () => void;
}

const SyncContext = createContext<SyncContextValue | null>(null);

/**
 * Одна фонова синхронізація на застосунок.
 *
 * `useOfflineSync` вішає таймер і підписку на `AppState`; якщо викликати його в шапці КОЖНОГО
 * екрана, чотири екрани в стеку вкладок тримали б чотири таймери й смикали `/sync` одночасно.
 * Провайдер викликає хук один раз, а шапка лише читає стан.
 */
export function SyncProvider({ children }: { children: ReactNode }) {
  const sync = useOfflineSync();
  const value = useMemo(() => ({ state: sync.state, refresh: sync.refresh }), [sync.state, sync.refresh]);
  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSyncStatus(): SyncContextValue {
  const context = useContext(SyncContext);
  if (!context) throw new Error('useSyncStatus must be used inside SyncProvider');
  return context;
}
