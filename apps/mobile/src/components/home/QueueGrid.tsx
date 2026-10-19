import { Pressable, Text, View } from 'react-native';

import { queueOptionsForGrid } from '@svitlo/core/lib/queue';

import { useTheme } from '@/theme/ThemeProvider';

interface QueueGridProps {
  queues: string[] | undefined;
  selected: string | null;
  active: Set<string>;
  onSelect: (queue: string) => void;
}

/**
 * Сетка групп 1/1…6/2. Состав берём из каталога области, а если он пуст — стандартные 12 подгрупп
 * (`queueOptionsForGrid` в ядре). Точка под кодом — у групп, которые по графику гасят сегодня.
 */
export function QueueGrid({ queues, selected, active, onSelect }: QueueGridProps) {
  const { palette } = useTheme();
  const options = queueOptionsForGrid(queues);

  return (
    <View className="gap-2">
      <Text className="text-sm font-semibold text-foreground">Моя черга</Text>
      <View className="flex-row flex-wrap gap-2">
        {options.map((queue) => {
          const isSelected = queue === selected;
          return (
            <Pressable
              key={queue}
              onPress={() => onSelect(queue)}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              className={
                isSelected
                  ? 'min-w-12 items-center rounded-xl border border-primary bg-primary-container px-3 py-2'
                  : 'min-w-12 items-center rounded-xl border border-border bg-surface-container-high px-3 py-2 active:opacity-70'
              }
            >
              <Text className={isSelected ? 'text-sm font-bold text-primary' : 'text-sm font-medium text-foreground'}>
                {queue}
              </Text>
              <View
                className="mt-1 h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: active.has(queue) ? palette.destructive : 'transparent' }}
              />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
