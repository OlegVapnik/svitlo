import React from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCcw } from 'lucide-react';
import { hapticTick } from '../../lib/haptics.js';
import { formatQueueLabel } from '../../lib/queue-label.js';
import { cn } from '../../lib/cn.js';
import type { OutageStatus } from '@svitlo/shared';

/**
 * Стан фільтрів сторінки «Відключення». Черга зберігається кодом («2/2»), а не числом:
 * у графіку ГПВ групи бувають складеними (2/1, 2/2), і числовий фільтр зливав би їх в одну.
 * Числову частину для параметра API рахує сторінка.
 */
export interface OutageFiltersState {
  status?: OutageStatus;
  queueCode?: string;
  area?: string;
  datePreset?: 'all' | 'today' | 'tomorrow' | 'week';
}

interface FilterPanelProps {
  filters: OutageFiltersState;
  onChange: (filters: OutageFiltersState) => void;
  /** Райони/населені пункти, які реально є в поточному списку. */
  areas: string[];
  /** Реальні коди груп області (з /queues), не вигаданий діапазон 1…6. */
  queueCodes: string[];
  /** cpu області — для підпису «Черга 2/2» / «Група 35». */
  regionCpu?: string;
  /** Група головного збереженого місця, якщо воно в цій області. */
  myQueue?: string | null;
}

const STATUS_OPTIONS: { value: OutageStatus | undefined; labelKey: string }[] = [
  { value: undefined, labelKey: 'outages.filterAll' },
  { value: 'scheduled', labelKey: 'outages.filterScheduled' },
  { value: 'active', labelKey: 'outages.filterActive' },
  { value: 'finished', labelKey: 'outages.finished' },
];

const DATE_OPTIONS: { value: NonNullable<OutageFiltersState['datePreset']>; labelKey: string }[] = [
  { value: 'all', labelKey: 'outages.filterAll' },
  { value: 'today', labelKey: 'outages.today' },
  { value: 'tomorrow', labelKey: 'outages.tomorrow' },
  { value: 'week', labelKey: 'outages.thisWeek' },
];

/**
 * Фільтри списку відключень — пігулками, а не випадаючими списками.
 *
 * Раніше тут стояли три `<select>` із зашитими українськими підписами й «чергами 1…6», яких
 * у графіку не існує: реальні коди — «2/2», «35/1». Вибір такої «черги» не знаходив нічого, і
 * фільтр виглядав зламаним. Тепер дата, статус і група — пігулки з фактичних даних області, а
 * всі підписи беруться з uk.json. Район лишається `<select>`: у великій області це десятки
 * населених пунктів, і горизонтальна стрічка пігулок перетворилася б на нескінченний скрол.
 */
export const FilterPanel: React.FC<FilterPanelProps> = ({
  filters,
  onChange,
  areas,
  queueCodes,
  regionCpu,
  myQueue,
}) => {
  const { t } = useTranslation();

  const datePreset = filters.datePreset ?? 'all';
  const hasActiveFilters =
    Boolean(filters.status) ||
    Boolean(filters.queueCode) ||
    Boolean(filters.area) ||
    datePreset !== 'all';

  /** Одна поведінка для всіх пігулок: тактильний відгук і повна заміна стану. */
  const apply = (patch: OutageFiltersState) => {
    hapticTick('select');
    onChange({ ...filters, ...patch });
  };

  const chipClass = (isActive: boolean) =>
    cn(
      'inline-flex min-h-9 shrink-0 items-center rounded-full border px-3 text-xs font-semibold transition-colors',
      isActive
        ? 'border-primary bg-primary text-primary-foreground'
        : 'border-hairline bg-surface-container-high/50 text-on-surface-variant hover:bg-surface-container-highest',
    );

  // «Моя черга» окремою пігулкою лише тоді, коли вона справді є в списку груп області:
  // інакше пігулка вела б у порожній результат.
  const showMyQueue = Boolean(myQueue && queueCodes.includes(myQueue));

  return (
    <div className="space-y-2 rounded-2xl border border-hairline bg-surface-container-high/40 p-3">
      <div className="flex gap-1.5 overflow-x-auto" role="group" aria-label={t('outages.filterDate')}>
        {DATE_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={datePreset === option.value}
            onClick={() => apply({ datePreset: option.value })}
            className={chipClass(datePreset === option.value)}
          >
            {t(option.labelKey)}
          </button>
        ))}
      </div>

      <div className="flex gap-1.5 overflow-x-auto" role="group" aria-label={t('outages.allStatuses')}>
        {STATUS_OPTIONS.map((option) => (
          <button
            key={option.value ?? 'all'}
            type="button"
            aria-pressed={filters.status === option.value}
            onClick={() => apply({ status: option.value })}
            className={chipClass(filters.status === option.value)}
          >
            {t(option.labelKey)}
          </button>
        ))}
      </div>

      <div className="flex gap-1.5 overflow-x-auto" role="group" aria-label={t('outages.queue')}>
        <button
          type="button"
          aria-pressed={!filters.queueCode}
          onClick={() => apply({ queueCode: undefined })}
          className={chipClass(!filters.queueCode)}
        >
          {t('outages.wholeRegion')}
        </button>

        {showMyQueue && myQueue && (
          <button
            type="button"
            aria-pressed={filters.queueCode === myQueue}
            onClick={() => apply({ queueCode: myQueue })}
            className={chipClass(filters.queueCode === myQueue)}
          >
            {t('outages.myQueue', { queue: myQueue })}
          </button>
        )}

        {queueCodes
          .filter((code) => code !== (showMyQueue ? myQueue : undefined))
          .map((code) => (
            <button
              key={code}
              type="button"
              aria-pressed={filters.queueCode === code}
              onClick={() => apply({ queueCode: code })}
              className={cn(chipClass(filters.queueCode === code), 'tabular')}
            >
              {formatQueueLabel(code, regionCpu)}
            </button>
          ))}
      </div>

      {areas.length > 1 && (
        <div className="flex items-center gap-2">
          <label htmlFor="outages-area" className="shrink-0 text-xs font-semibold text-on-surface-variant">
            {t('outages.area')}
          </label>
          <select
            id="outages-area"
            value={filters.area ?? ''}
            onChange={(event) => apply({ area: event.target.value || undefined })}
            className="min-h-9 min-w-0 flex-1 rounded-lg border border-hairline bg-surface-container-high px-2 text-xs text-on-surface focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">{t('outages.wholeRegion')}</option>
            {areas.map((area) => (
              <option key={area} value={area}>
                {area}
              </option>
            ))}
          </select>
        </div>
      )}

      {hasActiveFilters && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() =>
              onChange({ status: undefined, queueCode: undefined, area: undefined, datePreset: 'all' })
            }
            className="inline-flex min-h-9 items-center gap-1 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
          >
            <RotateCcw className="h-3 w-3" aria-hidden />
            {t('common.reset')}
          </button>
        </div>
      )}
    </div>
  );
};

