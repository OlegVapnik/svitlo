import {
  Activity,
  Building2,
  CalendarDays,
  Contact,
  Home,
  Info,
  MapPin,
  Newspaper,
  Phone,
  Search,
  Upload,
  Zap,
  type LucideIcon,
} from 'lucide-react';

/**
 * Единственный источник правды для навигации: Sidebar, BottomNav и редиректы читают
 * ЭТИ списки (раньше они дублировали его и успели разойтись).
 *
 * Внизу четыре таба. Восемь пунктов на телефоне не различались: иконки 48px рядом друг
 * с другом, и главный вопрос «свет сейчас есть?» тонул среди второстепенных разделов.
 */
export interface TabItem {
  to: string;
  icon: LucideIcon;
  /** Ключ i18n (nav.*), а не готовая строка: язык переключается без правок меню. */
  labelKey: string;
}

/** Нижняя навигация телефона: ровно четыре раздела. */
export const TAB_ITEMS: TabItem[] = [
  { to: '/', icon: Zap, labelKey: 'nav.home' },
  { to: '/search', icon: Search, labelKey: 'nav.search' },
  { to: '/monitor', icon: Activity, labelKey: 'nav.monitor' },
  { to: '/info', icon: Info, labelKey: 'nav.info' },
];

/**
 * Старые адреса разделов → новые табы.
 *
 * Зачем: у людей уже стоят закладки на /queues и /streets, а PWA хранит последний
 * открытый маршрут. Без редиректов после релиза они попали бы в 404, и выглядело бы так,
 * будто приложение сломалось. Редирект — самоклеящийся «апгрейд», незаметный для человека.
 *
 * Совпадение идёт по точному пути и по префиксу (см. resolveLegacyPath).
 */
export const LEGACY_ROUTES: Array<{ from: string; to: string }> = [
  { from: '/outages', to: '/monitor' },
  { from: '/incidents', to: '/monitor' },
  { from: '/queues', to: '/monitor' },
  { from: '/streets', to: '/search' },
  { from: '/my-address', to: '/search' },
  { from: '/news', to: '/info' },
  { from: '/contacts', to: '/info' },
];

/**
 * Куда ведёт старый адрес. null — такого маршрута нет.
 *
 * Сначала точный таб, потом префикс: `/monitor/outages` должен открыть мониторинг, а не 404.
 */
export function resolveLegacyPath(pathname: string): string | null {
  const clean = pathname.replace(/\/+$/u, '') || '/';
  if (TAB_ITEMS.some((item) => isNavItemActive(clean, item.to))) return null;

  for (const route of LEGACY_ROUTES) {
    if (clean === route.from || clean.startsWith(`${route.from}/`)) return route.to;
  }
  return null;
}

/** Активен ли пункт: точное совпадение, кроме корня (иначе «/» подсвечивался бы всегда). */
export function isNavItemActive(pathname: string, to: string): boolean {
  if (to === '/') return pathname === '/';
  return pathname === to || pathname.startsWith(`${to}/`);
}

/** Пункты бокового меню на широком экране: разделы внутри новых табов. */
export interface SidebarEntry {
  to: string;
  icon: LucideIcon;
  labelKey: string;
  /** Внутри какого таба живёт раздел — группируем по табам, чтобы меню читалось как структура. */
  tab: string;
}

export const SIDEBAR_ENTRIES: SidebarEntry[] = [
  { to: '/', icon: Home, labelKey: 'nav.home', tab: '/' },
  { to: '/search', icon: Search, labelKey: 'nav.search', tab: '/search' },
  { to: '/monitor', icon: CalendarDays, labelKey: 'nav.monitorGroups', tab: '/monitor' },
  { to: '/monitor?tab=outages', icon: Zap, labelKey: 'nav.monitorOutages', tab: '/monitor' },
  { to: '/monitor?tab=incidents', icon: Activity, labelKey: 'nav.monitorIncidents', tab: '/monitor' },
  { to: '/info', icon: Info, labelKey: 'nav.info', tab: '/info' },
  { to: '/info?tab=contacts', icon: Phone, labelKey: 'nav.infoContacts', tab: '/info' },
];

/** Служебные адреса вне публичного меню: импорт графика, выбор области. */
export const ADMIN_ENTRIES: SidebarEntry[] = [
  { to: '/schedule-import', icon: Upload, labelKey: 'nav.scheduleImport', tab: 'admin' },
  { to: '/region', icon: Building2, labelKey: 'nav.region', tab: 'admin' },
  { to: '/my-address', icon: MapPin, labelKey: 'nav.myAddress', tab: 'admin' },
  { to: '/contacts', icon: Contact, labelKey: 'nav.contacts', tab: 'admin' },
  { to: '/news', icon: Newspaper, labelKey: 'nav.news', tab: 'admin' },
];
