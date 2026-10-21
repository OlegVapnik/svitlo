import { useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import { useIncidents, useOutages, useQueues, useUpcomingGroupOutages } from '@svitlo/core/api/queries';
import { formatDate, formatTimeRange } from '@svitlo/core/lib/date';
import { canonicalQueueCode } from '@svitlo/core/lib/queue';
import { kyivDateOffsetKey } from '@svitlo/core/lib/outage-dates';
import type { Incident, Outage } from '@svitlo/shared';

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

const OUTAGE_STATUS_LABEL: Record<Outage['status'], string> = {
  scheduled: 'Заплановано',
  active: 'Триває',
  finished: 'Завершено',
  cancelled: 'Скасовано',
};

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
  const incidentsQuery = useIncidents();

  const upcoming = upcomingQuery.data?.data ?? [];
  const outages = outagesQuery.data?.data ?? [];

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

          {/* 1) Режим «Групи» — 24-часовая матрица 12 подгрупп */}
          {mode === 'groups' ? (
            <GroupMatrix
              regionCpu={currentRegion}
              selectedQueue={selectedQueue}
              upcoming={upcoming}
              date={today}
              now={now}
            />
          ) : null}

          {/* 2) Режим «Відключення» */}
          {mode === 'outages' ? (
            <View className="gap-2.5">
              <Text className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Поточні та заплановані події
              </Text>
              {outagesQuery.isLoading ? (
                <View className="items-center py-8">
                  <ActivityIndicator size="small" color={palette.primary} />
                </View>
              ) : outages.length === 0 ? (
                <View
                  style={{ backgroundColor: palette.card, borderColor: palette.hairline }}
                  className="rounded-2xl border p-5"
                >
                  <Text className="text-center text-sm font-medium text-muted-foreground">
                    Аварійних та позапланових відключень не зафіксовано.
                  </Text>
                </View>
              ) : (
                outages.slice(0, 15).map((item) => (
                  <View
                    key={item.id}
                    style={{ backgroundColor: palette.card, borderColor: palette.hairline }}
                    className="gap-1.5 rounded-2xl border p-4 shadow-sm"
                  >
                    <View className="flex-row items-center justify-between">
                      <Text className="text-sm font-bold text-foreground">
                        {item.areaName || currentRegionData.nameUa}
                      </Text>
                      <View className="rounded-full bg-surface-container-high px-2 py-0.5">
                        <Text className="text-[10px] font-bold text-muted-foreground">
                          {OUTAGE_STATUS_LABEL[item.status] || item.status}
                        </Text>
                      </View>
                    </View>
                    <Text className="text-xs text-muted-foreground">
                      {formatTimeRange(item.startsAt, item.endsAt)}
                    </Text>
                    {item.reason ? (
                      <Text className="text-xs font-medium text-foreground">{item.reason}</Text>
                    ) : null}
                  </View>
                ))
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
