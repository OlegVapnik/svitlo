import React from 'react';
import { useTranslation } from 'react-i18next';
import { Filter, RotateCcw } from 'lucide-react';
import { Select } from '../ui/Select.js';
import { Button } from '../ui/Button.js';
import type { OutageStatus } from '@svitlo/shared';

interface FilterState {
  status?: OutageStatus;
  queue?: number;
  area?: string;
  datePreset?: 'all' | 'today' | 'tomorrow' | 'week';
}

interface FilterPanelProps {
  filters: FilterState;
  onChange: (filters: FilterState) => void;
  areas: string[];
}

export const FilterPanel: React.FC<FilterPanelProps> = ({
  filters,
  onChange,
  areas,
}) => {
  const { t } = useTranslation();

  const handleDatePreset = (preset: 'all' | 'today' | 'tomorrow' | 'week') => {
    onChange({ ...filters, datePreset: preset });
  };

  const handleReset = () => {
    onChange({
      status: undefined,
      queue: undefined,
      area: undefined,
      datePreset: 'all',
    });
  };

  const hasActiveFilters =
    filters.status ||
    filters.queue ||
    filters.area ||
    (filters.datePreset && filters.datePreset !== 'all');

  return (
    <div className="bg-card p-3 sm:p-4 rounded-xl border border-border space-y-3">
      {/* Date preset buttons */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
        {(['all', 'today', 'tomorrow', 'week'] as const).map((preset) => (
          <button
            key={preset}
            onClick={() => handleDatePreset(preset)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
              (filters.datePreset || 'all') === preset
                ? 'bg-primary text-primary-foreground shadow-xs'
                : 'bg-muted/60 text-muted-foreground hover:bg-muted'
            }`}
          >
            {preset === 'all' && 'Всі дати'}
            {preset === 'today' && t('outages.today', 'Сьогодні')}
            {preset === 'tomorrow' && t('outages.tomorrow', 'Завтра')}
            {preset === 'week' && t('outages.thisWeek', 'Цей тиждень')}
          </button>
        ))}
      </div>

      {/* Dropdown filters */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {/* Status */}
        <select
          value={filters.status || ''}
          onChange={(e) => onChange({ ...filters, status: (e.target.value || undefined) as OutageStatus | undefined })}
          className="h-9 px-2.5 rounded-lg border border-border bg-background text-xs text-foreground focus:ring-1 focus:ring-primary"
        >
          <option value="">{t('outages.allStatuses', 'Всі статуси')}</option>
          <option value="scheduled">{t('outages.scheduled', 'Заплановані')}</option>
          <option value="active">{t('outages.active', 'Активні')}</option>
          <option value="finished">{t('outages.finished', 'Завершені')}</option>
        </select>

        {/* Queue */}
        <select
          value={filters.queue || ''}
          onChange={(e) =>
            onChange({ ...filters, queue: e.target.value ? Number(e.target.value) : undefined })
          }
          className="h-9 px-2.5 rounded-lg border border-border bg-background text-xs text-foreground focus:ring-1 focus:ring-primary"
        >
          <option value="">Всі черги</option>
          {[1, 2, 3, 4, 5, 6].map((q) => (
            <option key={q} value={q}>
              Черга {q}
            </option>
          ))}
        </select>

        {/* Area */}
        <select
          value={filters.area || ''}
          onChange={(e) => onChange({ ...filters, area: e.target.value || undefined })}
          className="h-9 px-2.5 rounded-lg border border-border bg-background text-xs text-foreground focus:ring-1 focus:ring-primary col-span-2 sm:col-span-1"
        >
          <option value="">Всі райони</option>
          {areas.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>

      {/* Reset button if filters active */}
      {hasActiveFilters && (
        <div className="flex justify-end pt-1">
          <button
            onClick={handleReset}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Скинути фільтри</span>
          </button>
        </div>
      )}
    </div>
  );
};