import { AlertTriangle, Building2, CalendarDays, Home, MapPin, Phone, Upload, Zap, type LucideIcon } from 'lucide-react';

/**
 * Единственный источник правды для навигации: Sidebar и BottomNav читают ЭТОТ список
 * (раньше они дублировали его и успели разойтись — см. skills/frontend-ui-change, «Structure»).
 */
export interface NavItem {
  to: string;
  icon: LucideIcon;
  /** Ключ i18n (nav.*), а не готовая строка: язык переключается без перезагрузки и без правок меню. */
  labelKey: string;
  /** Входит в нижнюю мобильную навигацию — самые частые сценарии (не больше пяти). */
  primary?: boolean;
  /** Служебный раздел (импорт графика): показывается отдельной группой, вне публичного меню. */
  admin?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', icon: Home, labelKey: 'nav.home', primary: true },
  { to: '/outages', icon: Zap, labelKey: 'nav.outages', primary: true },
  { to: '/incidents', icon: AlertTriangle, labelKey: 'nav.incidents', primary: true },
  { to: '/streets', icon: Building2, labelKey: 'nav.streets', primary: true },
  { to: '/contacts', icon: Phone, labelKey: 'nav.contacts', primary: true },
  { to: '/my-address', icon: MapPin, labelKey: 'nav.myAddress' },
  { to: '/queues', icon: CalendarDays, labelKey: 'nav.queues' },
  { to: '/schedule-import', icon: Upload, labelKey: 'nav.scheduleImport', admin: true },
];

export const SIDEBAR_ITEMS = NAV_ITEMS.filter((item) => !item.admin);
export const ADMIN_ITEMS = NAV_ITEMS.filter((item) => item.admin);
export const BOTTOM_NAV_ITEMS = NAV_ITEMS.filter((item) => item.primary);

/** Активен ли пункт: точное совпадение, кроме корня (иначе «/» подсвечивался бы всегда). */
export function isNavItemActive(pathname: string, to: string): boolean {
  if (to === '/') return pathname === '/';
  return pathname === to || pathname.startsWith(`${to}/`);
}
