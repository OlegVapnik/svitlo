import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { storage } from '@svitlo/core';

const LIVE_KEY = 'mobile.liveNotification';
const EARLY_KEY = 'mobile.earlyLightDetector';

interface SettingsContextValue {
  /** Постоянный индикатор сети в шторке уведомлений. */
  liveNotification: boolean;
  /** Детектор «світло з'явилося раніше графіка» по зарядке. */
  earlyLightDetector: boolean;
  setLiveNotification: (value: boolean) => void;
  setEarlyLightDetector: (value: boolean) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

function readBool(key: string, fallback: boolean): boolean {
  try {
    const raw = storage.getItem(key);
    if (raw == null) return fallback;
    return raw === 'true';
  } catch {
    return fallback;
  }
}

/**
 * Настройки нативных фич. Хранятся в том же kv-store, что и офлайн-кеш, поэтому читаются
 * до первого рендера и переживают перезапуск.
 */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [liveNotification, setLiveState] = useState(() => readBool(LIVE_KEY, false));
  const [earlyLightDetector, setEarlyState] = useState(() => readBool(EARLY_KEY, true));

  const setLiveNotification = useCallback((value: boolean) => {
    setLiveState(value);
    try {
      storage.setItem(LIVE_KEY, value ? 'true' : 'false');
    } catch {
      /* хранилище недоступно — фича просто не запомнится */
    }
  }, []);

  const setEarlyLightDetector = useCallback((value: boolean) => {
    setEarlyState(value);
    try {
      storage.setItem(EARLY_KEY, value ? 'true' : 'false');
    } catch {
      /* см. выше */
    }
  }, []);

  const value = useMemo(
    () => ({ liveNotification, earlyLightDetector, setLiveNotification, setEarlyLightDetector }),
    [liveNotification, earlyLightDetector, setLiveNotification, setEarlyLightDetector],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) throw new Error('useSettings must be used inside SettingsProvider');
  return context;
}
