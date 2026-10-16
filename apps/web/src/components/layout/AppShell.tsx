import { Outlet } from 'react-router-dom';
import { useBatterySaver } from '../../hooks/useBatterySaver.js';
import { useOfflineSync } from '../../hooks/useOfflineSync.js';
import { useOutageNotifications } from '../../hooks/useOutageNotifications.js';
import { Header } from './Header.js';
import { BottomNav } from './BottomNav.js';
import { Sidebar } from './Sidebar.js';

/**
 * Каркас приложения: шапка, боковое меню (desktop), контент, нижняя навигация (mobile).
 * «Skip to content» — первая ссылка на странице: клавиатурой можно проскочить меню.
 *
 * Здесь же запускается фоновая синхронизация офлайн-пакета: каркас живёт всю сессию и не
 * перемонтируется при переходах между экранами, поэтому один таймер обслуживает всё приложение
 * (индикатор в шапке только читает состояние).
 */
export const AppShell = () => {
  // Один вызов на всё приложение: класс ставится на <html> и гасит анимации разом.
  useBatterySaver();
  // Тоже один вызов на всё приложение: внутри таймер, обработчики сети и возврата во вкладку.
  useOfflineSync();
  // И предупреждения об отключениях: они читают тот же кеш, что наполняет офлайн-пакет.
  useOutageNotifications();

  return (
  <div className="flex min-h-dvh flex-col bg-background">
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-60 focus:rounded-lg focus:bg-card focus:px-4 focus:py-2 focus:text-sm focus:shadow-pop"
    >
      Перейти до вмісту
    </a>
    <Header />
    <div className="flex flex-1">
      <Sidebar />
      {/* pb-28 с запасом: таб-бар теперь на 4 пункта и выше (min-h-56px + safe-area), а
          раньше pb-24 прижимался к нему впритык и последняя карточка уезжала под панель. */}
      <main id="main" className="min-w-0 flex-1 px-4 pb-28 pt-4 sm:px-6 md:pb-8 md:pt-6">
        <Outlet />
      </main>
    </div>
    <BottomNav />
  </div>
  );
};
