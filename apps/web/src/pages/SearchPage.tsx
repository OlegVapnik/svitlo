import React from 'react';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import { AddressWizard } from '../components/address/AddressWizard.js';
import { SavedPlacesSection } from '../components/places/SavedPlacesSection.js';

/**
 * Раздел «Пошук»: область → населённый пункт → вулиця → дом.
 *
 * Он заменил два отдельных экрана (/streets и /my-address), которые выглядели как
 * дубликаты и путали человека: оба спрашивали про адрес и оба приводили к одному и тому
 * же ответу «ваша очередь». Разница была только в формулировках.
 *
 * Что важно для приватности: приложение НИЧЕГО не отправляет о доме человека, пока он
 * сам не нажмёт «Зберегти чергу». Поиск идёт по публичным данным оператора, а в закладки
 * попадает только то, что человек подтвердил сам. Персональные данные не собираются.
 */
export const SearchPage: React.FC = () => {
  const { t } = useTranslation();

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <header className="space-y-1">
        <h1 className="font-display text-xl font-bold tracking-tight text-foreground sm:text-2xl">
          <Search className="mr-1.5 inline h-5 w-5 align-text-bottom text-primary" aria-hidden />
          {t('nav.search')}
        </h1>
        <p className="text-xs text-muted-foreground sm:text-sm">{t('addressWizard.subtitle')}</p>
      </header>

      <AddressWizard />

      <SavedPlacesSection />

      {/* Честная граница возможностей, а не мелкий шрифт в подвале: часть адресов в базе
          ещё не привязана к группе, и человек должен знать об этом до, а не после поиска. */}
      <p className="rounded-2xl border border-border bg-card px-4 py-3 text-xs text-muted-foreground">
        {t('addressWizard.privacyNote')}
      </p>
    </div>
  );
};
