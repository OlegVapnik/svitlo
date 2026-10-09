import { Outlet } from 'react-router-dom';
import { Header } from './Header.js';
import { BottomNav } from './BottomNav.js';
import { Sidebar } from './Sidebar.js';

/**
 * Каркас приложения: шапка, боковое меню (desktop), контент, нижняя навигация (mobile).
 * «Skip to content» — первая ссылка на странице: клавиатурой можно проскочить меню.
 */
export const AppShell = () => (
  <div className="flex min-h-screen flex-col bg-background">
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-60 focus:rounded-lg focus:bg-card focus:px-4 focus:py-2 focus:text-sm focus:shadow-pop"
    >
      Перейти до вмісту
    </a>
    <Header />
    <div className="flex flex-1">
      <Sidebar />
      <main id="main" className="min-w-0 flex-1 px-4 pb-24 pt-4 sm:px-6 md:pb-8 md:pt-6">
        <Outlet />
      </main>
    </div>
    <BottomNav />
  </div>
);
