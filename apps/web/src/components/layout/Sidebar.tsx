import { Home, Zap, AlertTriangle, Phone, MapPin, CalendarDays, Upload, Building2 } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';

export const Sidebar = () => {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const items = [
    { to: '/', icon: Home, label: t('nav.home') },
    { to: '/outages', icon: Zap, label: t('nav.outages') },
    { to: '/incidents', icon: AlertTriangle, label: t('nav.incidents') },
    { to: '/contacts', icon: Phone, label: t('nav.contacts') },
    { to: '/my-address', icon: MapPin, label: t('nav.myAddress') },
    { to: '/queues', icon: CalendarDays, label: 'Мої черги' },
    { to: '/streets', icon: Building2, label: t('nav.streets') },
    { to: '/schedule-import', icon: Upload, label: 'Імпорт графіка' }
  ];

  return (
    <nav className="hidden md:flex flex-col w-64 border-r p-4 space-y-2 h-[calc(100vh-3.5rem)]">
      {items.map(item => {
        const active = pathname === item.to;
        return (
          <Link key={item.to} to={item.to} className={cn("flex items-center space-x-3 p-3 rounded-lg hover:bg-accent", active ? "bg-accent text-primary font-medium" : "text-muted-foreground")}>
            <item.icon className="h-5 w-5" />
            <span>{item.label}</span>
          </Link>
        )
      })}
    </nav>
  );
};