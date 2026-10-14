import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ZapOff } from 'lucide-react';
import { StatusDot, type NetworkState } from '../ui/StatusDot.js';
import { cn } from '../../lib/cn.js';
import type { GroupOutageSummary } from '@svitlo/shared';

/**
 * Матрица всех групп области: плитка на группу с текущим состоянием.
 *
 * Количество плиток берётся из ответа API, а не из списка «1/1…6/2» в коде. Список был
 * бы неправильным уже потому, что у разных областей разный набор групп (у Киева и Днепра
 * он другой), и человек видел бы несуществующие группы — или, что хуже, не видел бы
 * свою.
 *
 * Человек ищет не «список групп», а «свою». Поэтому плитки идут плотной сеткой, а не
 * колонкой: на телефоне помещаются все сразу, без прокрутки.
 */
export interface GroupMatrixProps {
  /** Сводка по группам области из GET /queues?region=… */
  queues: Array<{ queue: string; slots?: number; lastDate?: string | null }>;
  /** Отключения на сегодня/завтра: по isActiveNow понимаем, где света нет сейчас. */
  outages: GroupOutageSummary[];
  onSelect?: (queue: string) => void;
  className?: string;
}

export const GroupMatrix: React.FC<GroupMatrixProps> = ({ queues, outages, onSelect, className }) => {
  const { t } = useTranslation();

  // Состояние каждой группы собираем из двух источников: список групп даёт состав области,
  // сводка отключений — что происходит сейчас.
  const states = useMemo(() => {
    const byQueue = new Map<string, NetworkState>();
    for (const item of outages) {
      // isActiveNow === true означает отключение прямо сейчас; иначе группа просто есть
      // в графике (свет есть) либо графика по ней нет вовсе.
      byQueue.set(item.queue, item.isActiveNow ? 'off' : 'on');
    }
    return byQueue;
  }, [outages]);

  if (queues.length === 0) {
    return (
      <p className="rounded-2xl border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
        {t('monitor.noQueues')}
      </p>
    );
  }

  return (
    <div className={cn('grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6', className)}>
      {queues.map(({ queue, slots }) => {
        const state = states.get(queue) ?? 'unknown';
        const off = state === 'off';
        return (
          <button
            key={queue}
            type="button"
            onClick={() => onSelect?.(queue)}
            className={cn(
              'flex min-h-[76px] flex-col items-center justify-center gap-1 rounded-2xl border p-2 transition-colors',
              off
                ? 'border-destructive/40 bg-destructive/10'
                : state === 'unknown'
                  ? 'border-border bg-card'
                  : 'border-border bg-card hover:bg-card-raised',
            )}
          >
            <StatusDot state={state} />
            <span
              className={cn(
                'font-timer text-lg font-bold leading-none',
                off ? 'text-destructive' : state === 'unknown' ? 'text-unknown' : 'text-foreground',
              )}
            >
              {queue}
            </span>
            {/* Подпись состояния обязательна: цвет и точка — не единственный носитель смысла. */}
            <span className="flex items-center gap-1 text-[10px] leading-tight text-muted-foreground">
              {off && <ZapOff className="h-3 w-3" aria-hidden />}
              {off
                ? t('monitor.stateOff')
                : state === 'unknown'
                  ? t('monitor.stateNoData')
                  : slots
                    ? t('monitor.stateOn')
                    : t('monitor.stateNoData')}
            </span>
          </button>
        );
      })}
    </div>
  );
};
