import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

/**
 * «Сейчас» с обновлением раз в `intervalMs` (по умолчанию 30 с).
 *
 * Если вкладка не в фокусе (`enabled === false`), таймер спит и не пробуждает CPU.
 * При возвращении в фокус время мгновенно синхронизируется с системными часами,
 * а при возврате приложения из фона — по `AppState`: пока процесс спал, таймер
 * мог не сработать ни разу, и без этого экран показывал бы время из прошлого.
 */
export function useMinuteTicker(intervalMs = 30_000, enabled = true): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!enabled) return;

    const sync = () => setNow(new Date());

    // Відкладаємо синхронізацію часу на 150 мс після повернення фокусу,
    // щоб не блокувати 130-мс анімацію переходу важким перерахунком черг
    const timeout = setTimeout(sync, 150);

    const timer = setInterval(sync, intervalMs);
    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'active') sync();
    });

    return () => {
      clearTimeout(timeout);
      clearInterval(timer);
      subscription.remove();
    };
  }, [intervalMs, enabled]);

  return now;
}
