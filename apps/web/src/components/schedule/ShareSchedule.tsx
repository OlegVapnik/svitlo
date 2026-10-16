import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Share2, Check } from 'lucide-react';
import { Button } from '../ui/Button.js';
import { cn } from '../../lib/cn.js';
import type { ScheduleIntervalUtc } from '@svitlo/shared';

/**
 * «Поділитись графіком» — отправляет карточку с графиком через системное меню «Поделиться».
 *
 * ПОЧЕМУ НЕ PNG. Собрать canvas-картинку можно, но Web Share API с файлом поддерживают
 * единицы платформ, а `navigator.share` с обычным текстом работает везде. Поэтому шлём
 * текст: он переживает любой мессенджер и не требует canvas ради простой задачи. Если
 * системного меню нет — копируем в буфер, это осознанный запасной путь, а не ошибка.
 */
export interface ShareScheduleProps {
  queue: string;
  regionName: string;
  date: string;
  intervals: ScheduleIntervalUtc[];
  /** Текстовое описание состояния на момент нажатия. */
  summaryLine: string;
  className?: string;
}

/** Собирает человекочитаемый текст графика: окна отключений по локальному времени. */
function buildShareText(
  queue: string,
  regionName: string,
  date: string,
  intervals: ScheduleIntervalUtc[],
  summaryLine: string,
  formatLocal: (iso: string) => string,
): string {
  const lines = [`${summaryLine}`, '', `Черга ${queue} · ${regionName} · ${date}`];
  if (intervals.length === 0) {
    lines.push('Відключень за цей день не передбачено.');
    return lines.join('\n');
  }
  for (const item of intervals) {
    lines.push(`• ${formatLocal(item.startsAt)}–${formatLocal(item.endsAt)}`);
  }
  return lines.join('\n');
}

export const ShareSchedule: React.FC<ShareScheduleProps> = ({
  queue,
  regionName,
  date,
  intervals,
  summaryLine,
  className,
}) => {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  // Проверяем поддержку один раз: navigator.share есть не везде, и на сервере (SSR) его нет.
  const [canShare, setCanShare] = useState(false);

  useEffect(() => {
    setCanShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function');
  }, []);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const formatLocal = (iso: string) =>
    new Intl.DateTimeFormat('uk-UA', {
      timeZone: 'Europe/Kyiv',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));

  const share = async () => {
    const text = buildShareText(queue, regionName, date, intervals, summaryLine, formatLocal);
    try {
      if (canShare) {
        await navigator.share({ title: `Графік ${queue}`, text });
        return;
      }
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // Пользователь закрыл системное меню — это не ошибка, просто молча возвращаемся.
    }
  };

  return (
    <Button onClick={() => void share()} variant="outline" size="sm" className={cn('gap-2', className)}>
      {copied ? <Check className="h-4 w-4" aria-hidden /> : <Share2 className="h-4 w-4" aria-hidden />}
      {copied ? t('share.copied') : t('share.button')}
    </Button>
  );
};