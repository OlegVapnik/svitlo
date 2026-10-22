import { useEffect, useState } from 'react';
import { Plus, Share2, X } from 'lucide-react';

import {
  dismissIosInstallHint,
  shouldShowIosInstallHint,
} from '@/lib/ios-install.js';

/**
 * Ненавязчивая подсказка для iPhone: как добавить Svitlo на домашний экран.
 *
 * Показывается только в iOS Safari и только вне standalone-режима. Появляется с задержкой
 * после первой отрисовки, чтобы не спорить с главным экраном, и не перекрывает нижнюю
 * навигацию. Закрытие запоминается на 30 дней — это напоминание, а не модальное окно.
 *
 * Зачем вообще: установленная PWA открывается без адресной строки, работает офлайн и
 * получает safe-area, как нативное приложение. В Safari это две точки: «Поділитися» →
 * «На початковий екран».
 */
export function IosInstallHint() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return;

    const standaloneQuery = window.matchMedia?.('(display-mode: standalone)');
    const env = {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      maxTouchPoints: navigator.maxTouchPoints,
      standalone: (navigator as Navigator & { standalone?: boolean }).standalone,
      displayModeStandalone: standaloneQuery?.matches ?? false,
    };

    if (!shouldShowIosInstallHint(localStorage, env)) return;

    // Не выпрыгиваем в первые 2,5 секунды: человек ещё читает статус света.
    const timer = window.setTimeout(() => setVisible(true), 2500);

    const onInstalled = () => setVisible(false);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    dismissIosInstallHint(localStorage);
    setVisible(false);
  };

  return (
    <aside
      aria-label="Встановлення Svitlo на iPhone"
      className="fixed inset-x-3 bottom-28 z-50 rounded-2xl border border-outline-variant/60 bg-surface-container-high p-3 shadow-pop md:hidden"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-container text-on-primary-container">
          <Plus className="h-5 w-5" strokeWidth={2.4} aria-hidden />
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold leading-tight">Svitlo на iPhone</p>
          <p className="mt-1 text-xs leading-snug text-on-surface-variant">
            Працює офлайн і відкривається без браузера. Додайте за дві дії:
          </p>
          <ol className="mt-2 flex flex-col gap-1 text-xs font-medium">
            <li className="flex items-center gap-1.5">
              <Share2 className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
              Натисніть <span className="font-bold">«Поділитися»</span> внизу Safari
            </li>
            <li className="flex items-center gap-1.5">
              <Plus className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
              Оберіть <span className="font-bold">«На початковий екран»</span>
            </li>
          </ol>
        </div>

        <button
          type="button"
          onClick={dismiss}
          aria-label="Закрити підказку"
          className="-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-on-surface"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </aside>
  );
}
