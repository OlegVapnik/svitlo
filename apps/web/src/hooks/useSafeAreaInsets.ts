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
    if (!bridge) return;

    const style = document.documentElement.style;
    const write = (name: string, value: number) => {
      // Пишем только при изменении: нативную сторону (MainActivity.pushInsetsToPage) и этот хук
      // связывает один и тот же источник, поэтому лишняя запись — это только лишняя работа
      // раскладки на каждом кадре.
      const next = `${value}px`;
      if (style.getPropertyValue(name) !== next) style.setProperty(name, next);
    };

    const apply = () => {
      try {
        write('--safe-top', Math.max(0, Math.round(bridge.top?.() ?? 0)));
        write('--safe-bottom', Math.max(0, Math.round(bridge.bottom?.() ?? 0)));
      } catch {
        // WebView отдаёт методы моста через рефлексию, и её отказ (смена версии WebView,
        // пересозданный документ) выбрасывал бы исключение внутри эффекта — то есть ронял бы
        // каркас приложения из-за отступа. В этом случае работают env() и нативный push.
      }
    };

    apply();
    const timers = [150, 500, 1500].map((ms) => window.setTimeout(apply, ms));
    const onVisible = () => {
      if (document.visibilityState === 'visible') apply();
    };
    window.addEventListener('resize', apply);
    window.addEventListener('orientationchange', apply);
    window.addEventListener('pageshow', apply);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      for (const timer of timers) window.clearTimeout(timer);
      window.removeEventListener('resize', apply);
      window.removeEventListener('orientationchange', apply);
      window.removeEventListener('pageshow', apply);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
}
