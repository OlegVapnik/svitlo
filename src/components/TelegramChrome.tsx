/**
 * Хром Telegram Mini App (кнопка «назад» в шапке) — в APK не нужен.
 *
 * Файл-заглушка: Metro подставит `TelegramChrome.web.tsx` в веб-сборку, а нативная сборка
 * получит пустой компонент и не потянет за собой Telegram-код.
 */
export function TelegramChrome() {
  return null;
}
