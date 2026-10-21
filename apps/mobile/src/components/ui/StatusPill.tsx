import Ionicons from '@expo/vector-icons/Ionicons';
import { Text, View } from 'react-native';

import { useTheme, type PowerState } from '@/theme/ThemeProvider';

const ICONS: Record<PowerState, keyof typeof Ionicons.glyphMap> = {
  on: 'flash',
  warning: 'time-outline',
  off: 'flash-off-outline',
  allClear: 'checkmark-circle-outline',
  unknown: 'help-circle-outline',
};

export interface StatusPillProps {
  state: PowerState;
  label: string;
  /** Точка пульсирует — единственный «живой» элемент шапки. */
  pulse?: boolean;
}

/**
 * Пилл состояния сети: полупрозрачная заливка, грань 1px, светящаяся точка и иконка.
 *
 * Цвет приходит из токенов состояния (`palette.status[state]`), поэтому пилл, таймер,
 * волна и свечение не могут разойтись.
 */
export function StatusPill({ state, label, pulse = false }: StatusPillProps) {
  const { palette } = useTheme();
  const tone = palette.status[state];

  return (
    <View
      style={{ backgroundColor: tone.soft, borderColor: tone.border }}
      className="flex-row items-center gap-2 self-start rounded-full border px-3 py-1"
    >
      <View
        className="h-2 w-2 rounded-full"
        style={{
          backgroundColor: tone.color,
          opacity: pulse ? 1 : 0.9,
          shadowColor: tone.color,
          shadowOpacity: 0.9,
          shadowRadius: 5,
          shadowOffset: { width: 0, height: 0 },
          elevation: 3,
        }}
      />
      <Ionicons name={ICONS[state]} size={13} color={tone.text} />
      <Text className="text-xs font-semibold" style={{ color: tone.text }}>
        {label}
      </Text>
    </View>
  );
}
