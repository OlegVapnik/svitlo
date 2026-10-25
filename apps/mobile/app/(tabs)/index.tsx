import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';

import { api } from '@svitlo/core/api/client';
import { useOutages, useQueueSchedule, useUpcomingGroupOutages } from '@svitlo/core/api/queries';
import { kyivDateOffsetKey } from '@svitlo/core/lib/outage-dates';
import { canonicalQueueCode, queueCodeMatches } from '@svitlo/core/lib/queue';
import { formatMinutesUk, minutesOfDay, minutesToHm, slotProgress } from '@svitlo/core/lib/scheduleWindow';

import { AccidentBanner } from '@/components/home/AccidentBanner';
import { HeroStatus } from '@/components/home/HeroStatus';
import { Mascot } from '@/components/mascot/Mascot';
import { placeIconEmoji } from '@/components/places/PlaceIcon';
import { SavedPlacesCarousel } from '@/components/places/SavedPlacesCarousel';
import { Timeline24h } from '@/components/schedule/Timeline24h';
import { QueueGrid } from '@/components/home/QueueGrid';
import { ScreenHeader } from '@/components/navigation/ScreenHeader';
import { useRegion } from '@/context/RegionContext';
import { useSettings } from '@/context/SettingsContext';
import { useApplySavedPlace } from '@/hooks/useApplySavedPlace';
import { useEarlyPowerDetector } from '@/hooks/useEarlyPowerDetector';
import { useHomeWidget } from '@/hooks/useHomeWidget';
import { useLiveNotification } from '@/hooks/useLiveNotification';
import { useMinuteTicker } from '@/hooks/useMinuteTicker';
import { useRegionQueue } from '@/hooks/useRegionQueue';
import { useSavedPlaces } from '@/hooks/useSavedPlaces';
import { useSavedPlacesStatus } from '@/hooks/useSavedPlacesStatus';
import { useShareSchedule } from '@/components/share/useShareSchedule';
import { useSyncStatus } from '@/context/SyncContext';
import { triggerSoftHaptic } from '@/lib/haptics';
import { powerStateFromSchedule, unwrapSchedule } from '@/lib/power-state';
import { useNotificationAction, type NotificationAction } from '@/lib/notification-actions';
import type { WidgetSnapshotExtras } from '@/lib/widget';
import { useTheme } from '@/theme/ThemeProvider';
import { SwipeableScreen } from '@/components/navigation/SwipeableScreen';

export default function HomeScreen() {
  const router = useRouter();
  const { currentRegion, currentRegionData } = useRegion();
  const { palette } = useTheme();
  const { selectedQueue, selectQueue } = useRegionQueue(currentRegion, currentRegionData.queues ?? []);
  const { liveNotification, earlyLightDetector, mascotEnabled } = useSettings();
  const today = useMemo(() => kyivDateOffsetKey(0), []);
  const now = useMinuteTicker();
  const tomorrow = useMemo(() => kyivDateOffsetKey(1), []);
  const { places } = useSavedPlaces();
  const placesStatusMap = useSavedPlacesStatus(places, today, now);
  const applyPlace = useApplySavedPlace();
  const activePlace = useMemo(
    () =>
      places.find(
        (place) =>
          place.regionCpu === currentRegion &&
          selectedQueue != null &&
          queueCodeMatches(place.regionCpu, place.queue, selectedQueue),
      ) ?? null,
    [places, currentRegion, selectedQueue],
  );
  const queryClient = useQueryClient();

  useEffect(() => {
    if (places.length === 0) return;
    const timer = setTimeout(() => {
      for (const place of places) {
        const queue = canonicalQueueCode(place.regionCpu, place.queue);
        void queryClient.prefetchQuery({
          queryKey: ['queueSchedule', queue, today, place.regionCpu],
          queryFn: () => api.fetchQueueSchedule(queue, today, place.regionCpu),
          staleTime: 60_000,
          retry: 0,
        });
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [places, today, queryClient]);
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

  // Расписание на сегодня (для расчета статистики и состояния виджетов)
  const todayScheduleQuery = useQueueSchedule(selectedQueue ?? undefined, today, currentRegion);
  const todayDirectSchedule = unwrapSchedule(todayScheduleQuery.data);
  const todaySchedule = useMemo(() => {
    if (todayDirectSchedule && todayDirectSchedule.intervals && todayDirectSchedule.intervals.length > 0) {
      return todayDirectSchedule;
    }
    if (!selectedQueue) return todayDirectSchedule;
    const matched = upcoming.find(
      (item) => item.date === today && queueCodeMatches(currentRegion, item.queue, selectedQueue)
    );
    if (matched && matched.intervals && matched.intervals.length > 0) {
      return {
        region: currentRegion,
        queue: selectedQueue,
        date: today,
        intervals: matched.intervals,
        allClear: false,
        source: matched.source ?? 'mirror',
        lastImportedAt: new Date().toISOString(),
      };
    }
    return todayDirectSchedule;
  }, [todayDirectSchedule, selectedQueue, upcoming, today, currentRegion]);

  // Расписание на завтра (для сводной плитки)
  const tomorrowScheduleQuery = useQueueSchedule(selectedQueue ?? undefined, tomorrow, currentRegion);
  const tomorrowDirectSchedule = unwrapSchedule(tomorrowScheduleQuery.data);
  const tomorrowSchedule = useMemo(() => {
    if (tomorrowDirectSchedule && tomorrowDirectSchedule.intervals && tomorrowDirectSchedule.intervals.length > 0) {
      return tomorrowDirectSchedule;
    }
    if (!selectedQueue) return tomorrowDirectSchedule;
    const matched = upcoming.find(
      (item) => item.date === tomorrow && queueCodeMatches(currentRegion, item.queue, selectedQueue)
    );
    if (matched && matched.intervals && matched.intervals.length > 0) {
      return {
        region: currentRegion,
        queue: selectedQueue,
        date: tomorrow,
        intervals: matched.intervals,
        allClear: false,
        source: matched.source ?? 'mirror',
        lastImportedAt: new Date().toISOString(),
      };
    }
    return tomorrowDirectSchedule;
  }, [tomorrowDirectSchedule, selectedQueue, upcoming, tomorrow, currentRegion]);

  const intervals = schedule?.intervals ?? [];
  const { state, summary } = powerStateFromSchedule(schedule, activeDate);
  const { summary: todaySummary } = powerStateFromSchedule(todaySchedule, today);
  const { summary: tomorrowSummary } = powerStateFromSchedule(tomorrowSchedule, tomorrow);

  const outagesQuery = useOutages({ region: currentRegion, limit: 20 });
  const outages = outagesQuery.data?.data ?? [];

  const activeQueues = useMemo(() => {
    const set = new Set<string>();
    for (const item of upcoming) {
      if (item.date === today && item.isActiveNow) {
        set.add(item.queue);
      }
    }
    return set;
  }, [upcoming, today]);

  // Очереди, у которых отключение скоро (<= 30 мин)
  const soonQueues = useMemo(() => {
    const set = new Set<string>();
    const nowMs = now.getTime();
    for (const item of upcoming) {
      if (item.date !== today || item.isActiveNow) continue;
      for (const interval of item.intervals) {
        if (interval.stateCode === 3) {
          const startMs = Date.parse(interval.startsAt);
          const diffMinutes = (startMs - nowMs) / 60000;
          if (diffMinutes > 0 && diffMinutes <= 30) {
            set.add(item.queue);
            break;
          }
        }
      }
    }
    return set;
  }, [upcoming, today, now]);

  // Карта статусов для чипов сохраненных мест
  const queueStatusMap = useMemo(() => {
    const map: Record<string, { state: 'on' | 'warning' | 'off' | 'unknown'; label: string }> = {};
    const nowMs = now.getTime();

    for (const item of upcoming) {
      if (item.date !== today) continue;
      if (item.isActiveNow) {
        const currentSlot = item.intervals.find(
          (iv) => Date.parse(iv.startsAt) <= nowMs && nowMs < Date.parse(iv.endsAt) && iv.stateCode === 3
        );
        const endHm = currentSlot ? minutesToHm(minutesOfDay(currentSlot.endsAt, today)) : '';
        map[item.queue] = { state: 'off', label: endHm ? `до ${endHm}` : 'відключення' };
      } else {
        const nextSlot = item.intervals
          .filter((iv) => iv.stateCode === 3 && Date.parse(iv.startsAt) > nowMs)
          .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0];

        if (nextSlot) {
          const diffMin = (Date.parse(nextSlot.startsAt) - nowMs) / 60000;
          const startHm = minutesToHm(minutesOfDay(nextSlot.startsAt, today));
          if (diffMin <= 30) {
            map[item.queue] = { state: 'warning', label: `до ${startHm}` };
          } else {
            map[item.queue] = { state: 'on', label: `до ${startHm}` };
          }
        } else {
          map[item.queue] = { state: 'on', label: 'без відключень' };
        }
      }
    }
    return map;
  }, [upcoming, today, now]);

  const liveDetail = (() => {
    if (state === 'off') {
      if (summary?.offEndsAt) {
        return `Вимкнено до ${minutesToHm(minutesOfDay(summary.offEndsAt, today))}`;
      }
      return 'Зараз відключення за графіком';
    }
    if (state === 'warning') {
      if (summary?.nextStartsAt) {
        return `Скоро вимкнення о ${minutesToHm(minutesOfDay(summary.nextStartsAt, today))}`;
      }
      return 'Скоро відключення за графіком';
    }
    if (state === 'on') {
      if (summary?.nextStartsAt) {
        return `Наступне відключення о ${minutesToHm(minutesOfDay(summary.nextStartsAt, today))}`;
      }
      return 'Відключень за графіком не заплановано';
    }
    if (state === 'allClear') return 'Світло є, відключень на добу немає';
    return 'Графік ще не опубліковано';
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

  const sync = useSyncStatus();

  const onNotificationAction = useCallback(
    (action: NotificationAction) => {
      if (action === 'share') void share();
      if (action === 'refresh') sync.refresh();
    },
    [share, sync],
  );
  useNotificationAction(onNotificationAction);

  const nextQueue = useCallback(() => {
    const queues = currentRegionData.queues ?? [];
    if (queues.length === 0) return;
    const index = selectedQueue ? queues.indexOf(selectedQueue) : -1;
    selectQueue(queues[(index + 1) % queues.length]);
  }, [currentRegionData.queues, selectedQueue, selectQueue]);

  // Тап по капсулі/заголовку віджета: наступне збережене місце, а якщо місць немає — наступна черга.
  const cycleBookmark = useCallback(() => {
    if (places.length === 0) {
      nextQueue();
      return;
    }
    const index = activePlace ? places.indexOf(activePlace) : -1;
    applyPlace(places[(index + 1) % places.length]);
  }, [places, activePlace, applyPlace, nextQueue]);

  const currentSlotProgress = useMemo(
    () => (intervals.length > 0 ? slotProgress(intervals, activeDate, now) : null),
    [intervals, activeDate, now],
  );

  const widgetExtras = useMemo<WidgetSnapshotExtras>(
    () => ({
      placeLabel: activePlace
        ? `${activePlace.label} · ${activePlace.queue}`
        : selectedQueue
          ? `Черга ${selectedQueue}`
          : 'Мій графік',
      todayOffMinutes: todaySummary ? todaySummary.offMinutes : null,
      tomorrowOffMinutes: tomorrowSummary ? tomorrowSummary.offMinutes : null,
      progress: currentSlotProgress?.percent ?? null,
      places: places.slice(0, 3).map((place) => {
        const live = placesStatusMap[place.id];
        return {
          icon: place.icon,
          label: place.label,
          queue: place.queue,
          state: live?.state ?? 'unknown',
          timeLabel: live?.timeLabel ?? '',
          statusText: live?.statusText ?? 'Немає даних',
        };
      }),
    }),
    [activePlace, currentSlotProgress, places, placesStatusMap, selectedQueue, todaySummary, tomorrowSummary],
  );

  useHomeWidget({
    state,
    summary,
    intervals,
    date: today,
    now,
    queue: selectedQueue,
    detail: liveDetail,
    extras: widgetExtras,
    onRefresh: sync.refresh,
    onNextQueue: nextQueue,
    onCycleBookmark: cycleBookmark,
  });


  return (
    <SwipeableScreen>
      {hiddenCard}
      <SafeAreaView className="flex-1 bg-surface-dim" edges={['top']}>
        {/* Свободный, плавный вертикальный скролл без зажатия */}
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ gap: 16, paddingHorizontal: 16, paddingBottom: 48, paddingTop: 10 }}
          showsVerticalScrollIndicator={false}
        >
          {/* 1) Шапка и действия */}
          <ScreenHeader
            title="Svitlo"
            actions={
              <>
                <Pressable
                  onPress={() => router.push('/search')}
                  accessibilityRole="button"
                  accessibilityLabel="Пошук черги за адресою"
                  style={{ backgroundColor: palette.card, borderColor: palette.hairline }}
                  className="h-9 w-9 items-center justify-center rounded-full border active:opacity-70"
                >
                  <Ionicons name="search" size={16} color={palette.mutedForeground} />
                </Pressable>
                <Pressable
                  onPress={() => void share()}
                  disabled={sharing}
                  accessibilityRole="button"
                  accessibilityLabel="Поділитися графіком"
                  style={{ backgroundColor: palette.card, borderColor: palette.hairline }}
                  className={`h-9 w-9 items-center justify-center rounded-full border active:opacity-70 ${sharing ? 'opacity-50' : ''}`}
                >
                  <Ionicons name="share-social-outline" size={16} color={palette.mutedForeground} />
                </Pressable>
                <Pressable
                  onPress={sync.refresh}
                  accessibilityRole="button"
                  accessibilityLabel="Оновити дані"
                  style={{ backgroundColor: palette.card, borderColor: palette.hairline }}
                  className="h-9 w-9 items-center justify-center rounded-full border active:opacity-70"
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

          {/* 2) Мої місця с индикаторами состояния */}
          <SavedPlacesCarousel selectedQueue={selectedQueue} placesStatusMap={placesStatusMap} />

          <AccidentBanner outages={outages} loading={outagesQuery.isLoading} />

          {/* 3) Главный Hero-блок со стеклянным свечением */}
          <HeroStatus
            state={state}
            summary={summary}
            intervals={intervals}
            date={activeDate}
            now={now}
            queue={selectedQueue}
            isLoading={scheduleQuery.isLoading && !schedule}
            isError={scheduleQuery.isError && !schedule}
          />

          {/* 4) Блок «Графік» с переключателем Сьогодні | Завтра, тактильной шкалой и сводными плитками */}
          <View
            style={{
              backgroundColor: palette.card,
              borderColor: palette.hairline,
              borderWidth: 1,
            }}
            className="gap-3.5 rounded-3xl p-4 shadow-sm"
          >
            <View className="flex-row items-center justify-between">
              <Text className="text-sm font-bold text-foreground">Графік відключень</Text>

              {/* Пилюльный переключатель Сьогодні | Завтра */}
              <View
                style={{ backgroundColor: palette.surfaceContainerHigh }}
                className="flex-row rounded-xl p-0.5"
              >
                <Pressable
                  onPress={() => {
                    if (selectedDay !== 'today') {
                      triggerSoftHaptic();
                      setSelectedDay('today');
                    }
                  }}
                  style={{
                    backgroundColor: selectedDay === 'today' ? palette.card : 'transparent',
                  }}
                  className="rounded-lg px-3 py-1 active:opacity-70"
                >
                  <Text
                    style={{
                      color: selectedDay === 'today' ? palette.foreground : palette.mutedForeground,
                      fontWeight: selectedDay === 'today' ? '700' : '500',
                    }}
                    className="text-xs"
                  >
                    Сьогодні
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => {
                    if (selectedDay !== 'tomorrow') {
                      triggerSoftHaptic();
                      setSelectedDay('tomorrow');
                    }
                  }}
                  style={{
                    backgroundColor: selectedDay === 'tomorrow' ? palette.card : 'transparent',
                  }}
                  className="rounded-lg px-3 py-1 active:opacity-70"
                >
                  <Text
                    style={{
                      color: selectedDay === 'tomorrow' ? palette.foreground : palette.mutedForeground,
                      fontWeight: selectedDay === 'tomorrow' ? '700' : '500',
                    }}
                    className="text-xs"
                  >
                    Завтра
                  </Text>
                </Pressable>
              </View>
            </View>

            <Animated.View
              key={selectedDay}
              entering={FadeIn.duration(200)}
              exiting={FadeOut.duration(120)}
              layout={LinearTransition.duration(180)}
            >
              {intervals.length > 0 ? (
                <Timeline24h intervals={intervals} date={activeDate} now={now} />
              ) : (
                <View className="rounded-2xl bg-surface-container-low p-4">
                  <Text className="text-center text-sm font-medium text-muted-foreground">
                    {state === 'allClear'
                      ? 'Оператор підтвердив добу без відключень.'
                      : selectedDay === 'today'
                      ? 'Графік на сьогодні ще не опубліковано.'
                      : 'Графік на завтра ще не опубліковано.'}
                  </Text>
                </View>
              )}
            </Animated.View>

            {/* Две компактные сводные плитки в ряд */}
            <View className="flex-row gap-2 pt-1">
              <View
                style={{ backgroundColor: palette.surfaceContainerLow, borderColor: palette.hairline }}
                className="flex-1 rounded-2xl border p-3"
              >
                <Text className="text-[11px] font-medium text-muted-foreground">Сьогодні без світла</Text>
                <Text className="mt-0.5 text-base font-bold text-foreground">
                  {todaySummary && todaySummary.offMinutes > 0 ? formatMinutesUk(todaySummary.offMinutes) : '0 год'}
                </Text>
              </View>
              <View
                style={{ backgroundColor: palette.surfaceContainerLow, borderColor: palette.hairline }}
                className="flex-1 rounded-2xl border p-3"
              >
                <Text className="text-[11px] font-medium text-muted-foreground">Завтра без світла</Text>
                <Text className="mt-0.5 text-base font-bold text-foreground">
                  {tomorrowSummary && tomorrowSummary.offMinutes > 0 ? formatMinutesUk(tomorrowSummary.offMinutes) : '0 год'}
                </Text>
              </View>
            </View>
          </View>

          {/* 5) Блок «Моя черга» с 3 статусами */}
          <QueueGrid
            regionCpu={currentRegion} queues={currentRegionData.queues}
            selected={selectedQueue}
            active={activeQueues}
            soon={soonQueues}
            covered={currentRegionData.covered}
            onSelect={selectQueue}
          />

          {/* 6) Маскотка: лежить унизу головного екрана */}
          {mascotEnabled ? <Mascot mood="sleep" powerState={state} /> : null}
        </ScrollView>
      </SafeAreaView>
    </SwipeableScreen>
  );
}
