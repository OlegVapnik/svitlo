import { Home, Zap, AlertTriangle, Phone, MapPin, CalendarDays, Building2 } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';

export const BottomNav = () => {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const items = [
    { to: '/', icon: Home, label: t('nav.home') },
    { to: '/outages', icon: Zap, label: t('nav.outages') },
    { to: '/incidents', icon: AlertTriangle, label: t('nav.incidents') },
    { to: '/contacts', icon: Phone, label: t('nav.contacts') },
    { to: '/queues', icon: CalendarDays, label: 'Мої черги' },
    { to: '/streets', icon: Building2, label: t('nav.streets') }
  ];

  return (
    <nav className="fixed bottom-0 w-full border-t bg-background pb-safe flex justify-around p-1.5 md:hidden">
      {items.map(item => {
        const active = pathname === item.to;
        return (
          <Link key={item.to} to={item.to} className={cn("flex min-w-0 flex-1 flex-col items-center p-2", active ? "text-primary" : "text-muted-foreground")}>
            <item.icon className="h-6 w-6" />
            <span className="text-[10px] mt-1">{item.label}</span>
          </Link>
        )
      })}
    </nav>
  );
};