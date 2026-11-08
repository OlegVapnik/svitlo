import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Text } from '@/components/ui/AppText';
import { useRegionHistory } from '@svitlo/core/api/queries';
import { formatQueueLabel } from '@svitlo/core/lib/queue-label';
import { useTheme } from '@/theme/ThemeProvider';
import { triggerSoftHaptic } from '@/lib/haptics';

interface QueueFairnessCardProps {
  regionCpu: string;
  activeQueue: string | null;
  availableQueues: string[];
}

type Period = '1' | '7' | '14';

export function QueueFairnessCard({
  regionCpu,
  activeQueue,
  availableQueues,
}: QueueFairnessCardProps) {
  const { palette } = useTheme();
  const [period, setPeriod] = useState<Period>('7');

  const daysCount = period === '1' ? 1 : period === '7' ? 7 : 14;
  const { data: historyResponse } = useRegionHistory(regionCpu, 14);

  const stats = useMemo(() => {
    const rawHistory = historyResponse?.data ?? [];
    const sliced = rawHistory.slice(0, daysCount);

    if (sliced.length === 0 || availableQueues.length === 0) {
      return null;
    }

    const queueTotals: Record<string, number> = {};
    for (const q of availableQueues) {
      queueTotals[q] = 0;
    }

    let avgSum = 0;
    for (const day of sliced) {
      avgSum += day.avgMinutes || 0;
      const byQ = day.byQueueMinutes || {};
      for (const q of availableQueues) {
        const mins = typeof byQ[q] === 'number' ? byQ[q] : (day.avgMinutes || 0);
        queueTotals[q] = (queueTotals[q] || 0) + mins;
      }
    }

    const avgMinutes = Math.round(avgSum / Math.max(1, sliced.length));
    const activeTotal = activeQueue ? (queueTotals[activeQueue] ?? avgMinutes * sliced.length) : null;
    const activeAvg = activeTotal != null ? Math.round(activeTotal / Math.max(1, sliced.length)) : null;

    const ranking = Object.entries(queueTotals)
      .map(([q, total]) => ({ queue: q, avgPerDay: Math.round(total / Math.max(1, sliced.length)) }))
      .sort((a, b) => a.avgPerDay - b.avgPerDay);

    const activeRankIndex = activeQueue ? ranking.findIndex((r) => r.queue === activeQueue) : -1;
    const rankPosition = activeRankIndex >= 0 ? activeRankIndex + 1 : null;

    const deltaMinutes = activeAvg != null ? activeAvg - avgMinutes : 0;
    const isMilder = deltaMinutes < -15;
    const isHarder = deltaMinutes > 15;

    return {
      avgMinutes,
      activeAvg,
      deltaMinutes,
      isMilder,
      isHarder,
      ranking,
      rankPosition,
      totalQueues: ranking.length,
      daysSampled: sliced.length,
    };
  }, [historyResponse, availableQueues, activeQueue, daysCount]);

  if (!stats) return null;

  return (
    <View
      style={{
        backgroundColor: palette.card,
        borderColor: palette.hairline,
        borderWidth: 1,
      }}
      className="flex-col gap-3 rounded-3xl p-4 shadow-sm"
    >
      {/* Шапка з перемикачем днів */}
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-1.5 shrink">
          <Ionicons name="scale-outline" size={16} color={palette.primary} />
          <Text className="text-sm font-bold text-foreground">Справедливість черг</Text>
        </View>

        <View className="flex-row items-center rounded-xl bg-surface-container-high/60 p-0.5">
          {(['1', '7', '14'] as const).map((p) => {
            const active = period === p;
            return (
              <Pressable
                key={p}
                onPress={() => {
                  triggerSoftHaptic();
                  setPeriod(p);
                }}
                className={
                  active
                    ? 'rounded-lg bg-primary px-2 py-0.5'
                    : 'rounded-lg px-2 py-0.5'
                }
              >
                <Text
                  className={
                    active
                      ? 'text-2xs font-bold text-on-primary'
                      : 'text-2xs font-medium text-muted-foreground'
                  }
                >
                  {p === '1' ? '1 день' : `${p} днів`}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Аналітичний дельта-бейдж */}
      {activeQueue && stats.activeAvg != null ? (
        <View className="flex-col gap-2 rounded-2xl bg-surface-container-high/60 p-3">
          <View className="flex-row items-center justify-between">
            <Text className="text-xs font-semibold text-foreground">
              Черга {formatQueueLabel(activeQueue)}:
            </Text>
            {stats.rankPosition != null ? (
              <View className="flex-row items-center gap-1 rounded-full bg-surface-container-low px-2 py-0.5">
                <Ionicons name="trophy-outline" size={11} color={palette.primary} />
                <Text className="text-2xs font-semibold text-primary">
                  {stats.rankPosition}-а з {stats.totalQueues} за мʼякістю
                </Text>
              </View>
            ) : null}
          </View>

          <View className="flex-row items-center justify-between pt-1">
            <Text className="text-2xs text-muted-foreground">
              Середньодобове відключення:
            </Text>
            <Text className="text-xs font-bold text-foreground">
              {(stats.activeAvg / 60).toFixed(1)} год / день
            </Text>
          </View>

          <View className="flex-row items-center justify-between border-t border-hairline/60 pt-1.5">
            <Text className="text-2xs text-muted-foreground">
              Порівняно з іншими чергами:
            </Text>
            <Text
              className={
                stats.isMilder
                  ? 'text-xs font-bold text-emerald-400'
                  : stats.isHarder
                    ? 'text-xs font-bold text-rose-400'
                    : 'text-xs font-bold text-muted-foreground'
              }
            >
              {stats.isMilder
                ? `на ${(Math.abs(stats.deltaMinutes) / 60).toFixed(1)} год менше відключень`
                : stats.isHarder
                  ? `на ${(stats.deltaMinutes / 60).toFixed(1)} год більше відключень`
                  : 'на рівні середнього по області'}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}
