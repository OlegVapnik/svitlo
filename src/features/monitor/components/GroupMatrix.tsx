import React, { useMemo, useState } from 'react';
import { Pressable, useWindowDimensions, View } from 'react-native';
import { Text } from '@/components/ui/AppText';
import { Pin } from 'lucide-react-native';

import { generateTimelineSlots, getCurrentTimeMarker } from '@svitlo/core/lib/timeline';
import { formatMinutesUk, OFF_STATE_CODE } from '@svitlo/core/lib/scheduleWindow';
import { canonicalQueueCode, queueCodeMatches } from '@svitlo/core/lib/queue';
import type { GroupOutageSummary, ScheduleIntervalUtc } from '@svitlo/shared';

import { triggerSoftHaptic } from '@/lib/haptics';
import { useTheme, type Palette } from '@/theme/ThemeProvider';

const DEFAULT_12_GROUPS = [
  '1/1', '1/2',
  '2/1', '2/2',
  '3/1', '3/2',
  '4/1', '4/2',
  '5/1', '5/2',
  '6/1', '6/2',
];

const TIME_MARKS = [0, 6, 12, 18, 24];
const QUEUE_COL_WIDTH = 48;
const TOTAL_COL_WIDTH = 92;

/**
 * Фіксовані колонки матриці масштабуються разом із системним шрифтом: інакше
 * «4/2» і «−7 год 30 хв» перестають вміщатися і ріжуться трьома крапками.
 * Обмежуємо 1.6×, щоб шкала 24 годин у центрі не зникла зовсім.
 */
function matrixColWidths(fontScale: number): { queue: number; total: number } {
  const scale = Math.min(Math.max(fontScale, 1), 1.6);
  return {
    queue: Math.round(QUEUE_COL_WIDTH * scale),
    total: Math.round(TOTAL_COL_WIDTH * scale),
  };
}

interface GroupMatrixProps {
  regionCpu: string;
  selectedQueue: string | null;
  upcoming: GroupOutageSummary[];
  date: string;
  today: string;
  now: Date;
  selectedDay: 'today' | 'tomorrow';
  onSelectDay: (day: 'today' | 'tomorrow') => void;
  availableQueues?: string[];
  onSelectQueue?: (queue: string) => void;
}

interface MatrixRowItemProps {
  queue: string;
  isSelected: boolean;
  intervals: ScheduleIntervalUtc[];
  date: string;
  today: string;
  now: Date;
  palette: Palette;
  queueColWidth: number;
  totalColWidth: number;
  onSelect?: (queue: string) => void;
}

const MatrixRowItem = React.memo(function MatrixRowItem({
  queue,
  isSelected,
  intervals,
  date,
  today,
  now,
  palette,
  queueColWidth,
  totalColWidth,
  onSelect,
}: MatrixRowItemProps) {
  const slots = useMemo(() => generateTimelineSlots(intervals, date, now), [intervals, date, now]);

  const { offMinutes, state } = useMemo(() => {
    const offSlots = slots.filter((s) => s.stateCode === OFF_STATE_CODE).length;
    const current = slots.find((s) => s.isCurrent);
    let st: 'off' | 'on' | 'warning' | 'unknown' = 'unknown';
    if (intervals.length > 0) {
      if (current?.stateCode === OFF_STATE_CODE) st = 'off';
      else if (current?.stateCode === 2) st = 'warning';
      else if (current?.stateCode === 1) st = 'on';
    }
    return { offMinutes: offSlots * 30, state: st };
  }, [slots, intervals.length]);

  const isOffNow = date === today && state === 'off';

  const statusColor =
    state === 'off'
      ? palette.destructive
      : state === 'warning'
        ? palette.warning
        : state === 'on'
          ? palette.primary
          : palette.unknown;

  const offText = offMinutes > 0 ? `−${formatMinutesUk(offMinutes)}` : '0 хв';

  return (
    <Pressable
      onPress={() => {
        triggerSoftHaptic();
        onSelect?.(queue);
      }}
      style={{
        backgroundColor: isSelected ? 'rgba(16, 185, 129, 0.08)' : 'transparent',
        borderColor: isSelected ? 'rgba(16, 185, 129, 0.45)' : 'transparent',
        borderWidth: 1,
      }}
      className="flex-row items-center rounded-xl py-0.5 px-1 active:opacity-80"
    >
      {/* Назва черги + іконка Pin для вибраної (щоб не з'їдала ширину тексту) */}
      <View style={{ width: queueColWidth }} className="items-center justify-center">
        {isSelected ? (
          <View style={{ position: 'absolute', left: -2 }}>
            <Pin size={10} color={palette.primary} />
          </View>
        ) : null}
        <Text
          numberOfLines={1}
          className="text-xs font-bold"
          style={{
            width: '100%',
            textAlign: 'center',
            includeFontPadding: false,
            letterSpacing: 0,
            color: isOffNow
              ? palette.destructive
              : isSelected
                ? palette.primary
                : palette.foreground,
          }}
        >
          {queue}
        </Text>
      </View>

      {/* Шкала 48 півгодинних слотів доби (як на головній) */}
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

      {/* Колонка «Без світла» + статусний кружечок */}
      <View
        style={{ width: totalColWidth, flexShrink: 0 }}
        className="flex-row items-center justify-end gap-1"
      >
        <Text
          numberOfLines={1}
          style={{
            color: offMinutes > 0 ? palette.destructive : palette.primary,
            fontWeight: '700',
            includeFontPadding: false,
            letterSpacing: 0,
            flexShrink: 1,
          }}
          className="text-[11px] tabular-nums"
        >
          {offText}
        </Text>
        <View
          style={{
            width: 6.5,
            height: 6.5,
            borderRadius: 9999,
            backgroundColor: statusColor,
          }}
        />
      </View>
    </Pressable>
  );
});

export function GroupMatrix({
  regionCpu,
  selectedQueue,
  upcoming,
  date,
  today,
  now,
  selectedDay,
  onSelectDay,
  availableQueues,
  onSelectQueue,
}: GroupMatrixProps) {
  const { palette } = useTheme();
  const { fontScale } = useWindowDimensions();
  const cols = matrixColWidths(fontScale);
  const [trackWidth, setTrackWidth] = useState(0);

  // Скільки підписів «00:00» реально вміщає шкала при поточному системному шрифті.
  // Раніше всі п'ять малювалися абсолютно й при fontScale 2.0 злипалися в «00:0006:0012:00».
  // Коли навіть два повні підписи не влазять — лишаємо короткі «0» і «24».
  const timeScale = useMemo(() => {
    const labelWidth = 34 * Math.min(Math.max(fontScale, 1), 2);
    const slots = trackWidth > 0 ? Math.floor(trackWidth / (labelWidth * 1.15)) : TIME_MARKS.length;
    if (trackWidth > 0 && trackWidth < labelWidth * 2 * 1.3) {
      return { marks: [0, 24], compact: true, labelWidth: labelWidth / 2 };
    }
    if (slots >= TIME_MARKS.length) return { marks: TIME_MARKS, compact: false, labelWidth };
    if (slots >= 3) return { marks: [0, 12, 24], compact: false, labelWidth };
    return { marks: [0, 24], compact: false, labelWidth };
  }, [fontScale, trackWidth]);

  const marker = useMemo(
    () => (date === today ? getCurrentTimeMarker(date, now) : null),
    [date, today, now],
  );

  // Групуємо інтервали по чергах на обрану дату
  const intervalsByQueue = useMemo(() => {
    const map = new Map<string, GroupOutageSummary>();
    for (const item of upcoming) {
      if (item.date === date) {
        map.set(canonicalQueueCode(regionCpu, item.queue), item);
      }
    }
    return map;
  }, [upcoming, date, regionCpu]);

  // Перелік груп для відображення
  const groupsToDisplay = useMemo(() => {
    if (availableQueues && availableQueues.length > 0) {
      return availableQueues;
    }
    const fromUpcoming = Array.from(
      new Set(
        upcoming
          .filter((item) => item.date === date)
          .map((item) => item.queue),
      ),
    ).sort((a, b) => {
      const numA = parseInt(a, 10);
      const numB = parseInt(b, 10);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      return a.localeCompare(b);
    });

    return fromUpcoming.length > 0 ? fromUpcoming : DEFAULT_12_GROUPS;
  }, [availableQueues, upcoming, date]);

  return (
    <View
      style={{
        backgroundColor: palette.card,
        borderColor: palette.hairline,
        borderWidth: 1,
      }}
      className="gap-3 rounded-3xl p-4 shadow-sm"
    >
      {/* Шапка: обрана черга та перемикач Сьогодні | Завтра */}
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-2">
          {selectedQueue ? (
            <View
              style={{
                backgroundColor: 'rgba(16, 185, 129, 0.12)',
                borderColor: 'rgba(16, 185, 129, 0.35)',
                borderWidth: 1,
              }}
              className="flex-row items-center gap-1 rounded-full px-2.5 py-0.5"
            >
              <Pin size={10} color={palette.primary} />
              <Text className="text-[11px] font-bold" style={{ color: palette.primary }}>
                Черга {selectedQueue}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Пилюльний перемикач Сьогодні | Завтра */}
        <View
          style={{ backgroundColor: palette.surfaceContainerHigh }}
          className="flex-row rounded-xl p-0.5"
        >
          <Pressable
            onPress={() => {
              if (selectedDay !== 'today') {
                triggerSoftHaptic();
                onSelectDay('today');
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
                onSelectDay('tomorrow');
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

      {/* Шкала часу */}
      <View className="flex-row items-center px-1">
        <View style={{ width: cols.queue }} />
        <View
          style={{ flex: 1, height: 16, position: 'relative' }}
          onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
        >
          {timeScale.marks.map((h) => {
            const leftPercent = (h / 24) * 100;
            const labelWidth = timeScale.labelWidth;
            return (
              <Text
                key={h}
                className="absolute text-[10px] font-bold text-muted-foreground"
                style={
                  h === 0
                    ? { left: 0, width: labelWidth, textAlign: 'left' }
                    : h === 24
                      ? { right: 0, width: labelWidth, textAlign: 'right' }
                      : {
                          left: `${leftPercent}%`,
                          width: labelWidth,
                          textAlign: 'center',
                          transform: [{ translateX: -labelWidth / 2 }],
                        }
                }
              >
                {timeScale.compact ? String(h) : `${String(h).padStart(2, '0')}:00`}
              </Text>
            );
          })}
        </View>
        <View style={{ width: cols.total }} className="items-end pl-2">
          <Text className="text-[10px] font-bold text-muted-foreground">Без світла</Text>
        </View>
      </View>

      {/* Сітка рядків по всіх групах */}
      <View className="relative gap-1.5 px-1">
        {groupsToDisplay.map((q) => {
          const canon = canonicalQueueCode(regionCpu, q);
          const isSelected = selectedQueue != null && queueCodeMatches(regionCpu, q, selectedQueue);
          const groupData = intervalsByQueue.get(canon) ?? intervalsByQueue.get(q);
          const intervals = groupData?.intervals ?? [];

          return (
            <MatrixRowItem
              key={q}
              queue={q}
              isSelected={isSelected}
              intervals={intervals}
              date={date}
              today={today}
              now={now}
              palette={palette}
              queueColWidth={cols.queue}
              totalColWidth={cols.total}
              onSelect={onSelectQueue}
            />
          );
        })}

        {/* Вертикальна лінія поточного часу (тільки для сьогодні) */}
        {marker && trackWidth > 0 ? (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: cols.queue + (marker.percent / 100) * trackWidth,
              width: 1.5,
              backgroundColor: palette.primary,
              zIndex: 20,
              shadowColor: palette.primary,
              shadowOpacity: 0.9,
              shadowRadius: 3,
            }}
          />
        ) : null}
      </View>
    </View>
  );
}
