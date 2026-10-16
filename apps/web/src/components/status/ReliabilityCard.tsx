import React, { useMemo, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import type { ReliabilityBucket, ReliabilityRegionSummary, ReliabilityReport } from '@svitlo/shared';
import { Skeleton } from '../ui/Skeleton.js';
import { formatMinutes } from './PowerSummaryCard.js';

type Granularity = 'days' | 'weeks' | 'months' | 'groups' | 'regions';

const TABS: Array<{ id: Granularity; label: string }> = [
  { id: 'days', label: 'Дні' },
  { id: 'weeks', label: 'Тижні' },
  { id: 'months', label: 'Місяці' },
  // Розбиття по групах: люди найчастіше питають «а скільки в МОЄЙ групі», а не загальне по области.
  { id: 'groups', label: 'Групи' },
  // Той самий розрахунок по всіх областях: «як у мене і як поруч» видно без вигаданих цифр по
  // областях, де графіка немає — такі в список не потрапляють.
  { id: 'regions', label: 'Області' },
];

function barColor(pct: number): string {
  if (pct >= 99) return 'bg-emerald-500';
  if (pct >= 95) return 'bg-lime-500';
  if (pct >= 85) return 'bg-amber-500';
  return 'bg-red-500';
}

/** Один рядок статистики: підпис, смуга «зі світлом», надійність і час без світла. */
const ReliabilityRow: React.FC<{ bucket: ReliabilityBucket }> = ({ bucket }) => {
  const width = bucket.windowMinutes > 0
    ? Math.min(100, Math.max(0, (bucket.poweredMinutes / bucket.windowMinutes) * 100))
    : 100;
  return (
    <div className="flex items-center gap-3">
      <span className="flex w-24 shrink-0 items-center gap-1 text-xs text-muted-foreground">
        <span className="truncate">{bucket.label}</span>
        {/* Завтрашній день порахований за вже опублікованим ГПВ, а не за фактом: без позначки
            людина читала б прогноз як «так і було». */}
        {bucket.isForecast && (
          <span className="shrink-0 rounded bg-muted px-1 text-[10px] uppercase tracking-wide">прогноз</span>
        )}
      </span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-red-500/20">
        <div className={`h-full rounded-full ${barColor(bucket.reliabilityPct)}`} style={{ width: `${width}%` }} />
      </div>
      <span className="w-14 shrink-0 text-right text-xs font-semibold tabular-nums text-foreground">
        {bucket.hasData ? `${bucket.reliabilityPct}%` : '—'}
      </span>
      <span className="w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {bucket.hasData ? formatMinutes(bucket.outageMinutes) : '—'}
      </span>
    </div>
  );
};

/** Рядок «по областях»: назва, смуга надійності, відсоток і час без світла. */
const RegionRow: React.FC<{
  summary: ReliabilityRegionSummary;
  isCurrent: boolean;
}> = ({ summary, isCurrent }) => {
  const width = summary.windowMinutes > 0
    ? Math.min(100, Math.max(0, (summary.poweredMinutes / summary.windowMinutes) * 100))
    : 100;
  return (
    <div className="flex items-center gap-3">
      <span
        className={`w-24 shrink-0 truncate text-xs ${isCurrent ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}
      >
        {summary.nameUa}
      </span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-red-500/20">
        <div className={`h-full rounded-full ${barColor(summary.reliabilityPct)}`} style={{ width: `${width}%` }} />
      </div>
      <span className="w-14 shrink-0 text-right text-xs font-semibold tabular-nums text-foreground">
        {summary.hasData ? `${summary.reliabilityPct}%` : '—'}
      </span>
      <span className="w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {summary.hasData ? formatMinutes(summary.outageMinutes) : '—'}
      </span>
    </div>
  );
};

/** Рядок «по групах»: код черги, смуга надійності, відсоток і час без світла. */
const GroupRow: React.FC<{
  queue: string;
  reliabilityPct: number;
  outageMinutes: number;
  windowMinutes: number;
}> = ({ queue, reliabilityPct, outageMinutes, windowMinutes }) => {
  const width = windowMinutes > 0 ? Math.min(100, Math.max(0, ((windowMinutes - outageMinutes) / windowMinutes) * 100)) : 100;
  return (
    <div className="flex items-center gap-3">
      <span className="w-24 shrink-0 text-xs font-semibold text-foreground">Черга {queue}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-red-500/20">
        <div className={`h-full rounded-full ${barColor(reliabilityPct)}`} style={{ width: `${width}%` }} />
      </div>
      <span className="w-14 shrink-0 text-right text-xs font-semibold tabular-nums text-foreground">
        {reliabilityPct}%
      </span>
      <span className="w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {formatMinutes(outageMinutes)}
      </span>
    </div>
  );
};

interface ReliabilityCardProps {
  report?: ReliabilityReport | null;
  isLoading?: boolean;
  /** `cpu` обраної області: у списку областей її рядок має бути впізнаваний з першого погляду. */
  currentRegion?: string;
}

/**
 * Статистика електропостачання з початку поточного місяця: по днях, тижнях і місяцях.
 * Рахує лише фактичні (вже минулі) інтервали — у майбутнє не заглядає.
 */
export const ReliabilityCard: React.FC<ReliabilityCardProps> = ({ report, isLoading, currentRegion }) => {
  const [granularity, setGranularity] = useState<Granularity>('days');
  const groups = report?.groups ?? [];
  const regionSummaries = report?.byRegionSummary ?? [];
  // Найсвіжіші періоди — зверху. Режими «Групи» та «Області» рендеряться окремо (GroupRow,
  // RegionRow), тож у бакетах завжди ReliabilityBucket — інакше типи мішалися б.
  const timeGranularity: 'days' | 'weeks' | 'months' =
    granularity === 'groups' || granularity === 'regions' ? 'days' : granularity;
  const buckets = useMemo(
    () => [...(report?.[timeGranularity] ?? [])].reverse(),
    [report, timeGranularity],
  );

  // Для груп загальний відсоток рахуємо по сумі хвилин без світла (середнє за групами), а не
  // середньому відсотків: інакше група з 100% «піднімала» біднішу до 95% і різниця губилася.
  const totalWindow = buckets.reduce((sum, bucket) => sum + bucket.windowMinutes, 0);
  const totalOutage = buckets.reduce((sum, bucket) => sum + bucket.outageMinutes, 0);
  const overallPct = totalWindow > 0 ? Math.round((1 - totalOutage / totalWindow) * 1000) / 10 : 100;
  const hasAnyData = buckets.some((bucket) => bucket.hasData);
  // Список областей довгий (27 рядків), тому показуємо найгірші й завжди — свою область:
  // саме її людина шукає, і без неї порівняння втрачає сенс.
  const visibleRegions = useMemo(() => {
    const current = regionSummaries.filter((summary) => summary.region === currentRegion);
    const rest = regionSummaries.filter((summary) => summary.region !== currentRegion).slice(0, 8);
    return [...current, ...rest];
  }, [regionSummaries, currentRegion]);

  const fromLabel = report?.from
    ? new Intl.DateTimeFormat('uk-UA', { timeZone: 'Europe/Kyiv', day: 'numeric', month: 'long' }).format(new Date(report.from))
    : '';

  return (
    <div className="space-y-3 rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <BarChart3 className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-semibold text-foreground">Статистика електропостачання</div>
            <div className="text-xs text-muted-foreground">
              {fromLabel ? `З ${fromLabel} · по днях, тижнях і місяцях` : 'По днях, тижнях і місяцях'}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold leading-none text-foreground">
            {isLoading ? '—' : hasAnyData ? `${overallPct}%` : '—'}
          </div>
          <div className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">надійність</div>
        </div>
      </div>

      <div className="flex gap-1 rounded-lg bg-muted p-1">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setGranularity(tab.id)}
            className={`flex-1 rounded-md px-2 py-1 text-xs font-semibold transition-colors ${
              granularity === tab.id ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-4 w-full" />)}
        </div>
      ) : granularity === 'regions' ? (
        visibleRegions.length === 0 ? (
          <p className="text-xs text-muted-foreground">За цей період немає жодної області з графіком.</p>
        ) : (
          <div className="space-y-2">
            {visibleRegions.map((summary) => (
              <RegionRow
                key={summary.region}
                summary={summary}
                isCurrent={summary.region === currentRegion}
              />
            ))}
          </div>
        )
      ) : buckets.length === 0 ? (
        <p className="text-xs text-muted-foreground">Даних за цей період ще немає.</p>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-end gap-3 text-[10px] uppercase tracking-wide text-muted-foreground">
            <span className="w-14 text-right">надійність</span>
            <span className="w-20 text-right">без світла</span>
          </div>
          {granularity === 'groups'
            ? groups.map((group) => (
                <GroupRow
                  key={group.queue}
                  queue={group.queue}
                  reliabilityPct={group.reliabilityPct}
                  outageMinutes={group.outageMinutes}
                  windowMinutes={group.windowMinutes}
                />
              ))
            : buckets.map((bucket) => <ReliabilityRow key={bucket.key} bucket={bucket} />)}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        {granularity === 'regions'
          ? 'Порівняння областей за той самий період. Області без опублікованого графіка в список не потрапляють.'
          : 'Рахуємо фактично минулі інтервали; завтрашній день — прогноз за вже опублікованим ГПВ.'}
      </p>
    </div>
  );
};
