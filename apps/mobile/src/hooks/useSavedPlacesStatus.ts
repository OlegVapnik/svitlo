import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { readRegionScheduleSnapshot, useQueries } from '@svitlo/core';
import { api } from '@svitlo/core/api/client';
import { upcomingGroupOutagesQueryOptions } from '@svitlo/core/api/queries';
import { canonicalQueueCode, queueCodeMatches } from '@svitlo/core/lib/queue';
import { minutesOfDay, minutesToHm, scheduleWindow, OFF_STATE_CODE } from '@svitlo/core/lib/scheduleWindow';
import { SOON_MINUTES } from '@svitlo/core/lib/day-status';
import type { QueueScheduleData, ScheduleIntervalUtc } from '@svitlo/shared';

type ScheduleBucket = { queue: string; date: string; intervals: ScheduleIntervalUtc[] };

import type { SavedPlace } from '@svitlo/core/lib/saved-places';
import type { PowerState } from '@/theme/ThemeProvider';

export interface PlaceLiveStatus {
  state: PowerState;
  /** Текст времени: «до 09:00» */
  timeLabel: string;
  /** Подсказка: «Світло є», «Скоро вимкнуть», «Вимкнено» */
  statusText: string;
}

/**
 * Загружает срезы расписаний для всех уникальных регионов и мест в закладках пользователя
 * и рассчитывает точное состояние питания для каждого места (до скольки свет / отключение).
 * При монтировании мгновенно использует офлайн-снапшоты и кэш React Query, чтобы статус не мигал серым.
 */
export function useSavedPlacesStatus(
  places: SavedPlace[],
  today: string,
  now: Date,
): Record<string, PlaceLiveStatus> {
  const queryClient = useQueryClient();

  // Уникальные регионы среди сохраненных мест
  const uniqueRegions = useMemo(() => {
    return Array.from(new Set(places.map((p) => p.regionCpu).filter(Boolean)));
  }, [places]);

  const regionQueries = useQueries({
    queries: uniqueRegions.map((region) => ({
      ...upcomingGroupOutagesQueryOptions(region, 2),
      initialData: () => {
        const snapshot = readRegionScheduleSnapshot(region);
        if (!snapshot || !Array.isArray(snapshot.buckets)) return undefined;
        return {
          data: snapshot.buckets.map((item) => ({
            ...item,
            queue: canonicalQueueCode(region, item.queue),
          })),
        };
      },
    })),
  });

  // Запрашиваем расписание конкретной очереди для каждого места
  const placeQueries = useQueries({
    queries: places.map((place) => {
      const canonicalQueue = canonicalQueueCode(place.regionCpu, place.queue);
      return {
        queryKey: ['queueSchedule', canonicalQueue, today, place.regionCpu],
        queryFn: () => api.fetchQueueSchedule(canonicalQueue, today, place.regionCpu),
        // 5 минут, а не минута: каждый опрос — чтение слотов в D1 на сервере, и при открытом
        // приложении минутный ритм сжигал квоту впустую. Живой статус «зараз» этот запрос не
        // даёт — он приходит из плашки состояния и группового среза.
        staleTime: 120_000,
        refetchInterval: 300_000,
        enabled: Boolean(place.regionCpu && place.queue),
      };
    }),
  });

  return useMemo(() => {
    const statusByPlaceId: Record<string, PlaceLiveStatus> = {};
    const nowMs = now.getTime();

    // 1) Индексируем групповые данные по регионам (снапшоты + useUpcomingGroupOutages)
    const regionDataMap = new Map<string, ScheduleBucket[]>();
    for (const region of uniqueRegions) {
      const snap = readRegionScheduleSnapshot(region);
      if (snap?.buckets) {
        regionDataMap.set(
          region,
          snap.buckets.map((b) => ({ ...b, queue: canonicalQueueCode(region, b.queue) })),
        );
      }
    }

    regionQueries.forEach((query, index) => {
      const region = uniqueRegions[index];
      const data = query.data?.data;
      if (region && Array.isArray(data) && data.length > 0) {
        regionDataMap.set(region, data);
      }
    });

    // 2) Для каждого места находим интервалы: сперва индивидуальный запрос placeQueries, затем fallback на regionDataMap
    places.forEach((place, index) => {
      let placeIntervals: ScheduleIntervalUtc[] | null = null;
      let placeCovered = false;

      // Проверяем данные точечного запроса очереди
      const placeQueryData = placeQueries[index]?.data as { data?: QueueScheduleData } | undefined;
      const directSchedule = placeQueryData?.data;
      if (directSchedule) {
        if (Array.isArray(directSchedule.intervals) && directSchedule.intervals.length > 0) {
          placeIntervals = directSchedule.intervals;
          placeCovered = true;
        } else if (directSchedule.allClear === true) {
          // Только allClear — честное «график опубликован, отключений нет». Пустой intervals
          // с mere covered — это отставший импорт или недогруженные слоты: обещать
          // «світло цілий день» нельзя (см. dayPowerState в ядре — то же правило).
          placeIntervals = [];
          placeCovered = true;
        }
      }

      // Если в точечном запросе нет данных, ищем в React Query cache (например если запрошено под другим форматом очереди)
      if (!placeCovered && (!placeIntervals || placeIntervals.length === 0)) {
        const canonicalQueue = canonicalQueueCode(place.regionCpu, place.queue);
        const cached = queryClient.getQueryData<{ data?: QueueScheduleData }>([
          'queueSchedule',
          canonicalQueue,
          today,
          place.regionCpu,
        ]);
        if (cached?.data?.intervals && cached.data.intervals.length > 0) {
          placeIntervals = cached.data.intervals;
          placeCovered = true;
        } else if (cached?.data?.allClear === true) {
          placeIntervals = [];
          placeCovered = true;
        }
      }

      // Если всё ещё нет данных, смотрим в групповой срез региона
      if (!placeCovered && (!placeIntervals || placeIntervals.length === 0)) {
        const regionUpcoming = regionDataMap.get(place.regionCpu) ?? [];
        const matched = regionUpcoming.find(
          (item) => item.date === today && queueCodeMatches(place.regionCpu, item.queue, place.queue),
        );
        // Верим только непустому бакету: групповой срез не различает «очередь без отключений»
        // и «недогруженный слот», поэтому пустой buckets-интервал — не «світло цілий день».
        if (matched && Array.isArray(matched.intervals) && matched.intervals.length > 0) {
          placeIntervals = matched.intervals;
          placeCovered = true;
        }
      }

      // Если расписание так и не найдено
      if (!placeCovered && (!placeIntervals || placeIntervals.length === 0)) {
        statusByPlaceId[place.id] = {
          state: 'unknown',
          timeLabel: '',
          statusText: 'Немає даних',
        };
        return;
      }

      const summary = scheduleWindow(placeIntervals || [], today, now);

      if (summary.isOff) {
        const endHm = summary.offEndsAt ? minutesToHm(minutesOfDay(summary.offEndsAt, today)) : '';
        statusByPlaceId[place.id] = {
          state: 'off',
          timeLabel: endHm ? `до ${endHm}` : '',
          statusText: 'Вимкнено',
        };
      } else if (summary.nextInMinutes != null && summary.nextInMinutes <= SOON_MINUTES) {
        const nextHm = summary.nextStartsAt ? minutesToHm(minutesOfDay(summary.nextStartsAt, today)) : '';
        statusByPlaceId[place.id] = {
          state: 'warning',
          timeLabel: nextHm ? `до ${nextHm}` : '',
          statusText: 'Скоро вимкнуть',
        };
      } else if (summary.nextStartsAt) {
        const nextHm = minutesToHm(minutesOfDay(summary.nextStartsAt, today));
        statusByPlaceId[place.id] = {
          state: 'on',
          timeLabel: `до ${nextHm}`,
          statusText: 'Світло є',
        };
      } else {
        statusByPlaceId[place.id] = {
          state: 'on',
          timeLabel: 'цілий день',
          statusText: 'Світло є',
        };
      }
    });

    return statusByPlaceId;
  }, [places, regionQueries, placeQueries, uniqueRegions, today, now, queryClient]);
}

