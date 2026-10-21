import React from 'react';
import { useTranslation } from 'react-i18next';
import { Newspaper } from 'lucide-react';
import { MaintenanceNotice } from '../components/common/MaintenanceNotice.js';

/**
 * Раздел «Інфо»: лента новостей операторов.
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

      <MaintenanceNotice
        title="Стрічка новин на плановому обслуговуванні"
        subtitle="Проводяться роботи з модернізації джерел та оновлення телеграм-каналів обленерго."
      />
    </div>
  );
};
