import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Text } from '@/components/ui/AppText';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useIsFocused, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';

import { api } from '@svitlo/core/api/client';
import { useOutages, useQueueSchedule, useUpcomingGroupOutages } from '@svitlo/core/api/queries';
import { isSchedulePublished } from '@svitlo/core/lib/day-status';
import { canonicalQueueCode, queueCodeMatches } from '@svitlo/core/lib/queue';
import { formatMinutesUk, minutesOfDay, minutesToHm, OFF_STATE_CODE, slotProgress } from '@svitlo/core/lib/scheduleWindow';
import { scheduleWithFallback } from '@svitlo/core/lib/schedule-payload';
import { isSoonMinutes } from '@svitlo/core/lib/day-status';

import { AccidentBanner } from '@/features/home/components/AccidentBanner';
import { HeroStatus } from '@/features/home/components/HeroStatus';
import { GridRegimeBanner } from '@/features/home/components/GridRegimeBanner';
import { OperatorChips } from '@/features/home/components/OperatorChips';
import { DataTransparencyBar } from '@/features/home/components/DataTransparencyBar';
import { SmartWindowAdvisor } from '@/features/home/components/SmartWindowAdvisor';
import { QueueFairnessCard } from '@/features/home/components/QueueFairnessCard';
import { useGridRegime } from '@/hooks/useGridRegime';
import { placeIconEmoji } from '@/components/places/PlaceIcon';
import { SavedPlacesCarousel } from '@/components/places/SavedPlacesCarousel';
import { Timeline24h } from '@/components/schedule/Timeline24h';
import { QueueGrid } from '@/features/home/components/QueueGrid';
import { ScreenHeader } from '@/components/navigation/ScreenHeader';
import { useRegion } from '@/context/RegionContext';
import { useSettings } from '@/context/SettingsContext';
import { useUpdates } from '@/context/UpdateContext';
import { useApplySavedPlace } from '@/hooks/useApplySavedPlace';
import { useEarlyPowerDetector } from '@/hooks/useEarlyPowerDetector';
import { useHomeWidget } from '@/hooks/useHomeWidget';
import { useKyivDayKeys } from '@/hooks/useKyivDayKeys';
import { useLiveNotification } from '@/hooks/useLiveNotification';
import { useMinuteTicker } from '@/hooks/useMinuteTicker';
import { useRegionQueue } from '@/hooks/useRegionQueue';
import { useSavedPlaces } from '@/hooks/useSavedPlaces';
import { useSavedPlacesStatus } from '@/hooks/useSavedPlacesStatus';
import { useShareSchedule } from '@/components/share/useShareSchedule';
import { useSyncStatus } from '@/context/SyncContext';
import { triggerSelectionHaptic, triggerSoftHaptic } from '@/lib/haptics';
import { powerStateFromSchedule, unwrapSchedule } from '@/lib/power-state';
import { useNotificationAction, type NotificationAction } from '@/lib/notification-actions';
import type { WidgetSnapshotExtras } from '@/lib/widget';
import { buildWidgetWindows } from '@/lib/widget-windows';
import { useTheme } from '@/theme/ThemeProvider';
import { SwipeableScreen } from '@/components/navigation/SwipeableScreen';

export default function HomeScreen() {
  const router = useRouter();
  const { currentRegion, currentRegionData } = useRegion();
  const { palette } = useTheme();
  const { selectedQueue, selectQueue } = useRegionQueue(currentRegion, currentRegionData.queues ?? []);
  // Той самий режим мережі, що й на вебі: поле офлайн-пакета `/sync`.
  const gridRegime = useGridRegime();
  const { liveNotification, earlyLightDetector } = useSettings();
  const { pending } = useUpdates();
  const isFocused = useIsFocused();
  const now = useMinuteTicker(30_000, isFocused);
  // Дати рахуємо від тика, а не один раз при монтуванні: інакше після півночі «Сьогодні»
  // показувало вчорашній графік, а справжня доба ховалась під «Завтра».
  const { today, tomorrow } = useKyivDayKeys(now);
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

  // Синтезируем расписание из upcoming, если /schedules ещё не ответил или вернул пусто.
  // Правило одно на все три даты — в `@svitlo/core/lib/schedule-payload`: раньше здесь было
  // три почти одинаковых блока, и в одном из них терялся `allClear`.
  const schedule = useMemo(
    () =>
      scheduleWithFallback(directSchedule, upcoming, {
        regionCpu: currentRegion,
        queue: selectedQueue,
        date: activeDate,
      }),
    [directSchedule, upcoming, currentRegion, selectedQueue, activeDate],
  );

  // Расписание на сегодня (для расчета статистики и состояния виджетов)
  const todayScheduleQuery = useQueueSchedule(selectedQueue ?? undefined, today, currentRegion);
  const todayDirectSchedule = unwrapSchedule(todayScheduleQuery.data);
  const todaySchedule = useMemo(
    () =>
      scheduleWithFallback(todayDirectSchedule, upcoming, {
        regionCpu: currentRegion,
        queue: selectedQueue,
        date: today,
      }),
    [todayDirectSchedule, upcoming, currentRegion, selectedQueue, today],
  );

  // Расписание на завтра (для сводной плитки)
  const tomorrowScheduleQuery = useQueueSchedule(selectedQueue ?? undefined, tomorrow, currentRegion);
  const tomorrowDirectSchedule = unwrapSchedule(tomorrowScheduleQuery.data);
  const tomorrowSchedule = useMemo(
    () =>
      scheduleWithFallback(tomorrowDirectSchedule, upcoming, {
        regionCpu: currentRegion,
        queue: selectedQueue,
        date: tomorrow,
      }),
    [tomorrowDirectSchedule, upcoming, currentRegion, selectedQueue, tomorrow],
  );

  const intervals = schedule?.intervals ?? [];
  const todayIntervals = todaySchedule?.intervals ?? [];
  const { state, summary } = powerStateFromSchedule(todaySchedule, today);
  const todaySummary = summary;
  const { summary: tomorrowSummary } = powerStateFromSchedule(tomorrowSchedule, tomorrow);

  // Стан вибраної вкладки. Раніше порожній стан брав `state` (сьогодні) навіть коли відкрито
  // «Завтра»: людина бачила «Оператор підтвердив добу без відключень» про сьогодні, дивлячись
  // на завтрашню шкалу.
  const { state: activeState, summary: activeSummary } = powerStateFromSchedule(schedule, activeDate);

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

  // Очереди, у которых отключение скоро (порог `SOON_MINUTES` из домена)
  const soonQueues = useMemo(() => {
    const set = new Set<string>();
    const nowMs = now.getTime();
    for (const item of upcoming) {
      if (item.date !== today || item.isActiveNow) continue;
      for (const interval of item.intervals) {
        if (interval.stateCode === OFF_STATE_CODE) {
          const startMs = Date.parse(interval.startsAt);
          const diffMinutes = (startMs - nowMs) / 60000;
          if (diffMinutes > 0 && isSoonMinutes(diffMinutes)) {
            set.add(item.queue);
            break;
          }
        }
      }
    }
    return set;
  }, [upcoming, today, now]);

  // Черги з опублікованим графіком на сьогодні — для зелених плиток сітки «Моя черга».
  // Регіональний `covered` означає «покриті ВСІ черги області»; коли оператор опублікував
  // лише частину, він false — і групи зі світлом ставали сірими, хоча графік у них є.
  // Веб уже рахує покриття по кожній черзі, тримаємо ту саму логіку для паритету.
  const coveredQueues = useMemo<boolean | Set<string>>(() => {
    if (currentRegionData.covered === true || currentRegionData.allClear === true) return true;
    const set = new Set<string>();
    for (const item of upcoming) {
      if (item.date === today) set.add(canonicalQueueCode(currentRegion, item.queue));
    }
    if (
      todaySchedule &&
      (todaySchedule.covered === true ||
        todaySchedule.allClear === true ||
        (todaySchedule.intervals?.length ?? 0) > 0) &&
      selectedQueue
    ) {
      set.add(canonicalQueueCode(currentRegion, selectedQueue));
    }
    if (set.size > 0) return set;
    if ((currentRegionData.todaySlots ?? 0) > 0) return true;
    return false;
  }, [currentRegionData, upcoming, today, todaySchedule, selectedQueue, currentRegion]);

  // Карта статусов для чипов сохраненных мест
  const queueStatusMap = useMemo(() => {
    const map: Record<string, { state: 'on' | 'warning' | 'off' | 'unknown'; label: string }> = {};
    const nowMs = now.getTime();

    for (const item of upcoming) {
      if (item.date !== today) continue;
      if (item.isActiveNow) {
        const currentSlot = item.intervals.find(
          (iv) => Date.parse(iv.startsAt) <= nowMs && nowMs < Date.parse(iv.endsAt) && iv.stateCode === OFF_STATE_CODE
        );
        const endHm = currentSlot ? minutesToHm(minutesOfDay(currentSlot.endsAt, today)) : '';
        map[item.queue] = { state: 'off', label: endHm ? `до ${endHm}` : 'відключення' };
      } else {
        const nextSlot = item.intervals
          .filter((iv) => iv.stateCode === OFF_STATE_CODE && Date.parse(iv.startsAt) > nowMs)
          .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0];

        if (nextSlot) {
          const diffMin = (Date.parse(nextSlot.startsAt) - nowMs) / 60000;
          const startHm = minutesToHm(minutesOfDay(nextSlot.startsAt, today));
          if (isSoonMinutes(diffMin)) {
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
      // Место и очередь — раздельно: в виджете 2×1 склейка «Дім · 6/1» не влезала в строку.
      placeLabel: activePlace ? activePlace.label : 'Мій графік',
      queueLabel: activePlace ? activePlace.queue : selectedQueue ?? '',
      windowsToday: buildWidgetWindows(todayIntervals, today),
      windowsTomorrow: buildWidgetWindows(tomorrowSchedule?.intervals ?? [], tomorrow),
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
    [
      activePlace,
      currentSlotProgress,
      places,
      placesStatusMap,
      selectedQueue,
      todayIntervals,
      today,
      tomorrowSchedule,
      tomorrow,
      todaySummary,
      tomorrowSummary,
    ],
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

  const myQueueWindows = useMemo(() => {
    if (!selectedQueue) return [];
    const offIntervals = (intervals ?? [])
      .filter((iv) => iv.stateCode === OFF_STATE_CODE)
      .slice()
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));

    const merged: Array<{
      startsAt: string;
      endsAt: string;
      localTimeFrom?: string;
      localTimeTo?: string;
    }> = [];

    for (const cur of offIntervals) {
      const curExtra = cur as { localTimeFrom?: string; localTimeTo?: string };
      const prev = merged[merged.length - 1];
      const curStartMs = Date.parse(cur.startsAt);
      const curEndMs = Date.parse(cur.endsAt);
      if (prev) {
        const prevEndMs = Date.parse(prev.endsAt);
        if (curStartMs <= prevEndMs) {
          if (curEndMs > prevEndMs) {
            prev.endsAt = cur.endsAt;
            prev.localTimeTo = curExtra.localTimeTo;
          }
          continue;
        }
      }
      merged.push({
        startsAt: cur.startsAt,
        endsAt: cur.endsAt,
        localTimeFrom: curExtra.localTimeFrom,
        localTimeTo: curExtra.localTimeTo,
      });
    }

    const nowMs = now.getTime();
    return merged.map((item) => {
      const startMs = Date.parse(item.startsAt);
      const endMs = Date.parse(item.endsAt);
      const minutes = Math.max(0, Math.round((endMs - startMs) / 60_000));
      const timeFrom = item.localTimeFrom || minutesToHm(minutesOfDay(item.startsAt, activeDate));
      let timeTo = item.localTimeTo || minutesToHm(minutesOfDay(item.endsAt, activeDate));
      if (timeTo === '24:00') {
        timeTo = '00:00';
      }

      let windowState: 'active' | 'soon' | 'past' | 'scheduled' = 'scheduled';
      if (selectedDay === 'today') {
        if (startMs <= nowMs && nowMs < endMs) {
          windowState = 'active';
        } else if (endMs <= nowMs) {
          windowState = 'past';
        } else if (isSoonMinutes((startMs - nowMs) / 60_000)) {
          windowState = 'soon';
        }
      }

      return {
        startsAt: item.startsAt,
        endsAt: item.endsAt,
        timeFrom,
        timeTo,
        minutes,
        state: windowState,
      };
    });
  }, [selectedQueue, intervals, activeDate, selectedDay, now]);

  const isOffNow = selectedDay === 'today' && myQueueWindows.some((w) => w.state === 'active');
  const hasFutureOff = selectedDay === 'today'
    ? myQueueWindows.some((w) => w.state === 'soon' || w.state === 'scheduled')
    : myQueueWindows.length > 0;
  const outageTone = isOffNow
    ? palette.status.off
    : hasFutureOff
      ? palette.status.warning
      : palette.status.on;

  const outageBadgeLabel = (() => {
    if (selectedDay === 'today') {
      if (isOffNow) return 'Триває';
      const nextWindow = myQueueWindows.find((w) => w.state === 'soon' || w.state === 'scheduled');
      if (nextWindow) return `Далі о ${nextWindow.timeFrom}`;
      if (myQueueWindows.length > 0) return 'Завершено';
      return isSchedulePublished(schedule) ? 'Без відключень' : 'Очікується';
    }
    if (myQueueWindows.length > 0) {
      return `Далі о ${myQueueWindows[0].timeFrom}`;
    }
    return isSchedulePublished(schedule) ? 'Без відключень' : 'Очікується';
  })();

  const totalOffMinutes = useMemo(
    () => myQueueWindows.reduce((sum, w) => sum + w.minutes, 0),
    [myQueueWindows],
  );

  return (
    <SwipeableScreen>
      {hiddenCard}
      <SafeAreaView className="flex-1 bg-surface-dim" edges={['top']}>
        {/* Свободный, плавный вертикальный скролл без зажатия */}
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ gap: 10, paddingHorizontal: 16, paddingBottom: 26, paddingTop: 6 }}
          showsVerticalScrollIndicator={false}
          // Mali (MediaTek): картки поза екраном не рендеряться — розвантажує GPU при скролі.
          removeClippedSubviews={true}
          refreshControl={
            <RefreshControl
              refreshing={sync.state.phase === 'syncing'}
              onRefresh={() => {
                triggerSelectionHaptic();
                sync.refresh();
              }}
              tintColor={palette.primary}
              colors={[palette.primary]}
            />
          }
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
                    <Ionicons name="reload" size={16} color={palette.mutedForeground} />
                  )}
                </Pressable>
              </>
            }
          />

          {/* 2) Мої місця с индикаторами состояния */}
          <SavedPlacesCarousel selectedQueue={selectedQueue} placesStatusMap={placesStatusMap} />

          {/* Компактный баннер доступного обновления: ведёт в карточку на «Налаштуваннях» */}
          {pending ? (
            <Animated.View
              entering={FadeIn.duration(200)}
              className="flex-row items-center gap-2.5 rounded-2xl border p-3"
              style={{ backgroundColor: 'rgba(16, 185, 129, 0.10)', borderColor: 'rgba(16, 185, 129, 0.35)' }}
            >
              <Ionicons name="download-outline" size={18} color="#10B981" />
              <Text className="flex-1 text-xs font-semibold text-foreground">
                Доступне оновлення v{pending.version}
              </Text>
              <Pressable
                onPress={() => router.push('/settings')}
                accessibilityRole="button"
                accessibilityLabel="Оновити застосунок"
                className="rounded-full px-3 py-1.5 active:opacity-80"
                style={{ backgroundColor: '#10B981' }}
              >
                <Text className="text-xs font-bold" style={{ color: '#05231a' }}>
                  Оновити
                </Text>
              </Pressable>
            </Animated.View>
          ) : null}

          <AccidentBanner outages={outages} loading={outagesQuery.isLoading} />

          <GridRegimeBanner regime={gridRegime} queue={selectedQueue} />

          {/* Вибір оператора для областей із кількома мережами (Дніпропетровщина: ДТЕК / ЦЕК) */}
          <OperatorChips />

          {/* Прозорість даних: актуальність графіка, остання перевірка та джерело */}
          <DataTransparencyBar region={currentRegionData} />

          {/* 3) Главный Hero-блок со стеклянным свечением */}
          <HeroStatus
            state={selectedDay === 'today' ? state : activeState}
            summary={selectedDay === 'today' ? summary : activeSummary}
            intervals={selectedDay === 'today' ? todayIntervals : intervals}
            today={activeDate}
            now={now}
            isTomorrow={selectedDay === 'tomorrow'}
            queue={selectedQueue}
            isLoading={(selectedDay === 'today' ? todayScheduleQuery.isLoading : tomorrowScheduleQuery.isLoading) && !schedule}
            isError={(selectedDay === 'today' ? todayScheduleQuery.isError : tomorrowScheduleQuery.isError) && !schedule}
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
            <View className="flex-row flex-wrap items-center justify-between gap-2">
              <Text className="text-sm font-bold text-foreground" style={{ flexShrink: 1 }}>
                Графік відключень
              </Text>

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
                      width: '100%',
                      textAlign: 'center',
                      includeFontPadding: false,
                      letterSpacing: 0,
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
                      width: '100%',
                      textAlign: 'center',
                      includeFontPadding: false,
                      letterSpacing: 0,
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
              entering={FadeIn.duration(150)}
              exiting={FadeOut.duration(80)}
            >
              {intervals.length > 0 ? (
                <Timeline24h intervals={intervals} date={activeDate} now={now} />
              ) : (
                <View className="rounded-2xl bg-surface-container-low p-4">
                  <Text className="text-center text-sm font-medium text-muted-foreground">
                    {activeState === 'allClear'
                      ? 'Оператор підтвердив добу без відключень.'
                      : selectedDay === 'today'
                      ? 'Графік на сьогодні ще не опубліковано.'
                      : 'Графік на завтра ще не опубліковано.'}
                  </Text>
                </View>
              )}
            </Animated.View>

            {/* Единая плашка итоговых минут без света за выбранный день */}
            <View
              style={{
                backgroundColor: palette.surfaceContainerLow,
                borderColor: palette.hairline,
                borderWidth: 1,
              }}
              className="flex-row items-center justify-between rounded-2xl px-4 py-3"
            >
              <Text className="text-xs font-semibold text-muted-foreground">
                {selectedDay === 'today' ? 'Без світла за сьогодні' : 'Без світла за завтра'}
              </Text>
              <Text className="text-base font-bold text-foreground">
                {selectedDay === 'today'
                  ? todaySummary
                    ? formatMinutesUk(todaySummary.offMinutes)
                    : isSchedulePublished(todaySchedule)
                      ? '0 год'
                      : '—'
                  : tomorrowSummary
                    ? formatMinutesUk(tomorrowSummary.offMinutes)
                    : isSchedulePublished(tomorrowSchedule)
                      ? '0 год'
                      : '—'}
              </Text>
            </View>
          </View>

          {/* 5) Блок «Моя черга» с 3 статусами */}
          <QueueGrid
            regionCpu={currentRegion} queues={currentRegionData.queues}
            selected={selectedQueue}
            active={activeQueues}
            soon={soonQueues}
            covered={coveredQueues}
            onSelect={selectQueue}
          />

          {/* 6) Карточка відключень для вибраної черги */}
          {selectedQueue ? (
            <Animated.View
              key={`${selectedQueue}-${selectedDay}`}
              entering={FadeIn.duration(160)}
              style={{
                backgroundColor: palette.card,
                borderColor: isOffNow ? outageTone.border : palette.hairline,
                borderWidth: 1,
                borderRadius: 16,
                padding: 16,
                gap: 10,
                shadowColor: '#000',
                shadowOpacity: 0.12,
                shadowRadius: 8,
                shadowOffset: { width: 0, height: 2 },
              }}
            >
              <View className="flex-row flex-wrap items-center justify-between gap-2">
                <Text className="text-sm font-bold text-foreground" style={{ flexShrink: 1 }}>
                  Черга {selectedQueue}
                </Text>
                <View
                  style={{ backgroundColor: outageTone.soft, borderColor: outageTone.border, flexShrink: 0 }}
                  className="rounded-full border px-2.5 py-0.5"
                >
                  {/* «За графіком», «Далі о 09:00»: нерозривні пробіли, щоб бейдж не
                      переносив слово всередину, і padding як ширший запас. */}
                  <Text
                    className="text-[10px] font-bold"
                    style={{ color: outageTone.text, includeFontPadding: false, letterSpacing: 0 }}
                  >
                    {outageBadgeLabel.replace(/\s/g, '\u00A0')}
                  </Text>
                </View>
              </View>

              {/* Рядок «Без світла за графіком: 8 год» — нерозривні пробіли всередині
                  фрази й числа, щоб MiSans не переносив хвіст на наступний рядок. */}
              <Text className="text-xs font-semibold text-foreground">
                {'Без світла за графіком:\u00A0'.replace(/\s/g, '\u00A0')}{formatMinutesUk(totalOffMinutes).replace(/\s/g, '\u00A0')}
              </Text>

              {myQueueWindows.length === 0 ? (
                <View
                  style={{
                    backgroundColor: palette.surfaceContainerLow,
                    borderColor: palette.hairline,
                  }}
                  className="rounded-xl border p-3.5"
                >
                  <Text className="text-center text-xs font-medium text-muted-foreground">
                    {isSchedulePublished(schedule)
                      ? `На ${selectedDay === 'today' ? 'сьогодні' : 'завтра'} відключень не заплановано`
                      : `Графік на ${selectedDay === 'today' ? 'сьогодні' : 'завтра'} ще не опубліковано`}
                  </Text>
                </View>
              ) : (
                <View className="gap-1.5">
                  {myQueueWindows.map((window) => {
                    const active = window.state === 'active';
                    const past = window.state === 'past';
                    const dotColor = active
                      ? palette.status.off.color
                      : past
                        ? palette.mutedForeground
                        : palette.status.warning.color;
                    return (
                      <View
                        key={`${window.startsAt}-${window.endsAt}`}
                        style={{
                          backgroundColor: active ? palette.status.off.soft : palette.surfaceContainerLow,
                          borderColor: active ? palette.status.off.border : palette.hairline,
                          opacity: past ? 0.6 : 1,
                        }}
                        className="flex-row items-center justify-between rounded-xl border px-3 py-1.5"
                      >
                        <View className="flex-row items-center gap-2">
                          <Text className="text-[10px]" style={{ color: dotColor }}>
                            {active ? '■' : '●'}
                          </Text>
                          <Text className="text-xs font-semibold tabular-nums text-foreground">
                            {window.timeFrom} – {window.timeTo}
                          </Text>
                        </View>
                        <Text className="text-[11px] tabular-nums text-muted-foreground">
                          {formatMinutesUk(window.minutes)}
                          {active ? ' · зараз' : ''}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              )}
            </Animated.View>
          ) : null}

          {/* 7) Розумний радник вікон зі світлом та аналітика справедливості черги */}
          {selectedQueue ? (
            <>
              <SmartWindowAdvisor
                queue={selectedQueue}
                intervals={selectedDay === 'today' ? todayIntervals : intervals}
                todayDate={activeDate}
                now={now}
                allClear={activeState === 'allClear'}
              />
              <QueueFairnessCard
                regionCpu={currentRegion}
                activeQueue={selectedQueue}
                availableQueues={currentRegionData.queues ?? []}
              />
            </>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </SwipeableScreen>
  );
}
