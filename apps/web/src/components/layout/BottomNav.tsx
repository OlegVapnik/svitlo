import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { TAB_ITEMS, isNavItemActive, type TabItem } from './nav-items.js';

/**
 * Нижняя навигация: четыре раздела вместо восьми.
 *
 * Восемь пунктов на телефоне означали восемь иконок по 48px — они не отличались друг от
 * друга, и главный сценарий («свет сейчас есть?») тонул среди второстепенных. Четыре
 * таба — это уровень, на котором человек различает их не глядя.
 *
 * Активный таб помечен мягкой «пилюлей» под иконкой плюс жирной подписью: цвет не
 * единственный сигнал состояния (доступность).
 *
 * backdrop-blur здесь оправдан — это один из двух элементов в приложении с размытием
 * (второй — шторка). Размытие на каждой карточке съедало бы батарею при прокрутке.
 */
export const BottomNav = () => {
  const { t } = useTranslation();
  const { pathname } = useLocation();

  return (
    <nav
      aria-label={t('nav.home')}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/85 pb-safe backdrop-blur-xl md:hidden"
    >
      <ul className="flex items-stretch justify-around gap-1 px-2 pt-1.5">
        {TAB_ITEMS.map((item: TabItem) => {
          const active = isNavItemActive(pathname, item.to);
          const Icon = item.icon;
          return (
            <li key={item.to} className="flex-1">
              <Link
                to={item.to}
                aria-current={active ? 'page' : undefined}
                // Haptic на переключении: короткая вибрация подтверждает смену экрана,
                // не глядя на него. Поддерживается не везде, поэтому guarded и тихий.
                onClick={() => {
                  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
                    navigator.vibrate(10);
                  }
                }}
                className={cn(
                  'flex min-h-[56px] flex-col items-center justify-center gap-1 px-1 py-1.5',
                  'text-[11px] font-semibold transition-colors',
                  active ? 'text-primary' : 'text-muted-foreground',
                )}
              >
                <span
                  className={cn(
                    'flex h-7 min-w-12 items-center justify-center rounded-full transition-colors',
                    active && 'bg-primary/12',
                  )}
                >
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <span className="truncate leading-tight">{t(item.labelKey)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};
