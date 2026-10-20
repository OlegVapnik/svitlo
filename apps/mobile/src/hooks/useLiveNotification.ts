import { useEffect } from 'react';

import { minutesOfDay, minutesToHm, slotProgress, type ScheduleWindow } from '@svitlo/core/lib/scheduleWindow';
import type { ScheduleIntervalUtc } from '@svitlo/shared';

import { hideLiveNotification, showLiveNotification } from '@/lib/notifications';
import { useTheme, type PowerState } from '@/theme/ThemeProvider';

const TITLES: Record<PowerState, string> = {
  on: 'Світло є',
  warning: 'Скоро вимкнуть',
  off: 'Світла немає',
  allClear: 'Відключень немає',
  unknown: 'Немає даних',
};

interface Params {
  enabled: boolean;
  state: PowerState;
  summary: ScheduleWindow | null;
  intervals: ScheduleIntervalUtc[];
  date: string;
  now: Date;
  queue: string | null;
  detail: string;
}

/**
 * Синхронизирует постоянную плашку в шторке с текущим состоянием сети.
 *
 * Обновляем не каждую секунду: хронометр тикает силами Android, а прогресс пересчитывается
 * вместе с минутным тиком экрана. При выключенном тумблере плашка снимается.
 */
export function useLiveNotification({
  enabled,
  state,
  summary,
  intervals,
  date,
  now,
  queue,
  detail,
}: Params) {
  const { palette } = useTheme();
  const tone = palette.status[state];

  useEffect(() => {
    if (!enabled) {
      void hideLiveNotification();
      return;
    }

    const progress = intervals.length > 0 ? slotProgress(intervals, date, now) : null;
    const endsAt = state === 'off' ? summary?.offEndsAt : summary?.nextStartsAt;
    const title = queue ? `⚡ ${TITLES[state]} · черга ${queue}` : `⚡ ${TITLES[state]}`;
    const timeHint =
      state === 'off' && summary?.offEndsAt
        ? ` · до ${minutesToHm(minutesOfDay(summary.offEndsAt, date))}`
        : state === 'on' && summary?.nextStartsAt
          ? ` · вимкнуть о ${minutesToHm(minutesOfDay(summary.nextStartsAt, date))}`
          : '';

    void showLiveNotification({
      title,
      body: `${detail}${timeHint}`.trim(),
      color: tone.color,
      progress: progress?.percent ?? null,
      endsAtMs: endsAt ? Date.parse(endsAt) : null,
    });
  }, [enabled, state, summary, intervals, date, now, queue, detail, tone.color]);
}
