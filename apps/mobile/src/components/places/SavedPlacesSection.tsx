import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { Pressable, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';

import { useQueues } from '@svitlo/core/api/queries';
import { formatQueueLabel } from '@svitlo/core/lib/queue-label';
import type { PlaceIcon, SavedPlace } from '@svitlo/core/lib/saved-places';

import { PlaceEditor } from '@/components/places/PlaceEditor';
import { PlaceIconBadge } from '@/components/places/PlaceIcon';
import { useApplySavedPlace } from '@/hooks/useApplySavedPlace';
import { useSavedPlaces } from '@/hooks/useSavedPlaces';
import { useRegion } from '@/context/RegionContext';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Повний список збережених місць на екрані пошуку.
 *
 * На головній — лише стрічка швидкого перемикання. Тут живуть редагування назви/іконки/черги,
 * головне місце, порядок і видалення з Undo.
 */
export function SavedPlacesSection() {
  const { palette } = useTheme();
  const { places, canAdd, removePlace, restorePlace } = useSavedPlaces();
  const [undo, setUndo] = useState<{ place: SavedPlace; index: number } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
    },
    [],
  );

  const deletePlace = (place: SavedPlace) => {
    const removed = removePlace(place.id);
    if (!removed) return;
    setUndo(removed);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndo(null), 5000);
  };

  const handleUndo = () => {
    if (!undo) return;
    restorePlace(undo.place, undo.index);
    setUndo(null);
    if (undoTimer.current) clearTimeout(undoTimer.current);
  };

  return (
    <View className="gap-3 rounded-3xl border border-border bg-card p-4">
      <View className="gap-0.5">
        <Text className="text-sm font-bold text-foreground">Збережені місця</Text>
        <Text className="text-xs text-muted-foreground">
          Дім, робота, дача — зі своєю назвою, іконкою та чергою.
        </Text>
      </View>

      {places.length === 0 ? (
        <View className="rounded-xl bg-surface-container-high px-3 py-2.5">
          <Text className="text-xs font-semibold text-foreground">Поки що порожньо</Text>
          <Text className="mt-0.5 text-xs text-muted-foreground">
            Знайдіть адресу вище й натисніть «Зберегти місце».
          </Text>
        </View>
      ) : (
        <View className="gap-2">
          {places.map((place, index) => (
            <SavedPlaceRow
              key={place.id}
              place={place}
              isFirst={index === 0}
              isLast={index === places.length - 1}
              onDelete={() => deletePlace(place)}
            />
          ))}
        </View>
      )}

      {!canAdd ? (
        <Text className="text-xs font-semibold text-warning">
          Ліміт 10 місць. Видаліть одне, щоб додати нове.
        </Text>
      ) : null}

      {undo ? (
        <View className="flex-row items-center justify-between gap-2 rounded-xl bg-surface-container-high px-3 py-2">
          <Text className="flex-1 text-xs text-foreground" numberOfLines={1}>
            Видалено «{undo.place.label}»
          </Text>
          <Pressable
            onPress={handleUndo}
            accessibilityRole="button"
            className="min-h-9 flex-row items-center gap-1 rounded-full border border-primary/40 px-3 active:opacity-70"
          >
            <Ionicons name="arrow-undo-outline" size={14} color={palette.primary} />
            <Text className="text-xs font-bold text-primary">Повернути</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function SavedPlaceRow({
  place,
  isFirst,
  isLast,
  onDelete,
}: {
  place: SavedPlace;
  isFirst: boolean;
  isLast: boolean;
  onDelete: () => void;
}) {
  const { palette } = useTheme();
  const router = useRouter();
  const { currentRegion, regions } = useRegion();
  const applySavedPlace = useApplySavedPlace();
  const {
    renamePlace,
    setPlaceIcon,
    setPlaceQueue,
    setPrimaryPlace,
    movePlace,
  } = useSavedPlaces();
  const { data: queuesResponse } = useQueues(place.regionCpu);
  const [editing, setEditing] = useState(false);
  const [draftQueue, setDraftQueue] = useState(place.queue);

  const regionName =
    regions.find((region) => region.cpu === place.regionCpu)?.nameUa ?? place.regionCpu;
  const address = [place.settlementName, place.streetName, place.house].filter(Boolean).join(', ');
  const queues = [
    ...new Set([place.queue, ...(queuesResponse?.data ?? []).map((item) => item.queue)]),
  ];
  const active = place.regionCpu === currentRegion && place.isPrimary;

  const applyPlace = () => {
    applySavedPlace(place);
    router.navigate('/');
  };

  const startEditing = () => {
    setDraftQueue(place.queue);
    setEditing(true);
  };

  const finishEditing = (label: string, icon: PlaceIcon) => {
    renamePlace(place.id, label);
    setPlaceIcon(place.id, icon);
    if (draftQueue !== place.queue) setPlaceQueue(place.id, draftQueue);
    setEditing(false);
  };

  return (
    <View
      className={
        place.isPrimary
          ? 'gap-3 rounded-2xl border border-primary/40 bg-primary-container/20 p-3'
          : 'gap-3 rounded-2xl border border-border p-3'
      }
    >
      {editing ? (
        <View className="gap-3">
          <PlaceEditor
            initialLabel={place.label}
            initialIcon={place.icon}
            autoFocus
            submitLabel="Готово"
            onSave={finishEditing}
            onCancel={() => setEditing(false)}
          />
          <View className="gap-1.5">
            <Text className="text-[11px] font-semibold text-muted-foreground">Черга</Text>
            <View className="flex-row flex-wrap gap-2">
              {queues.map((queue) => {
                const selected = queue === draftQueue;
                return (
                  <Pressable
                    key={queue}
                    onPress={() => setDraftQueue(queue)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    className={
                      selected
                        ? 'rounded-full border border-primary bg-primary-container px-3 py-1.5 active:opacity-80'
                        : 'rounded-full border border-border bg-surface-container-high px-3 py-1.5 active:opacity-70'
                    }
                  >
                    <Text className={selected ? 'text-xs font-bold text-primary' : 'text-xs font-semibold text-foreground'}>
                      {formatQueueLabel(queue, place.regionCpu)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>
      ) : (
        <>
          <Pressable
            onPress={applyPlace}
            accessibilityRole="button"
            accessibilityLabel={`Відкрити ${place.label}, черга ${place.queue}`}
            className="flex-row items-start gap-2.5 active:opacity-70"
          >
            <View className="mt-0.5 h-9 w-9 items-center justify-center rounded-full bg-surface-container-high">
              <PlaceIconBadge icon={place.icon} size={17} color={active ? palette.primary : palette.foreground} />
            </View>
            <View className="min-w-0 flex-1 gap-0.5">
              <View className="flex-row flex-wrap items-center gap-1.5">
                <Text numberOfLines={1} className="max-w-40 text-sm font-bold text-foreground">
                  {place.label}
                </Text>
                {place.isPrimary ? (
                  <View className="rounded-full bg-primary-container px-1.5 py-0.5">
                    <Text className="text-[10px] font-bold text-primary">Головне</Text>
                  </View>
                ) : null}
                <View className="rounded-full border border-border px-1.5 py-0.5">
                  <Text className="text-[10px] font-semibold text-foreground">Черга {place.queue}</Text>
                </View>
              </View>
              <Text numberOfLines={2} className="text-xs text-muted-foreground">
                {regionName}
                {address ? ` · ${address}` : ' · адреса не вказана'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={palette.mutedForeground} />
          </Pressable>

          <View className="flex-row flex-wrap items-center gap-1 border-t border-hairline pt-2">
            <RowAction
              label="Вище"
              disabled={isFirst}
              onPress={() => movePlace(place.id, -1)}
              icon="arrow-up-outline"
            />
            <RowAction
              label="Нижче"
              disabled={isLast}
              onPress={() => movePlace(place.id, 1)}
              icon="arrow-down-outline"
            />
            <RowAction
              label={place.isPrimary ? 'Головне місце' : 'Зробити головним'}
              disabled={place.isPrimary}
              active={place.isPrimary}
              onPress={() => setPrimaryPlace(place.id)}
              icon={place.isPrimary ? 'star' : 'star-outline'}
            />
            <RowAction label="Редагувати" onPress={startEditing} icon="pencil-outline" />
            <RowAction label="Видалити" destructive onPress={onDelete} icon="trash-outline" />
          </View>
        </>
      )}
    </View>
  );
}

function RowAction({
  label,
  icon,
  onPress,
  disabled = false,
  active = false,
  destructive = false,
}: {
  label: string;
  icon: ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  disabled?: boolean;
  active?: boolean;
  destructive?: boolean;
}) {
  const { palette } = useTheme();
  const color = disabled
    ? palette.mutedForeground
    : destructive
      ? palette.destructive
      : active
        ? palette.primary
        : palette.foreground;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected: active }}
      className={
        disabled
          ? 'h-9 w-9 items-center justify-center rounded-full opacity-30'
          : 'h-9 w-9 items-center justify-center rounded-full active:bg-surface-container-high'
      }
    >
      <Ionicons name={icon} size={16} color="#FFFFFF" />
    </Pressable>
  );
}
