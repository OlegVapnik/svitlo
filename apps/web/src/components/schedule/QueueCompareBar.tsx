import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ArrowLeftRight, Check, ChevronDown, X } from 'lucide-react';
import { useQueueSchedule, useQueues } from '../../api/queries.js';
import { useBookmarks } from '../../hooks/useBookmarks.js';
import { useRegion } from '../../hooks/useRegion.js';
import {
  overlapStates,
  overlapSummary,
  slotStates,
  slotsToMinutes,
  type OverlapState,
  type SlotState,
} from '../../lib/queue-overlap.js';
import { toDaySchedule } from '../../lib/schedule-payload.js';
import { formatMinutesUk } from '../../lib/scheduleWindow.js';
import { hapticTick } from '../../lib/haptics.js';
import { Button } from '../ui/Button.js';
import { cn } from '../../lib/cn.js';

/**
 * «Перетин груп» — що відбувається зі світлом у двох місцях одночасно.
 *
 * Задача не «показати ще один графік», а відповісти на питання: коли я можу бути вдома, а коли —
 * на роботі, і чи є година, коли світло є хоч десь (переждати відключення). Тому третя смуга —
 * не сума двох, а окрема класифікація кожної півгодини: в обох / хоч в одній / ніде.
 *
 * Другу групу беремо з закладок (у них своя область — «Дім» і «Робота» можуть бути в різних
 * ОСР) або зі списку груп поточної області. Жодних вигаданих кодів: тільки те, що є в API.
 */
interface CompareCandidate {
  key: string;
  /** Название закладки («Дім», «Робота»); у групп своей области его нет. */
  title?: string;
  /** Название области — вторая строка в списке выбора. */
  regionName: string;
  regionCpu: string;
  queue: string;
}

export interface QueueCompareBarProps {
  /** cpu области основной группы. */
  region: string;
  /** Код основной группы. */
  queue: string;
  /** Киевская дата, на которую сравниваем (та же, что выбрана в герое). */
  date: string;
  className?: string;
}

const GROUP_TONE: Record<SlotState, string> = {
  on: 'bg-success/70',
  off: 'bg-destructive/70',
  unknown: 'bg-surface-container-highest',
};

const OVERLAP_TONE: Record<OverlapState, string> = {
  both: 'bg-success',
  either: 'bg-warning/80',
  none: 'bg-destructive/70',
  unknown: 'bg-surface-container-highest',
};

export const QueueCompareBar: React.FC<QueueCompareBarProps> = ({ region, queue, date, className }) => {
  const { t } = useTranslation();
  const { bookmarks } = useBookmarks();
  const { regions } = useRegion();
  const { data: queuesResponse } = useQueues(region);
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Выпадающий список закрывается тапом мимо него: на телефоне это ожидаемое поведение
  // любого меню, а оставленный открытым список перекрывал смуги сравнения.
  useEffect(() => {
    if (!pickerOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [pickerOpen]);

  const candidates = useMemo<CompareCandidate[]>(() => {
    const regionName = (cpu: string) => regions.find((item) => item.cpu === cpu)?.nameUa ?? cpu;
    const fromBookmarks = bookmarks
      .filter((bookmark) => !(bookmark.regionCpu === region && bookmark.queue === queue))
      .map((bookmark) => ({
        key: `bm:${bookmark.id}`,
        title: bookmark.label,
        regionName: regionName(bookmark.regionCpu),
        regionCpu: bookmark.regionCpu,
        queue: bookmark.queue,
      }));
    const fromQueues = (queuesResponse?.data ?? [])
      .map((item) => item.queue)
      .filter((code) => code !== queue)
      .map((code) => ({
        key: `q:${code}`,
        regionName: regionName(region),
        regionCpu: region,
        queue: code,
      }));
    return [...fromBookmarks, ...fromQueues];
  }, [bookmarks, region, queue, regions, queuesResponse]);

  const target = candidates.find((candidate) => candidate.key === selection) ?? candidates[0] ?? null;

  /** Первая строка пункта списка: название закладки либо «Черга 2/2» для групп области. */
  const candidateTitle = (candidate: CompareCandidate): string =>
    candidate.title ?? t('home.heroQueue', { queue: candidate.queue });
  /** Вторая строка: область, а для закладки ещё и её группа (закладка живёт в другой области). */
  const candidateSubtitle = (candidate: CompareCandidate): string =>
    candidate.title ? `${candidate.regionName} · ${candidate.queue}` : candidate.regionName;

  const aQuery = useQueueSchedule(queue, date, region);
  const bQuery = useQueueSchedule(open ? target?.queue : undefined, date, target?.regionCpu ?? region);

  const aDay = useMemo(() => toDaySchedule(date, aQuery.data), [date, aQuery.data]);
  const bDay = useMemo(() => (open ? toDaySchedule(date, bQuery.data) : null), [open, date, bQuery.data]);
  const aStates = useMemo(() => (aDay ? slotStates(aDay) : null), [aDay]);
  const bStates = useMemo(() => (bDay ? slotStates(bDay) : null), [bDay]);
  const cells = useMemo(
    () => (aStates && bStates ? overlapStates(aStates, bStates) : null),
    [aStates, bStates],
  );
  const summary = useMemo(() => (cells ? overlapSummary(cells) : null), [cells]);

  const ownLabel = bookmarks.find((bookmark) => bookmark.regionCpu === region && bookmark.queue === queue)?.label;
  // Без закладки подписываем строку самим кодом группы: `home.heroQueue` уже содержит
  // «Черга», и в паре с кодом получалось «Основна · Черга 2/2 · 2/2».
  const aLabel = ownLabel ?? queue;

  if (!queue) return null;

  const unknownCells = (count: number): string[] => new Array(count).fill('bg-surface-container-highest');

  return (
    <div className={cn('rounded-2xl border border-hairline bg-surface-container-high/50 p-3', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-on-surface-variant">
          <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden />
          {t('compare.title')}
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-expanded={open}
          className="gap-1.5"
          onClick={() => {
            hapticTick('select');
            if (open) setPickerOpen(false);
            setOpen((value) => !value);
          }}
        >
          {open ? <X className="h-3.5 w-3.5" aria-hidden /> : <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden />}
          {open ? t('compare.hide') : t('compare.button')}
        </Button>
      </div>

      {open && (
        <div className="mt-2.5 space-y-2">
          {candidates.length === 0 ? (
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t('compare.needSecond')}{' '}
              <Link to="/queues" className="font-semibold text-primary underline-offset-2 hover:underline">
                {t('nav.queues')}
              </Link>
            </p>
          ) : (
            <>
              <div className="space-y-1">
                <span id="compare-queue-label" className="block text-[11px] font-semibold text-on-surface-variant">
                  {t('compare.pickQueue')}
                </span>
                {target && (
                  <div ref={pickerRef} className="relative">
                    {/* Свой список вместо нативного <select>: системный диалог рисовал
                        «Чернігівська область · Черга 1/1» огромным шрифтом поверх
                        приложения и не помещался в экран. Здесь — короткий код группы
                        и область второй строкой, как в остальном интерфейсе. */}
                    <button
                      type="button"
                      aria-haspopup="listbox"
                      aria-expanded={pickerOpen}
                      aria-labelledby="compare-queue-label"
                      onClick={() => {
                        hapticTick('tick');
                        setPickerOpen((value) => !value);
                      }}
                      className="flex min-h-11 w-full items-center gap-2 rounded-xl border border-hairline bg-surface-container-high px-3 text-left text-xs font-semibold text-on-surface transition-colors hover:bg-surface-container-highest focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="shrink-0 rounded-full bg-surface-container-highest px-2 py-0.5 text-[11px] font-bold tabular">
                        {target.queue}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-on-surface-variant">
                        {candidateSubtitle(target)}
                      </span>
                      <ChevronDown
                        className={cn(
                          'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                          pickerOpen && 'rotate-180',
                        )}
                        aria-hidden
                      />
                    </button>

                    {pickerOpen && (
                      <ul
                        role="listbox"
                        aria-labelledby="compare-queue-label"
                        className="absolute inset-x-0 top-full z-20 mt-1 max-h-60 overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-lg"
                      >
                        {candidates.map((candidate) => {
                          const isSelected = candidate.key === target.key;
                          return (
                            <li key={candidate.key} role="option" aria-selected={isSelected}>
                              <button
                                type="button"
                                onClick={() => {
                                  hapticTick('select');
                                  setSelection(candidate.key);
                                  setPickerOpen(false);
                                }}
                                className={cn(
                                  'flex min-h-11 w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors',
                                  isSelected ? 'bg-primary/10 text-primary' : 'hover:bg-muted',
                                )}
                              >
                                <span className="w-11 shrink-0 text-xs font-bold tabular">{candidate.queue}</span>
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-xs font-semibold">{candidateTitle(candidate)}</span>
                                  <span className="block truncate text-[11px] text-muted-foreground">
                                    {candidateSubtitle(candidate)}
                                  </span>
                                </span>
                                {isSelected && <Check className="h-4 w-4 shrink-0" aria-hidden />}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <CompareRow
                  label={`${t('compare.rowA')} · ${aLabel} · ${queue}`}
                  cells={aStates ? aStates.map((state) => GROUP_TONE[state]) : unknownCells(48)}
                />
                <CompareRow
                  label={`${t('compare.rowB')} · ${target ? (target.title ?? target.queue) : ''}`}
                  cells={bStates ? bStates.map((state) => GROUP_TONE[state]) : unknownCells(48)}
                />
                <CompareRow
                  label={t('compare.overlap')}
                  emphasize
                  cells={cells ? cells.map((state) => OVERLAP_TONE[state]) : unknownCells(48)}
                />
              </div>

              <div className="flex justify-between pl-28 text-[10px] font-semibold text-muted-foreground tabular">
                <span>00</span>
                <span>06</span>
                <span>12</span>
                <span>18</span>
                <span>24</span>
              </div>

              <p className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-success" aria-hidden />
                  {t('compare.sumBoth', { time: formatMinutesUk(slotsToMinutes(summary?.both ?? 0)) })}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-warning" aria-hidden />
                  {t('compare.sumEither', { time: formatMinutesUk(slotsToMinutes(summary?.either ?? 0)) })}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-destructive" aria-hidden />
                  {t('compare.sumNone', { time: formatMinutesUk(slotsToMinutes(summary?.none ?? 0)) })}
                </span>
              </p>

              {(!bDay || (summary?.unknown ?? 0) > 0) && (
                <p className="text-[11px] leading-tight text-warning">{t('compare.noData', { date })}</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * Одна смуга порівняння: 48 півгодинних клітинок без проміжків усередині кольору.
 * `role="img"` + подпись: для скрінрідера це одна фраза, а не 48 пустих елементів.
 */
const CompareRow: React.FC<{ label: string; cells: string[]; emphasize?: boolean }> = ({ label, cells, emphasize }) => (
  <div className="flex items-center gap-2">
    <span
      className={cn(
        'w-26 shrink-0 truncate text-[11px]',
        emphasize ? 'font-bold text-on-surface' : 'font-semibold text-on-surface-variant',
      )}
      title={label}
    >
      {label}
    </span>
    <div role="img" aria-label={label} className="flex h-3 flex-1 gap-px overflow-hidden rounded-sm">
      {cells.map((tone, index) => (
        <span key={index} className={cn('flex-1', tone)} aria-hidden />
      ))}
    </div>
  </div>
);
