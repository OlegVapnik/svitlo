import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LayoutGrid, Radar, ZapOff } from 'lucide-react';
import { StatusDot, type NetworkState } from '../ui/StatusDot.js';
import { Queues24hMatrix } from './Queues24hMatrix.js';
import { cn } from '../../lib/cn.js';
import { hapticTick } from '../../lib/haptics.js';
import type { GroupOutageSummary } from '@svitlo/shared';

/**
 * Обзор всех групп области: плитки «что сейчас» и матрица на 24 часа.
 *
 * Плитка отвечает на один вопрос — где света нет прямо сейчас — и это по-прежнему главный
 * сценарий на телефоне. Матрица показывает ритм суток: когда отключат мою чергу и соседнюю.
 * Поэтому режим переключается таблеткой, а не прячется в настройках: оба вида — про одно и
 * то же, но на разной дистанции.
 *
 * Количество плиток берётся из ответа API, а не из списка «1/1…6/2» в коде: у разных
 * областей разный набор групп, и выдуманная группа хуже отсутствующей.
 */
export interface GroupMatrixProps {
  /** Сводка по группам области из GET /queues?region=… */
  queues: Array<{ queue: string; slots?: number; lastDate?: string | null }>;
  /** Отключения на сегодня/завтра: по isActiveNow понимаем, где света нет сейчас. */
  outages: GroupOutageSummary[];
  /** Активная (закладка) очередь: строка матрицы подсвечивается и закрепляется. */
  selectedQueue?: string | null;
  /** Выбор очереди из матрицы: мгновенно делает её активной, без перехода на другой экран. */
  onQueueSelect?: (queue: string) => void;
  /** Старое поведение плитки: открыть график выбранной группы. */
  onSelect?: (queue: string) => void;
  className?: string;
}

type ViewMode = 'matrix' | 'tiles';

export const GroupMatrix: React.FC<GroupMatrixProps> = ({
  queues,
  outages,
  selectedQueue = null,
  onQueueSelect,
  onSelect,
  className,
}) => {
  const { t } = useTranslation();
  const [mode, setMode] = useState<ViewMode>('matrix');

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
      <p className="rounded-2xl border border-hairline bg-card px-4 py-6 text-center text-sm text-on-surface-variant">
        {t('monitor.noQueues')}
      </p>
    );
  }

  return (
    <div className={cn('space-y-3', className)}>
      {/* Переключатель вида: 44px по высоте, как остальные тач-цели приложения. */}
      <div
        role="tablist"
        aria-label={t('monitor.subtitle')}
        className="inline-flex rounded-full border border-hairline bg-card p-0.5"
      >
        {(
          [
            { id: 'matrix', labelKey: 'monitor.modeMatrix', Icon: Radar },
            { id: 'tiles', labelKey: 'monitor.modeTiles', Icon: LayoutGrid },
          ] as const
        ).map(({ id, labelKey, Icon }) => {
          const active = mode === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => {
                hapticTick('select');
                setMode(id);
              }}
              className={cn(
                'inline-flex min-h-11 items-center gap-1.5 rounded-full px-3.5 text-xs font-semibold transition-colors',
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'text-on-surface-variant hover:bg-muted',
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {t(labelKey)}
            </button>
          );
        })}
      </div>

      {mode === 'matrix' ? (
        <Queues24hMatrix
          queues={queues}
          outages={outages}
          selectedQueue={selectedQueue}
          onSelectQueue={(queue) => onQueueSelect?.(queue)}
        />
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
          {queues.map(({ queue, slots }) => {
            const state = states.get(queue) ?? 'unknown';
            const off = state === 'off';
            const active = queue === selectedQueue;
            return (
              <button
                key={queue}
                type="button"
                onClick={() => {
                  hapticTick('select');
                  onQueueSelect?.(queue);
                  onSelect?.(queue);
                }}
                aria-pressed={active}
                className={cn(
                  // Плитка группы: строгий радиус и грань. Морфинг формы при нажатии убран — от него
                  // сетка «дрожала», а состояние и так читается цветом, точкой и подписью.
                  'flex min-h-[76px] flex-col items-center justify-center gap-1 rounded-xl border p-2',
                  'transition-colors duration-150 active:scale-[0.99]',
                  active && 'ring-2 ring-primary/60',
                  off
                    ? 'border-destructive/30 bg-destructive/10'
                    : state === 'unknown'
                      ? 'border-hairline bg-card'
                      : 'border-hairline bg-surface-container-high hover:bg-surface-container-highest',
                )}
              >
                <StatusDot state={state} />
                <span
                  className={cn(
                    'font-timer text-lg font-bold leading-none tabular',
                    off ? 'text-destructive' : state === 'unknown' ? 'text-unknown' : 'text-on-surface',
                  )}
                >
                  {queue}
                </span>
                {/* Подпись состояния обязательна: цвет и точка — не единственный носитель смысла. */}
                <span className="flex items-center gap-1 text-[10px] leading-tight text-on-surface-variant">
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
      )}
    </div>
  );
};

