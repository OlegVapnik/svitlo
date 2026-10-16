import { useEffect, useMemo } from 'react';
import { useRegion } from './useRegion.js';
import { useRegionQueue } from './useRegionQueue.js';
import { useQueueSchedule } from '../api/queries.js';
import { kyivDateOffsetKey } from '../lib/outage-dates.js';
import { scheduleWindow } from '../lib/scheduleWindow.js';
import type { QueueScheduleData } from '@svitlo/shared';

/**
 * Состояние сети для всего интерфейса: on (світло є) / warning (скоро вимкнуть) / off / unknown.
 *
 * ЗАЧЕМ ХУК. Раньше статус знал только Hero и перекрашивал одну метку в `<meta name="theme-color">`
 * и себя самого. M3 Expressive строит на статусе всю палитру: цвет акцента, кнопок, навигации.
 * Чтобы десяток компонентов не спорил за один и тот же цвет, статус считает ОДИН хук (в AppShell),
 * а остальные читают цвет из CSS-переменных через `data-power-state` на `<html>`.
 *
 * Почему это не лишний запрос: ключи react-query совпадают с ключами Hero (область + очередь +
 * сегодняшняя дата), поэтому берётся тот же кэш — сетевого вызова хук не добавляет.
 *
 * `warning` = отключение в пределах часа: человек должен увидеть предупреждение ДО темноты
 * (тот же порог, что в HeroStatus — иначе бейдж и фон говорили бы разное).
 */
export type PowerState = 'on' | 'warning' | 'off' | 'unknown';

/** Порог «скоро вимкнуть», в минутах. Синхронизирован с HeroStatus. */
const SOON_MINUTES = 60;

export function usePowerState(): PowerState {
  const { currentRegion, currentRegionData } = useRegion();
  const { selectedQueue } = useRegionQueue(currentRegion, currentRegionData.queues ?? []);
  const today = useMemo(() => kyivDateOffsetKey(0), []);
  const { data: scheduleResponse } = useQueueSchedule(selectedQueue ?? undefined, today, currentRegion);

  // API отдаёт конверт { data: { … } }, но кэш может держать и развёрнутый график —
  // та же развязка, что в HomeHeroSection (иначе статус считался бы по undefined).
  const schedule: QueueScheduleData | undefined = Array.isArray(
    (scheduleResponse as { intervals?: unknown } | undefined)?.intervals,
  )
    ? (scheduleResponse as unknown as QueueScheduleData)
    : scheduleResponse?.data;

  const state: PowerState = useMemo(() => {
    const intervals = schedule?.intervals ?? [];
    // Пустой график — это «не знаем», а не «свет есть»: зелёный цвет при отсутствии данных
    // означал бы, что оператор подтвердил отсутствие отключений.
    if (intervals.length === 0) return 'unknown';
    const summary = scheduleWindow(intervals, today);
    if (summary.isOff) return 'off';
    if (summary.nextInMinutes != null && summary.nextInMinutes <= SOON_MINUTES) return 'warning';
    return 'on';
  }, [schedule, today]);

  useEffect(() => {
    // Атрибут на <html>: от него зависят все --md-primary в globals.css. Единственный писатель —
    // этот хук, поэтому порядок монтирования компонентов не влияет на цвет.
    document.documentElement.dataset.powerState = state;
  }, [state]);

  return state;
}
