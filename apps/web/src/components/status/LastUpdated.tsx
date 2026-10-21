import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock } from 'lucide-react';
import { cn } from '../../lib/cn.js';
import { formatDateTime, formatRelative } from '../../lib/date.js';

interface LastUpdatedProps {
  timestamp: string;
  className?: string;
}

/**
 * «Оновлено 5 хвилин тому» с абсолютным временем в подсказке.
 * Текст обновляется раз в 30 секунд (и без него подпись «5 хвилин тому» застыла бы навсегда).
 */
export const LastUpdated: React.FC<LastUpdatedProps> = ({ timestamp, className }) => {
  const { t } = useTranslation();
  const [, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTick((tick) => tick + 1), 30000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div
      className={cn('flex items-center gap-1.5 text-xs text-muted-foreground', className)}
      title={formatDateTime(timestamp)}
    >
      <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="truncate">
        {t('status.lastUpdated')}: <b className="tabular font-semibold text-foreground">{formatRelative(timestamp)}</b>
      </span>
    </div>
  );
};
