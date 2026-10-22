import { useMemo } from 'react';
import { readRegionScheduleSnapshot, useQueries } from '@svitlo/core';
import { api } from '@svitlo/core/api/client';
import { canonicalQueueCode, queueCodeMatches } from '@svitlo/core/lib/queue';
import { minutesOfDay, minutesToHm, scheduleWindow, OFF_STATE_CODE } from '@svitlo/core/lib/scheduleWindow';
import { SOON_MINUTES } from '@svitlo/core/lib/day-status';
import type { GroupOutageSummary, ScheduleIntervalUtc } from '@svitlo/shared';

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
 * Загружает срезы расписаний для всех уникальных регионов в закладках пользователя
 * и рассчитывает точное состояние питания для каждого места (до скольки свет / отключение).
 * При монтировании мгновенно использует офлайн-снапшоты, чтобы статус не мигал серым.
 */
export function useSavedPlacesStatus(
  places: SavedPlace[],
  today: string,
  now: Date,
): Record<string, PlaceLiveStatus> {
  // Уникальные регионы среди сохраненных мест
  const uniqueRegions = useMemo(() => {
    return Array.from(new Set(places.map((p) => p.regionCpu).filter(Boolean)));
  }, [places]);

  const regionQueries = useQueries({
    queries: uniqueRegions.map((region) => ({
      queryKey: ['upcomingGroupOutages', region, 2],
      queryFn: async ({ signal }: { signal?: AbortSignal }) => {
        const response = await api.fetchUpcomingGroupOutages(region, 2, signal);
        return {
          region,
          data: (response?.data ?? []).map((item: GroupOutageSummary) => ({
            ...item,
            queue: canonicalQueueCode(region, item.queue),
          })),
        };
      },
      initialData: () => {
        const snapshot = readRegionScheduleSnapshot(region);
        if (!snapshot || !Array.isArray(snapshot.buckets)) return undefined;
        return {
          region,
          data: snapshot.buckets.map((item) => ({
            ...item,
            queue: canonicalQueueCode(region, item.queue),
          })),
        };
      },
      staleTime: 60_000,
      refetchInterval: 30_000,
    })),
  });

  return useMemo(() => {
    const statusByPlaceId: Record<string, PlaceLiveStatus> = {};
    const nowMs = now.getTime();

    // Индексируем данные по регионам (сперва снапшоты для фолбэка, затем свежие данные)
    const regionDataMap = new Map<string, GroupOutageSummary[]>();
    for (const region of uniqueRegions) {
      const snap = readRegionScheduleSnapshot(region);
      if (snap?.buckets) {
        regionDataMap.set(
          region,
          snap.buckets.map((b) => ({ ...b, queue: canonicalQueueCode(region, b.queue) })),
        );
      }
    }

    for (const q of regionQueries) {
      if (q.data?.region && Array.isArray(q.data.data) && q.data.data.length > 0) {
        regionDataMap.set(q.data.region, q.data.data);
      }
    }

    for (const place of places) {
      const regionUpcoming = regionDataMap.get(place.regionCpu) ?? [];
      const matched = regionUpcoming.find(
        (item) => item.date === today && queueCodeMatches(place.regionCpu, item.queue, place.queue),
      );

      if (!matched || !matched.intervals || matched.intervals.length === 0) {
        statusByPlaceId[place.id] = {
          state: 'unknown',
          timeLabel: '',
          statusText: 'Немає даних',
        };
        continue;
      }

      const summary = scheduleWindow(matched.intervals, today, now);

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
    }

    return statusByPlaceId;
  }, [places, regionQueries, uniqueRegions, today, now]);
}

