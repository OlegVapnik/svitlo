import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Zap } from 'lucide-react';
import { ThemeToggle } from '../ui/ThemeToggle.js';
import { RegionPicker } from '../region/RegionPicker.js';
import { FreshnessChip } from '../status/FreshnessChip.js';
import { SyncIndicator } from '../status/SyncIndicator.js';

/**
 * Верхняя панель — M3 Top App Bar: узнаваемый логотип в контейнере акцента, состояние источника
 * данных (свежесть/ошибка), выбор области (мультирегіональність) и переключатели.
 *
 * Свежесть вынесена в шапку намеренно: «данные устарели» должно быть видно с любой страницы,
 * а не только на главной (skills/frontend-ui-change, PWA). Рядом — индикатор офлайн-пакета: он
 * отвечает на другой вопрос («знает ли телефон график») и с ошибкой источника не совпадает,
 * поэтому это две отдельные метки, а не одна.
 */
export const Header = () => {
  const { t } = useTranslation();

  return (
    <header className="sticky top-0 z-50 border-b border-outline-variant/40 bg-surface-container/85 backdrop-blur-xl supports-[backdrop-filter]:bg-surface-container/70">
      <div className="container flex h-14 items-center justify-between gap-2">
        <Link to="/" className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[14px] bg-primary-container text-on-primary-container">
            <Zap className="h-5 w-5" strokeWidth={2.4} aria-hidden />
          </span>
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-sm font-bold tracking-tight">Svitlo</span>
            <span className="hidden truncate text-[11px] text-on-surface-variant sm:block">{t('home.subtitle')}</span>
          </span>
        </Link>

        <div className="flex items-center gap-1.5">
          {/* Тот же выбор области с поиском, что и на главной, — но компактный. Раньше в шапке
              стоял нативный <select> без поиска, из-за чего в мобильном приложении выбрать
              область в средине списка было невозможно. */}
          <RegionPicker variant="compact" />
          <SyncIndicator />
          <FreshnessChip />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
};
