import { createBrowserRouter } from 'react-router-dom';
import { RouteErrorElement } from './components/common/RouteErrorElement';
import { AppShell } from './components/layout/AppShell';
import { HomePage } from './pages/HomePage';
import { OutagesPage } from './pages/OutagesPage';
import { IncidentsPage } from './pages/IncidentsPage';
import { ContactsPage } from './pages/ContactsPage';
import { MyAddressPage } from './pages/MyAddressPage';
import { ScheduleImportPage } from './pages/ScheduleImportPage';
import { QueueSchedulePage } from './pages/QueueSchedulePage';
import { StreetsPage } from './pages/StreetsPage';
import { NewsPage } from './pages/NewsPage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    // Свой errorElement на корневом маршруте: он ловит падение ЛЮБОЙ вложенной страницы и
    // показывает понятный экран с кнопками восстановления. Без него react-router
    // показывал служебный «Hey developer 👋» без единого способа выбраться из белого экрана.
    errorElement: <RouteErrorElement />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'outages', element: <OutagesPage /> },
      { path: 'incidents', element: <IncidentsPage /> },
      { path: 'news', element: <NewsPage /> },
      { path: 'contacts', element: <ContactsPage /> },
      { path: 'my-address', element: <MyAddressPage /> },
      { path: 'schedule-import', element: <ScheduleImportPage /> },
      { path: 'queues', element: <QueueSchedulePage /> },
      { path: 'streets', element: <StreetsPage /> },
    ]
  }
]);