import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Loader2, Minimize2, Share2, SquareDashed, TriangleAlert } from 'lucide-react';
import type { ScheduleIntervalUtc } from '@svitlo/shared';
import { shareScheduleCard, type ShareCardLabels } from '../../lib/share-card.js';
import { OFF_STATE_CODE } from '../../lib/scheduleWindow.js';
import { kyivDateKey } from '../../lib/outage-dates.js';
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
  /**
   * Палитра карточки. Если не задана, берётся текущая тема приложения: тёмно-серая
   * картинка в светлом интерфейсе выглядит вклеенной из чужого приложения.
   */
  theme?: 'dark' | 'light';
  /** 'compact' убирает список окон: та же шкала на 480 px ниже. */
  variant?: 'full' | 'compact';
}

export const ShareScheduleButton: React.FC<ShareScheduleButtonProps> = ({
  queue,
  regionName,
  date,
  intervals,
  className,
  theme,
  variant,
}) => {
  const { t } = useTranslation();
  const [state, setState] = useState<ShareState>('idle');
  // Выбор варианта живёт здесь, а не в настройках: это разовое решение перед отправкой,
  // и просить человека сначала сходить в настройки ради «картинка пониже» — лишний шаг.
  const [cardVariant, setCardVariant] = useState<'full' | 'compact'>(variant ?? 'full');

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

    const now = new Date();
    const isToday = date === kyivDateKey(now);
    const currentOff = isToday
      ? intervals.find(
          (interval) =>
            interval.stateCode === OFF_STATE_CODE &&
            Date.parse(interval.startsAt) <= now.getTime() &&
            now.getTime() < Date.parse(interval.endsAt),
        )
      : undefined;
    const statusLabel = !isToday
      ? undefined
      : currentOff
        ? t('home.heroOff')
        : intervals.length > 0
          ? t('home.heroOn')
          : t('home.heroNoData');
    const statusTone = !isToday
      ? undefined
      : currentOff
        ? 'off'
        : intervals.length > 0
          ? 'on'
          : 'unknown';

    // Тему читаем в момент нажатия, а не в рендере: пользователь мог переключить её
    // после того, как кнопка появилась на экране.
    const activeTheme =
      theme ?? (document.documentElement.classList.contains('dark') ? 'dark' : 'light');

    const result = await shareScheduleCard({
      queue,
      regionName,
      date,
      intervals,
      labels,
      statusLabel,
      statusTone,
      theme: activeTheme,
      variant: cardVariant,
    });
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

  const isCompact = cardVariant === 'compact';

  return (
    <div className="flex items-center gap-2">
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

      {/* Переключатель высоты карточки. Иконки, а не текст: рядом с кнопкой уже есть
          подпись результата, и третья надпись здесь превращалась бы в мешанину. */}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => setCardVariant(isCompact ? 'full' : 'compact')}
        aria-pressed={isCompact}
        aria-label={isCompact ? t('share.variantFull') : t('share.variantCompact')}
        title={isCompact ? t('share.variantFull') : t('share.variantCompact')}
        // Рамка и высота как у соседней кнопки. Голый icon без рамки в ленте действий
        // читался как «забытый в разметке SVG», а не как переключатель размера картинки.
        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-hairline bg-surface-container px-0 text-muted-foreground hover:bg-surface-container-high hover:text-foreground"
      >
        {isCompact
          ? <SquareDashed className="h-4 w-4" aria-hidden />
          : <Minimize2 className="h-4 w-4" aria-hidden />}
      </Button>
    </div>
  );
};
