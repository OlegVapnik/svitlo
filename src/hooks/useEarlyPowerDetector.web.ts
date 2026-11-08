/**
 * Web-заглушка детектора «світло дали раніше графіка».
 *
 * Тригер — перехід телефона з батареї на зарядку (`expo-battery`), а в браузері такого
 * сигналу немає: `navigator.getBattery()` не працює у WebView Telegram і не означає
 * відновлення живлення. Тому хук просто нічого не робить і не реєструє підписок.
 */
import type { ScheduleWindow } from '@svitlo/core/lib/scheduleWindow';
import type { ScheduleIntervalUtc } from '@svitlo/shared';

import type { PowerState } from '@/theme/ThemeProvider';

interface Params {
  enabled: boolean;
  state: PowerState;
  summary: ScheduleWindow | null;
  date: string;
  intervals: ScheduleIntervalUtc[];
  queue: string | null;
  now: Date;
}

export function useEarlyPowerDetector(_params: Params): void {
  /* у браузері заряду батареї не читаємо — детектор вимкнено */
}
