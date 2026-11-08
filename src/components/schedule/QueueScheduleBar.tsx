import { View } from 'react-native';
import { Text } from '@/components/ui/AppText';

import { formatMinutesUk, minutesOfDay, minutesToHm, scheduleWindow } from '@svitlo/core/lib/scheduleWindow';
import type { ScheduleIntervalUtc } from '@svitlo/shared';

import { Timeline24h } from './Timeline24h';

interface QueueScheduleBarProps {
  intervals: ScheduleIntervalUtc[];
  date: string;
  now?: Date;
  /** Показывать строку-итог под шкалой. */
  showSummary?: boolean;
}

/**
 * Полоса суток очереди: та же 48-сегментная шкала, что и Timeline24h, плюс текстовый итог
 * «зараз / наступне / скільки без світла». Расчёт берётся из ядра, чтобы цифры в герое и
 * на экране группы не разъезжались.
 */
export function QueueScheduleBar({ intervals, date, now = new Date(), showSummary = true }: QueueScheduleBarProps) {
  const summary = scheduleWindow(intervals, date, now);

  return (
    <View className="gap-2.5">
      <Timeline24h intervals={intervals} date={date} now={now} />

      {showSummary ? (
        <View className="flex-row flex-wrap gap-3">
          {summary.isOff && summary.offEndsAt ? (
            <Text className="text-xs font-medium text-destructive">
              Зараз без світла · до{' '}
              {minutesToHm(minutesOfDay(summary.offEndsAt, date))}
            </Text>
          ) : null}
          {summary.nextInMinutes != null && !summary.isOff ? (
            <Text className="text-xs font-semibold text-foreground">
              Вимкнуть через {formatMinutesUk(summary.nextInMinutes)}
            </Text>
          ) : null}
          <Text className="text-xs text-muted-foreground">
            Без світла за добу: {formatMinutesUk(summary.offMinutes)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
