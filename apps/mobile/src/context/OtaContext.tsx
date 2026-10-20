import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { confirmOtaBoot, downloadOtaBundle, fetchOtaBundleInfo, pendingOtaVersion } from '@/lib/ota';

interface OtaContextValue {
  /** Версия скачанного JS-бандла, ждущего следующего запуска. */
  readyVersion: string | null;
  dismiss: () => void;
}

const OtaContext = createContext<OtaContextValue | null>(null);

/**
 * Второй контур OTA: подтверждает удачный старт и в фоне скачивает новый JS-бандл.
 *
 * Провайдер стоит под QueryClientProvider (нужен useAppVersion). Показ баннера — отдельно:
 * скачивание не должно блокировать первый экран, а применяется бандл только при следующем
 * запуске, когда нативный загрузчик увидит подтверждённый файл.
 */
export function OtaProvider({ children }: { children: ReactNode }) {
  const [readyVersion, setReadyVersion] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Успешный монтаж = прошлый бандл рабочий: снимаем маркер отката и фиксируем SHA.
    // Ждём подтверждение, иначе `pendingOtaVersion()` успевает прочитать старый meta.json
    // и на один кадр показывает баннер про уже применённое обновление.
    void (async () => {
      await confirmOtaBoot();
      const version = await pendingOtaVersion();
      if (version) setReadyVersion(version);
    })();
  }, []);

  useEffect(() => {
    let active = true;
    const check = async () => {
      const info = await fetchOtaBundleInfo();
      if (!active || !info) return;
      const downloaded = await downloadOtaBundle(info);
      if (active && downloaded) setReadyVersion(downloaded);
    };
    void check();
    const timer = setInterval(() => void check(), 6 * 60 * 60_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  const value = useMemo<OtaContextValue>(
    () => ({
      readyVersion: dismissed ? null : readyVersion,
      dismiss: () => setDismissed(true),
    }),
    [dismissed, readyVersion],
  );

  return <OtaContext.Provider value={value}>{children}</OtaContext.Provider>;
}

export function useOta(): OtaContextValue {
  const context = useContext(OtaContext);
  if (!context) throw new Error('useOta must be used inside OtaProvider');
  return context;
}
