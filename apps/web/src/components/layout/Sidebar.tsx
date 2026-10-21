import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { hapticTick } from '@/lib/haptics';
import { SIDEBAR_ENTRIES, isNavItemActive, type SidebarEntry } from './nav-items.js';

/**
 * Пункт M3 Navigation Rail: иконка в пилюле и подпись под ней.
 * Активный пункт получает контейнер-пилюлю (`bg-primary-container`) и утолщённый штрих иконки:
 * на десктопе курсор мыши не даёт haptic-подтверждения, поэтому форма работает громче.
 */
function RailLink({ item }: { item: SidebarEntry }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  // Ссылка может нести ?tab=... (например /monitor?tab=outages), поэтому сверяем путь,
  // а не весь адрес: иначе подсветка активного раздела не работала бы.
  const active = isNavItemActive(pathname, item.to.split('?')[0] ?? item.to);
  const Icon = item.icon;

  return (
    <Link
      to={item.to}
      aria-current={active ? 'page' : undefined}
      onClick={() => hapticTick('tick')}
      className={cn(
        'flex w-full flex-col items-center gap-1 rounded-3xl px-1 py-2.5 transition-colors duration-200',
        active ? 'text-on-surface' : 'text-on-surface-variant hover:bg-surface-container-high/60 hover:text-on-surface',
      )}
    >
      <span
        className={cn(
          'flex h-8 w-16 items-center justify-center rounded-full transition-colors duration-300 ease-m3-expressive-fast',
          active ? 'bg-primary-container text-on-primary-container' : 'bg-transparent',
        )}
      >
        <Icon className="h-5 w-5" strokeWidth={active ? 2.5 : 2.2} aria-hidden />
      </span>
      <span className="w-full truncate text-center text-[10px] font-semibold leading-tight">{t(item.labelKey)}</span>
    </Link>
  );
}

/**
 * M3 Navigation Rail (desktop). На телефоне его заменяет BottomNav — список берётся из одного
 * места (nav-items.ts), поэтому разделы не могут разойтись между мобильной и десктопной навигацией.
 */
export const Sidebar = () => {
  const { t } = useTranslation();

  return (
    <nav
      aria-label={t('nav.home')}
      className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-24 shrink-0 flex-col items-center gap-1.5 overflow-y-auto border-r border-outline-variant/40 bg-surface-container-low/50 px-2 py-3 md:flex"
    >
      {SIDEBAR_ENTRIES.map((item) => (
        <RailLink key={item.to} item={item} />
      ))}

      <p className="mt-auto px-1 pt-4 text-center text-[9px] leading-tight text-on-surface-variant/70">
        {t('common.serverHint')}
        {/* Метка сборки: на телефоне сразу видно, какая версия приложения установлена. */}
        <span className="mt-1 block font-mono break-all text-[9px] text-on-surface-variant/50">
          build {__BUILD_ID__}
        </span>
      </p>
    </nav>
  );
};
