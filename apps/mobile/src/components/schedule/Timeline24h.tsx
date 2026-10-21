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
 * 24-часовая шкала: 48 получасовых сегментов в строгом треке.
 *
 * Часы со светом — изумрудные, без света — рубиновые с диагональной SVG-штриховкой
 * (читается даже на солнце и при дальтонизме). Белая риска показывает текущую минуту
 * без нависающих плашек. Долгое протягивание пальцем открывает лупу с подсказкой и
 * щёлкает haptics на каждой получасовой границе — как колесо будильника.
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
    .minDistance(6)
    .activeOffsetX([-8, 8])
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
  // Тултип не должен вылезти за край экрана: сдвигаем его внутрь.
  const tooltipShift = scrubPercent < 14 ? 0 : scrubPercent > 86 ? -100 : -50;

  return (
    <View className="w-full gap-3">
      <View className="flex-row justify-between px-0.5">
        {HOUR_TICKS.map((hour) => (
          <Text key={hour} className="text-[11px] font-semibold text-muted-foreground">
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
              bottom: 46,
              left: `${scrubPercent}%`,
              transform: [{ translateX: tooltipShift }],
              backgroundColor: palette.surfaceContainerHighest,
              borderColor: palette.border,
              borderWidth: 1,
              borderRadius: 10,
              paddingHorizontal: 10,
              paddingVertical: 6,
              zIndex: 30,
              elevation: 8,
              minWidth: 120,
            }}
          >
            <Text className="text-[11px] font-bold text-foreground">
              {activeSlot.rangeLabel} · {activeSlot.stateName}
            </Text>
          </View>
        ) : null}

        <GestureDetector gesture={pan}>
          <View
            onLayout={onLayout}
            style={{
              height: 48,
              backgroundColor: '#0e0e12',
              borderColor: palette.hairline,
              borderWidth: 1,
              borderRadius: 16,
              padding: 6,
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
                      height: 36,
                      borderRadius: 4,
                      opacity: slot.isPast ? 0.55 : 1,
                      backgroundColor: isOff
                        ? 'rgba(244, 63, 94, 0.34)'
                        : isWarning
                          ? 'rgba(245, 158, 11, 0.26)'
                          : isOn
                            ? 'rgba(16, 185, 129, 0.24)'
                            : palette.surfaceContainerHigh,
                      borderWidth: 1,
                      borderColor: isOff
                        ? 'rgba(251, 113, 133, 0.5)'
                        : isWarning
                          ? 'rgba(251, 191, 36, 0.4)'
                          : isOn
                            ? 'rgba(52, 211, 153, 0.4)'
                            : palette.hairline,
                    }}
                  />
                );
              })}
            </View>

            {/* Одна SVG-маска штриховки поверх всех рубиновых сегментов. */}
            <Svg
              pointerEvents="none"
              style={{ position: 'absolute', left: 6, right: 6, top: 6, bottom: 6 }}
              viewBox="0 0 1440 36"
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
                  <Line x1={0} y1={0} x2={0} y2={6} stroke="rgba(255,228,230,0.3)" strokeWidth={2} strokeLinecap="round" />
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
                    height={36}
                    fill={`url(#${hatchId})`}
                  />
                ))}
            </Svg>

            {marker ? (
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  top: 6,
                  bottom: 6,
                  left: 6 + (trackWidth - 12) * (marker.percent / 100),
                  width: 2,
                  marginLeft: -1,
                  borderRadius: 2,
                  backgroundColor: 'rgba(255,255,255,0.9)',
                }}
              />
            ) : null}
          </View>
        </GestureDetector>
      </View>

      <View className="flex-row flex-wrap items-center gap-2 pt-0.5">
        <View
          className="flex-row items-center gap-1.5 rounded-full border px-2.5 py-1"
          style={{ borderColor: palette.hairline, backgroundColor: palette.surfaceContainerHigh }}
        >
          <View
            className="h-2.5 w-2.5 rounded-full border"
            style={{ borderColor: 'rgba(52,211,153,0.5)', backgroundColor: 'rgba(16,185,129,0.3)' }}
          />
          <Text className="text-[11px] font-medium text-muted-foreground">Світло є</Text>
        </View>
        <View
          className="flex-row items-center gap-1.5 rounded-full border px-2.5 py-1"
          style={{ borderColor: palette.hairline, backgroundColor: palette.surfaceContainerHigh }}
        >
          <View
            className="h-2.5 w-2.5 rounded border"
            style={{ borderColor: 'rgba(251,113,133,0.55)', backgroundColor: 'rgba(244,63,94,0.35)' }}
          />
          <Text className="text-[11px] font-medium text-muted-foreground">Відключення</Text>
        </View>
        {marker ? (
          <View className="ml-auto flex-row items-center gap-1.5">
            <View className="h-3.5 w-0.5 rounded-full bg-white/85" />
            <Text className="text-[11px] font-semibold text-foreground">Зараз {minutesToHm(marker.nowMinutes)}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}
