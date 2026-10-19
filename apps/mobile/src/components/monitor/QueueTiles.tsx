import { Pressable, Text, View } from 'react-native';

import { canonicalQueueCode, queueCodeMatches } from '@svitlo/core/lib/queue';
import type { GroupOutageSummary } from '@svitlo/shared';

import { useTheme, type PowerState } from '@/theme/ThemeProvider';

interface QueueTilesProps {
  regionCpu: string;
  queues: Array<{ queue: string; slots?: number }>;
  outages: GroupOutageSummary[];
  selected: string | null;
  onSelect: (queue: string) => void;
}

/**
 * Плитки групп области: где света нет прямо сейчас.
 *
 * Состояние берём из `isActiveNow` в сводке отключений, а не из наличия слотов: слоты есть и у
 * группы со светом. Если группы нет в сводке — честно «Немає даних», а не «Є світло».
 *
 * Карта здесь принципиально не нужна: человеку важен код своей группы и факт отключения, а
 * геоточки тянули бы нативный движок карт, разрешения и вес APK.
 */
export function QueueTiles({ regionCpu, queues, outages, selected, onSelect }: QueueTilesProps) {
  const { palette } = useTheme();

  const states = new Map<string, PowerState>();
  for (const item of outages) {
    const code = canonicalQueueCode(regionCpu, item.queue);
    // Одна группа приходит минимум дважды — на сегодня и на завтра. Запись «завтра» с
    // `isActiveNow: false` не должна затирать сегодняшнюю активную: отключение важнее.
    if (item.isActiveNow) states.set(code, 'off');
    else if (states.get(code) !== 'off') states.set(code, 'on');
  }

  if (queues.length === 0) {
    return (
      <Text className="rounded-2xl border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
        Для цієї області немає переліку груп. Графік ще не імпортовано.
      </Text>
    );
  }

  return (
    <View className="flex-row flex-wrap gap-2">
      {queues.map(({ queue, slots }) => {
        const code = canonicalQueueCode(regionCpu, queue);
        const state = states.get(code) ?? 'unknown';
        const isSelected = selected != null && queueCodeMatches(regionCpu, queue, selected);
        const tone = palette.status[state];
        const label = state === 'off' ? 'Немає світла' : state === 'unknown' ? 'Немає даних' : 'Є світло';

        return (
          <Pressable
            key={queue}
            onPress={() => onSelect(queue)}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={`Черга ${queue}: ${label}`}
            className={
              isSelected
                ? 'w-[31%] min-w-28 flex-1 items-center gap-1 rounded-xl border-2 border-primary bg-primary-container px-2 py-3 active:opacity-80'
                : 'w-[31%] min-w-28 flex-1 items-center gap-1 rounded-xl border border-border bg-surface-container-low px-2 py-3 active:opacity-70'
            }
            style={!isSelected && state === 'off' ? { backgroundColor: tone.soft, borderColor: tone.border } : undefined}
          >
            <View className="h-2 w-2 rounded-full" style={{ backgroundColor: tone.color }} />
            <Text className="text-lg font-bold text-foreground">{queue}</Text>
            <Text className="text-center text-[10px] leading-tight" style={{ color: tone.text }}>
              {label}
            </Text>
            {slots === 0 ? (
              <Text className="text-[10px] text-muted-foreground">без слотів</Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
