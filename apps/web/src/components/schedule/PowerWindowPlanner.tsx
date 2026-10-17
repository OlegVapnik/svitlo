import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BatteryCharging, Bell, BellRing, Flame, Laptop, Shirt, Sparkles, X, type LucideIcon } from 'lucide-react';
import { useQueueSchedule } from '../../api/queries.js';
import { kyivDateOffsetKey } from '../../lib/outage-dates.js';
import {
  getNotificationSupport,
  requestNotificationPermission,
  scheduleNotificationAt,
  type ScheduledReminder,
} from '../../lib/outage-notifications.js';
import { formatMinutesUk, minutesToHm } from '../../lib/scheduleWindow.js';
import { planPowerWindow, windowStartMs, type DaySchedule, type LightWindow } from '../../lib/power-windows.js';
import { toDaySchedule } from '../../lib/schedule-payload.js';
import { hapticTick } from '../../lib/haptics.js';
import { Button } from '../ui/Button.js';
import { cn } from '../../lib/cn.js';

/**
 * «Коли увімкнути прилади» — підбір вікна зі світлом під побутову задачу.
 *
 * Задача людини звучить не «покажи графік», а «коли я встигну випрати». Тому блок стоїть під
 * шкалою 24 годин і відповідає одним реченням: або «зараз і ви встигаєте», або «найкраще вікно
 * завтра 00:00–12:00». Уся арифметика — у lib/power-windows.ts (там же її тести), тут лише
 * вибір приладу, текст і нагадування.
 *
 * Нагадування ставиться на ПОЧАТОК вікна, а не за 30 хвилин до відключення: людині потрібен
 * сигнал «світло є, запускай», і він працює через той самий локальний канал сповіщень, що й
 * попередження про відключення (обмеження — поки застосунок відкритий, про це сказано в підписі).
 */
interface TaskPreset {
  minutes: number;
  icon: LucideIcon;
  labelKey: string;
}

/** Пресети побутових задач: длительность — реальная, а не «приблизительно красивая». */
const TASKS: TaskPreset[] = [
  { minutes: 120, icon: Shirt, labelKey: 'planner.taskLaundry' },
  { minutes: 180, icon: Flame, labelKey: 'planner.taskBoiler' },
  { minutes: 90, icon: BatteryCharging, labelKey: 'planner.taskStation' },
  { minutes: 240, icon: Laptop, labelKey: 'planner.taskWork' },
];

export interface PowerWindowPlannerProps {
  /** Код очереди; пусто — блок не рисуется (нечего планировать). */
  queue?: string;
  /** cpu области выбранной очереди. */
  region: string;
  /** Текущее время: от него зависит «зараз» и обрезка сегодняшнего окна. */
  now: Date;
  className?: string;
}

export const PowerWindowPlanner: React.FC<PowerWindowPlannerProps> = ({ queue, region, now, className }) => {
  const { t } = useTranslation();
  const [taskIndex, setTaskIndex] = useState(0);
  const [reminder, setReminder] = useState<{ time: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const reminderRef = useRef<ScheduledReminder | null>(null);

  const today = useMemo(() => kyivDateOffsetKey(0, now), [now]);
  const tomorrow = useMemo(() => kyivDateOffsetKey(1, now), [now]);
  const todayQuery = useQueueSchedule(queue, today, region);
  const tomorrowQuery = useQueueSchedule(queue, tomorrow, region);

  const task = TASKS[Math.min(taskIndex, TASKS.length - 1)] ?? TASKS[0];

  const days = useMemo<DaySchedule[]>(() => {
    const result: DaySchedule[] = [];
    const append = (date: string, payload: unknown) => {
      const day = toDaySchedule(date, payload);
      if (day) result.push(day);
    };
    append(today, todayQuery.data);
    append(tomorrow, tomorrowQuery.data);
    return result;
  }, [today, tomorrow, todayQuery.data, tomorrowQuery.data]);

  const suggestion = useMemo(() => planPowerWindow(days, task.minutes, now), [days, task.minutes, now]);

  // Напомнить можно только о будущем окне: «почалося щойно» уже не нагадування.
  const upcoming: LightWindow | null =
    suggestion.window && windowStartMs(suggestion.window) > now.getTime() + 5_000 ? suggestion.window : null;

  const cancelReminder = () => {
    reminderRef.current?.cancel();
    reminderRef.current = null;
    setReminder(null);
  };

  // Уход со страницы не должен оставлять таймер, который «выстрелит» неизвестно когда.
  useEffect(() => () => {
    reminderRef.current?.cancel();
    reminderRef.current = null;
  }, []);

  // Смена группы или области делает прежнее напоминание ложью: оно про окно другой очереди.
  useEffect(() => {
    reminderRef.current?.cancel();
    reminderRef.current = null;
    setReminder(null);
    setNotice(null);
  }, [queue, region]);

  const handleRemind = async () => {
    if (!upcoming) return;
    cancelReminder();
    setNotice(null);

    const support = getNotificationSupport();
    const granted = support === 'granted' ? 'granted' : await requestNotificationPermission();
    if (granted !== 'granted') {
      setNotice(t(granted === 'denied' ? 'planner.remindDenied' : 'planner.remindUnavailable'));
      return;
    }

    const handle = scheduleNotificationAt(windowStartMs(upcoming), {
      title: t('planner.notifyTitle'),
      body: t('planner.notifyBody', { task: t(task.labelKey), until: minutesToHm(upcoming.end) }),
      tag: `svitlo-window:${queue ?? ''}:${upcoming.date}:${upcoming.start}`,
    });
    if (!handle) {
      setNotice(t('planner.remindUnavailable'));
      return;
    }

    reminderRef.current = handle;
    setReminder({ time: minutesToHm(upcoming.start) });
    hapticTick('confirm');
  };

  if (!queue) return null;

  let suggestionText: string;
  if (days.length === 0 && (todayQuery.isLoading || tomorrowQuery.isLoading)) {
    suggestionText = t('planner.loading');
  } else if (days.length === 0) {
    suggestionText = t('planner.noData');
  } else if (suggestion.kind === 'now' && suggestion.window) {
    suggestionText = t('planner.nowWindow', { time: formatMinutesUk(suggestion.remaining) });
  } else if (suggestion.kind === 'best' && suggestion.window) {
    const isToday = suggestion.window.date === today;
    suggestionText = t(isToday ? 'planner.bestToday' : 'planner.bestTomorrow', {
      from: minutesToHm(suggestion.window.start),
      to: minutesToHm(suggestion.window.end),
      length: formatMinutesUk(suggestion.window.minutes),
      slack: formatMinutesUk(suggestion.slack),
    });
  } else if (suggestion.window) {
    suggestionText = t('planner.noFit', { length: formatMinutesUk(suggestion.window.minutes) });
  } else {
    suggestionText = t('planner.noData');
  }

  return (
    <section
      aria-label={t('planner.title')}
      className={cn('space-y-2.5 rounded-2xl border border-hairline bg-surface-container-high/50 p-3', className)}
    >
      <div className="space-y-0.5">
        <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-on-surface-variant">
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
          {t('planner.title')}
        </h3>
        <p className="text-[11px] leading-tight text-muted-foreground">{t('planner.subtitle')}</p>
      </div>

      <div role="group" aria-label={t('planner.title')} className="flex flex-wrap gap-1.5">
        {TASKS.map((preset, index) => {
          const Icon = preset.icon;
          const active = index === taskIndex;
          return (
            <button
              key={preset.labelKey}
              type="button"
              aria-pressed={active}
              onClick={() => {
                hapticTick('select');
                cancelReminder();
                setNotice(null);
                setTaskIndex(index);
              }}
              className={cn(
                'inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors',
                active
                  ? 'border-transparent bg-primary-container text-on-primary-container'
                  : 'border-outline-variant/70 bg-surface-container text-on-surface hover:bg-surface-container-highest',
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {t(preset.labelKey)}
            </button>
          );
        })}
      </div>

      <div role="status" className="rounded-xl border border-hairline bg-card/70 px-3 py-2">
        <p className="text-sm font-semibold text-on-surface">{suggestionText}</p>
        {upcoming && <p className="pt-0.5 text-[11px] text-muted-foreground">{t('planner.remindHint')}</p>}
      </div>

      {upcoming && (
        <div className="flex flex-wrap items-center gap-2">
          {reminder ? (
            <span className="inline-flex min-h-11 items-center gap-2 rounded-full border border-success/30 bg-success/10 px-3 text-xs font-semibold text-success">
              <BellRing className="h-3.5 w-3.5" aria-hidden />
              {t('planner.remindAt', { time: reminder.time })}
              <button
                type="button"
                onClick={() => {
                  hapticTick('tick');
                  cancelReminder();
                }}
                aria-label={t('planner.remindCancel')}
                className="inline-flex h-6 w-6 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-on-surface"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </span>
          ) : (
            <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={() => void handleRemind()}>
              <Bell className="h-3.5 w-3.5" aria-hidden />
              {t('planner.remind')}
            </Button>
          )}
        </div>
      )}

      {notice && (
        <p role="alert" className="text-[11px] leading-tight text-warning">
          {notice}
        </p>
      )}
    </section>
  );
};
