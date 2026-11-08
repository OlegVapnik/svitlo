import { useMemo } from 'react';
import { View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Text } from '@/components/ui/AppText';
import { useTheme } from '@/theme/ThemeProvider';
import type { ScheduleIntervalUtc } from '@svitlo/shared';

interface WindowSlot {
  startMinutes: number;
  endMinutes: number;
  durationMinutes: number;
  startTime: string;
  endTime: string;
  isPast: boolean;
  isCurrent: boolean;
}

interface SmartWindowAdvisorProps {
  queue: string;
  intervals: ScheduleIntervalUtc[];
  todayDate: string;
  now: Date;
  allClear?: boolean;
}

function parseTimeToMinutes(timeStr: string): number {
  const [h, m] = timeStr.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function formatMinutesToTime(mins: number): string {
  const clamped = Math.max(0, Math.min(1440, mins));
  if (clamped >= 1440) return '24:00';
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function SmartWindowAdvisor({
  queue,
  intervals,
  todayDate,
  now,
  allClear = false,
}: SmartWindowAdvisorProps) {
  const { palette } = useTheme();

  const kyivNowMinutes = useMemo(() => {
    try {
      const kyivTimeStr = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Kyiv',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(now);
      return parseTimeToMinutes(kyivTimeStr);
    } catch {
      return now.getHours() * 60 + now.getMinutes();
    }
  }, [now]);

  // Обчислення вільних слотів (зі світлом) протягом доби
  const lightWindows = useMemo<WindowSlot[]>(() => {
    if (allClear || intervals.length === 0) {
      return [
        {
          startMinutes: 0,
          endMinutes: 1440,
          durationMinutes: 1440,
          startTime: '00:00',
          endTime: '24:00',
          isPast: false,
          isCurrent: true,
        },
      ];
    }

    const outageRanges = intervals
      .map((it) => {
        const start = it.localTimeFrom ? parseTimeToMinutes(it.localTimeFrom) : 0;
        const end = it.localTimeTo
          ? (it.localTimeTo === '00:00' ? 1440 : parseTimeToMinutes(it.localTimeTo))
          : 0;
        return { start, end };
      })
      .filter((r) => r.end > r.start)
      .sort((a, b) => a.start - b.start);

    const mergedOutages: Array<{ start: number; end: number }> = [];
    for (const r of outageRanges) {
      if (mergedOutages.length === 0) {
        mergedOutages.push(r);
      } else {
        const last = mergedOutages[mergedOutages.length - 1];
        if (last && r.start <= last.end) {
          last.end = Math.max(last.end, r.end);
        } else {
          mergedOutages.push(r);
        }
      }
    }

    const freeSlots: WindowSlot[] = [];
    let currentMin = 0;

    for (const out of mergedOutages) {
      if (out.start > currentMin) {
        const dur = out.start - currentMin;
        if (dur >= 30) {
          freeSlots.push({
            startMinutes: currentMin,
            endMinutes: out.start,
            durationMinutes: dur,
            startTime: formatMinutesToTime(currentMin),
            endTime: formatMinutesToTime(out.start),
            isPast: out.start <= kyivNowMinutes,
            isCurrent: currentMin <= kyivNowMinutes && kyivNowMinutes < out.start,
          });
        }
      }
      currentMin = Math.max(currentMin, out.end);
    }

    if (currentMin < 1440) {
      const dur = 1440 - currentMin;
      if (dur >= 30) {
        freeSlots.push({
          startMinutes: currentMin,
          endMinutes: 1440,
          durationMinutes: dur,
          startTime: formatMinutesToTime(currentMin),
          endTime: '24:00',
          isPast: 1440 <= kyivNowMinutes,
          isCurrent: currentMin <= kyivNowMinutes,
        });
      }
    }

    return freeSlots;
  }, [intervals, allClear, kyivNowMinutes]);

  const activeWindow = lightWindows.find((w) => w.isCurrent);
  const nextWindow = lightWindows.find((w) => !w.isPast && !w.isCurrent);
  const longestWindow = useMemo(() => {
    if (lightWindows.length === 0) return null;
    return [...lightWindows].sort((a, b) => b.durationMinutes - a.durationMinutes)[0];
  }, [lightWindows]);

  const totalLightMinutes = useMemo(
    () => lightWindows.reduce((acc, w) => acc + w.durationMinutes, 0),
    [lightWindows],
  );
  const totalLightHours = (totalLightMinutes / 60).toFixed(1).replace('.0', '');

  return (
    <View
      style={{
        backgroundColor: palette.card,
        borderColor: palette.hairline,
        borderWidth: 1,
      }}
      className="flex-col gap-3 rounded-3xl p-4 shadow-sm"
    >
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-2">
          <Ionicons name="sparkles-outline" size={16} color={palette.primary} />
          <Text className="text-sm font-bold text-foreground">Розумний радник вікон зі світлом</Text>
        </View>

        <View className="rounded-full bg-primary/10 px-2 py-0.5">
          <Text className="text-2xs font-semibold text-primary">{totalLightHours} год зі світлом</Text>
        </View>
      </View>

      {/* Найдовше вікно для побутової техніки */}
      {longestWindow ? (
        <View className="flex-col gap-1.5 rounded-2xl bg-surface-container-high/60 p-3">
          <View className="flex-row items-center justify-between">
            <Text className="text-xs font-semibold text-muted-foreground">Найдовше вікно доби:</Text>
            <Text className="text-xs font-bold text-emerald-400">
              {longestWindow.startTime} — {longestWindow.endTime} (
              {Math.floor(longestWindow.durationMinutes / 60)} год{' '}
              {longestWindow.durationMinutes % 60 ? `${longestWindow.durationMinutes % 60} хв` : ''})
            </Text>
          </View>

          {/* Рекомендовані прилади */}
          <View className="flex-row flex-wrap items-center gap-1.5 pt-1">
            <View className="flex-row items-center gap-1 rounded-lg bg-surface-container-low px-2 py-1">
              <Ionicons name="battery-charging-outline" size={11} color={palette.foreground} />
              <Text className="text-2xs font-medium text-foreground">Зарядна станція</Text>
            </View>
            <View className="flex-row items-center gap-1 rounded-lg bg-surface-container-low px-2 py-1">
              <Ionicons name="water-outline" size={11} color={palette.foreground} />
              <Text className="text-2xs font-medium text-foreground">Бойлер</Text>
            </View>
            <View className="flex-row items-center gap-1 rounded-lg bg-surface-container-low px-2 py-1">
              <Ionicons name="refresh-outline" size={11} color={palette.foreground} />
              <Text className="text-2xs font-medium text-foreground">Пральна машина</Text>
            </View>
          </View>
        </View>
      ) : null}

      {/* Наступне вікно зі світлом */}
      {activeWindow ? (
        <View className="flex-row items-center justify-between border-t border-hairline/60 pt-2">
          <View className="flex-row items-center gap-1.5">
            <Ionicons name="sunny-outline" size={13} color="#10b981" />
            <Text className="text-xs font-medium text-foreground">Зараз триває вікно зі світлом:</Text>
          </View>
          <Text className="text-xs font-bold text-emerald-400">до {activeWindow.endTime}</Text>
        </View>
      ) : nextWindow ? (
        <View className="flex-row items-center justify-between border-t border-hairline/60 pt-2">
          <View className="flex-row items-center gap-1.5">
            <Ionicons name="time-outline" size={13} color={palette.mutedForeground} />
            <Text className="text-xs font-medium text-foreground">Наступне ввімкнення світла:</Text>
          </View>
          <Text className="text-xs font-bold text-primary">
            {nextWindow.startTime} — {nextWindow.endTime}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
