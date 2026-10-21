import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import {
  MAX_PLACE_LABEL_LENGTH,
  sanitizePlaceLabel,
  type PlaceIcon,
} from '@svitlo/core/lib/saved-places';

import { PlaceIconPicker } from '@/components/places/PlaceIcon';
import { useTheme } from '@/theme/ThemeProvider';

/** Редактор назви та іконки місця: один компонент для створення й перейменування. */
export function PlaceEditor({
  initialLabel,
  initialIcon,
  autoFocus = false,
  submitLabel = 'Зберегти',
  onSave,
  onCancel,
}: {
  initialLabel: string;
  initialIcon: PlaceIcon;
  autoFocus?: boolean;
  submitLabel?: string;
  onSave: (label: string, icon: PlaceIcon) => void;
  onCancel: () => void;
}) {
  const { palette } = useTheme();
  const [label, setLabel] = useState(initialLabel);
  const [icon, setIcon] = useState<PlaceIcon>(initialIcon);
  const clean = sanitizePlaceLabel(label);

  return (
    <View className="gap-3">
      <View className="gap-1">
        <Text className="text-[11px] font-semibold text-muted-foreground">Назва місця</Text>
        <TextInput
          value={label}
          onChangeText={setLabel}
          autoFocus={autoFocus}
          maxLength={MAX_PLACE_LABEL_LENGTH}
          placeholder="Дім, робота, дача"
          placeholderTextColor={palette.mutedForeground}
          className="min-h-11 rounded-xl border border-border bg-surface-container-low px-3 py-2 text-sm text-foreground"
        />
        <Text className="text-[10px] text-muted-foreground">
          {clean.length}/{MAX_PLACE_LABEL_LENGTH}
        </Text>
      </View>

      <PlaceIconPicker value={icon} onChange={setIcon} />

      <View className="flex-row gap-2">
        <Pressable
          onPress={() => onSave(clean, icon)}
          disabled={!clean}
          accessibilityRole="button"
          className={
            clean
              ? 'min-h-10 flex-1 items-center justify-center rounded-xl bg-primary px-3 active:opacity-80'
              : 'min-h-10 flex-1 items-center justify-center rounded-xl bg-primary-container px-3 opacity-50'
          }
        >
          <Text className="text-sm font-bold text-on-primary">{submitLabel}</Text>
        </Pressable>
        <Pressable
          onPress={onCancel}
          accessibilityRole="button"
          className="min-h-10 items-center justify-center rounded-xl border border-border px-4 active:opacity-70"
        >
          <Text className="text-sm font-semibold text-foreground">Скасувати</Text>
        </Pressable>
      </View>
    </View>
  );
}
