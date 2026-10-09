import { Header } from './Header';
import { BottomNav } from './BottomNav';
import { Sidebar } from './Sidebar';
import { Outlet } from 'react-router-dom';
export const AppShell = () => (
  <div className="min-h-screen bg-background flex flex-col">
    <Header />
    <div className="flex flex-1 overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-auto p-4 md:p-8 pb-24 md:pb-8">
        <Outlet />
      </main>
    </div>
    <BottomNav />
  </div>
);