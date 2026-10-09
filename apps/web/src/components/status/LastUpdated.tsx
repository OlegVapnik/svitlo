import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock } from 'lucide-react';
import { formatRelative } from '../../lib/date.js';

interface LastUpdatedProps {
  timestamp: string;
}

export const LastUpdated: React.FC<LastUpdatedProps> = ({ timestamp }) => {
  const { t } = useTranslation();
  const [, setTick] = useState(0);

  // Re-render every 30 seconds to update relative time
  useEffect(() => {
    const timer = setInterval(() => {
      setTick((prev) => prev + 1);
    }, 30000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground whitespace-nowrap">
      <Clock className="w-3.5 h-3.5" />
      <span>{t('status.lastUpdated', 'Оновлено')}: <b>{formatRelative(timestamp)}</b></span>
    </div>
  );
};