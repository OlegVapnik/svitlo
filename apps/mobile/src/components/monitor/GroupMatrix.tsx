import { useMemo } from 'react';
import { Text, View } from 'react-native';
import Svg, { Defs, Line, Pattern, Rect } from 'react-native-svg';

import { generateTimelineSlots, getCurrentTimeMarker } from '@svitlo/core/lib/timeline';
import { minutesToHm, OFF_STATE_CODE } from '@svitlo/core/lib/scheduleWindow';
import { canonicalQueueCode, queueCodeMatches } from '@svitlo/core/lib/queue';
import type { GroupOutageSummary } from '@svitlo/shared';

import { useTheme } from '@/theme/ThemeProvider';

const MATRIX_GROUPS = [
  '1/1', '1/2',
  '2/1', '2/2',
  '3/1', '3/2',
  '4/1', '4/2',
  '5/1', '5/2',
  '6/1', '6/2',
];

const TIME_MARKS = [0, 6, 12, 18, 24];

interface GroupMatrixProps {
  regionCpu: string;
  selectedQueue: string | null;
  upcoming: GroupOutageSummary[];
  date: string;
  now: Date;
}

export function GroupMatrix({ regionCpu, selectedQueue, upcoming, date, now }: GroupMatrixProps) {
  const { palette } = useTheme();
  const marker = useMemo(() => getCurrentTimeMarker(date, now), [date, now]);

  // Группируем интервалы по очередям на дату
  const intervalsByQueue = useMemo(() => {
    const map = new Map<string, GroupOutageSummary>();
    for (const item of upcoming) {
      if (item.date === date) {
        map.set(canonicalQueueCode(regionCpu, item.queue), item);
      }
    }
    return map;
  }, [upcoming, date, regionCpu]);

  return (
    <View
      style={{
        backgroundColor: palette.card,
        borderColor: palette.hairline,
        borderWidth: 1,
      }}
      className="gap-3 rounded-3xl p-4 shadow-sm"
    >
      <View className="flex-row items-center justify-between">
        <Text className="text-sm font-bold text-foreground">Матриця груп 1/1 – 6/2</Text>
        {marker ? (
          <View className="flex-row items-center gap-1.5 rounded-full bg-surface-container-high px-2.5 py-1">
            <View className="h-2 w-2 rounded-full bg-white shadow-sm" />
            <Text className="text-[11px] font-bold text-foreground">Зараз {minutesToHm(marker.nowMinutes)}</Text>
          </View>
        ) : null}
      </View>

      {/* Временная шкала сверху матрицы */}
      <View className="flex-row justify-between pl-12 pr-1">
        {TIME_MARKS.map((h) => (
          <Text key={h} className="text-[10px] font-bold text-muted-foreground">
            {String(h).padStart(2, '0')}:00
          </Text>
        ))}
      </View>

      {/* Сетка полосок по всем 12 группам */}
      <View className="relative gap-1.5">
        {MATRIX_GROUPS.map((q) => {
          const canon = canonicalQueueCode(regionCpu, q);
          const isSelected = selectedQueue != null && queueCodeMatches(regionCpu, q, selectedQueue);
          const groupData = intervalsByQueue.get(canon);
          const intervals = groupData?.intervals ?? [];
          const slots = generateTimelineSlots(intervals, date, now);

          return (
            <View
              key={q}
              style={{
                backgroundColor: isSelected ? 'rgba(16, 185, 129, 0.08)' : 'transparent',
                borderColor: isSelected ? 'rgba(16, 185, 129, 0.4)' : 'transparent',
                borderWidth: isSelected ? 1 : 0,
              }}
              className="flex-row items-center rounded-xl py-0.5"
            >
              <View className="w-12 pr-2">
                <Text
                  className="text-xs font-bold"
                  style={{ color: isSelected ? palette.primary : palette.foreground }}
                >
                  {q}
                </Text>
              </View>

              <View
                style={{
                  height: 20,
                  flex: 1,
                  backgroundColor: '#0d0d11',
                  borderRadius: 6,
                  overflow: 'hidden',
                  borderColor: palette.hairline,
                  borderWidth: 0.5,
                }}
                className="flex-row gap-[0.5px]"
              >
                {slots.map((slot) => {
                  const isOff = slot.stateCode === OFF_STATE_CODE;
                  const isWarning = slot.stateCode === 2;
                  const isOn = slot.stateCode === 1;

                  return (
                    <View
                      key={slot.index}
                      style={{
                        flex: 1,
                        height: '100%',
                        backgroundColor: isOff
                          ? 'rgba(244, 63, 94, 0.75)'
                          : isWarning
                            ? 'rgba(245, 158, 11, 0.7)'
                            : isOn
                              ? 'rgba(16, 185, 129, 0.55)'
                              : '#1c1c24',
                      }}
                    />
                  );
                })}
              </View>
            </View>
          );
        })}

        {/* Общая вертикальная линия текущего времени поверх всех полосок */}
        {marker ? (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: 48 + marker.percent * 0.01 * 260, // расчет относительно полосы
              width: 2,
              backgroundColor: '#FFFFFF',
              zIndex: 20,
              shadowColor: '#FFF',
              shadowOpacity: 0.9,
              shadowRadius: 3,
            }}
          />
        ) : null}
      </View>

      <View className="flex-row items-center justify-between pt-1">
        <View className="flex-row items-center gap-3">
          <View className="flex-row items-center gap-1.5">
            <View className="h-2 w-2 rounded-full bg-success" />
            <Text className="text-[11px] text-muted-foreground">Світло</Text>
          </View>
          <View className="flex-row items-center gap-1.5">
            <View className="h-2 w-2 rounded bg-destructive" />
            <Text className="text-[11px] text-muted-foreground">Відключення</Text>
          </View>
        </View>
        <Text className="text-[11px] text-muted-foreground">
          {selectedQueue ? `Вибрана черга ${selectedQueue}` : 'Чергу не вибрано'}
        </Text>
      </View>
    </View>
  );
}
