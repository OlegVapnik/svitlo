import { Outlet, useLocation } from 'react-router-dom';
import { useBatterySaver } from '../../hooks/useBatterySaver.js';
import { useOfflineSync } from '../../hooks/useOfflineSync.js';
import { useOutageNotifications } from '../../hooks/useOutageNotifications.js';
import { usePowerState } from '../../hooks/usePowerState.js';
import { useSafeAreaInsets } from '../../hooks/useSafeAreaInsets.js';
import { useSwipeTabs } from '../../hooks/useSwipeTabs.js';
import { useTabTransition } from '../../hooks/useTabTransition.js';
import { useAppVersion } from '../../api/queries.js';
import { UpdateGate } from '../changelog/UpdateModal.js';
import { cn } from '../../lib/cn.js';
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
 *
 * И здесь же — единственный вызов usePowerState(): он ставит на <html> `data-power-state`,
 * от которого зависит цвет акцентов состояния (бейдж, таймер, линия прогресса, свечение).
 * Один писатель на приложение: если бы статус красил каждый экран сам, цвет «мигал» бы при
 * переходах между страницами.
 *
 * Свайп между табами висит на этом же контейнере: жест должен работать и над контентом, и над
 * шапкой, а не только внутри <main>.
 */
export const AppShell = () => {
  // Один вызов на всё приложение: класс ставится на <html> и гасит анимации разом.
  useBatterySaver();
  // Тоже один вызов на всё приложение: внутри таймер, обработчики сети и возврата во вкладку.
  useOfflineSync();
  // И предупреждения об отключениях: они читают тот же кеш, что наполняет офлайн-пакет.
  useOutageNotifications();
  // Акценты состояния: статус сети больше не перекрашивает оболочку — только бейдж, таймер,
  // линию прогресса и свечение (см. --md-status* в globals.css).
  usePowerState();
  // Безопасные зоны для нативной обёртки: в WebView env(safe-area-inset-*) нет.
  useSafeAreaInsets();
  // OTA: при запуске и раз в 6 часов проверяем, не опубликована ли новая сборка. Ошибка сети
  // здесь не показывается — окно просто не появится до следующей успешной проверки.
  const appVersion = useAppVersion();
  // Горизонтальный свайп переключает нижние табы — на телефоне это быстрее, чем целиться в иконку.
  const swipe = useSwipeTabs();
  // Мягкий приход контента при смене таба: направление берём из порядка табов, а не из жеста,
  // поэтому тап по нижней панели и свайп выглядят одинаково.
  const { pathname } = useLocation();
  const transition = useTabTransition(pathname);

  return (
  <div className="flex min-h-dvh flex-col bg-surface-dim" {...swipe}>
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-60 focus:rounded-lg focus:bg-surface-container-high focus:px-4 focus:py-2 focus:text-sm focus:shadow-pop"
    >
      Перейти до вмісту
    </a>
    <Header />
    <div className="flex flex-1">
      <Sidebar />
      {/* pb-32 с запасом: M3 Navigation Bar теперь 80px (h-20) плюс safe-area, а прижатая
          вплотную панель обрезала последнюю карточку. */}
      <main id="main" className="min-w-0 flex-1 px-4 pb-32 pt-4 sm:px-6 md:pb-8 md:pt-6">
        <div
          className={cn('tab-enter', transition.entered && 'tab-enter-shown')}
          data-nav-direction={transition.direction}
        >
          <Outlet />
        </div>
      </main>
    </div>
    <BottomNav />
    <UpdateGate info={appVersion.data?.data ?? null} />
  </div>
  );
};
