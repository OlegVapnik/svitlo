import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, View } from 'react-native';
import { Text } from '@/components/ui/AppText';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import {
  regionFreshnessSection,
  sortRegionsByDataFreshness,
  type RegionSummary,
} from '@svitlo/core/lib/region';
import { formatDayMonth } from '@svitlo/core/lib/date';

import { useRegion } from '@/context/RegionContext';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Выбор области. В шапке — текущая область, по нажатию открывается список каталога.
 *
 * Области без графика помечаем прямо в списке: «є графік», «ост. 17.10» для застарілих і
 * «немає даних» для тех, у кого графика не было ни разу. Последние отделены заголовком, чтобы
 * шесть мёртвых областей не смешивались с живыми и просто застарілими.
 *
 * Форк за ADR-0007 (mobile): нативный `Modal` + `FlatList` вместо DOM-комбобокса, потому что
 * шторка, жест «назад» и виртуализованный список есть только в RN. Доменные правила
 * (`sortRegionsByDataFreshness`, тип `RegionSummary`) — из `@svitlo/core`, не здесь.
 */
export function RegionPicker() {
  const { currentRegionData, regions, setRegion } = useRegion();
  const { palette } = useTheme();
  const [open, setOpen] = useState(false);

  type Row =
    | { kind: 'header'; key: string; title: string }
    | { kind: 'region'; key: string; region: RegionSummary };

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    let staleHeader = false;
    let deadHeader = false;
    for (const region of sortRegionsByDataFreshness(regions)) {
      // Мережа всередині області (`dnipro-cek`, `dnipro-dnem`) — не окремий рядок списку:
      // оператора вибирають чипсами під шапкою області (див. `OperatorChips`).
      if (region.parentCpu) continue;
      const section = regionFreshnessSection(region);
      if (section === 'none' && !deadHeader) {
        out.push({ kind: 'header', key: 'header-dead', title: 'Немає даних' });
        deadHeader = true;
      } else if (section === 'stale' && !staleHeader) {
        out.push({ kind: 'header', key: 'header-stale', title: 'Застарілі графіки' });
        staleHeader = true;
      }
      out.push({ kind: 'region', key: region.cpu, region });
    }
    return out;
  }, [regions]);



  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Обрати область"
        onPress={() => setOpen(true)}
        className="flex-row items-center gap-2 rounded-full border border-border bg-surface-container-high px-3 py-2 active:opacity-70"
      >
        <Ionicons name="location-outline" size={16} color={palette.mutedForeground} />
        <Text className="shrink truncate text-sm font-medium text-foreground" numberOfLines={1}>
          {currentRegionData.nameUa}
        </Text>
        <Ionicons name="chevron-down" size={16} color={palette.mutedForeground} />
      </Pressable>

      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <SafeAreaView className="flex-1 bg-surface" edges={['top', 'bottom']}>
          <View className="flex-row items-center justify-between border-b border-border px-4 py-3">
            <Text className="text-lg font-semibold text-foreground">Область</Text>
            <Pressable onPress={() => setOpen(false)} className="p-1 active:opacity-70">
              <Ionicons name="close" size={22} color={palette.foreground} />
            </Pressable>
          </View>
          <FlatList
            data={rows}
            keyExtractor={(item) => item.key}
            renderItem={({ item }) => {
              if (item.kind === 'header') {
                return (
                  <Text className="px-4 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {item.title}
                  </Text>
                );
              }
              const region = item.region;
              const active = region.cpu === currentRegionData.cpu;
              const section = regionFreshnessSection(region);
              return (
                <Pressable
                  onPress={() => {
                    setRegion(region.cpu);
                    setOpen(false);
                  }}
                  className="flex-row items-center justify-between border-b border-hairline px-4 py-3 active:bg-surface-container-high"
                >
                  <Text
                    className={active ? 'text-base font-semibold text-primary' : 'text-base text-foreground'}
                    numberOfLines={1}
                    style={{ flex: 1, includeFontPadding: false, letterSpacing: 0 }}
                  >
                    {region.nameUa}
                  </Text>
                  {region.covered ? (
                    <Text
                      className="text-xs font-medium text-primary"
                      style={{ flexShrink: 0, includeFontPadding: false, letterSpacing: 0 }}
                    >
                      {'Є\u00A0графік'}
                    </Text>
                  ) : section === 'stale' ? (
                    <Text
                      className="text-xs text-muted-foreground"
                      style={{ flexShrink: 0, includeFontPadding: false, letterSpacing: 0 }}
                    >
                      {'Ост.\u00A0'}
                      {formatDayMonth(region.lastDate)}
                    </Text>
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
        </SafeAreaView>
      </Modal>
    </>
  );
}
