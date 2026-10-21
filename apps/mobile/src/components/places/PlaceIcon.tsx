import type { ComponentProps } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, Text, View } from 'react-native';

import { PLACE_ICONS, type PlaceIcon } from '@svitlo/core/lib/saved-places';

const META: Record<PlaceIcon, { icon: ComponentProps<typeof Ionicons>['name']; label: string }> = {
  home: { icon: 'home-outline', label: 'Дім' },
  work: { icon: 'briefcase-outline', label: 'Робота' },
  family: { icon: 'people-outline', label: 'Родина' },
  dacha: { icon: 'leaf-outline', label: 'Дача' },
  garage: { icon: 'car-outline', label: 'Гараж' },
  office: { icon: 'business-outline', label: 'Офіс' },
  school: { icon: 'school-outline', label: 'Школа' },
  star: { icon: 'star-outline', label: 'Інше' },
};

export function PlaceIconBadge({
  icon,
  size = 18,
  color,
}: {
  icon: PlaceIcon;
  size?: number;
  color?: string;
}) {
  return <Ionicons name={META[icon].icon} size={size} color={color} />;
}

export function PlaceIconPicker({
  value,
  onChange,
}: {
  value: PlaceIcon;
  onChange: (icon: PlaceIcon) => void;
}) {
  return (
    <View className="flex-row flex-wrap gap-2">
      {PLACE_ICONS.map((icon) => {
        const selected = icon === value;
        return (
          <Pressable
            key={icon}
            onPress={() => onChange(icon)}
            accessibilityRole="button"
            accessibilityLabel={META[icon].label}
            accessibilityState={{ selected }}
            className={
              selected
                ? 'h-10 w-10 items-center justify-center rounded-full border-2 border-primary bg-primary-container active:opacity-80'
                : 'h-10 w-10 items-center justify-center rounded-full border border-border bg-surface-container-high active:opacity-70'
            }
          >
            <PlaceIconBadge icon={icon} size={18} />
          </Pressable>
        );
      })}
    </View>
  );
}

export function iconLabel(icon: PlaceIcon): string {
  return META[icon].label;
}

export { PLACE_ICONS };
