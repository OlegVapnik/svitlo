import { useEffect } from 'react';

/**
 * Безопасные зоны телефона для CSS.
 *
 * ПОЧЕМУ ЭТО НУЖНО. В браузере высоту строки состояния знает `env(safe-area-inset-top)`.
 * Android-WebView (нативная обёртка Capacitor) inset'ы в CSS не отдаёт вовсе: значение всегда 0,
 * и содержимое приложения рисовалось прямо под часами и иконками батареи — «интерфейс залезал на
 * строку состояния». Нативная сторона (`MainActivity.java`) измеряет зоны через WindowInsets и
 * отдаёт их странице синхронным мостом `window.SvitloInsets`. Здесь они превращаются в CSS-
 * переменные `--safe-top` / `--safe-bottom`, которые читают утилиты `.pt-safe` и `.pb-safe`
 * (globals.css) — берётся максимум из системного значения браузера и нативного.
 *
 * Значения тянутся повторно: WindowInsets приходят от системы после первого раскладки, поэтому
 * одиночный замер на старте мог увидеть 0. Плюс поворот экрана меняет зоны (чёлку сбоку).
 */
interface NativeInsetsBridge {
  top?: () => number;
  bottom?: () => number;
}

declare global {
  interface Window {
    /** Мост из MainActivity (Android-обёртка): top()/bottom() — инсеты в CSS-пикселях. */
    SvitloInsets?: NativeInsetsBridge;
  }
}

export function useSafeAreaInsets(): void {
  useEffect(() => {
    const bridge = window.SvitloInsets;
    if (!bridge?.top && !bridge?.bottom) return;

    const apply = () => {
      const style = document.documentElement.style;
      const top = Math.max(0, Math.round(bridge.top?.() ?? 0));
      const bottom = Math.max(0, Math.round(bridge.bottom?.() ?? 0));
      style.setProperty('--safe-top', `${top}px`);
      style.setProperty('--safe-bottom', `${bottom}px`);
    };

    apply();
    const timers = [150, 500, 1500].map((ms) => window.setTimeout(apply, ms));
    window.addEventListener('resize', apply);
    window.addEventListener('orientationchange', apply);

    return () => {
      for (const timer of timers) window.clearTimeout(timer);
      window.removeEventListener('resize', apply);
      window.removeEventListener('orientationchange', apply);
    };
  }, []);
}
