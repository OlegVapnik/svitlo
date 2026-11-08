import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { Text } from '@/components/ui/AppText';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused } from 'expo-router';

import { useOutages, useUpcomingGroupOutages } from '@svitlo/core/api/queries';
import { formatTimeRange } from '@svitlo/core/lib/date';
import { formatMinutesUk } from '@svitlo/core/lib/scheduleWindow';
import { buildOutageEvents, groupOutageEventsByQueue, repairEvents } from '@svitlo/core/lib/outages';
import type { Outage } from '@svitlo/shared';

import { GroupMatrix } from '@/features/monitor/components/GroupMatrix';
import { ScreenHeader } from '@/components/navigation/ScreenHeader';
import { useRegion } from '@/context/RegionContext';
import { useSavedPlaces } from '@/hooks/useSavedPlaces';
import { useKyivDayKeys } from '@/hooks/useKyivDayKeys';
import { useMinuteTicker } from '@/hooks/useMinuteTicker';
import { useRegionQueue } from '@/hooks/useRegionQueue';
import { useTheme } from '@/theme/ThemeProvider';
import { SwipeableScreen } from '@/components/navigation/SwipeableScreen';
import { triggerSoftHaptic } from '@/lib/haptics';
import Animated, { FadeIn } from 'react-native-reanimated';

const MODES = [
  { id: 'groups', label: 'Матриця груп' },
  { id: 'outages', label: 'Відключення' },
] as const;

type ModeId = (typeof MODES)[number]['id'];


export default function MonitorScreen() {
  const { currentRegion, currentRegionData } = useRegion();
  const { palette } = useTheme();
  const isFocused = useIsFocused();
  const [mode, setMode] = useState<ModeId>('groups');
  const now = useMinuteTicker(30_000, isFocused);
  const nowMs = now.getTime();
  // Дати перераховуються від тика: екран живе у фоні добами і не має застрягати на вчора.
  const { today, tomorrow } = useKyivDayKeys(now);
  const [matrixDay, setMatrixDay] = useState<'today' | 'tomorrow'>('today');
  const matrixDate = matrixDay === 'today' ? today : tomorrow;

  const { selectedQueue, selectQueue } = useRegionQueue(currentRegion, currentRegionData.queues ?? []);
  const { places } = useSavedPlaces();
  const upcomingQuery = useUpcomingGroupOutages(currentRegion, 2);
  const outagesQuery = useOutages({ region: currentRegion, limit: 100 });

  const upcoming = upcomingQuery.data?.data ?? [];
  const rawOutages = outagesQuery.data?.data ?? [];

  // Синтезируем события из реальных интервалов графика (ленты upcoming) + аварийные отключения.
  // Само правило (что активно, что «скоро», что прошло) живёт в ядре; экран только подписывает.
  const events = useMemo(
    () =>
      buildOutageEvents(upcoming, rawOutages, {
        date: today,
        now,
        regionName: currentRegionData.nameUa,
      }),
    [upcoming, rawOutages, today, now, currentRegionData.nameUa],
  );

  // Одна карточка на очередь: раньше карточка рисовалась на КАЖДОЕ окно, и у 12 групп с двумя
  // окнами получалась простыня, где свою очередь человек искал дважды. Склейка и порядок
  // («мої» сверху, затем по номерам) — в ядре, чтобы web и mobile видели одинаковый список.
  const mineQueues = useMemo(
    () => [selectedQueue, ...places.map((place) => place.queue)].filter((q): q is string => Boolean(q)),
    [selectedQueue, places],
  );
  const queueCards = useMemo(
    () => groupOutageEventsByQueue(events, { now, mine: mineQueues, regionCpu: currentRegion }),
    [events, now, mineQueues, currentRegion],
  );
  const repairs = useMemo(() => repairEvents(events), [events]);

  return (
    <SwipeableScreen>
      <SafeAreaView className="flex-1 bg-surface-dim" edges={['top']}>
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ gap: 14, paddingHorizontal: 16, paddingBottom: 48, paddingTop: 10 }}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews={true}
        >
          <ScreenHeader title="Графіки" />

          {/* Режимы: Групи | Відключення */}
          <View
            style={{ backgroundColor: palette.surfaceContainerHigh }}
            className="flex-row rounded-2xl p-1"
          >
            {MODES.map((item) => {
              const active = mode === item.id;
              return (
                <Pressable
                  key={item.id}
                  onPress={() => {
                    triggerSoftHaptic();
                    setMode(item.id);
                  }}
                  style={{
                    backgroundColor: active ? palette.card : 'transparent',
                    borderColor: active ? palette.hairline : 'transparent',
                    borderWidth: active ? 1 : 0,
                  }}
                  className="flex-1 items-center rounded-xl py-2 active:opacity-70"
                >
                  <Text
                    // «Відключенн» → обрізання останньої літери: MiSans ширший за Yoga-метрики.
                    // Центруємо на всю ширину сегмента, без letterSpacing.
                    style={{
                      color: active ? palette.foreground : palette.mutedForeground,
                      fontWeight: active ? '700' : '500',
                      width: '100%',
                      textAlign: 'center',
                      includeFontPadding: false,
                      letterSpacing: 0,
                    }}
                    className="text-xs"
                    numberOfLines={1}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Animated.View key={mode} entering={FadeIn.duration(160)} style={{ gap: 12 }}>

          {/* 1) Режим «Групи» — 24-годинна матриця груп (усі черги регіону, до 60 у Києві) */}
          {mode === 'groups' ? (
            <GroupMatrix
              regionCpu={currentRegion}
              selectedQueue={selectedQueue}
              upcoming={upcoming}
              date={matrixDate}
              today={today}
              now={now}
              selectedDay={matrixDay}
              onSelectDay={setMatrixDay}
              availableQueues={currentRegionData.queues}
              onSelectQueue={selectQueue}
            />
          ) : null}

          {/* 2) Режим «Відключення» — одна карточка на чергу: все її вікна за день */}
          {mode === 'outages' ? (
            <View className="gap-3">
              <Text className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Відключення на сьогодні ({queueCards.length})
              </Text>

              {queueCards.length === 0 && repairs.length === 0 ? (
                <View
                  style={{ backgroundColor: palette.card, borderColor: palette.hairline }}
                  className="rounded-2xl border p-5"
                >
                  <Text className="text-center text-sm font-medium text-muted-foreground">
                    Наразі немає активних або запланованих відключень.
                  </Text>
                </View>
              ) : null}

              {queueCards.map((card) => {
                const isOff = card.isActiveNow;
                const hasFuture = card.nextStartsAt != null;
                const tone = isOff
                  ? palette.status.off
                  : hasFuture
                    ? palette.status.warning
                    : palette.status.on;
                const badgeLabel = isOff
                  ? 'Триває'
                  : hasFuture
                    ? `Далі о ${card.windows.find((w) => w.state === 'soon' || w.state === 'scheduled')?.timeFrom ?? ''}`
                    : 'Завершено';

                return (
                  <View
                    key={card.queue ?? 'repair'}
                    style={{
                      backgroundColor: palette.card,
                      borderColor: card.isMine || isOff ? tone.border : palette.hairline,
                      borderWidth: 1,
                    }}
                    className="gap-2.5 rounded-2xl p-4 shadow-sm"
                  >
                    <View className="flex-row items-center justify-between">
                      <View className="flex-row items-center gap-1.5">
                        <Text className="text-sm font-bold text-foreground">
                          Черга {card.queue}
                        </Text>
                        {card.isMine ? (
                          <View
                            style={{ backgroundColor: palette.status.on.soft, borderColor: palette.status.on.border }}
                            className="rounded-full border px-2 py-0.5"
                          >
                            <Text className="text-[10px] font-bold" style={{ color: palette.status.on.text }}>
                              Моя черга
                            </Text>
                          </View>
                        ) : null}
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

                    {/* Сумарні години за день: головне число карточки, як у герої на головній */}
                    <Text className="text-xs font-semibold text-foreground">
                      Без світла за графіком: {formatMinutesUk(card.offMinutes)}
                    </Text>

                    <View className="gap-1.5">
                      {card.windows.map((window) => {
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
                  </View>
                );
              })}

              {/* Аварійні роботи: без «черги» й без обіцянки графіка — окремим блоком */}
              {repairs.length > 0 ? (
                <View className="gap-2 pt-1">
                  <Text className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Аварійні роботи ({repairs.length})
                  </Text>
                  {repairs.map((repair) => (
                    <View
                      key={repair.id}
                      style={{
                        backgroundColor: palette.card,
                        borderColor: palette.status.off.border,
                        borderWidth: 1,
                      }}
                      className="gap-1 rounded-2xl p-4"
                    >
                      <Text className="text-sm font-bold text-foreground">
                        {repair.areaName ?? currentRegionData.nameUa}
                      </Text>
                      <Text className="text-xs text-muted-foreground">
                        {repair.reason?.trim() || 'Аварійно-відновлювальні роботи'}
                      </Text>
                      <Text className="text-[11px] tabular-nums text-muted-foreground">
                        {formatTimeRange(repair.startsAt, repair.endsAt)}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}

          </Animated.View>
        </ScrollView>
      </SafeAreaView>
    </SwipeableScreen>
  );
}
