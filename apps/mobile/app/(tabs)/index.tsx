import { useCallback, useEffect, useMemo } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';

import { useOutages, useQueueSchedule, useUpcomingGroupOutages } from '@svitlo/core/api/queries';
import { kyivDateOffsetKey } from '@svitlo/core/lib/outage-dates';

import { AccidentBanner } from '@/components/home/AccidentBanner';
import { HeroStatus } from '@/components/home/HeroStatus';
import { SavedPlacesCarousel } from '@/components/places/SavedPlacesCarousel';
import { Timeline24h } from '@/components/schedule/Timeline24h';
import { QueueGrid } from '@/components/home/QueueGrid';
import { UpcomingOutages } from '@/components/home/UpcomingOutages';
import { ScreenHeader } from '@/components/navigation/ScreenHeader';
import { useRegion } from '@/context/RegionContext';
import { useSettings } from '@/context/SettingsContext';
import { useEarlyPowerDetector } from '@/hooks/useEarlyPowerDetector';
import { useHomeWidget } from '@/hooks/useHomeWidget';
import { useLiveNotification } from '@/hooks/useLiveNotification';
import { useMinuteTicker } from '@/hooks/useMinuteTicker';
import { useRegionQueue } from '@/hooks/useRegionQueue';
import { useShareSchedule } from '@/components/share/useShareSchedule';
import { useSyncStatus } from '@/context/SyncContext';
import { powerStateFromSchedule, unwrapSchedule } from '@/lib/power-state';
import { useNotificationAction, type NotificationAction } from '@/lib/notification-actions';
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
  const router = useRouter();
  const { currentRegion, currentRegionData } = useRegion();
  const { palette, setPowerState } = useTheme();
  const { selectedQueue, selectQueue } = useRegionQueue(currentRegion, currentRegionData.queues ?? []);
  const { liveNotification, earlyLightDetector } = useSettings();
  const today = useMemo(() => kyivDateOffsetKey(0), []);
  const now = useMinuteTicker();
  const tomorrow = useMemo(() => kyivDateOffsetKey(1), []);

  const scheduleQuery = useQueueSchedule(selectedQueue ?? undefined, today, currentRegion);
  const schedule = unwrapSchedule(scheduleQuery.data);
  const intervals = schedule?.intervals ?? [];
  const { state, summary } = powerStateFromSchedule(schedule, today);

  const upcomingQuery = useUpcomingGroupOutages(currentRegion, 2);
  const upcoming = upcomingQuery.data?.data ?? [];

  // Аварії — окремим джерелом. `/outages` віддає і планові ГПВ-вікна (`kind: 'gpv'`), і фактичні
  // перерви (`kind: 'repair'`). На головній важить друге: план уже показано нижче, а аварія — факт,
  // який графіку не підкоряється.
  const outagesQuery = useOutages({ region: currentRegion, limit: 50 });
  const outages = outagesQuery.data?.data ?? [];

  const sync = useSyncStatus();

  useEffect(() => {
    setPowerState(state);
  }, [state, setPowerState]);

  const activeQueues = useMemo(() => {
    const set = new Set<string>();
    for (const item of upcoming) {
      // Тільки активне зараз: слоти на сьогодні є майже в кожної групи, і червона підсвітка
      // на всіх перетворювала «за графіком» на «блекаут».
      if (item.date === today && item.isActiveNow) set.add(item.queue);
    }
    return set;
  }, [upcoming, today]);

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

  useEarlyPowerDetector({
    enabled: earlyLightDetector,
    state,
    summary,
    date: today,
    intervals,
    queue: selectedQueue,
    now,
  });

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

  /**
   * Кнопки шторки работают на том же экране, что и иконки в шапке: «поділитися» отдаёт ту же
   * PNG-карточку, «оновити» запускает тот же sync. Никакого второго пути к данным.
   */
  const onNotificationAction = useCallback(
    (action: NotificationAction) => {
      if (action === 'share') void share();
      if (action === 'refresh') sync.refresh();
    },
    [share, sync],
  );
  useNotificationAction(onNotificationAction);

  /** Виджет листает очереди той же области — без отдельного состояния и второго источника правды. */
  const nextQueue = useCallback(() => {
    const queues = currentRegionData.queues ?? [];
    if (queues.length === 0) return;
    const index = selectedQueue ? queues.indexOf(selectedQueue) : -1;
    selectQueue(queues[(index + 1) % queues.length]);
  }, [currentRegionData.queues, selectedQueue, selectQueue]);

  useHomeWidget({
    state,
    summary,
    intervals,
    date: today,
    now,
    queue: selectedQueue,
    detail: liveDetail,
    onRefresh: sync.refresh,
    onNextQueue: nextQueue,
  });

  return (
    <SwipeableScreen>
      {hiddenCard}
      <SafeAreaView className="flex-1 bg-surface-dim" edges={['top']}>
      <ScrollView contentContainerStyle={{ gap: 20, paddingHorizontal: 16, paddingBottom: 32, paddingTop: 12 }}>
        <ScreenHeader
          title="Головна"
          subtitle={selectedQueue ? `Обрана черга ${selectedQueue}` : 'Черга ще не вибрана'}
          actions={
            <>
              <Pressable
                onPress={() => router.navigate('/search')}
                accessibilityRole="button"
                accessibilityLabel="Зберегти місце"
                className="h-9 w-9 items-center justify-center rounded-full border border-border active:opacity-70"
              >
                <Ionicons name="star-outline" size={16} color={palette.mutedForeground} />
              </Pressable>
              <Pressable
                onPress={() => void share()}
                disabled={sharing}
                accessibilityRole="button"
                accessibilityLabel="Поділитися графіком"
                className={`h-9 w-9 items-center justify-center rounded-full border border-border active:opacity-70 ${sharing ? 'opacity-50' : ''}`}
              >
                <Ionicons name="share-social-outline" size={16} color={palette.mutedForeground} />
              </Pressable>
              <Pressable
                onPress={sync.refresh}
                accessibilityRole="button"
                accessibilityLabel="Оновити дані"
                className="h-9 w-9 items-center justify-center rounded-full border border-border active:opacity-70"
              >
                {sync.state.phase === 'syncing' ? (
                  <ActivityIndicator size="small" color={palette.mutedForeground} />
                ) : (
                  <Ionicons name="refresh" size={16} color={palette.mutedForeground} />
                )}
              </Pressable>
            </>
          }
        />

        <AccidentBanner outages={outages} loading={outagesQuery.isLoading} />

        <SavedPlacesCarousel selectedQueue={selectedQueue} />

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
          covered={currentRegionData.covered}
          onSelect={selectQueue}
        />

        {upcomingQuery.isLoading && upcoming.length === 0 ? (
          <ActivityIndicator color={palette.mutedForeground} />
        ) : (
          <UpcomingOutages outages={upcoming} today={today} tomorrow={tomorrow} now={now.getTime()} />
        )}
      </ScrollView>
    </SafeAreaView>
    </SwipeableScreen>
  );
}
