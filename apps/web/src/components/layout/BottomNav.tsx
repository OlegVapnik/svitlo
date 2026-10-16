import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { TAB_ITEMS, isNavItemActive, type TabItem } from './nav-items.js';

/**
 * M3 Navigation Bar: четыре раздела вместо восьми.
 *
 * Восемь пунктов на телефоне означали восемь иконок по 48px — они не отличались друг от
 * друга, и главный сценарий («свет сейчас есть?») тонул среди второстепенных. Четыре
 * таба — это уровень, на котором человек различает их не глядя.
 *
 * Активный таб: овальная пилюля M3 (`w-16` против `w-12` у соседей) раскрывается пружинкой, а
 * иконка внутри получает более толстый штрих и лёгкий масштаб. Цвет — не единственный сигнал
 * состояния (доступность), поэтому форма и вес штриха работают вместе с ним.
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
      className="fixed inset-x-0 bottom-0 z-40 rounded-t-[28px] border-t border-outline-variant/40 bg-surface-container/95 pb-safe backdrop-blur-xl md:hidden"
    >
      <ul className="flex h-20 items-stretch justify-around gap-1 px-2">
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
                className="flex h-full flex-col items-center justify-center gap-1 text-[11px] font-semibold"
              >
                <span
                  className={cn(
                    // Пилюля раскрывается пружинкой: 48px → 64px. Ширина — часть обратной связи.
                    'flex h-8 items-center justify-center transition-[width,background-color,color] duration-300 ease-[var(--ease-m3-expressive-fast)]',
                    active
                      ? 'w-16 rounded-full bg-primary-container text-on-primary-container'
                      : 'w-12 rounded-full text-on-surface-variant',
                  )}
                >
                  <Icon
                    className={cn(
                      'h-5 w-5 transition-transform duration-300 ease-[var(--ease-m3-expressive-fast)]',
                      active && 'scale-110',
                    )}
                    strokeWidth={active ? 2.5 : 2.2}
                    aria-hidden
                  />
                </span>
                <span className={cn('truncate leading-tight', active ? 'text-on-surface' : 'text-on-surface-variant')}>
                  {t(item.labelKey)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};
