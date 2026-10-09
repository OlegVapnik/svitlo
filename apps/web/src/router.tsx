import { createBrowserRouter } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { HomePage } from './pages/HomePage';
import { OutagesPage } from './pages/OutagesPage';
import { IncidentsPage } from './pages/IncidentsPage';
import { ContactsPage } from './pages/ContactsPage';
import { MyAddressPage } from './pages/MyAddressPage';
import { ScheduleImportPage } from './pages/ScheduleImportPage';
import { QueueSchedulePage } from './pages/QueueSchedulePage';
import { StreetsPage } from './pages/StreetsPage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'outages', element: <OutagesPage /> },
      { path: 'incidents', element: <IncidentsPage /> },
      { path: 'contacts', element: <ContactsPage /> },
      { path: 'my-address', element: <MyAddressPage /> },
      { path: 'schedule-import', element: <ScheduleImportPage /> },
      { path: 'queues', element: <QueueSchedulePage /> },
      { path: 'streets', element: <StreetsPage /> },
    ]
  }
]);