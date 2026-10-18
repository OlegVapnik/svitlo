import { useEffect, useMemo, useState } from 'react';

export interface WindowProgress {
  progress: number;
  elapsedMinutes: number;
  remainingMinutes: number;
}

/**
 * Прогресс активного окна: «минуло / залишилось».
 *
 * Один таймер на 30 секунд и только пока окно активно. Плановое отключение длится часы, поэтому
 * минутного шага достаточно; частый таймер гортал бы список без видимой смены цифр. Неактивное
 * окно не держит интервал вообще.
 */
export function useWindowProgress(
  startsAt: string,
  endsAt: string,
  active: boolean,
): WindowProgress | null {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [active, startsAt, endsAt]);

  return useMemo(() => {
    if (!active) return null;
    const start = Date.parse(startsAt);
    const end = Date.parse(endsAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    const totalMinutes = Math.round((end - start) / 60_000);
    const elapsedMinutes = Math.min(totalMinutes, Math.max(0, Math.round((nowMs - start) / 60_000)));
    return {
      progress: Math.min(100, Math.max(0, (elapsedMinutes / totalMinutes) * 100)),
      elapsedMinutes,
      remainingMinutes: Math.max(0, totalMinutes - elapsedMinutes),
    };
  }, [active, startsAt, endsAt, nowMs]);
}
