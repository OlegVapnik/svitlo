import { Text, View } from 'react-native';

import { useTheme, type PowerState } from '@/theme/ThemeProvider';

export interface StatusPillProps {
  state: PowerState;
  label: string;
  pulse?: boolean;
}

/**
 * Пилл состояния сети: полупрозрачная заливка, грань 1px, светящаяся геометрическая форма (● / ◆ / ■).
 * - Світло є: круг ● (#10B981)
 * - Скоро вимкнення: ромб ◆ (#F59E0B)
 * - Відключення: квадрат ■ (#F43F5E)
 * - Немає даних: нейтральний сірий
 */
export function StatusPill({ state, label, pulse = false }: StatusPillProps) {
  const { palette } = useTheme();
  const tone = palette.status[state];

  // Геометрический индикатор формы
  const renderShape = () => {
    if (state === 'warning') {
      return (
        <View
          style={{
            width: 7,
            height: 7,
            backgroundColor: tone.color,
            transform: [{ rotate: '45deg' }],
            shadowColor: tone.color,
            shadowOpacity: 0.9,
            shadowRadius: 5,
            shadowOffset: { width: 0, height: 0 },
            elevation: 3,
          }}
        />
      );
    }
    if (state === 'off') {
      return (
        <View
          style={{
            width: 7,
            height: 7,
            borderRadius: 1.5,
            backgroundColor: tone.color,
            shadowColor: tone.color,
            shadowOpacity: 0.8,
            shadowRadius: 4,
            shadowOffset: { width: 0, height: 0 },
            elevation: 3,
          }}
        />
      );
    }
    // on, allClear, unknown: круг
    return (
      <View
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: tone.color,
          opacity: pulse ? 1 : 0.9,
          shadowColor: tone.color,
          shadowOpacity: 0.9,
          shadowRadius: 5,
          shadowOffset: { width: 0, height: 0 },
          elevation: 3,
        }}
      />
    );
  };

  return (
    <View
      style={{ backgroundColor: tone.soft, borderColor: tone.border }}
      className="flex-row items-center gap-2 self-start rounded-full border px-3 py-1"
    >
      {renderShape()}
      <Text className="text-xs font-bold" style={{ color: tone.text }}>
        {label}
      </Text>
    </View>
  );
}
