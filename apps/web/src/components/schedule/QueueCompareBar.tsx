import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ArrowLeftRight, Check, X } from 'lucide-react';
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
import { Select } from '../ui/Select.js';
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
  label: string;
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

  const candidates = useMemo<CompareCandidate[]>(() => {
    const regionName = (cpu: string) => regions.find((item) => item.cpu === cpu)?.nameUa ?? cpu;
    const fromBookmarks = bookmarks
      .filter((bookmark) => !(bookmark.regionCpu === region && bookmark.queue === queue))
      .map((bookmark) => ({
        key: `bm:${bookmark.id}`,
        label: `${bookmark.label} · ${bookmark.queue}`,
        regionCpu: bookmark.regionCpu,
        queue: bookmark.queue,
      }));
    const fromQueues = (queuesResponse?.data ?? [])
      .map((item) => item.queue)
      .filter((code) => code !== queue)
      .map((code) => ({
        key: `q:${code}`,
        label: `${regionName(region)} · ${t('home.heroQueue', { queue: code })}`,
        regionCpu: region,
        queue: code,
      }));
    return [...fromBookmarks, ...fromQueues];
  }, [bookmarks, region, queue, regions, queuesResponse, t]);

  const target = candidates.find((candidate) => candidate.key === selection) ?? candidates[0] ?? null;

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
  const aLabel = ownLabel ?? t('home.heroQueue', { queue });

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
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor="compare-queue" className="text-[11px] font-semibold text-on-surface-variant">
                  {t('compare.pickQueue')}
                </label>
                <Select
                  id="compare-queue"
                  value={target?.key ?? ''}
                  onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
                    hapticTick('select');
                    setSelection(event.target.value);
                  }}
                  className="h-10 min-w-40 flex-1 rounded-xl border border-input bg-transparent px-2 text-xs font-semibold text-on-surface"
                >
                  {candidates.map((candidate) => (
                    <option key={candidate.key} value={candidate.key}>
                      {candidate.label}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="space-y-1.5">
                <CompareRow
                  label={`${t('compare.rowA')} · ${aLabel} · ${queue}`}
                  cells={aStates ? aStates.map((state) => GROUP_TONE[state]) : unknownCells(48)}
                />
                <CompareRow
                  label={`${t('compare.rowB')} · ${target?.label ?? ''}`}
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
