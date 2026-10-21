import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { canonicalQueueCode, queueCodeMatches, queueOptionsForGrid } from '@svitlo/core/lib/queue';

import { useTheme } from '@/theme/ThemeProvider';

const COLUMNS = 6;

interface QueueGridProps {
  regionCpu: string;
  queues: string[] | undefined;
  selected: string | null;
  /** Черги, у яких відключення йде ПРЯМО ЗАРАЗ (`isActiveNow`) */
  active: Set<string>;
  /** Черги, у яких відключення почнеться скоро (<= 30 хв) */
  soon?: Set<string>;
  /** Чи оператор опублікував графік на сьогодні */
  covered?: boolean;
  onSelect: (queue: string) => void;
}

const COLLAPSED_QUEUES = 12;

export function QueueGrid({ regionCpu, queues, selected, active, soon = new Set(), covered, onSelect }: QueueGridProps) {
  const { palette } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const options = queueOptionsForGrid(queues);
  const activeCanonical = new Set([...active].map((code) => canonicalQueueCode(regionCpu, code)));
  const soonCanonical = new Set([...soon].map((code) => canonicalQueueCode(regionCpu, code)));

  const offTone = palette.status.off;
  const warningTone = palette.status.warning;
  const onTone = palette.status.on;
  const unknownTone = palette.status.unknown;

  const selectedIndex = selected
    ? options.findIndex((queue) => queueCodeMatches(regionCpu, queue, selected))
    : -1;
  let visible = options;
  if (!expanded && options.length > COLLAPSED_QUEUES) {
    visible = options.slice(0, COLLAPSED_QUEUES);
    if (selectedIndex >= COLLAPSED_QUEUES) {
      visible = [...visible.slice(0, COLLAPSED_QUEUES - 1), options[selectedIndex]!].sort(
        (a, b) => options.indexOf(a) - options.indexOf(b),
      );
    }
  }

  const rows: string[][] = [];
  for (let index = 0; index < visible.length; index += COLUMNS) {
    rows.push(visible.slice(index, index + COLUMNS));
  }
  const cellWidth = `${100 / COLUMNS}%`;
  const lightOn = covered === true;

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
        <Text className="text-sm font-bold text-foreground">Моя черга</Text>
        {/* Компактная легенда: ● світло ◆ скоро ■ немає */}
        <View className="flex-row items-center gap-2.5">
          <View className="flex-row items-center gap-1">
            <Text className="text-[10px] font-bold text-success">●</Text>
            <Text className="text-[10px] text-muted-foreground">світло</Text>
          </View>
          <View className="flex-row items-center gap-1">
            <Text className="text-[10px] font-bold text-warning">◆</Text>
            <Text className="text-[10px] text-muted-foreground">скоро</Text>
          </View>
          <View className="flex-row items-center gap-1">
            <Text className="text-[10px] font-bold text-destructive">■</Text>
            <Text className="text-[10px] text-muted-foreground">немає</Text>
          </View>
        </View>
      </View>

      <View className="gap-1.5">
        {rows.map((row, rowIndex) => (
          <View key={rowIndex} className="flex-row">
            {row.map((queue) => {
              const canon = canonicalQueueCode(regionCpu, queue);
              const isSelected = selected != null && queueCodeMatches(regionCpu, queue, selected);
              const isOff = activeCanonical.has(canon);
              const isSoon = !isOff && soonCanonical.has(canon);

              const stateSymbol = isOff ? '■' : isSoon ? '◆' : lightOn ? '●' : '●';
              const symbolColor = isOff ? offTone.color : isSoon ? warningTone.color : lightOn ? onTone.color : unknownTone.color;

              const bgColor = isOff
                ? 'rgba(244, 63, 94, 0.18)'
                : isSoon
                  ? 'rgba(245, 158, 11, 0.18)'
                  : lightOn
                    ? 'rgba(16, 185, 129, 0.12)'
                    : palette.surfaceContainerHigh;

              const borderColor = isSelected
                ? palette.primary
                : isOff
                  ? offTone.border
                  : isSoon
                    ? warningTone.border
                    : palette.border;

              return (
                <View key={queue} style={{ width: cellWidth }} className="px-0.5">
                  <Pressable
                    onPress={() => onSelect(queue)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    style={{
                      borderColor,
                      borderWidth: isSelected ? 2 : 1,
                      backgroundColor: bgColor,
                    }}
                    className="h-11 items-center justify-center gap-0.5 rounded-xl active:opacity-75"
                  >
                    <Text
                      numberOfLines={1}
                      className="text-xs font-bold leading-none"
                      style={{
                        color: isSelected ? palette.primary : isOff ? offTone.text : isSoon ? warningTone.text : palette.foreground,
                      }}
                    >
                      {queue}
                    </Text>
                    <Text className="text-[9px] font-bold leading-none" style={{ color: symbolColor }}>
                      {stateSymbol}
                    </Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
        ))}
      </View>

      {options.length > COLLAPSED_QUEUES ? (
        <Pressable
          onPress={() => setExpanded((value) => !value)}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          className="min-h-9 flex-row items-center justify-center gap-1 rounded-xl border border-border bg-surface-container-low active:opacity-70"
        >
          <Text className="text-xs font-semibold text-foreground">
            {expanded ? 'Згорнути' : `Показати всі ${options.length} черг`}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
