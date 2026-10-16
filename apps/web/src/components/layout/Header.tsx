import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Zap } from 'lucide-react';
import { ThemeToggle } from '../ui/ThemeToggle.js';
import { RegionPicker } from '../region/RegionPicker.js';
import { FreshnessChip } from '../status/FreshnessChip.js';
import { SyncIndicator } from '../status/SyncIndicator.js';

/**
 * Верхняя панель — M3 Top App Bar: узнаваемый логотип в контейнере акцента, состояние источника
 * данных (свежесть/ошибка), выбор области (мультирегіональність) и переключатель темы.
 *
 * Свежесть вынесена в шапку намеренно: «данные устарели» должно быть видно с любой страницы,
 * а не только на главной (skills/frontend-ui-change, PWA). Рядом — индикатор офлайн-пакета: он
 * отвечает на другой вопрос («знает ли телефон график») и с ошибкой источника не совпадает,
 * поэтому это две отдельные метки, а не одна.
 *
 * ПОЧЕМУ .pt-safe ЗДЕСЬ, А НЕ НА body. Шапка `sticky top-0`: при прокрутке она прилипает к
 * верхней кромке окна, игнорируя padding родителя, и содержимое уезжало под часы и иконки
 * батареи (на телефоне это выглядело как «интерфейс залез на строку состояния»). Отступ
 * безопасной зоны должен жить на самой панели — тогда её фон закрашивает эту зону.
 *
 * На телефоне в шапке остаются логотип-иконка, чип области и одна кнопка темы: словесный
 * логотип и три кнопки темы не помещались в 360px и налезали друг на друга.
 */
export const Header = () => {
  const { t } = useTranslation();

  return (
    <header className="pt-safe sticky top-0 z-50 border-b border-outline-variant/40 bg-surface-container/85 backdrop-blur-xl supports-[backdrop-filter]:bg-surface-container/70">
      <div className="container flex h-14 items-center justify-between gap-2">
        <Link to="/" className="flex shrink-0 items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[14px] bg-primary-container text-on-primary-container">
            <Zap className="h-5 w-5" strokeWidth={2.4} aria-hidden />
          </span>
          <span className="hidden min-w-0 leading-tight sm:block">
            <span className="block truncate text-sm font-bold tracking-tight">Svitlo</span>
            <span className="hidden truncate text-[11px] text-on-surface-variant sm:block">{t('home.subtitle')}</span>
          </span>
        </Link>

        <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5 sm:flex-none">
          {/* Тот же выбор области с поиском, что и на главной, — но компактный. Раньше в шапке
              стоял нативный <select> без поиска, из-за чего в мобильном приложении выбрать
              область в средине списка было невозможно. */}
          <RegionPicker variant="compact" className="min-w-0 flex-1 sm:flex-none" />
          <SyncIndicator />
          <FreshnessChip />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
};
