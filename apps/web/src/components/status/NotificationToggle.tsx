import React from 'react';
import { useTranslation } from 'react-i18next';
import { BellOff, BellRing, ShieldAlert } from 'lucide-react';
import { Button } from '../ui/Button.js';
import { enableNotifications, useNotificationSupport } from '../../hooks/useOutageNotifications.js';

/**
 * Включение предупреждений об отключениях.
 *
 * Текст говорит, что предупредим **пока приложение открыто**: без push-сервера фоновые
 * уведомления невозможны, а обещание «предупредим, даже если застосунок закрито» было бы
 * ложью, из-за которой человек выключил бы будильник, понадеявшись на приложение.
 *
 * Если доступа нет вовсе (Android WebView в APK, старый браузер), кнопки не показываем — их
 * нажатие ничего не даст; вместо этого честно говорим, что именно недоступно.
 */
export const NotificationToggle: React.FC = () => {
  const { t } = useTranslation();
  const support = useNotificationSupport();

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-foreground">{t('alerts.settingsTitle')}</p>

        {support === 'granted' && (
          <span role="status" className="inline-flex items-center gap-1.5 text-xs font-medium text-success">
            <BellRing className="h-4 w-4" aria-hidden />
            {t('alerts.enabled')}
          </span>
        )}

        {support === 'default' && (
          <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={enableNotifications}>
            <BellRing className="h-4 w-4" aria-hidden />
            {t('alerts.enable')}
          </Button>
        )}

        {support === 'denied' && (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-warning">
            <BellOff className="h-4 w-4" aria-hidden />
            {t('alerts.denied')}
          </span>
        )}

        {support === 'unsupported' && (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <ShieldAlert className="h-4 w-4" aria-hidden />
            {t('alerts.unsupported')}
          </span>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {support === 'denied'
          ? t('alerts.deniedHint')
          : support === 'unsupported'
            ? t('alerts.unsupportedHint')
            : t('alerts.hint')}
      </p>
    </div>
  );
};
