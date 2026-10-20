import { useEffect, useMemo } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import { useQueueSchedule, useUpcomingGroupOutages } from '@svitlo/core/api/queries';
import { kyivDateOffsetKey } from '@svitlo/core/lib/outage-dates';

import { HeroStatus } from '@/components/home/HeroStatus';
import { Timeline24h } from '@/components/schedule/Timeline24h';
import { QueueGrid } from '@/components/home/QueueGrid';
import { RegionPicker } from '@/components/home/RegionPicker';
import { UpcomingOutages } from '@/components/home/UpcomingOutages';
import { useOta } from '@/context/OtaContext';
import { useRegion } from '@/context/RegionContext';
import { useSettings } from '@/context/SettingsContext';
import { useOfflineSync } from '@/hooks/useOfflineSync';
import { useEarlyPowerDetector } from '@/hooks/useEarlyPowerDetector';
import { useLiveNotification } from '@/hooks/useLiveNotification';
import { useMinuteTicker } from '@/hooks/useMinuteTicker';
import { useRegionQueue } from '@/hooks/useRegionQueue';
import { useShareSchedule } from '@/components/share/useShareSchedule';
import { powerStateFromSchedule, unwrapSchedule } from '@/lib/power-state';
import { useTheme } from '@/theme/ThemeProvider';
import { SwipeableScreen } from '@/components/navigation/SwipeableScreen';

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
  const { liveNotification, earlyLightDetector } = useSettings();
  const ota = useOta();
  const today = useMemo(() => kyivDateOffsetKey(0), []);
  const now = useMinuteTicker();
  const tomorrow = useMemo(() => kyivDateOffsetKey(1), []);

  const scheduleQuery = useQueueSchedule(selectedQueue ?? undefined, today, currentRegion);
  const schedule = unwrapSchedule(scheduleQuery.data);
  const intervals = schedule?.intervals ?? [];
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

  const liveDetail = (() => {
    if (state === 'off' && summary?.backInMinutes != null) {
      return `Світло через ${Math.max(1, summary.backInMinutes)} хв`;
    }
    if (state === 'warning' && summary?.nextInMinutes != null) {
      return `Вимкнуть через ${Math.max(1, summary.nextInMinutes)} хв`;
    }
    if (state === 'on' && summary?.nextInMinutes != null) {
      return `Відключення через ${Math.max(1, summary.nextInMinutes)} хв`;
    }
    return state === 'allClear' ? 'Відключень за графіком немає' : 'За графіком на сьогодні';
  })();

  useLiveNotification({
    enabled: liveNotification,
    state,
    summary,
    intervals,
    date: today,
    now,
    queue: selectedQueue,
    detail: liveDetail,
  });

  useEarlyPowerDetector({ enabled: earlyLightDetector, state, summary, date: today });

  const { share, sharing, hiddenCard } = useShareSchedule({
    state,
    queue: selectedQueue,
    regionName: currentRegionData.nameUa,
    date: today,
    intervals,
    offMinutes: summary?.offMinutes ?? 0,
    backInMinutes: summary?.backInMinutes ?? null,
    nextInMinutes: summary?.nextInMinutes ?? null,
    offEndsAt: summary?.offEndsAt ?? null,
  });

  return (
    <SwipeableScreen>
      {hiddenCard}
      <SafeAreaView className="flex-1 bg-surface-dim" edges={['top']}>
      <ScrollView contentContainerStyle={{ gap: 20, paddingHorizontal: 16, paddingBottom: 32, paddingTop: 12 }}>
        <View className="flex-row items-center justify-between">
          <RegionPicker />
          <View className="flex-row items-center gap-2">
          <Pressable
            onPress={() => void share()}
            disabled={sharing}
            accessibilityRole="button"
            accessibilityLabel="Поділитися графіком"
            className={`flex-row items-center gap-2 rounded-full border border-border px-3 py-2 active:opacity-70 ${sharing ? 'opacity-50' : ''}`}
          >
            <Ionicons name="share-social-outline" size={16} color={palette.mutedForeground} />
          </Pressable>
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
        </View>

        {ota.readyVersion ? (
          <Pressable
            onPress={ota.dismiss}
            accessibilityRole="button"
            accessibilityLabel="Закрити повідомлення про оновлення"
            className="flex-row items-center gap-2 rounded-2xl border border-primary/30 bg-primary-container px-4 py-3 active:opacity-80"
          >
            <Ionicons name="cloud-download-outline" size={18} color={palette.primary} />
            <Text className="flex-1 text-xs font-medium text-foreground">
              JS-оновлення {ota.readyVersion} завантажено. Застосується після наступного запуску.
            </Text>
            <Ionicons name="close" size={16} color={palette.mutedForeground} />
          </Pressable>
        ) : null}

        <HeroStatus
          state={state}
          summary={summary}
          intervals={intervals}
          date={today}
          now={now}
          queue={selectedQueue}
          isLoading={scheduleQuery.isLoading && !schedule}
          isError={scheduleQuery.isError && !schedule}
        />

        <View
          className="gap-3 rounded-3xl border border-hairline bg-card p-4"
        >
          <View className="flex-row items-center justify-between">
            <Text className="text-sm font-semibold text-foreground">Графік на сьогодні</Text>
            {selectedQueue ? (
              <Text className="text-xs font-medium text-muted-foreground">Черга {selectedQueue}</Text>
            ) : null}
          </View>
          {intervals.length > 0 ? (
            <Timeline24h intervals={intervals} date={today} now={now} />
          ) : (
            <Text className="text-sm text-muted-foreground">
              {state === 'allClear'
                ? 'Оператор підтвердив добу без відключень.'
                : 'Графік на сьогодні ще не опубліковано.'}
            </Text>
          )}
        </View>

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
    </SwipeableScreen>
  );
}
