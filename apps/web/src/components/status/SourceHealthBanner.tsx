import { useTranslation } from 'react-i18next';
import { CheckCircle2, CircleAlert, RefreshCw, TriangleAlert, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useStatus } from '@/api/queries.js';
import { useRegion } from '@/hooks/useRegion.js';
import { sourceSeverity, type SourceSeverity } from '@/lib/source-health.js';
import { formatDateTime, formatRelative } from '@/lib/date.js';
import { Button } from '../ui/Button.js';

const TONE: Record<SourceSeverity, { wrap: string; icon: string; Icon: LucideIcon }> = {
  ok: { wrap: 'border-border bg-card', icon: 'text-success', Icon: CheckCircle2 },
  stale: { wrap: 'border-warning/40 bg-warning/5', icon: 'text-warning', Icon: TriangleAlert },
  problem: { wrap: 'border-destructive/40 bg-destructive/5', icon: 'text-destructive', Icon: CircleAlert },
};

interface FactProps {
  label: string;
  value: string;
}

function Fact({ label, value }: FactProps) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="tabular truncate text-xs font-medium text-foreground">{value}</div>
    </div>
  );
}

/**
 * Состояние источника данных: когда обновлялись, когда попробуем снова, что сломалось.
 *
 * Зачем отдельный блок: продукт ценен только свежими данными, а источник (оператор за WAF) иногда
 * отвечает 403/429 — тогда API ставит источник на паузу и кладёт причину в /status (lastError).
 * Показываем всё это честно: «устаревшие данные» нельзя выдавать за живые
 * (skills/frontend-ui-change, PWA; причина уже очищена от персональных данных на стороне API).
 */
export const SourceHealthBanner = ({ className }: { className?: string }) => {
  const { t } = useTranslation();
  const { currentRegion } = useRegion();
  const { data, isLoading, isFetching, refetch } = useStatus(currentRegion);
  const status = data?.data;
  const severity = sourceSeverity(status);
  const tone = TONE[severity];
  const Icon = tone.Icon;

  const title =
    severity === 'problem'
      ? t('status.sourceProblem')
      : severity === 'stale'
        ? t('status.sourceStale')
        : t('status.sourceOk');

  return (
    <section
      aria-live="polite"
      className={cn('rounded-2xl border p-4 shadow-card', tone.wrap, className)}
    >
      <div className="flex items-start gap-3">
        <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', tone.icon)} aria-hidden />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h2 className="text-sm font-semibold text-foreground">{title}</h2>
            {status?.lastUpdatedAt && severity !== 'problem' && (
              <span className="text-xs text-muted-foreground">
                {t('status.lastUpdated')}: {formatRelative(status.lastUpdatedAt)}
              </span>
            )}
          </div>

          {severity === 'stale' && (
            <p className="text-xs text-muted-foreground">{t('status.sourceStaleNote')}</p>
          )}

          {severity === 'problem' && status?.lastError && (
            <p className="tabular break-words rounded-lg bg-background/60 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-destructive">
              {status.lastError}
            </p>
          )}

          {/* Колонка «Оновлено» продублировала строку в шапке («13 хвилин тому») абсолютной
              датой в двух сантиметрах ниже — человек читал одно и то же дважды. Оставляем
              в шапке относительное время (оно и есть главное), а здесь только то, чего там
              нет: когда плановая следующая попытка и сколько раз источник подряд не отдал
              данных. Если `nextAttemptAt` неизвестен (null), колонку не рисуем вовсе — раньше
              на её месте появлялось обрезанное «автооновлення вим…», прямо противоречащее
              заголовку «Дані оновлюються за розкладом». */}
          <div className={cn('grid gap-3', status?.nextAttemptAt ? 'grid-cols-2 sm:grid-cols-2' : 'grid-cols-1')}>
            {status?.nextAttemptAt ? (
              <Fact
                label={t('status.nextAttempt')}
                value={formatDateTime(status.nextAttemptAt)}
              />
            ) : null}
            {status && (status.consecutiveParseFailures ?? 0) > 0 && (
              <Fact
                label={t('status.failuresInRow')}
                value={String(status.consecutiveParseFailures ?? 0)}
              />
            )}
          </div>

          {status?.pausedUntil && (
            <p className="text-xs font-medium text-destructive">
              {t('status.sourcePaused')} {formatDateTime(status.pausedUntil)}
            </p>
          )}
        </div>

        <Button
          variant="ghost"
          size="icon"
          onClick={() => void refetch()}
          aria-label={t('status.refresh')}
          title={t('status.refresh')}
          disabled={isFetching}
        >
          <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} aria-hidden />
        </Button>
      </div>
    </section>
  );
};
