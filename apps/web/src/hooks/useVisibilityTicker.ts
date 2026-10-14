import { useEffect, useState } from 'react';

/**
 * Секундный тик, который ОСТАНАВЛИВАЕТСЯ, когда вкладка не видна.
 *
 * Зачем: таймер обратного отсчёта в Hero обновляет текст раз в секунду. Если он тикает в
 * фоновой вкладке, он будит CPU телефона каждую секунду — а приложение открывают именно
 * тогда, когда телефон лежит в кармане. Page Visibility API даёт честный ответ «показывают
 * ли меня сейчас», и мы на него опираемся.
 *
 * Возвращает Date, а не число: React должен получить новое значение, а мутировать Date
 * нельзя — компонент просто не перерисуется.
 */
export function useVisibilityTicker(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  const [visible, setVisible] = useState(
    () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
  );

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVisibility = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    // Невидимая вкладка: тик не нужен вообще, поэтому таймер даже не создаётся.
    if (!visible) return;
    const timer = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(timer);
  }, [visible, intervalMs]);

  return now;
}
