import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, MapPin, Search, X } from 'lucide-react';
import { useRegion } from '../../hooks/useRegion.js';
import { regionDataBadge, type RegionSummary } from '../../lib/region.js';
import { cn } from '../../lib/cn.js';

interface RegionPickerProps {
  className?: string;
  variant?: 'prominent' | 'compact';
}

export const RegionPicker: React.FC<RegionPickerProps> = ({
  className,
  variant = 'prominent',
}) => {
  const { t } = useTranslation();
  const { currentRegion, setRegion, regions, currentRegionData, isLoading } = useRegion();
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const listboxId = useId();
  // Бейдж області: слоти / «світло за графіком» / «немає даних» — логіка спільна зі списком.
  const currentBadge = regionDataBadge(currentRegionData);

  // Фільтруємо області за пошуковим запитом
  const filteredRegions = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return regions;
    return regions.filter((r) => {
      const matchUa = r.nameUa.toLowerCase().includes(query);
      const matchEn = r.nameEn ? r.nameEn.toLowerCase().includes(query) : false;
      const matchCpu = r.cpu.toLowerCase().includes(query);
      return matchUa || matchEn || matchCpu;
    });
  }, [regions, search]);

  // Закриття при кліку поза межами
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Фокус на інпут при відкритті
  useEffect(() => {
    if (isOpen) {
      setSearch('');
      setActiveIndex(0);
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  // Прокручування до активного елемента при клавіатурній навігації
  useEffect(() => {
    if (!isOpen || !listRef.current) return;
    const activeEl = listRef.current.children[activeIndex] as HTMLElement | undefined;
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex, isOpen]);

  const handleSelect = (region: RegionSummary) => {
    setRegion(region.cpu);
    setIsOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => (prev + 1 < filteredRegions.length ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => (prev - 1 >= 0 ? prev - 1 : filteredRegions.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const selected = filteredRegions[activeIndex];
      if (selected) {
        handleSelect(selected);
      }
    }
  };

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      {/* Кнопка-тригер вибору області */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        onKeyDown={handleKeyDown}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-label={t('regions.label')}
        className={cn(
          'group flex items-center justify-between gap-3 rounded-2xl border border-border bg-card text-left transition-all duration-200 hover:border-primary/50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring shadow-card',
          variant === 'prominent'
            ? 'w-full p-3.5 sm:p-4'
            : 'min-h-[44px] px-3.5 py-2 text-xs',
        )}
      >
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={cn(
              'flex shrink-0 items-center justify-center rounded-xl transition-colors',
              variant === 'prominent'
                ? 'h-10 w-10 bg-primary/10 text-primary group-hover:bg-primary/15'
                : 'h-7 w-7 bg-muted text-muted-foreground',
            )}
          >
            <MapPin className={cn(variant === 'prominent' ? 'h-5 w-5' : 'h-3.5 w-3.5')} aria-hidden />
          </span>
          <div className="min-w-0">
            {variant === 'prominent' && (
              <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t('regions.label')}
              </span>
            )}
            <span
              className={cn(
                'block truncate font-bold text-foreground',
                variant === 'prominent' ? 'text-base sm:text-lg' : 'text-xs',
              )}
            >
              {currentRegionData.nameUa}
            </span>
            {variant === 'prominent' && currentRegionData.nameEn && (
              <span className="block truncate text-xs text-muted-foreground">
                {currentRegionData.nameEn}
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {variant === 'prominent' && currentBadge === 'slots' ? (
            <span className="hidden rounded-full bg-success/10 px-2.5 py-0.5 text-xs font-semibold text-success sm:inline-block">
              {t('regions.slotsAvailable', { count: currentRegionData.slots })}
            </span>
          ) : variant === 'prominent' ? (
            <span
              className={cn(
                'hidden rounded-full px-2.5 py-0.5 text-xs font-semibold sm:inline-block',
                currentBadge === 'allClear' ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground',
              )}
            >
              {currentBadge === 'allClear' ? t('regions.allClearShort') : t('regions.noDataShort')}
            </span>
          ) : null}
          <ChevronDown
            className={cn(
              'text-muted-foreground transition-transform duration-200',
              isOpen && 'rotate-180 text-foreground',
              variant === 'prominent' ? 'h-5 w-5' : 'h-4 w-4',
            )}
            aria-hidden
          />
        </div>
      </button>

      {/* Панель випадаючого пошуку та списку (Command-palette style) */}
      {isOpen && (
        <div
          className={cn(
            // У шапці (compact) панель выравнивается по правому краю: кнопка там у правого
            // края экрана, и панель на `left-0 right-0` уезжала бы за границу окна на телефоне.
            variant === 'prominent'
              ? 'absolute left-0 right-0 z-60 mt-2 overflow-hidden rounded-2xl border border-border bg-card shadow-pop animate-fade-in w-full min-w-[300px]'
              : 'absolute right-0 z-60 mt-2 overflow-hidden rounded-2xl border border-border bg-card shadow-pop animate-fade-in w-80 max-w-[90vw]',
          )}
        >
          {/* Пошуковий інпут */}
          <div className="relative border-b border-border p-2.5">
            <Search
              className="pointer-events-none absolute left-5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={handleKeyDown}
              placeholder={t('regions.searchPlaceholder')}
              aria-label={t('regions.searchPlaceholder')}
              aria-autocomplete="list"
              aria-controls={listboxId}
              className="w-full rounded-xl border border-border bg-muted/40 py-2 pl-9 pr-8 text-sm font-medium text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
            />
            {search && (
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  searchInputRef.current?.focus();
                }}
                className="absolute right-4 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:text-foreground"
                aria-label={t('common.dismiss')}
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            )}
          </div>

          {/* Список областей */}
          <ul
            id={listboxId}
            ref={listRef}
            role="listbox"
            aria-label={t('regions.label')}
            className="max-h-72 overflow-y-auto p-1.5 focus:outline-hidden"
          >
            {isLoading && regions.length === 0 ? (
              <li className="px-4 py-6 text-center text-sm text-muted-foreground">
                {t('regions.loading')}
              </li>
            ) : filteredRegions.length === 0 ? (
              <li className="px-4 py-6 text-center text-sm text-muted-foreground">
                {t('regions.notFound')}
              </li>
            ) : (
              filteredRegions.map((region, idx) => {
                const isSelected = region.cpu === currentRegion;
                const isItemActive = idx === activeIndex;
                const badge = regionDataBadge(region);

                return (
                  <li
                    key={region.cpu}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => handleSelect(region)}
                    onMouseEnter={() => setActiveIndex(idx)}
                    className={cn(
                      'flex min-h-[44px] cursor-pointer items-center justify-between rounded-xl px-3 py-2.5 text-sm transition-colors',
                      isItemActive && 'bg-muted',
                      isSelected && 'bg-primary/10 font-semibold text-primary',
                    )}
                  >
                    <div className="min-w-0 pr-2">
                      <div className="flex items-center gap-2">
                        <span className={cn('truncate font-medium text-foreground', isSelected && 'text-primary font-bold')}>
                          {region.nameUa}
                        </span>
                        {isSelected && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden />}
                      </div>
                      {region.nameEn && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {region.nameEn}
                        </span>
                      )}
                    </div>

                    <div className="shrink-0 text-right">
                      {badge === 'slots' ? (
                        <span className="inline-block rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-semibold text-success">
                          {t('regions.slotsCount', { count: region.slots })}
                        </span>
                      ) : (
                        <span
                          className={cn(
                            'inline-block rounded-full px-2 py-0.5 text-[11px]',
                            badge === 'allClear' ? 'bg-success/10 font-semibold text-success' : 'bg-muted font-medium text-muted-foreground',
                          )}
                        >
                          {badge === 'allClear' ? t('regions.allClearShort') : t('regions.noDataShort')}
                        </span>
                      )}
                    </div>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
};
