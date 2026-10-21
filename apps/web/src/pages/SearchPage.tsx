import React from 'react';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import { AddressWizard } from '../components/address/AddressWizard.js';

/**
 * Раздел «Пошук»: область → населённый пункт → вулиця → дом.
 *
 * Он заменил два отдельных экрана (/streets и /my-address), которые выглядели как
 * дубликаты и путали человека: оба спрашивали про адрес и оба приводили к одному и тому
 * же ответу «ваша очередь». Разница была только в формулировках.
 *
 * Блок «Бережні місця» и примечание о приватности убраны: поиск адреса и график подгруппы
 * теперь показываются сразу, без промежуточного «сохраните, чтобы увидеть» шага.
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
    </div>
  );
};
