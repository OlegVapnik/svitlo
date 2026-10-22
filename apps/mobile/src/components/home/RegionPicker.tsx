import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { sortRegionsByDataFreshness, type RegionSummary } from '@svitlo/core/lib/region';

import { useRegion } from '@/context/RegionContext';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Выбор области. В шапке — текущая область, по нажатию открывается список каталога.
 *
 * Области без графика помечаем прямо в списке: «є графік», «ост. 17.10» для застарілих і
 * «немає даних» для тех, у кого графика не было ни разу. Последние отделены заголовком, чтобы
 * шесть мёртвых областей не смешивались с живыми и просто застарілими.
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
      const hasAnyData =
        region.covered === true ||
        region.allClear === true ||
        (region.todaySlots ?? 0) > 0 ||
        region.lastDate != null ||
        (region.slots ?? 0) > 0;
      if (!hasAnyData && !deadHeader) {
        out.push({ kind: 'header', key: 'header-dead', title: 'Немає даних' });
        deadHeader = true;
      } else if (!region.covered && hasAnyData && !staleHeader) {
        out.push({ kind: 'header', key: 'header-stale', title: 'Застарілі графіки' });
        staleHeader = true;
      }
      out.push({ kind: 'region', key: region.cpu, region });
    }
    return out;
  }, [regions]);

  const shortDate = (date: string | null) => {
    if (!date) return '';
    const [, month, day] = date.split('-');
    return `${day}.${month}`;
  };

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
              const hasAnyData =
                region.covered === true ||
                region.allClear === true ||
                (region.todaySlots ?? 0) > 0 ||
                region.lastDate != null ||
                (region.slots ?? 0) > 0;
              return (
                <Pressable
                  onPress={() => {
                    setRegion(region.cpu);
                    setOpen(false);
                  }}
                  className="flex-row items-center justify-between border-b border-hairline px-4 py-3 active:bg-surface-container-high"
                >
                  <Text className={active ? 'text-base font-semibold text-primary' : 'text-base text-foreground'}>
                    {region.nameUa}
                  </Text>
                  {region.covered ? (
                    <Text className="text-xs font-medium text-primary">Є графік</Text>
                  ) : hasAnyData ? (
                    <Text className="text-xs text-muted-foreground">
                      Ост. {shortDate(region.lastDate)}
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
        </View>
      </Modal>
    </>
  );
}
