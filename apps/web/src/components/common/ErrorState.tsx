import { useTranslation } from 'react-i18next';
import { TriangleAlert } from 'lucide-react';
import { Button } from '../ui/Button.js';

interface ErrorStateProps {
  onRetry?: () => void;
  className?: string;
}

/**
 * Ошибка загрузки. Отдельный блок вместо красной строки «Error/Retry» без перевода:
 * у пользователя должен быть выход (кнопка) и объяснение (skills/frontend-ui-change).
 */
export const ErrorState = ({ onRetry, className }: ErrorStateProps) => {
  const { t } = useTranslation();

  return (
    <div
      role="alert"
      className={[
        'flex flex-col items-center gap-3 rounded-2xl border border-destructive/40 bg-destructive/5 px-6 py-8 text-center',
        className ?? '',
      ].join(' ')}
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
        <TriangleAlert className="h-5 w-5" aria-hidden />
      </span>
      <p className="text-sm font-semibold text-foreground">{t('common.error')}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      )}
    </div>
  );
};
