import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { BOTTOM_NAV_ITEMS, isNavItemActive } from './nav-items.js';

/**
 * Мобильная навигация. Пять пунктов, тач-зона ≥ 44 px, активный пункт помечен цветом И
 * жирным подписью — цвет не единственный сигнал (skills/frontend-ui-change, accessibility).
 */
export const BottomNav = () => {
  const { t } = useTranslation();
  const { pathname } = useLocation();

  return (
    <nav
      aria-label={t('nav.home')}
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/95 pb-safe backdrop-blur md:hidden"
    >
      <ul className="flex items-stretch justify-around">
        {BOTTOM_NAV_ITEMS.map((item) => {
          const active = isNavItemActive(pathname, item.to);
          const Icon = item.icon;
          return (
            <li key={item.to} className="flex-1">
              <Link
                to={item.to}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-[52px] flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-[10px]',
                  active ? 'font-semibold text-primary' : 'text-muted-foreground',
                )}
              >
                <Icon className={cn('h-5 w-5', active && 'text-primary')} aria-hidden />
                <span className="truncate leading-tight">{t(item.labelKey)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};
