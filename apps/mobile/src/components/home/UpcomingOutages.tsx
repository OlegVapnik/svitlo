import { Text, View } from 'react-native';

import type { GroupOutageSummary } from '@svitlo/shared';

interface UpcomingOutagesProps {
  outages: GroupOutageSummary[];
  today: string;
  tomorrow: string;
}

/**
 * Ближайшие отключения по группам области.
 *
 * Источник — `schedules/upcoming`: это ГПВ-слоты оператора по группам, а не точечные ремонты.
 * Показываем только сегодня и завтра — дальше график оператор всё равно переписывает, а в списке
 * будущих окон легко принять устаревшее за актуальное.
 */
export function UpcomingOutages({ outages, today, tomorrow }: UpcomingOutagesProps) {
  const relevant = outages
    .filter((item) => item.date === today || item.date === tomorrow)
    .sort((a, b) => a.date.localeCompare(b.date) || a.queue.localeCompare(b.queue))
    .slice(0, 12);

  if (relevant.length === 0) {
    return (
      <View className="gap-2">
        <Text className="text-sm font-semibold text-foreground">Найближчі відключення</Text>
        <Text className="text-sm text-muted-foreground">
          На сьогодні й завтра відключень за графіком немає.
        </Text>
      </View>
    );
  }

  return (
    <View className="gap-2">
      <Text className="text-sm font-semibold text-foreground">Найближчі відключення</Text>
      {relevant.map((item) => (
        <View
          key={`${item.queue}-${item.date}`}
          className="flex-row items-center justify-between rounded-2xl border border-border bg-surface-container-low px-4 py-3"
        >
          <View className="flex-row items-center gap-2">
            <View className="min-w-12 items-center rounded-lg bg-surface-container-highest px-2 py-1">
              <Text className="text-sm font-bold text-foreground">{item.queue}</Text>
            </View>
            <Text className="text-sm text-muted-foreground">
              {item.date === today ? 'Сьогодні' : 'Завтра'}
            </Text>
          </View>
          <Text className="text-sm font-medium text-foreground">
            {item.intervals.map((interval) => `${interval.localTimeFrom}–${interval.localTimeTo}`).join(', ')}
          </Text>
        </View>
      ))}
    </View>
  );
}
