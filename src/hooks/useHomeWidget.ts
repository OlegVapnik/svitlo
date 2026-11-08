import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import type { ScheduleWindow } from '@svitlo/core/lib/scheduleWindow';
import type { ScheduleIntervalUtc } from '@svitlo/shared';

import { buildNotificationBanner } from '@/lib/notification-preview';
import { consumeWidgetAction, pushWidgetSnapshot, type WidgetSnapshotExtras } from '@/lib/widget';
import type { PowerState } from '@/theme/ThemeProvider';

interface Params {
  state: PowerState;
  summary: ScheduleWindow | null;
  intervals: ScheduleIntervalUtc[];
  date: string;
  now: Date;
  queue: string | null;
  detail: string;
  /** Дані, яких немає у плашці: назва місця, підсумки за сьогодні/завтра та список місць. */
  extras?: WidgetSnapshotExtras;
  onRefresh: () => void;
  onNextQueue: () => void;
  onCycleBookmark: () => void;
}

/**
 * Держит домашний виджет в актуальном состоянии и разбирает клики по его зонам.
 *
 * Снимок собирается тем же билдером, что плашка в шторке: виджет, уведомление и Hero-карточка
 * не могут показать разные цифры. Запись происходит при каждом изменении состояния (минутный
 * тик, новая очередь, новый график) — нативный слой сам решает, перерисовывать ли Bitmap.
 *
 * Клики: `refresh` запускает обычный sync, `next_queue` листает очереди области. Зоны виджета
 * не знают о React — они кладут действие в `SharedPreferences`, поэтому хук забирает его и при
 * монтировании (холодный старт), и при возврате приложения в foreground.
 */
export function useHomeWidget({
  state,
  summary,
  intervals,
  date,
  now,
  queue,
  detail,
  extras,
  onRefresh,
  onNextQueue,
  onCycleBookmark,
}: Params) {
  // Ключ снимка: минута + значимые поля. Ссылки на `summary`/`intervals` меняются на каждый
  // рендер экрана, и без ключа виджет перерисовывался бы на любое движение UI.
  const snapshotKey = [
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
    extras?.placeLabel ?? '',
    extras?.todayOffMinutes ?? '',
    extras?.tomorrowOffMinutes ?? '',
    extras?.places.map((place) => `${place.queue}:${place.state}:${place.timeLabel}`).join(','),
  ].join('|');

  useEffect(() => {
    const timer = setTimeout(() => {
      pushWidgetSnapshot(
        buildNotificationBanner({ state, summary, intervals, date, now, queue, detail }),
        extras,
      );
    }, 250);
    return () => clearTimeout(timer);
  }, [snapshotKey]);

  // Колбэки держим в ref: подписка на AppState не должна пересоздаваться на каждый рендер.
  const handlers = useRef({ onRefresh, onNextQueue, onCycleBookmark });
  handlers.current = { onRefresh, onNextQueue, onCycleBookmark };

  useEffect(() => {
    let active = true;

    const drain = async () => {
      if (!active) return;
      const action = await consumeWidgetAction();
      if (!active || !action) return;
      if (action === 'refresh') handlers.current.onRefresh();
      if (action === 'next_queue') handlers.current.onNextQueue();
      if (action === 'cycle_bookmark') handlers.current.onCycleBookmark();
    };

    void drain();
    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'active') void drain();
    });

    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
}
