import React from 'react';
import { useTranslation } from 'react-i18next';
import { PlugZap } from 'lucide-react';
import { useRegion } from '../../hooks/useRegion.js';
import { useQueues } from '../../api/queries.js';
import { getApiBaseUrl } from '@svitlo/core';

/**
 * Диагностика соединения с API.
 *
 * Показывается, только когда каталог областей не загрузился. Без неё отказ выглядит как
 * «нечего выбирать»: приложение откатывается на область по умолчанию (Чернігівська) и
 * молчит, а человек гадает — это данные, сеть или устаревшая сборка на телефоне.
 *
 * Здесь видно три вещи, которых иначе нет: адрес, куда приложение реально ходит, метку
 * сборки (по ней сразу видно, стоит ли старая версия APK) и текст ошибки.
 */
export const ConnectionProblem: React.FC = () => {
  const { t } = useTranslation();
  const { isError, error, refetch, isLoading } = useRegion();
  // Отдельный запрос: он показывает, грузится ли уже выбранная область. Если каталог областей
  // упал, но график области приходит — значит дело не в сети, а в самом запросе каталога.
  const { data: queuesData, isError: queuesError } = useQueues();

  if (!isError) return null;

  const message = error instanceof Error ? error.message : String(error ?? t('regions.loadFailed'));

  return (
    <section
      role="alert"
      className="space-y-2 rounded-2xl border border-destructive/40 bg-destructive/5 p-4"
    >
      <p className="inline-flex items-center gap-2 text-sm font-bold text-destructive">
        <PlugZap className="h-4 w-4" aria-hidden />
        {t('regions.connectionProblem')}
      </p>

      <dl className="space-y-1 text-xs">
        <div className="flex gap-2">
          <dt className="shrink-0 font-semibold text-muted-foreground">{t('regions.apiAddress')}</dt>
          <dd className="min-w-0 break-all font-mono text-foreground">{getApiBaseUrl()}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="shrink-0 font-semibold text-muted-foreground">build</dt>
          <dd className="font-mono text-foreground">{__BUILD_ID__}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="shrink-0 font-semibold text-muted-foreground">{t('regions.queueRequest')}</dt>
          <dd className="text-foreground">
            {isLoading
              ? t('regions.loading')
              : queuesError
                ? t('regions.queueFailed')
                : `${t('regions.queueOk')}: ${queuesData?.data?.length ?? 0}`}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="shrink-0 font-semibold text-muted-foreground">{t('regions.error')}</dt>
          <dd className="min-w-0 break-all text-foreground">{message}</dd>
        </div>
      </dl>

      <button
        type="button"
        onClick={() => void refetch()}
        className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
      >
        {t('common.retry')}
      </button>
    </section>
  );
};