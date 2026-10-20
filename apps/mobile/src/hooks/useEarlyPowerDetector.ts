import { useEffect, useRef } from 'react';
import * as Battery from 'expo-battery';

import { storage } from '@svitlo/core';
import { minutesOfDay, minutesToHm, type ScheduleWindow } from '@svitlo/core/lib/scheduleWindow';

import { notifyEarlyPower } from '@/lib/notifications';
import type { PowerState } from '@/theme/ThemeProvider';

const NOTIFIED_KEY = 'mobile.earlyPowerNotified';

function isPowered(state: Battery.BatteryState): boolean {
  return state === Battery.BatteryState.CHARGING || state === Battery.BatteryState.FULL;
}

interface Params {
  enabled: boolean;
  state: PowerState;
  summary: ScheduleWindow | null;
  date: string;
}

/**
 * Детектор «дали світло раніше графіка».
 *
 * Тригер — переход телефона с батареи на зарядку в момент, когда по графику идёт отключение.
 * Дома это почти всегда означает, что питание вернулось. Ограничение: power bank и зарядка
 * в машине тоже дают ложный сигнал — поэтому это подсказка, а не факт, и её можно выключить.
 *
 * Повторно за одно и то же отключение не уведомляем: ключ — конец текущего off-слота.
 */
export function useEarlyPowerDetector({ enabled, state, summary, date }: Params) {
  const powered = useRef<boolean | null>(null);
  const stateRef = useRef(state);
  const summaryRef = useRef(summary);
  const dateRef = useRef(date);

  stateRef.current = state;
  summaryRef.current = summary;
  dateRef.current = date;

  useEffect(() => {
    if (!enabled) return;

    let active = true;

    const maybeNotify = () => {
      if (!active) return;
      if (stateRef.current !== 'off') return;
      const current = summaryRef.current;
      const key = current?.offEndsAt ?? `off:${dateRef.current}`;
      try {
        if (storage.getItem(NOTIFIED_KEY) === key) return;
        storage.setItem(NOTIFIED_KEY, key);
      } catch {
        /* без хранилища всё равно уведомим один раз за сессию */
      }
      const until = current?.offEndsAt
        ? minutesToHm(minutesOfDay(current.offEndsAt, dateRef.current))
        : null;
      void notifyEarlyPower(until);
    };

    void Battery.getPowerStateAsync().then((power) => {
      if (active) powered.current = isPowered(power.batteryState);
    });

    const subscription = Battery.addBatteryStateListener(({ batteryState }) => {
      const nowPowered = isPowered(batteryState);
      // Уведомляем только на фронте «было без питания → подключили», чтобы не спамить
      // каждым событием статуса, пока телефон уже стоит на зарядке.
      if (nowPowered && powered.current === false) maybeNotify();
      powered.current = nowPowered;
    });

    return () => {
      active = false;
      subscription.remove();
    };
  }, [enabled]);
}
