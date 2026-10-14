import React from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Заглушка раздела «Інфо». Наполняется в этапах 5–7 редизайна.
 *
 * Сейчас это рабочая страница, а не пустышка: редиректы со старых адресов уже ведут сюда,
 * и человек не должен попадать в 404 или на голый экран. Раздел помечен как «скоро» —
 * честнее, чем показывать пустоту с иконкой, будто данных просто нет.
 */
export const InfoPage: React.FC = () => {
  const { t } = useTranslation();

  return (
    <div className="space-y-3">
      <header className="space-y-1">
        <h1 className="font-display text-xl font-bold tracking-tight text-foreground sm:text-2xl">
          📰 Інфо
        </h1>
        <p className="text-xs text-muted-foreground sm:text-sm">Новини та контакти обленерго</p>
      </header>

      <div className="rounded-2xl border border-border bg-card p-5 text-center">
        <p className="text-sm font-semibold text-foreground">{t('common.comingSoon')}</p>
        <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">Новини та контакти обленерго</p>
      </div>
    </div>
  );
};
