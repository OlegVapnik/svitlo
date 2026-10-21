import { useId, useMemo, useRef, useState } from 'react';
import { LayoutChangeEvent, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import Svg, { Defs, Line, Pattern, Rect } from 'react-native-svg';

import { generateTimelineSlots, getCurrentTimeMarker } from '@svitlo/core/lib/timeline';
import { minutesToHm, OFF_STATE_CODE } from '@svitlo/core/lib/scheduleWindow';
import type { ScheduleIntervalUtc } from '@svitlo/shared';

import { useTheme } from '@/theme/ThemeProvider';

const HOUR_TICKS = [0, 4, 8, 12, 16, 20, 24];

type ScrubPoint = { minute: number; slotIndex: number };

interface Timeline24hProps {
  intervals: ScheduleIntervalUtc[];
  date: string;
  now?: Date;
}

/**
 * 24-часовая шкала: 48 получасовых сегментов с интерактивным scrubbing жестом (рулетка времени),
 * тактильным откликом Haptics.selectionAsync() на каждом 30-минутном шаге и диагональной штриховкой.
 */
export function Timeline24h({ intervals, date, now = new Date() }: Timeline24hProps) {
  const { palette } = useTheme();
  const hatchId = `hatch-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const slots = useMemo(() => generateTimelineSlots(intervals, date, now), [intervals, date, now]);
  const marker = useMemo(() => getCurrentTimeMarker(date, now), [date, now]);

  const [trackWidth, setTrackWidth] = useState(0);
  const [scrub, setScrub] = useState<ScrubPoint | null>(null);
  const lastHalf = useRef<number | null>(null);

  const onLayout = (event: LayoutChangeEvent) => setTrackWidth(event.nativeEvent.layout.width);

  const pointForX = (x: number): ScrubPoint | null => {
    if (trackWidth <= 0) return null;
    const ratio = Math.max(0, Math.min(1, x / trackWidth));
    const minute = Math.round((ratio * 1440) / 30) * 30;
    return { minute: Math.min(1440, minute), slotIndex: Math.min(47, Math.floor(minute / 30)) };
  };

  const pan = Gesture.Pan()
    .runOnJS(true)
    .minDistance(4)
    .activeOffsetX([-6, 6])
    .failOffsetY([-12, 12])
    .onBegin((event) => {
      const point = pointForX(event.x);
      if (!point) return;
      lastHalf.current = point.minute;
      setScrub(point);
      void Haptics.selectionAsync();
    })
    .onUpdate((event) => {
      const point = pointForX(event.x);
      if (!point) return;
      if (point.minute !== lastHalf.current) {
        lastHalf.current = point.minute;
        void Haptics.selectionAsync();
      }
      setScrub(point);
    })
    .onFinalize(() => {
      lastHalf.current = null;
      setScrub(null);
    });

  const activeSlot = scrub ? slots[scrub.slotIndex] : null;
  const scrubPercent = scrub ? (scrub.minute / 1440) * 100 : 0;
  const tooltipShift = scrubPercent < 16 ? 0 : scrubPercent > 84 ? -100 : -50;

  return (
    <View className="w-full gap-2.5">
      <View className="flex-row justify-between px-0.5">
        {HOUR_TICKS.map((hour) => (
          <Text key={hour} className="text-[10px] font-semibold text-muted-foreground">
            {String(hour).padStart(2, '0')}:00
          </Text>
        ))}
      </View>

      <View className="relative">
        {scrub && activeSlot ? (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              bottom: 50,
              left: `${scrubPercent}%`,
              transform: [{ translateX: tooltipShift }],
              backgroundColor: '#1b1b22',
              borderColor: activeSlot.stateCode === 3 ? '#F43F5E' : activeSlot.stateCode === 2 ? '#F59E0B' : '#10B981',
              borderWidth: 1.5,
              borderRadius: 12,
              paddingHorizontal: 12,
              paddingVertical: 7,
              zIndex: 30,
              elevation: 10,
              shadowColor: '#000',
              shadowOpacity: 0.5,
              shadowRadius: 8,
              minWidth: 130,
            }}
          >
            <Text className="text-center text-xs font-bold text-foreground">
              {activeSlot.rangeLabel}
            </Text>
            <Text
              className="text-center text-[11px] font-semibold"
              style={{
                color: activeSlot.stateCode === 3 ? '#FB7185' : activeSlot.stateCode === 2 ? '#FBBF24' : '#34D399',
              }}
            >
              {activeSlot.stateCode === 3 ? '■ Відключення' : activeSlot.stateCode === 2 ? '◆ Скоро вимкнення' : '● Світло є'}
            </Text>
          </View>
        ) : null}

        <GestureDetector gesture={pan}>
          <View
            onLayout={onLayout}
            style={{
              height: 48,
              backgroundColor: '#0c0c10',
              borderColor: palette.hairline,
              borderWidth: 1,
              borderRadius: 16,
              padding: 5,
            }}
          >
            <View className="flex-1 flex-row gap-[1px] overflow-hidden rounded-lg">
              {slots.map((slot) => {
                const isOff = slot.stateCode === OFF_STATE_CODE;
                const isWarning = slot.stateCode === 2;
                const isOn = slot.stateCode === 1;
                return (
                  <View
                    key={slot.index}
                    style={{
                      flex: 1,
                      height: 38,
                      borderRadius: 3.5,
                      opacity: slot.isPast ? 0.5 : 1,
                      backgroundColor: isOff
                        ? 'rgba(244, 63, 94, 0.42)'
                        : isWarning
                          ? 'rgba(245, 158, 11, 0.35)'
                          : isOn
                            ? 'rgba(16, 185, 129, 0.28)'
                            : palette.surfaceContainerHigh,
                      borderWidth: 1,
                      borderColor: isOff
                        ? 'rgba(244, 63, 94, 0.65)'
                        : isWarning
                          ? 'rgba(245, 158, 11, 0.6)'
                          : isOn
                            ? 'rgba(16, 185, 129, 0.45)'
                            : palette.hairline,
                    }}
                  />
                );
              })}
            </View>

            {/* SVG-штриховка рубиновых сегментов отключений */}
            <Svg
              pointerEvents="none"
              style={{ position: 'absolute', left: 5, right: 5, top: 5, bottom: 5 }}
              viewBox="0 0 1440 38"
              preserveAspectRatio="none"
            >
              <Defs>
                <Pattern
                  id={hatchId}
                  width={6}
                  height={6}
                  patternUnits="userSpaceOnUse"
                  patternTransform="rotate(45)"
                >
                  <Line x1={0} y1={0} x2={0} y2={6} stroke="rgba(255,228,230,0.35)" strokeWidth={1.8} strokeLinecap="round" />
                </Pattern>
              </Defs>
              {slots
                .filter((slot) => slot.stateCode === OFF_STATE_CODE)
                .map((slot) => (
                  <Rect
                    key={slot.index}
                    x={slot.startMinutes}
                    y={0}
                    width={30}
                    height={38}
                    fill={`url(#${hatchId})`}
                  />
                ))}
            </Svg>

            {marker ? (
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  top: 4,
                  bottom: 4,
                  left: 5 + (trackWidth - 10) * (marker.percent / 100),
                  width: 2.5,
                  marginLeft: -1.25,
                  borderRadius: 2,
                  backgroundColor: '#FFFFFF',
                  shadowColor: '#FFF',
                  shadowOpacity: 0.8,
                  shadowRadius: 4,
                }}
              />
            ) : null}
          </View>
        </GestureDetector>
      </View>

      {/* Легенда статусов шкалы с символами */}
      <View className="flex-row flex-wrap items-center justify-between gap-1.5 pt-1">
        <View className="flex-row items-center gap-3">
          <View className="flex-row items-center gap-1.5">
            <Text className="text-xs font-bold text-success">●</Text>
            <Text className="text-[11px] font-medium text-muted-foreground">Світло</Text>
          </View>
          <View className="flex-row items-center gap-1.5">
            <Text className="text-xs font-bold text-warning">◆</Text>
            <Text className="text-[11px] font-medium text-muted-foreground">Скоро</Text>
          </View>
          <View className="flex-row items-center gap-1.5">
            <Text className="text-xs font-bold text-destructive">■</Text>
            <Text className="text-[11px] font-medium text-muted-foreground">Відключення</Text>
          </View>
        </View>

        {marker ? (
          <View className="flex-row items-center gap-1">
            <View className="h-3 w-0.5 rounded-full bg-white" />
            <Text className="text-[11px] font-bold text-foreground">Зараз {minutesToHm(marker.nowMinutes)}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}
