import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { SIDEBAR_ITEMS, isNavItemActive, type NavItem } from './nav-items.js';

function NavLink({ item, compact = false }: { item: NavItem; compact?: boolean }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const active = isNavItemActive(pathname, item.to);
  const Icon = item.icon;

  return (
    <Link
      to={item.to}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors',
        compact && 'text-muted-foreground',
        active
          ? 'bg-accent font-semibold text-accent-foreground'
          : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
      )}
    >
      <Icon className="h-5 w-5 shrink-0" aria-hidden />
      <span className="truncate">{t(item.labelKey)}</span>
    </Link>
  );
}

/** Боковое меню (desktop). На телефоне его заменяет BottomNav — список берётся из одного места. */
export const Sidebar = () => {
  const { t } = useTranslation();

  return (
    <nav
      aria-label={t('nav.home')}
      className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-64 shrink-0 flex-col gap-1 overflow-y-auto border-r border-border bg-card/40 px-3 py-4 md:flex"
    >
      {SIDEBAR_ITEMS.map((item) => (
        <NavLink key={item.to} item={item} />
      ))}

      <p className="mt-auto px-3 pt-4 text-[11px] leading-relaxed text-muted-foreground/80">
        {t('common.serverHint')}
      </p>
    </nav>
  );
};
