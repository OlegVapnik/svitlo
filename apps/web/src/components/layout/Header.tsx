import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Zap } from 'lucide-react';
import { ThemeToggle } from '../ui/ThemeToggle.js';
import { RegionSelect } from '../ui/RegionSelect.js';
import { FreshnessChip } from '../status/FreshnessChip.js';

/**
 * Верхняя панель: узнаваемый логотип, состояние источника данных (свежесть/ошибка),
 * выбор области (мультирегіональність) и переключатели.
 * Свежесть вынесена в шапку намеренно: «данные устарели» должно быть видно с любой страницы,
 * а не только на главной (skills/frontend-ui-change, PWA).
 */
export const Header = () => {
  const { t } = useTranslation();

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="container flex h-14 items-center justify-between gap-2">
        <Link to="/" className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-xs">
            <Zap className="h-5 w-5" aria-hidden />
          </span>
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-sm font-bold tracking-tight">Svitlo</span>
            <span className="hidden truncate text-[11px] text-muted-foreground sm:block">{t('home.subtitle')}</span>
          </span>
        </Link>

        <div className="flex items-center gap-1.5">
          <RegionSelect />
          <FreshnessChip />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
};
