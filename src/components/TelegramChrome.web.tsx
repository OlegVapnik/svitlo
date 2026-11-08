/**
 * Хром Telegram Mini App для веб-сборки.
 *
 * Внутри Telegram нет системной кнопки «назад» — её рисует сам клиент, но включает только по
 * запросу. Показываем её там, где экран вложенный (настройки и прочие `push`-маршруты), и
 * прячем на корневых табах: иначе кнопка «назад» закрывала бы Mini App вместо возврата.
 *
 * Ничего не рендерит — это только синхронизация с `window.Telegram.WebApp`.
 */
import { usePathname, useRouter } from 'expo-router';
import { useEffect } from 'react';

/** Корневые маршруты таб-бара: на них кнопка «назад» не нужна. */
const TAB_ROUTES = new Set(['/', '/search', '/monitor', '/info']);

interface BackButton {
  show?: () => void;
  hide?: () => void;
  onClick?: (handler: () => void) => void;
  offClick?: (handler: () => void) => void;
}

function backButton(): BackButton | undefined {
  if (typeof window === 'undefined') return undefined;
  const telegram = (window as unknown as { Telegram?: { WebApp?: { BackButton?: BackButton } } })
    .Telegram;
  return telegram?.WebApp?.BackButton;
}

export function TelegramChrome() {
  const pathname = usePathname();
  const router = useRouter();
  const isRoot = TAB_ROUTES.has(pathname);

  useEffect(() => {
    const button = backButton();
    if (!button) return;
    if (isRoot) {
      button.hide?.();
      return;
    }
    const handleBack = () => router.back();
    button.onClick?.(handleBack);
    button.show?.();
    return () => {
      button.offClick?.(handleBack);
      button.hide?.();
    };
  }, [isRoot, router]);

  return null;
}
