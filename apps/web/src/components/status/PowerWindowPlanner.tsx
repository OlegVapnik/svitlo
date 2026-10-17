import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BatteryCharging,
  Bell,
  BellRing,
  Check,
  Clock3,
  Flame,
  Laptop,
  Shirt,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import type { DaySchedule } from '../../lib/day-schedule.js';
import {
  POWER_TASKS,
  formatKyivHm,
  formatWindowRange,
  planPowerTasks,
  taskDurationLabel,
  type PowerTaskId,
  type PowerTaskPlan,
} from '../../lib/power-window-planner.js';
import { formatMinutesUk } from '../../lib/scheduleWindow.js';
import {
  getNotificationSupport,
  requestNotificationPermission,
  showLocalNotification,
} from '../../lib/outage-notifications.js';
import { hapticTick } from '../../lib/haptics.js';
import { cn } from '../../lib/cn.js';

/**
 * «Коли увімкнути прилади» — компактний планувальник побутових справ за вікнами зі світлом.
 *
 * Чому не просто «порада на весь екран»: графік оператора орієнтовний і може змінитися. Тому
 * картка показує конкретне вікно з таймлайна, а не обіцяє «встигнете» без меж. Нагадування
 * створюється лише за явним натисканням і живе в localStorage; без дозволу на сповіщення воно
 * не вдає, що спрацює у фоні.
 */
const REMINDERS_KEY = 'svitlo_power_reminders';

interface StoredReminder {
  taskId: PowerTaskId;
  startEpochMs: number;
  endEpochMs: number;
}

function loadReminders(): StoredReminder[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(REMINDERS_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is StoredReminder => {
      if (!item || typeof item !== 'object') return false;
      const record = item as Record<string, unknown>;
      return (
        typeof record['taskId'] === 'string' &&
        typeof record['startEpochMs'] === 'number' &&
        typeof record['endEpochMs'] === 'number'
      );
    });
  } catch {
    return [];
  }
}

function saveReminders(reminders: StoredReminder[]): void {
  try {
    localStorage.setItem(REMINDERS_KEY, JSON.stringify(reminders));
  } catch {
    // Приватний режим або переповнене сховище — нагадування просто не збережеться.
  }
}

const TASK_ICONS: Record<PowerTaskId, LucideIcon> = {
  laundry: Shirt,
  boiler: Flame,
  battery: BatteryCharging,
  work: Laptop,
};

export interface PowerWindowPlannerProps {
  /** Сьогодні й завтра — саме ті доби, за якими будується вікно. */
  days: readonly DaySchedule[];
  /** Поточний момент; батько оновлює його раз на хвилину. */
  now: Date;
  className?: string;
}

export const PowerWindowPlanner: React.FC<PowerWindowPlannerProps> = ({ days, now, className }) => {
  const { t } = useTranslation();
  const [selectedTask, setSelectedTask] = useState<PowerTaskId>('laundry');
  const [reminders, setReminders] = useState<StoredReminder[]>(loadReminders);
  const [permission, setPermission] = useState(getNotificationSupport);
  const firedRef = useRef<Set<string>>(new Set());

  const plans = useMemo(() => planPowerTasks(days, now), [days, now]);
  const plan = plans.find((item) => item.task.id === selectedTask) ?? plans[0]!;
  const activeReminder =
    plan.kind === 'later'
      ? reminders.find(
          (item) => item.taskId === plan.task.id && item.startEpochMs === plan.best.startMs,
        )
      : undefined;

  useEffect(() => {
    setPermission(getNotificationSupport());
  }, []);

  // Поки застосунок відкритий, нагадування спрацьовує в першу хвилину вікна. Це не фоновий
  // будильник: без push-сервера обіцяти роботу в закритому застосунку не можна.
  useEffect(() => {
    const check = () => {
      const currentMs = Date.now();
      let changed = false;
      const next = reminders.filter((reminder) => {
        if (currentMs < reminder.startEpochMs || currentMs >= reminder.endEpochMs) return true;
        const key = `${reminder.taskId}:${reminder.startEpochMs}`;
        if (firedRef.current.has(key)) return true;
        firedRef.current.add(key);
        changed = true;
        const taskLabel = t(`powerPlanner.tasks.${reminder.taskId}`);
        void showLocalNotification({
          title: t('powerPlanner.notificationTitle'),
          body: t('powerPlanner.notificationBody', {
            task: taskLabel,
            start: formatKyivHm(reminder.startEpochMs),
            end: formatKyivHm(reminder.endEpochMs),
          }),
          tag: `svitlo-power-${reminder.taskId}`,
        });
        return false;
      });
      if (changed) {
        setReminders(next);
        saveReminders(next);
      }
    };
    check();
    const timer = window.setInterval(check, 30_000);
    return () => window.clearInterval(timer);
  }, [reminders, t]);

  const toggleReminder = async (target: PowerTaskPlan) => {
    if (target.kind !== 'later') return;
    hapticTick('select');
    if (activeReminder) {
      const next = reminders.filter(
        (item) => !(item.taskId === target.task.id && item.startEpochMs === target.best.startMs),
      );
      setReminders(next);
      saveReminders(next);
      return;
    }

    if (getNotificationSupport() === 'default') {
      const result = await requestNotificationPermission();
      setPermission(result);
    }
    const next: StoredReminder[] = [
      ...reminders.filter((item) => item.taskId !== target.task.id),
      {
        taskId: target.task.id,
        startEpochMs: target.best.startMs,
        endEpochMs: target.best.endMs,
      },
    ];
    setReminders(next);
    saveReminders(next);
  };

  return (
    <section
      className={cn(
        'rounded-2xl border border-hairline bg-surface-container-high/45 p-3.5',
        className,
      )}
      aria-labelledby="power-planner-title"
    >
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Clock3 className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <h3 id="power-planner-title" className="text-sm font-semibold text-on-surface">
            {t('powerPlanner.title')}
          </h3>
          <p className="text-xs text-muted-foreground">{t('powerPlanner.subtitle')}</p>
        </div>
      </div>

      <div
        role="group"
        aria-label={t('powerPlanner.tasksLabel')}
        className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-4"
      >
        {POWER_TASKS.map((task) => {
          const Icon = TASK_ICONS[task.id];
          const isActive = task.id === selectedTask;
          return (
            <button
              key={task.id}
              type="button"
              onClick={() => {
                hapticTick('tick');
                setSelectedTask(task.id);
              }}
              aria-pressed={isActive}
              className={cn(
                'flex min-h-11 items-center gap-1.5 rounded-xl border px-2.5 text-left transition-colors',
                isActive
                  ? 'border-primary/50 bg-primary/10 text-on-surface'
                  : 'border-hairline bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest',
              )}
            >
              <Icon className={cn('h-4 w-4 shrink-0', isActive && 'text-primary')} aria-hidden />
              <span className="min-w-0">
                <span className="block truncate text-xs font-semibold">
                  {t(`powerPlanner.tasks.${task.id}`)}
                </span>
                <span className="block text-xs text-muted-foreground">{taskDurationLabel(task)}</span>
              </span>
            </button>
          );
        })}
      </div>


      <div className="mt-2.5 rounded-xl border border-hairline bg-surface-container-low px-3 py-2.5">
        {plan.kind === 'now' ? (
          <div className="flex items-start gap-2">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
            <p className="text-xs leading-relaxed text-on-surface">
              {t('powerPlanner.fitsNow', {
                time: formatMinutesUk(plan.remainingMinutes),
                end: formatKyivHm(plan.window.endMs),
              })}
            </p>
          </div>
        ) : plan.kind === 'later' ? (
          <div className="space-y-2">
            <div className="flex items-start gap-2">
              <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
              <div className="min-w-0">
                <p className="text-xs font-semibold leading-relaxed text-on-surface">
                  {t('powerPlanner.bestWindow', {
                    range: formatWindowRange(plan.best),
                    duration: formatMinutesUk(plan.best.endMs - plan.best.startMs),
                  })}
                </p>
                {plan.next && (
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    {t('powerPlanner.nextWindow', { range: formatWindowRange(plan.next) })}
                  </p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void toggleReminder(plan)}
              className={cn(
                'inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors',
                activeReminder
                  ? 'border-primary/50 bg-primary/10 text-primary'
                  : 'border-border bg-card text-foreground hover:bg-muted',
              )}
            >
              {activeReminder ? (
                <BellRing className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <Bell className="h-3.5 w-3.5" aria-hidden />
              )}
              {activeReminder
                ? t('powerPlanner.reminderSet', { time: formatKyivHm(activeReminder.startEpochMs) })
                : t('powerPlanner.remind')}
            </button>
            {permission === 'denied' && !activeReminder && (
              <p className="flex items-center gap-1 text-xs text-warning">
                <TriangleAlert className="h-3.5 w-3.5" aria-hidden />
                {t('powerPlanner.notificationDenied')}
              </p>
            )}
            {permission === 'unsupported' && !activeReminder && (
              <p className="text-xs text-muted-foreground">
                {t('powerPlanner.notificationUnsupported')}
              </p>
            )}
          </div>
        ) : (
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t('powerPlanner.noWindow')}
          </p>
        )}
      </div>

      <p className="mt-2 text-xs leading-relaxed text-muted-foreground/80">
        {t('powerPlanner.disclaimer')}
      </p>
    </section>
  );
};

