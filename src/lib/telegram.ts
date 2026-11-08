/**
 * Telegram Mini App: нативная сборка о Telegram ничего не знает.
 *
 * Файл существует только для того, чтобы `_layout.tsx` мог вызывать `initTelegramMiniApp()`
 * и монтировать `TelegramChrome` без `Platform.OS === 'web'`-веток по всему коду: Metro сам
 * подставит `telegram.web.ts` в веб-сборку, а в APK останется этот no-op.
 *
 * Типы возвращаемого значения общие, поэтому менять их нужно в двух файлах сразу.
 */
import type { Metrics } from 'react-native-safe-area-context';

/** Не Mini App: в APK Telegram-объекта нет. */
export function initTelegramMiniApp(): boolean {
  return false;
}

/** Внешние отступы Telegram (безопасные зоны). В APK их считает нативный SafeAreaProvider. */
export function telegramSafeAreaMetrics(): Metrics | null {
  return null;
}

/** Тактильный отклик Telegram. В APK вибрацией управляет `@/lib/haptics`. */
export function telegramHaptic(_kind: 'light' | 'medium' | 'success' | 'error'): void {}
