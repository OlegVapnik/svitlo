import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useOutages, useUpcomingGroupOutages } from '@svitlo/core/api/queries';
import { formatTimeRange } from '@svitlo/core/lib/date';
import { kyivDateOffsetKey } from '@svitlo/core/lib/outage-dates';
import { formatMinutesUk, minutesOfDay, minutesToHm } from '@svitlo/core/lib/scheduleWindow';
import type { Outage } from '@svitlo/shared';

import { GroupMatrix } from '@/components/monitor/GroupMatrix';
import { UpcomingOutages } from '@/components/home/UpcomingOutages';
import { ScreenHeader } from '@/components/navigation/ScreenHeader';
import { useRegion } from '@/context/RegionContext';
import { useMinuteTicker } from '@/hooks/useMinuteTicker';
import { useRegionQueue } from '@/hooks/useRegionQueue';
import { useTheme } from '@/theme/ThemeProvider';
import { SwipeableScreen } from '@/components/navigation/SwipeableScreen';

const MODES = [
  { id: 'groups', label: 'Групи' },
  { id: 'outages', label: 'Відключення' },
  { id: 'statistics', label: 'Статистика' },
] as const;

type ModeId = (typeof MODES)[number]['id'];

interface UnifiedOutageItem {
  id: string;
  kind: 'active' | 'soon' | 'scheduled' | 'repair';
  queueLabel: string;
  startsAt: string;
  endsAt: string;
  title: string;
  description?: string;
}

export default function MonitorScreen() {
  const { currentRegion, currentRegionData } = useRegion();
  const { palette } = useTheme();
  const [mode, setMode] = useState<ModeId>('groups');
  const now = useMinuteTicker();
  const nowMs = now.getTime();
  const today = useMemo(() => kyivDateOffsetKey(0), []);

  const { selectedQueue } = useRegionQueue(currentRegion, currentRegionData.queues ?? []);
  const upcomingQuery = useUpcomingGroupOutages(currentRegion, 2);
  const outagesQuery = useOutages({ region: currentRegion, limit: 100 });

  const upcoming = upcomingQuery.data?.data ?? [];
  const rawOutages = outagesQuery.data?.data ?? [];

  // Синтезируем события из реальных интервалов графика (ленты upcoming) + аварийные отключения
  const eventsList = useMemo<UnifiedOutageItem[]>(() => {
    const list: UnifiedOutageItem[] = [];

    // 1. События из плановых интервалов графика на сегодня
    for (const group of upcoming) {
      if (group.date !== today) continue;
      for (const interval of group.intervals) {
        if (interval.stateCode === 3) {
          const startMs = Date.parse(interval.startsAt);
          const endMs = Date.parse(interval.endsAt);
          if (endMs < nowMs) continue; // прошедшие слоты

          const isActive = startMs <= nowMs && nowMs < endMs;
          const isSoon = !isActive && startMs - nowMs <= 30 * 60 * 1000;

          list.push({
            id: `plan-${group.queue}-${interval.startsAt}`,
            kind: isActive ? 'active' : isSoon ? 'soon' : 'scheduled',
            queueLabel: `Черга ${group.queue}`,
            startsAt: interval.startsAt,
            endsAt: interval.endsAt,
            title: isActive
              ? 'Відключення триває зараз'
              : isSoon
                ? 'Скоро відключення'
                : 'Заплановане відключення',
            description: `За графіком: ${interval.localTimeFrom || minutesToHm(minutesOfDay(interval.startsAt, today))} – ${interval.localTimeTo || minutesToHm(minutesOfDay(interval.endsAt, today))}`,
          });
        }
      }
    }

    // 2. Аварийные события (если есть в базе)
    for (const out of rawOutages) {
      list.push({
        id: `outage-${out.id}`,
        kind: 'repair',
        queueLabel: out.areaName || currentRegionData.nameUa,
        startsAt: out.startsAt,
        endsAt: out.endsAt,
        title: 'Аварійне відключення',
        description: out.reason || 'Аварійно-відновлювальні роботи',
      });
    }

    // Сортировка: сначала активные, затем скорые, затем запланированные
    return list.sort((a, b) => {
      const rank = (k: UnifiedOutageItem['kind']) => (k === 'active' ? 0 : k === 'soon' ? 1 : k === 'repair' ? 2 : 3);
      return rank(a.kind) - rank(b.kind) || Date.parse(a.startsAt) - Date.parse(b.startsAt);
    });
  }, [upcoming, rawOutages, today, nowMs, currentRegionData.nameUa]);

  return (
    <SwipeableScreen>
      <SafeAreaView className="flex-1 bg-surface-dim" edges={['top']}>
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ gap: 14, paddingHorizontal: 16, paddingBottom: 48, paddingTop: 10 }}
          showsVerticalScrollIndicator={false}
        >
          <ScreenHeader title="Графіки" />

          {/* Режимы: Групи | Відключення | Статистика */}
          <View
            style={{ backgroundColor: palette.surfaceContainerHigh }}
            className="flex-row rounded-2xl p-1"
          >
            {MODES.map((item) => {
              const active = mode === item.id;
              return (
                <Pressable
                  key={item.id}
                  onPress={() => setMode(item.id)}
                  style={{
                    backgroundColor: active ? palette.card : 'transparent',
                    borderColor: active ? palette.hairline : 'transparent',
                    borderWidth: active ? 1 : 0,
                  }}
                  className="flex-1 items-center rounded-xl py-2 active:opacity-70"
                >
                  <Text
                    style={{
                      color: active ? palette.foreground : palette.mutedForeground,
                      fontWeight: active ? '700' : '500',
                    }}
                    className="text-xs"
                  >
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* 1) Режим «Групи» — 24-годинна матриця груп (усі черги регіону, до 60 у Києві) */}
          {mode === 'groups' ? (
            <GroupMatrix
              regionCpu={currentRegion}
              selectedQueue={selectedQueue}
              upcoming={upcoming}
              date={today}
              now={now}
              availableQueues={currentRegionData.queues}
            />
          ) : null}

          {/* 2) Режим «Відключення» — Поточні та заплановані події */}
          {mode === 'outages' ? (
            <View className="gap-3">
              <Text className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Поточні та заплановані події ({eventsList.length})
              </Text>

              {eventsList.length === 0 ? (
                <View
                  style={{ backgroundColor: palette.card, borderColor: palette.hairline }}
                  className="rounded-2xl border p-5"
                >
                  <Text className="text-center text-sm font-medium text-muted-foreground">
                    Наразі немає активних або запланованих відключень.
                  </Text>
                </View>
              ) : (
                eventsList.slice(0, 30).map((event) => {
                  const isOff = event.kind === 'active' || event.kind === 'repair';
                  const isSoon = event.kind === 'soon';
                  const tone = isOff
                    ? palette.status.off
                    : isSoon
                      ? palette.status.warning
                      : palette.status.on;

                  const badgeLabel =
                    event.kind === 'active'
                      ? 'Триває'
                      : event.kind === 'soon'
                        ? 'Скоро'
                        : event.kind === 'repair'
                          ? 'Аварія'
                          : 'Заплановано';

                  const badgeSymbol = isOff ? '■' : isSoon ? '◆' : '●';

                  return (
                    <View
                      key={event.id}
                      style={{
                        backgroundColor: palette.card,
                        borderColor: isOff ? tone.border : isSoon ? tone.border : palette.hairline,
                        borderWidth: 1,
                      }}
                      className="gap-2 rounded-2xl p-4 shadow-sm"
                    >
                      <View className="flex-row items-center justify-between">
                        <View className="flex-row items-center gap-1.5">
                          <Text className="text-sm font-bold text-foreground">
                            {event.queueLabel}
                          </Text>
                          <Text className="text-xs font-bold" style={{ color: tone.color }}>
                            {badgeSymbol}
                          </Text>
                        </View>
                        <View
                          style={{ backgroundColor: tone.soft, borderColor: tone.border }}
                          className="rounded-full border px-2.5 py-0.5"
                        >
                          <Text className="text-[10px] font-bold" style={{ color: tone.text }}>
                            {badgeLabel}
                          </Text>
                        </View>
                      </View>

                      <Text className="text-xs font-semibold text-foreground">
                        {event.title}
                      </Text>

                      {event.description ? (
                        <Text className="text-xs text-muted-foreground">
                          {event.description}
                        </Text>
                      ) : null}

                      <Text className="text-[11px] text-muted-foreground">
                        {formatTimeRange(event.startsAt, event.endsAt)}
                      </Text>
                    </View>
                  );
                })
              )}
            </View>
          ) : null}

          {/* 3) Режим «Статистика» */}
          {mode === 'statistics' ? (
            <UpcomingOutages
              regionCpu={currentRegion}
              selectedQueue={selectedQueue}
            />
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </SwipeableScreen>
  );
}
