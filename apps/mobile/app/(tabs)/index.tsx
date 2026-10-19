import { useEffect, useMemo } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import { useQueueSchedule, useUpcomingGroupOutages } from '@svitlo/core/api/queries';
import { kyivDateOffsetKey } from '@svitlo/core/lib/outage-dates';

import { HeroStatus } from '@/components/home/HeroStatus';
import { QueueGrid } from '@/components/home/QueueGrid';
import { RegionPicker } from '@/components/home/RegionPicker';
import { UpcomingOutages } from '@/components/home/UpcomingOutages';
import { useRegion } from '@/context/RegionContext';
import { useOfflineSync } from '@/hooks/useOfflineSync';
import { useRegionQueue } from '@/hooks/useRegionQueue';
import { powerStateFromSchedule, unwrapSchedule } from '@/lib/power-state';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Главная: статус по выбранной группе, выбор группы и ближайшие отключения области.
 *
 * Состояние области и группы держим в одном месте (здесь) и передаём вниз пропсами: два вызова
 * `useRegionQueue` в разных компонентах дали бы два независимых состояния выбора, и нажатие в
 * сетке не меняло бы герой-статус.
 */
export default function HomeScreen() {
  const { currentRegion, currentRegionData } = useRegion();
  const { palette, setPowerState } = useTheme();
  const { selectedQueue, selectQueue } = useRegionQueue(currentRegion, currentRegionData.queues ?? []);
  const today = useMemo(() => kyivDateOffsetKey(0), []);
  const tomorrow = useMemo(() => kyivDateOffsetKey(1), []);

  const scheduleQuery = useQueueSchedule(selectedQueue ?? undefined, today, currentRegion);
  const schedule = unwrapSchedule(scheduleQuery.data);
  const { state, summary } = powerStateFromSchedule(schedule, today);

  const upcomingQuery = useUpcomingGroupOutages(currentRegion, 2);
  const upcoming = upcomingQuery.data?.data ?? [];

  const sync = useOfflineSync();

  useEffect(() => {
    setPowerState(state);
  }, [state, setPowerState]);

  const activeQueues = useMemo(() => {
    const set = new Set<string>();
    for (const item of upcoming) {
      if (item.date === today && (item.isActiveNow || item.intervals.length > 0)) set.add(item.queue);
    }
    return set;
  }, [upcoming, today]);

  const syncLabel = (() => {
    switch (sync.state.phase) {
      case 'syncing':
        return 'Оновлення…';
      case 'offline':
        return 'Офлайн-дані';
      case 'idle':
        return 'Немає даних';
      default:
        return 'Оновлено';
    }
  })();

  return (
    <SafeAreaView className="flex-1 bg-surface-dim" edges={['top']}>
      <ScrollView contentContainerStyle={{ gap: 20, paddingHorizontal: 16, paddingBottom: 32, paddingTop: 12 }}>
        <View className="flex-row items-center justify-between">
          <RegionPicker />
          <Pressable
            onPress={sync.refresh}
            accessibilityRole="button"
            accessibilityLabel="Оновити дані"
            className="flex-row items-center gap-2 rounded-full border border-border px-3 py-2 active:opacity-70"
          >
            {sync.state.phase === 'syncing' ? (
              <ActivityIndicator size="small" color={palette.mutedForeground} />
            ) : (
              <Ionicons name="refresh" size={16} color={palette.mutedForeground} />
            )}
            <Text className="text-xs font-medium text-muted-foreground">{syncLabel}</Text>
          </Pressable>
        </View>

        <HeroStatus
          state={state}
          summary={summary}
          queue={selectedQueue}
          today={today}
          isLoading={scheduleQuery.isLoading && !schedule}
          isError={scheduleQuery.isError && !schedule}
        />

        <QueueGrid
          regionCpu={currentRegion}
          queues={currentRegionData.queues}
          selected={selectedQueue}
          active={activeQueues}
          onSelect={selectQueue}
        />

        {upcomingQuery.isLoading && upcoming.length === 0 ? (
          <ActivityIndicator color={palette.mutedForeground} />
        ) : (
          <UpcomingOutages outages={upcoming} today={today} tomorrow={tomorrow} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
