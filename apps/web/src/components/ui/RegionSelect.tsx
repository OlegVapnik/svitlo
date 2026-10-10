import React from 'react';
import { useTranslation } from 'react-i18next';
import { MapPin } from 'lucide-react';
import { useRegion } from '../../hooks/useRegion.js';
import { DEFAULT_REGION, formatRegionOption } from '../../lib/region.js';
import { cn } from '../../lib/cn.js';

interface RegionSelectProps {
  id?: string;
  className?: string;
  showIcon?: boolean;
}

/**
 * Вибір області (мультирегіональність /tmp/API-CONTRACT-regions.md).
 * Семантичні класи Tailwind tokens, доступний елемент select, підтримка тач-зон.
 */
export const RegionSelect: React.FC<RegionSelectProps> = ({
  id = 'region-select',
  className,
  showIcon = true,
}) => {
  const { t } = useTranslation();
  const { currentRegion, setRegion, regions, isLoading } = useRegion();

  const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setRegion(event.target.value);
  };

  return (
    <div className={cn('relative inline-flex items-center', className)}>
      {showIcon && (
        <MapPin
          className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-muted-foreground"
          aria-hidden
        />
      )}
      <select
        id={id}
        value={currentRegion}
        onChange={handleChange}
        aria-label={t('regions.label')}
        className={cn(
          'min-h-[44px] appearance-none rounded-xl border border-border bg-card py-2 text-xs font-semibold text-foreground shadow-xs transition-colors hover:border-primary/50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
          showIcon ? 'pl-8 pr-7' : 'px-3 pr-7',
        )}
      >
        {regions.length === 0 ? (
          <option value={DEFAULT_REGION}>
            {isLoading ? t('regions.loading') : t('regions.defaultChernihiv')}
          </option>
        ) : (
          regions.map((region) => (
            <option key={region.cpu} value={region.cpu}>
              {formatRegionOption(region)}
            </option>
          ))
        )}
      </select>
    </div>
  );
};
