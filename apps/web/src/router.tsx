import { createBrowserRouter, Navigate, useLocation } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { RouteErrorElement } from './components/common/RouteErrorElement';
import { resolveLegacyPath } from './components/layout/nav-items';
import { HomePage } from './pages/HomePage';
import { SearchPage } from './pages/SearchPage';
import { MonitorPage } from './pages/MonitorPage';
import { InfoPage } from './pages/InfoPage';
import { ScheduleImportPage } from './pages/ScheduleImportPage';

/**
 * Старый адрес → новый таб.
 *
 * Ставится ПЕРВЫМ в списке маршрутов, иначе React Router нашёл бы ниже объявленный
 * /outages и открыл старую страницу вместо редиректа. Закладки и сохранённое состояние
 * PWA продолжают работать, человек ничего не замечает.
 *
 * `replace` обязателен: без него «Назад» уводил бы на уже заменённый адрес, и человек
 * нажимал бы «Назад» снова и снова, не понимая почему.
 */
const LegacyRedirect = () => {
  const { pathname } = useLocation();
  const target = resolveLegacyPath(pathname);
  return <Navigate to={target ?? '/'} replace />;
};

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    // Свой errorElement ловит падение ЛЮБОЙ вложенной страницы и рисует экран с кнопками
    // восстановления. Без него react-router показывал служебный текст без способа выбраться.
    errorElement: <RouteErrorElement />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'search', element: <SearchPage /> },
      { path: 'monitor', element: <MonitorPage /> },
      { path: 'info', element: <InfoPage /> },

      // Старые адреса разделов: работают через редирект, чтобы не ломать закладки и PWA.
      { path: 'outages', element: <LegacyRedirect /> },
      { path: 'incidents', element: <LegacyRedirect /> },
      { path: 'queues', element: <LegacyRedirect /> },
      { path: 'streets', element: <LegacyRedirect /> },
      { path: 'my-address', element: <LegacyRedirect /> },
      { path: 'news', element: <LegacyRedirect /> },

      // Импорт графика остаётся отдельным служебным адресом: это не раздел для человека,
      // а админский инструмент, прятать его в таб было бы неудобно.
      { path: 'schedule-import', element: <ScheduleImportPage /> },
    ],
  },
]);
