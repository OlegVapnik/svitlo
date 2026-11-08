import { useState } from 'react';
import { Pressable, useWindowDimensions, View } from 'react-native';
import { Text } from '@/components/ui/AppText';

import {
  canonicalQueueCode,
  collapsedQueueOptions,
  queueCellState,
  queueCodeMatches,
  queueOptionsForGrid,
} from '@svitlo/core/lib/queue';

import { useTheme } from '@/theme/ThemeProvider';
import { triggerSoftHaptic } from '@/lib/haptics';

const COLUMNS = 6;

interface QueueGridProps {
  regionCpu: string;
  queues: string[] | undefined;
  selected: string | null;
  /** Черги, у яких відключення йде ПРЯМО ЗАРАЗ (`isActiveNow`) */
  active: Set<string>;
  /** Черги, у яких відключення почнеться скоро (<= 30 хв) */
  soon?: Set<string>;
  /** Чи оператор опублікував графік на сьогодні: boolean або Set канонічних кодів черг */
  covered?: boolean | Set<string>;
  onSelect: (queue: string) => void;
}

const COLLAPSED_QUEUES = 12;

export function QueueGrid({ regionCpu, queues, selected, active, soon = new Set(), covered, onSelect }: QueueGridProps) {
  const { palette } = useTheme();
  const { fontScale } = useWindowDimensions();
  // Шість колонок при fontScale ≥ 1.5 не вміщають «12/3»: зменшуємо кількість
  // колонок, щоб коди черг лишалися повними, а не «4…».
  const columns = fontScale >= 1.5 ? 4 : fontScale >= 1.25 ? 5 : COLUMNS;
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
  const visible = expanded ? options : collapsedQueueOptions(options, selectedIndex, COLLAPSED_QUEUES);

  const rows: string[][] = [];
  for (let index = 0; index < visible.length; index += columns) {
    rows.push(visible.slice(index, index + columns));
  }

  // Покриття може бути як «уся область», так і набором конкретних черг: коли оператор
  // опублікував графік лише для частини груп, регіональний прапорець false, і плитки
  // груп зі світлом без цієї перевірки ставали сірими.
  const isCoveredQueue = (queue: string, canon: string): boolean => {
    if (covered instanceof Set) return covered.has(canon) || covered.has(queue);
    return covered === true;
  };

  return (
    <View
      style={{
        backgroundColor: palette.card,
        borderColor: palette.hairline,
        borderWidth: 1,
      }}
      className="gap-3 rounded-3xl p-4 shadow-sm"
    >
      <View className="flex-row flex-wrap items-center justify-between gap-y-1">
        <Text className="text-sm font-bold text-foreground">Моя черга</Text>
        {/* Компактная легенда: ● світло ◆ скоро ■ немає. flexWrap — щоб при
            fontScale 2.0 «немає» переходило на новий рядок, а не за картку. */}
        <View className="flex-row flex-wrap items-center gap-2.5">
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
          <View key={rowIndex} className="flex-row gap-1">
            {row.map((queue) => {
              const canon = canonicalQueueCode(regionCpu, queue);
              const isSelected = selected != null && queueCodeMatches(regionCpu, queue, selected);
              const isOff = activeCanonical.has(canon);
              const isSoon = !isOff && soonCanonical.has(canon);

              const cellState = queueCellState({ isOff, isSoon, covered: isCoveredQueue(queue, canon) });
              const stateSymbol = cellState === 'off' ? '■' : cellState === 'soon' ? '◆' : '●';
              const symbolColor =
                cellState === 'off'
                  ? offTone.color
                  : cellState === 'soon'
                    ? warningTone.color
                    : cellState === 'on'
                      ? onTone.color
                      : unknownTone.color;

              // Фоновые цвета и бордеры: выбранная черга подсвечивается рамкой в цвет своего статуса
              const bgColor =
                cellState === 'off'
                  ? isSelected
                    ? 'rgba(244, 63, 94, 0.30)'
                    : 'rgba(244, 63, 94, 0.22)'
                  : cellState === 'soon'
                    ? isSelected
                      ? 'rgba(245, 158, 11, 0.30)'
                      : 'rgba(245, 158, 11, 0.22)'
                    : cellState === 'on'
                      ? isSelected
                        ? 'rgba(16, 185, 129, 0.26)'
                        : 'rgba(16, 185, 129, 0.18)'
                      : isSelected
                        ? 'rgba(39, 39, 42, 0.85)'
                        : 'rgba(39, 39, 42, 0.6)';

              const selectedBorderColor =
                cellState === 'off'
                  ? offTone.color
                  : cellState === 'soon'
                    ? warningTone.color
                    : cellState === 'on'
                      ? onTone.color
                      : palette.primary;

              const borderColor = isSelected
                ? selectedBorderColor
                : cellState === 'off'
                  ? 'rgba(244, 63, 94, 0.45)'
                  : cellState === 'soon'
                    ? 'rgba(245, 158, 11, 0.45)'
                    : cellState === 'on'
                      ? 'rgba(16, 185, 129, 0.35)'
                      : palette.border;

              const textColor =
                cellState === 'off'
                  ? isSelected
                    ? '#ff6b81'
                    : '#fda4af'
                  : cellState === 'soon'
                    ? isSelected
                      ? '#fbbf24'
                      : '#fcd34d'
                    : cellState === 'on'
                      ? isSelected
                        ? '#34d399'
                        : '#ffffff'
                      : isSelected
                        ? palette.primary
                        : palette.foreground;

              return (
                <View key={queue} className="flex-1">
                  <Pressable
                    onPress={() => {
                      triggerSoftHaptic();
                      onSelect(queue);
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    style={{
                      backgroundColor: bgColor,
                      borderColor,
                      borderWidth: isSelected ? 2 : 1,
                      minHeight: 48,
                      paddingVertical: 6,
                    }}
                    className="items-center justify-center gap-0.5 rounded-2xl active:opacity-75"
                  >
                    <Text
                      // MiSans (HyperOS) рендерить bold на пару пікселів ширше, ніж його вимірює
          // Yoga: «4/2» обрізалось до «4…». Центруємо на всю ширину клітинки без
                      // горизонтальних відступів усередині, тоді вимірювання не впирається в межі.
                      numberOfLines={1}
                      className="text-xs font-bold leading-none"
                      style={{ color: textColor, width: '100%', textAlign: 'center', includeFontPadding: false, letterSpacing: 0 }}
                    >
                      {queue}
                    </Text>
                    <Text
                      className="text-[9px] font-bold leading-none"
                      style={{ color: symbolColor, width: '100%', textAlign: 'center', includeFontPadding: false }}
                    >
                      {stateSymbol}
                    </Text>
                  </Pressable>
                </View>
              );
            })}
            {/* Неповний рядок: клітинки не розтягуються на всю ширину, а тримають
                той самий розмір, що й у повних рядах. */}
            {Array.from({ length: columns - row.length }).map((_, spacer) => (
              <View key={`spacer-${spacer}`} className="flex-1" />
            ))}
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
