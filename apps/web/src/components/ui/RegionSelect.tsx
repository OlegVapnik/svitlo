import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { MapPin } from 'lucide-react';
import { useRegion } from '../../hooks/useRegion.js';
import { DEFAULT_REGION, formatRegionOption, regionOptions, type RegionOption } from '../../lib/region.js';
import { cn } from '../../lib/cn.js';

interface RegionSelectProps {
  id?: string;
  className?: string;
  showIcon?: boolean;
}

/** Рядок `<select>`: або звичайна область, або `optgroup` з мережами всередині області. */
type SelectEntry =
  | { kind: 'region'; option: RegionOption }
  | { kind: 'group'; label: string; options: RegionOption[] };

/**
 * Вибір області (мультирегіональність /tmp/API-CONTRACT-regions.md).
 * Семантичні класи Tailwind tokens, доступний елемент select, підтримка тач-зон.
 *
 * Область, яку фід віддає кількома мережами (м. Дніпро: ЦЕК і ДнЕМ), віддаємо `optgroup`-ом: у
 * нативному `<select>` заголовок optgroup не обирається — саме те, що потрібно, бо графіка «по
 * області цілком» не існує, обирати треба мережу (див. `regionOptions`).
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

  const entries = useMemo<SelectEntry[]>(() => {
    const result: SelectEntry[] = [];
    for (const option of regionOptions(regions)) {
      if (option.isGroup) {
        result.push({ kind: 'group', label: formatRegionOption(option.region), options: [] });
        continue;
      }
      const last = result[result.length - 1];
      // Мережі йдуть одразу за своїм заголовком (див. `regionOptions`), тому достатньо перевірити хвіст.
      if (option.depth === 1 && last?.kind === 'group') {
        last.options.push(option);
        continue;
      }
      result.push({ kind: 'region', option });
    }
    return result;
  }, [regions]);

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
          entries.map((entry) =>
            entry.kind === 'region' ? (
              <option key={entry.option.region.cpu} value={entry.option.region.cpu}>
                {formatRegionOption(entry.option.region)}
              </option>
            ) : (
              <optgroup key={entry.label} label={entry.label}>
                {entry.options.map((option) => (
                  <option key={option.region.cpu} value={option.region.cpu}>
                    {formatRegionOption(option.region)}
                  </option>
                ))}
              </optgroup>
            ),
          )
        )}
      </select>
    </div>
  );
};
