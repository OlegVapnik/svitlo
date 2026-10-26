import React from 'react';
import { useTranslation } from 'react-i18next';
import { Newspaper } from 'lucide-react';
import { NewsPage } from './NewsPage.js';

/**
 * Раздел «Інфо»: лента новостей операторов. NewsPage живёт здесь сегментом (`embedded`):
 * свой заголовок рисует таб, а лента — содержимое. Раньше вместо неё стояла заглушка
 * «на обслуговуванні», хотя готовая страница и работающий `GET /news` были в коде.
 */
export const InfoPage: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header className="space-y-1">
        <h1 className="font-display text-xl font-bold tracking-tight text-foreground sm:text-2xl">
          <Newspaper className="mr-1.5 inline h-5 w-5 align-text-bottom text-primary" aria-hidden />
          {t('nav.info')}
        </h1>
        <p className="text-xs text-muted-foreground sm:text-sm">{t('info.subtitle')}</p>
      </header>

      <NewsPage embedded />
    </div>
  );
};
