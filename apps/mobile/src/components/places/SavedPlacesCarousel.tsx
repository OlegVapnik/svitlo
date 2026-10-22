import { Pressable, ScrollView, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';

import { triggerSoftHaptic } from '@/lib/haptics';
import { useRegion } from '@/context/RegionContext';
import { useApplySavedPlace } from '@/hooks/useApplySavedPlace';
import { useSavedPlaces } from '@/hooks/useSavedPlaces';
import { useTheme } from '@/theme/ThemeProvider';
import { PlaceIconBadge } from '@/components/places/PlaceIcon';
import type { PlaceLiveStatus } from '@/hooks/useSavedPlacesStatus';

interface SavedPlacesCarouselProps {
  selectedQueue: string | null;
  /** Карта статусов для сохраненных мест по place.id */
  placesStatusMap?: Record<string, PlaceLiveStatus>;
}

export function SavedPlacesCarousel({
  selectedQueue,
  placesStatusMap = {},
}: SavedPlacesCarouselProps) {
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
        style={{ backgroundColor: palette.card, borderColor: palette.hairline }}
        className="flex-row items-center gap-3 rounded-2xl border border-dashed px-4 py-3 active:opacity-70"
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
        <Text className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Мої місця
        </Text>
        <Pressable
          onPress={() => router.navigate('/search')}
          accessibilityRole="button"
          accessibilityLabel="Керувати збереженими місцями"
          className="flex-row items-center gap-1 rounded-full px-1 active:opacity-70"
        >
          <Ionicons name="settings-outline" size={13} color={palette.mutedForeground} />
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
          const live = placesStatusMap[place.id] ?? {
            state: 'unknown',
            timeLabel: '',
            statusText: '',
          };
          const tone = palette.status[live.state] ?? palette.status.unknown;

          return (
            <Pressable
              key={place.id}
              onPress={() => {
                triggerSoftHaptic();
                applyPlace(place);
              }}
              accessibilityRole="button"
              accessibilityLabel={`${place.label}, черга ${place.queue}`}
              accessibilityState={{ selected: active }}
              style={{
                backgroundColor: active ? palette.primaryContainer : palette.card,
                borderColor: active
                  ? palette.primary
                  : live.state === 'off'
                    ? 'rgba(239, 68, 68, 0.45)'
                    : live.state === 'warning'
                      ? 'rgba(245, 158, 11, 0.45)'
                      : live.state === 'on'
                        ? 'rgba(16, 185, 129, 0.35)'
                        : palette.border,
                borderWidth: active ? 1.5 : 1,
                shadowColor: tone.color,
                shadowOpacity: live.state !== 'unknown' ? 0.25 : 0,
                shadowRadius: 6,
                elevation: live.state !== 'unknown' ? 2 : 0,
              }}
              className="flex-row items-center gap-2.5 rounded-2xl px-3.5 py-2.5 active:opacity-75"
            >
              <View className="relative h-8 w-8 items-center justify-center rounded-full bg-surface-container-high">
                <PlaceIconBadge icon={place.icon} size={15} color={active ? palette.primary : palette.foreground} />
                {/* Светящийся индикатор текущего состояния закладки */}
                <View
                  style={{
                    position: 'absolute',
                    top: -1,
                    right: -1,
                    width: 8,
                    height: 8,
                    borderRadius: live.state === 'off' ? 2 : live.state === 'warning' ? 1 : 4,
                    transform: live.state === 'warning' ? [{ rotate: '45deg' }] : [],
                    backgroundColor: tone.color,
                    shadowColor: tone.color,
                    shadowOpacity: 0.9,
                    shadowRadius: 5,
                    borderWidth: 1,
                    borderColor: palette.card,
                  }}
                />
              </View>

              <View className="min-w-0">
                <View className="flex-row items-center gap-1.5">
                  <Text numberOfLines={1} className="text-xs font-bold text-foreground">
                    {place.label}
                  </Text>
                  <Text className="text-[11px] font-bold" style={{ color: tone.color }}>
                    {tone.symbol}
                  </Text>
                </View>
                <Text className="text-[11px] font-semibold text-muted-foreground">
                  {place.queue} {live.timeLabel ? `· ${live.timeLabel}` : ''}
                </Text>
              </View>
            </Pressable>
          );
        })}

        <Pressable
          onPress={() => router.navigate('/search')}
          accessibilityRole="button"
          accessibilityLabel="Додати місце"
          style={{ backgroundColor: palette.card, borderColor: palette.border }}
          className="flex-row items-center gap-1.5 rounded-2xl border border-dashed px-3 py-2.5 active:opacity-70"
        >
          <Ionicons name="add" size={18} color={palette.mutedForeground} />
          <Text className="text-xs font-semibold text-muted-foreground">Додати місце</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
