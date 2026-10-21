import { useEffect, useState } from 'react';

/**
 * «Сейчас» с обновлением раз в `intervalMs` (по умолчанию 30 с).
 *
 * Тик нужен таймеру, волне и белой риске на шкале. Не секундный: на телефоне в кармане
 * лишние пробуждения CPU не стоят точности, а получасовые границы всё равно круглые.
 */
export function useMinuteTicker(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return now;
}
