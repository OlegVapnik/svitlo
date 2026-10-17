/**
 * Тактильний відгук інтерфейсу: короткий «тік» під пальцем.
 *
 * Навіщо. Перемикання черги в сітці 1/1…6/2 і табів унизу — часті дії навпомацки, часто без
 * погляду на екран (у темряві, під час відключення). Вібрація підтверджує, що тап зарахований,
 * і людина не тисне ту саму кнопку вдруге.
 *
 * Два шляхи доставки:
 *   1. нативний міст `window.SvitloHaptics` (MainActivity.java) — `View.performHapticFeedback`,
 *      який не потребує дозволу VIBRATE і поважає системне налаштування тактильного відгуку;
 *   2. `navigator.vibrate` у браузері — короткий імпульс 8–18 мс.
 * Обидва можуть бути недоступні (десктоп, WebView без моста, Safari), тому функція ніколи не
 * кидає виняток і нічого не обіцяє: відсутність вібрації — це не помилка, а нормальний стан.
 */
export type HapticKind = 'tick' | 'select' | 'confirm';

interface NativeHapticsBridge {
  vibrateTick?: (kind: string) => void;
}

declare global {
  interface Window {
    /** Мост из MainActivity (Android-обёртка): тактильный отклик без разрешений. */
    SvitloHaptics?: NativeHapticsBridge;
  }
}

/** Длительность импульса для ветки `navigator.vibrate` (мс) — нативная ветка решает сама. */
const FALLBACK_MS: Record<HapticKind, number> = {
  tick: 8,
  select: 12,
  confirm: 18,
};

export function hapticTick(kind: HapticKind = 'tick'): void {
  if (typeof window === 'undefined') return;

  try {
    const bridge = window.SvitloHaptics;
    // Мост вызывается через рефлексию WebView: если он пересоздан или метод пропал, вызов
    // бросит исключение — тогда честно уходим в браузерную ветку, а не роняем обработчик тапа.
    if (bridge && typeof bridge.vibrateTick === 'function') {
      bridge.vibrateTick(kind);
      return;
    }
  } catch {
    // см. выше: нативный мост — необязательный путь.
  }

  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(FALLBACK_MS[kind]);
    }
  } catch {
    // Вибрация — акцент, а не функция: её отсутствие не должно ломать нажатие.
  }
}
