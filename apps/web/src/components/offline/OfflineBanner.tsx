import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CloudOff } from 'lucide-react';
import {
  isOfflineServed,
  offlineServedAt,
  subscribeOffline,
} from '../../api/offline-cache.js';

/**
 * Баннер «дані з кешу».
 *
 * Пока данные приходят из локального кеша, человек обязан знать, что это не «свежие» цифры:
 * показывать устаревший график молча было бы хуже, чем показать пустой экран. Когда сеть
 * возвращается, баннер исчезает сам — первый успешный ответ снимает флаг.
 */
export const OfflineBanner: React.FC = () => {
  const { t } = useTranslation();
  const [active, setActive] = useState(isOfflineServed());
  const [since, setSince] = useState<string | null>(offlineServedAt());

  useEffect(() => subscribeOffline(() => {
    setActive(isOfflineServed());
    setSince(offlineServedAt());
  }), []);

  if (!active) return null;

  const when = since
    ? new Intl.DateTimeFormat('uk-UA', {
        timeZone: 'Europe/Kyiv',
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(since))
    : null;

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-xs font-semibold text-foreground"
    >
      <CloudOff className="h-4 w-4 shrink-0 text-warning" aria-hidden />
      <span>{t('offline.banner')}</span>
      {when && <span className="text-muted-foreground">{t('offline.savedAt', { when })}</span>}
    </div>
  );
};