import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';

import { useOutages, useQueueSchedule, useUpcomingGroupOutages } from '@svitlo/core/api/queries';
import { kyivDateOffsetKey } from '@svitlo/core/lib/outage-dates';
import { queueCodeMatches } from '@svitlo/core/lib/queue';
import { formatMinutesUk, minutesOfDay, minutesToHm } from '@svitlo/core/lib/scheduleWindow';

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
  const [selectedDay, setSelectedDay] = useState<'today' | 'tomorrow'>('today');
  const activeDate = selectedDay === 'today' ? today : tomorrow;

  const upcomingQuery = useUpcomingGroupOutages(currentRegion, 2);
  const upcoming = upcomingQuery.data?.data ?? [];

  const scheduleQuery = useQueueSchedule(selectedQueue ?? undefined, activeDate, currentRegion);
  const directSchedule = unwrapSchedule(scheduleQuery.data);

  // Синтезируем расписание из upcoming, если /schedules ещё не ответил или вернул пусто
  const schedule = useMemo(() => {
    if (directSchedule && directSchedule.intervals && directSchedule.intervals.length > 0) {
      return directSchedule;
    }
    if (!selectedQueue) return directSchedule;

    const matched = upcoming.find(
      (item) => item.date === activeDate && queueCodeMatches(currentRegion, item.queue, selectedQueue)
    );
    if (matched && matched.intervals && matched.intervals.length > 0) {
      return {
        region: currentRegion,
        queue: selectedQueue,
        date: activeDate,
        intervals: matched.intervals,
        allClear: false,
        source: matched.source ?? 'mirror',
        lastImportedAt: new Date().toISOString(),
      };
    }
    return directSchedule;
  }, [directSchedule, selectedQueue, upcoming, activeDate, currentRegion]);

  const intervals = schedule?.intervals ?? [];
  const { state, summary } = powerStateFromSchedule(schedule, activeDate);

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
      if (item.date === today && item.isActiveNow) set.add(item.queue);
    }
    return set;
  }, [upcoming, today]);



  const liveDetail = (() => {
    if (state === 'off') {
      if (summary?.offEndsAt) {
        return `Буде о ${minutesToHm(minutesOfDay(summary.offEndsAt, activeDate))}`;
      }
      if (summary?.backInMinutes != null) {
        return `Буде через ${formatMinutesUk(summary.backInMinutes)}`;
      }
    }
    if (state === 'warning') {
      if (summary?.nextStartsAt) {
        return `Вимкнуть о ${minutesToHm(minutesOfDay(summary.nextStartsAt, activeDate))}`;
      }
      if (summary?.nextInMinutes != null) {
        return `Вимкнуть через ${formatMinutesUk(summary.nextInMinutes)}`;
      }
    }
    if (state === 'on') {
      if (summary?.nextStartsAt) {
        return `Відключення о ${minutesToHm(minutesOfDay(summary.nextStartsAt, activeDate))}`;
      }
      if (summary?.nextInMinutes != null) {
        return `Відключення через ${formatMinutesUk(summary.nextInMinutes)}`;
      }
    }
    if (state === 'allClear') {
      return selectedDay === 'today' ? 'Відключень за графіком немає' : 'На завтра відключень немає';
    }
    if (!summary && intervals.length === 0) {
      return selectedDay === 'today' ? 'Світло є (графік очікується)' : 'Графік на завтра очікується';
    }
    return selectedDay === 'today' ? 'За графіком на сьогодні' : 'За графіком на завтра';
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
            <Text className="text-sm font-semibold text-foreground">
              {selectedDay === 'today' ? 'Графік на сьогодні' : 'Графік на завтра'}
            </Text>
            {selectedQueue ? (
              <Text className="text-xs font-medium text-muted-foreground">Черга {selectedQueue}</Text>
            ) : null}
          </View>

          {/* Переключатель Сьогодні / Завтра */}
          <View
            style={{ backgroundColor: palette.surfaceContainerHigh }}
            className="flex-row rounded-xl p-1"
          >
            <Pressable
              onPress={() => setSelectedDay('today')}
              style={{
                backgroundColor: selectedDay === 'today' ? palette.card : 'transparent',
              }}
              className="flex-1 items-center rounded-lg py-1.5 active:opacity-70"
            >
              <Text
                style={{
                  color: selectedDay === 'today' ? palette.foreground : palette.mutedForeground,
                  fontWeight: selectedDay === 'today' ? '600' : '500',
                }}
                className="text-xs"
              >
                Сьогодні
              </Text>
            </Pressable>

            <Pressable
              onPress={() => setSelectedDay('tomorrow')}
              style={{
                backgroundColor: selectedDay === 'tomorrow' ? palette.card : 'transparent',
              }}
              className="flex-1 items-center rounded-lg py-1.5 active:opacity-70"
            >
              <Text
                style={{
                  color: selectedDay === 'tomorrow' ? palette.foreground : palette.mutedForeground,
                  fontWeight: selectedDay === 'tomorrow' ? '600' : '500',
                }}
                className="text-xs"
              >
                Завтра
              </Text>
            </Pressable>
          </View>

          {intervals.length > 0 ? (
            <Timeline24h intervals={intervals} date={activeDate} now={now} />
          ) : (
            <Text className="text-sm text-muted-foreground">
              {state === 'allClear'
                ? 'Оператор підтвердив добу без відключень.'
                : selectedDay === 'today'
                ? 'Графік на сьогодні ще не опубліковано.'
                : 'Графік на завтра ще не опубліковано.'}
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

        <UpcomingOutages
          regionCpu={currentRegion}
          selectedQueue={selectedQueue}
        />
      </ScrollView>
    </SafeAreaView>
    </SwipeableScreen>
  );
}
