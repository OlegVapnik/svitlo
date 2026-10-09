import { useTranslation } from 'react-i18next';
import { CircleAlert, CircleCheck, CircleDashed } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useStatus } from '@/api/queries.js';
import { sourceSeverity } from '@/lib/source-health.js';
import { formatDateTime, formatRelative } from '@/lib/date.js';

const STYLES = {
  ok: { icon: CircleCheck, className: 'text-success' },
  stale: { icon: CircleDashed, className: 'text-warning' },
  problem: { icon: CircleAlert, className: 'text-destructive' },
} as const;

/**
 * Компактный индикатор состояния источника для шапки: одна иконка и одна подпись.
 * Полные детали (причина, число неудач, время следующей попытки) показывает SourceHealthBanner
 * на странице — в шапке места для них нет, но «данные устарели» видно с любого экрана.
 */
export const FreshnessChip = () => {
  const { t } = useTranslation();
  const { data, isLoading } = useStatus();
  const status = data?.data;

  // Пока идёт первая загрузка — нейтральное «Завантаження…», а не «всё хорошо».
  if (isLoading && !status) {
    return (
      <span className="hidden items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground sm:inline-flex">
        {t('common.loading')}
      </span>
    );
  }

  const severity = sourceSeverity(status);
  const style = STYLES[severity];
  const Icon = style.icon;
  const label =
    severity === 'problem'
      ? t('status.sourceProblem')
      : severity === 'stale'
        ? t('status.dataStale')
        : status?.lastUpdatedAt
          ? formatRelative(status.lastUpdatedAt)
          : t('status.sourceOk');

  const tooltip = [
    status?.lastUpdatedAt ? `${t('status.lastUpdated')}: ${formatDateTime(status.lastUpdatedAt)}` : null,
    status?.nextAttemptAt ? `${t('status.nextAttempt')}: ${formatDateTime(status.nextAttemptAt)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <span
      title={tooltip || undefined}
      className={cn(
        'hidden items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[11px] font-medium sm:inline-flex',
        style.className,
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      <span className="max-w-[14rem] truncate">{label}</span>
    </span>
  );
};
