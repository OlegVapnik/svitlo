import React from 'react';
import { ShieldCheck } from 'lucide-react';
import type { PowerSummary, PowerWindowSummary } from '@svitlo/shared';
import { Skeleton } from '../ui/Skeleton.js';

/** «1 год 20 хв» з хвилин (0 хв → «0 хв»). */
export function formatMinutes(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (hours === 0) return `${mins} хв`;
  if (mins === 0) return `${hours} год`;
  return `${hours} год ${mins} хв`;
}

export function reliabilityLevel(pct: number): 'excellent' | 'good' | 'warning' | 'bad' {
  if (pct >= 99) return 'excellent';
  if (pct >= 95) return 'good';
  if (pct >= 85) return 'warning';
  return 'bad';
}

const LEVEL_STYLES = {
  excellent: { text: 'text-emerald-600 dark:text-emerald-400', bar: 'bg-emerald-500', chip: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
  good: { text: 'text-lime-600 dark:text-lime-400', bar: 'bg-lime-500', chip: 'bg-lime-500/10 text-lime-600 dark:text-lime-400' },
  warning: { text: 'text-amber-600 dark:text-amber-400', bar: 'bg-amber-500', chip: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' },
  bad: { text: 'text-red-600 dark:text-red-400', bar: 'bg-red-500', chip: 'bg-red-500/10 text-red-600 dark:text-red-400' },
} as const;

/** Рядок «сьогодні» — з 00:00 місцевого часу. */
function TodayRow({ today }: { today?: PowerWindowSummary | null }) {
  if (!today || !today.hasData) return null;
  return (
    <p className="text-[11px] text-muted-foreground">
      За добу (з 00:00): без світла {formatMinutes(today.outageMinutes)} · зі світлом{' '}
      {formatMinutes(today.poweredMinutes)} · у середньому по {today.outageCount} групах
    </p>
  );
}

interface PowerSummaryCardProps {
  summary?: PowerSummary | null;
  isLoading?: boolean;
}

export const PowerSummaryCard: React.FC<PowerSummaryCardProps> = ({ summary, isLoading }) => {
  const window = summary?.last24h;
  const hasData = Boolean(window?.hasData);
  const powered = window?.poweredMinutes ?? 0;
  const outage = window?.outageMinutes ?? 0;
  const windowMinutes = window?.windowMinutes ?? 1440;
  const reliability = window?.reliabilityPct ?? 100;
  const level = LEVEL_STYLES[reliabilityLevel(reliability)];
  const poweredWidth = windowMinutes > 0 ? Math.min(100, Math.max(0, (powered / windowMinutes) * 100)) : 100;

  return (
    <div className="h-full space-y-3 rounded-[28px] border border-outline-variant/50 bg-surface-container p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className={`rounded-2xl p-2 ${level.chip}`}>
            <ShieldCheck className="h-4 w-4" strokeWidth={2.3} />
          </div>
          <div>
            <div className="text-sm font-semibold text-foreground">Електропостачання за 24 години</div>
            {/* Числа — середні по групах области за графиком ГПВ. Сума по группах дала б «20 год
                без світла из 24», хотя окна групп разнесены по часам и света нет лишь у части
                людей; среднее отвечает на вопрос конкретного человека: сколько часов без света
                у группы, в которую попалёшь ты. */}
            <div className="text-xs text-muted-foreground">
              Час без світла та зі світлом, у середньому по групах ({window?.outageCount ?? 0})
            </div>
          </div>
        </div>
        {isLoading ? (
          <Skeleton className="h-9 w-16" />
        ) : (
          <div className={`text-right ${level.text}`}>
            <div className="text-2xl font-bold leading-none">{hasData ? `${reliability}%` : '—'}</div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mt-1">надійність</div>
          </div>
        )}
      </div>

      <div className="h-2.5 w-full overflow-hidden rounded-full bg-destructive/25" role="img" aria-label="Частка часу зі світлом">
        <div className={`h-full rounded-full ${level.bar} transition-all`} style={{ width: `${poweredWidth}%` }} />
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-2">
          <div className="text-muted-foreground">Зі світлом</div>
          <div className="font-semibold text-emerald-600 dark:text-emerald-400">{formatMinutes(powered)}</div>
        </div>
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-2">
          <div className="text-muted-foreground">Без світла</div>
          <div className="font-semibold text-red-600 dark:text-red-400">{formatMinutes(outage)}</div>
        </div>
      </div>

      <TodayRow today={summary?.today} />

      {!isLoading && !hasData && (
        <p className="text-[11px] text-muted-foreground">
          За останні 24 години перерв у даних не зафіксовано — або джерело ще не віддало дані.
        </p>
      )}
      {!isLoading && hasData && window && (
        <p className="text-[11px] text-muted-foreground">Записів про перерви за 24 год: {window.outageCount}.</p>
      )}
    </div>
  );
};
