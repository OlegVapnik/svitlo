import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Loader2, Share2, TriangleAlert } from 'lucide-react';
import type { ScheduleIntervalUtc } from '@svitlo/shared';
import { shareScheduleCard, type ShareCardLabels } from '../../lib/share-card.js';
import { hapticTick } from '../../lib/haptics.js';
import { Button } from '../ui/Button.js';
import { cn } from '../../lib/cn.js';

/**
 * «Поділитися графіком» — PNG-картка 1080×1350 у системне меню «Поділитися».
 *
 * Раніше кнопка відправляла текст: у Telegram він приходив простирадлом, а в Viber губив
 * вирівнювання. Картинка читається однаково в будь-якому месенджері й не залежить від ширини
 * екрана в отримувача. Якщо платформа не вміє ділитися файлами (десктопний браузер), PNG просто
 * скачується — це той самий результат, лише іншим шляхом.
 *
 * Текст іконки й підпису живе в i18n: у lib/share-card.ts немає жодного зашитого рядка інтерфейсу.
 */
type ShareState = 'idle' | 'busy' | 'shared' | 'downloaded' | 'failed';

export interface ShareScheduleButtonProps {
  queue: string;
  regionName: string;
  date: string;
  intervals: ScheduleIntervalUtc[];
  className?: string;
}

export const ShareScheduleButton: React.FC<ShareScheduleButtonProps> = ({
  queue,
  regionName,
  date,
  intervals,
  className,
}) => {
  const { t } = useTranslation();
  const [state, setState] = useState<ShareState>('idle');

  // Итог («Надіслано» / «Картинку збережено») — подсказка на пару секунд, а не новый статус кнопки.
  useEffect(() => {
    if (state === 'idle' || state === 'busy') return;
    const timer = window.setTimeout(() => setState('idle'), 2600);
    return () => window.clearTimeout(timer);
  }, [state]);

  const labels: ShareCardLabels = {
    title: t('share.cardTitle'),
    queue: t('share.cardQueue'),
    outages: t('share.cardOutages'),
    empty: t('share.cardEmpty'),
    now: t('schedule.now'),
    footer: t('share.cardFooter'),
    updated: t('share.cardUpdated'),
    more: (count: number) => t('share.cardMore', { count }),
  };

  const handleShare = async () => {
    if (state === 'busy') return;
    setState('busy');
    hapticTick('confirm');
    const result = await shareScheduleCard({ queue, regionName, date, intervals, labels });
    if (result === 'cancelled') {
      setState('idle');
      return;
    }
    setState(result);
    hapticTick(result === 'failed' ? 'tick' : 'confirm');
  };

  const text =
    state === 'busy'
      ? t('share.preparing')
      : state === 'failed'
        ? t('share.failed')
        : state === 'shared'
          ? t('share.shared')
          : state === 'downloaded'
            ? t('share.downloaded')
            : t('share.button');

  const Icon =
    state === 'busy' ? Loader2 : state === 'failed' ? TriangleAlert : state === 'idle' ? Share2 : Check;

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={() => void handleShare()}
      disabled={state === 'busy'}
      aria-live="polite"
      className={cn('gap-2', state === 'failed' && 'text-destructive', className)}
    >
      <Icon className={cn('h-4 w-4', state === 'busy' && 'animate-spin')} aria-hidden />
      {text}
    </Button>
  );
};
