import { useState } from 'react';
import { FlatList, Modal, Pressable, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { useRegion } from '@/context/RegionContext';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Выбор области. В шапке — текущая область, по нажатию открывается список каталога.
 *
 * Области без графика помечаем прямо в списке («немає даних»): иначе человек выбирает область и
 * видит пустой экран, не понимая — это сбой или у оператора нет данных. Признак «є графік» —
 * `covered` из каталога, единственный честный сигнал живых данных.
 */
export function RegionPicker() {
  const { currentRegionData, regions, setRegion } = useRegion();
  const { palette } = useTheme();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Обрати область"
        onPress={() => setOpen(true)}
        className="flex-row items-center gap-2 rounded-full border border-border bg-surface-container-high px-3 py-2 active:opacity-70"
      >
        <Ionicons name="location-outline" size={16} color={palette.mutedForeground} />
        <Text className="max-w-52 truncate text-sm font-medium text-foreground">
          {currentRegionData.nameUa}
        </Text>
        <Ionicons name="chevron-down" size={16} color={palette.mutedForeground} />
      </Pressable>

      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View className="flex-1 bg-surface">
          <View className="flex-row items-center justify-between border-b border-border px-4 py-3">
            <Text className="text-lg font-semibold text-foreground">Область</Text>
            <Pressable onPress={() => setOpen(false)} className="p-1 active:opacity-70">
              <Ionicons name="close" size={22} color={palette.foreground} />
            </Pressable>
          </View>
          <FlatList
            data={regions}
            keyExtractor={(item) => item.cpu}
            renderItem={({ item }) => {
              const active = item.cpu === currentRegionData.cpu;
              return (
                <Pressable
                  onPress={() => {
                    setRegion(item.cpu);
                    setOpen(false);
                  }}
                  className="flex-row items-center justify-between border-b border-hairline px-4 py-3 active:bg-surface-container-high"
                >
                  <Text className={active ? 'text-base font-semibold text-primary' : 'text-base text-foreground'}>
                    {item.nameUa}
                  </Text>
                  {item.covered ? (
                    <Text className="text-xs font-medium text-primary">Є графік</Text>
                  ) : (
                    <Text className="text-xs text-muted-foreground">Немає даних</Text>
                  )}
                </Pressable>
              );
            }}
            ListEmptyComponent={
              <Text className="px-4 py-6 text-center text-sm text-muted-foreground">
                Каталог областей недоступний. Перевірте звʼязок.
              </Text>
            }
          />
        </View>
      </Modal>
    </>
  );
}
