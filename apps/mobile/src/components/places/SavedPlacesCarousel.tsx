import { Pressable, ScrollView, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';

import { useRegion } from '@/context/RegionContext';
import { useApplySavedPlace } from '@/hooks/useApplySavedPlace';
import { useSavedPlaces } from '@/hooks/useSavedPlaces';
import { useTheme } from '@/theme/ThemeProvider';
import { PlaceIconBadge } from '@/components/places/PlaceIcon';

/**
 * Швидкий перемикач збережених місць над героєм.
 *
 * Горизонтальна стрічка не розсуває головний екран: перші місця видно без прокрутки, решта —
 * свайпом. Дотик застосовує і область, і чергу, тому графік нижче одразу перебудовується.
 */
export function SavedPlacesCarousel({
  selectedQueue,
}: {
  selectedQueue: string | null;
}) {
  const { palette } = useTheme();
  const router = useRouter();
  const { currentRegion } = useRegion();
  const { places } = useSavedPlaces();
  const applyPlace = useApplySavedPlace();

  if (places.length === 0) {
    return (
      <Pressable
        onPress={() => router.navigate('/search')}
        accessibilityRole="button"
        accessibilityLabel="Зберегти місце"
        className="flex-row items-center gap-3 rounded-2xl border border-dashed border-border bg-card px-4 py-3 active:opacity-70"
      >
        <View className="h-9 w-9 items-center justify-center rounded-full bg-primary-container">
          <Ionicons name="star-outline" size={18} color={palette.primary} />
        </View>
        <View className="flex-1">
          <Text className="text-sm font-semibold text-foreground">Збережіть дім або роботу</Text>
          <Text className="text-xs text-muted-foreground">
            Перемикайтесь між адресами одним дотиком.
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={palette.mutedForeground} />
      </Pressable>
    );
  }

  return (
    <View className="gap-2">
      <View className="flex-row items-center justify-between">
        <Text className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Збережені місця
        </Text>
        <Pressable
          onPress={() => router.navigate('/search')}
          accessibilityRole="button"
          accessibilityLabel="Керувати збереженими місцями"
          className="min-h-8 flex-row items-center gap-1 rounded-full px-2 active:opacity-70"
        >
          <Ionicons name="settings-outline" size={14} color={palette.mutedForeground} />
          <Text className="text-xs font-semibold text-muted-foreground">Керувати</Text>
        </Pressable>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8, paddingRight: 8 }}
      >
        {places.map((place) => {
          const active = place.regionCpu === currentRegion && place.queue === selectedQueue;
          return (
            <Pressable
              key={place.id}
              onPress={() => applyPlace(place)}
              accessibilityRole="button"
              accessibilityLabel={`${place.label}, черга ${place.queue}`}
              accessibilityState={{ selected: active }}
              className={
                active
                  ? 'min-w-28 flex-row items-center gap-2 rounded-2xl border-2 border-primary bg-primary-container px-3 py-2.5 active:opacity-80'
                  : 'min-w-28 flex-row items-center gap-2 rounded-2xl border border-border bg-card px-3 py-2.5 active:opacity-70'
              }
            >
              <View className="h-8 w-8 items-center justify-center rounded-full bg-surface-container-high">
                <PlaceIconBadge icon={place.icon} size={16} color={active ? palette.primary : palette.foreground} />
              </View>
              <View className="min-w-0 flex-1">
                <Text numberOfLines={1} className="text-xs font-bold text-foreground">
                  {place.label}
                </Text>
                <Text className="text-[11px] font-semibold text-muted-foreground">
                  {place.isPrimary ? 'Головне · ' : ''}
                  Черга {place.queue}
                </Text>
              </View>
            </Pressable>
          );
        })}

        <Pressable
          onPress={() => router.navigate('/search')}
          accessibilityRole="button"
          accessibilityLabel="Додати місце"
          className="w-14 items-center justify-center rounded-2xl border border-dashed border-border bg-card active:opacity-70"
        >
          <Ionicons name="add" size={22} color={palette.mutedForeground} />
          <Text className="text-[10px] font-semibold text-muted-foreground">Додати</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
