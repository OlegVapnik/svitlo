import { useEffect } from 'react';

import { slotProgress, type ScheduleWindow } from '@svitlo/core/lib/scheduleWindow';
import type { ScheduleIntervalUtc } from '@svitlo/shared';

import { notificationColor } from '@/lib/notification-banner';
import { buildNotificationBanner } from '@/lib/notification-preview';
import { hideLiveNotification, showLiveNotification } from '@/lib/notifications';
import type { PowerState } from '@/theme/ThemeProvider';

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
 *
 * Вместе с текстом уходит графическая плашка: тёмная карточка с пилюлей, крупным остатком и
 * 24-часовой шкалой. Цвет акцента берётся из `notificationColor` — тот же тон, что у главного
 * экрана, чтобы шторка и приложение не спорили о состоянии сети.
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
  // Ключ снимка: минута + значимые поля состояния. `summary` и `intervals` — новые объекты на
  // каждый рендер, поэтому без ключа снимок плашки делался бы на любое движение UI.
  const snapshotKey = [
    enabled,
    state,
    queue ?? '',
    date,
    Math.floor(now.getTime() / 60_000),
    detail,
    summary?.backInMinutes ?? '',
    summary?.nextInMinutes ?? '',
    summary?.offEndsAt ?? '',
    summary?.nextStartsAt ?? '',
    summary?.offMinutes ?? 0,
    intervals.map((item) => `${item.startsAt}-${item.endsAt}-${item.stateCode}`).join(','),
  ].join('|');

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!enabled) {
        void hideLiveNotification();
        return;
      }

      const progress = intervals.length > 0 ? slotProgress(intervals, date, now) : null;
      const endsAt = state === 'off' ? summary?.offEndsAt : summary?.nextStartsAt;
      const title = queue ? `${TITLES[state]} · черга ${queue}` : `${TITLES[state]}`;

      void showLiveNotification({
        title,
        // Точное время следующего события уже внутри `detail` («Наступне: о 08:30»), поэтому
        // второй раз в теле его не повторяем — раньше «о 08:30» шло и там, и в хвосте строки.
        body: detail,
        color: notificationColor(state),
        progress: progress?.percent ?? null,
        endsAtMs: endsAt ? Date.parse(endsAt) : null,
        banner: buildNotificationBanner({ state, summary, intervals, date, now, queue }),
      });
    }, 250);
    return () => clearTimeout(timer);
    // Ключ снимка пересобирается только при реальном изменении цифр или минуты.
  }, [snapshotKey]);
}
