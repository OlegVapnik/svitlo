import Ionicons from '@expo/vector-icons/Ionicons';
import type { BottomTabBarProps } from 'expo-router/build/layouts/Tabs';
import { triggerSoftHaptic } from '@/lib/haptics';
import { useCallback, useEffect, useState } from 'react';
import { LayoutChangeEvent, Pressable, useWindowDimensions, View } from 'react-native';
import { Text } from '@/components/ui/AppText';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/theme/ThemeProvider';

const ICONS: Record<string, { active: keyof typeof Ionicons.glyphMap; idle: keyof typeof Ionicons.glyphMap }> = {
  index: { active: 'home', idle: 'home-outline' },
  search: { active: 'search', idle: 'search-outline' },
  monitor: { active: 'calendar', idle: 'calendar-outline' },
  info: { active: 'information-circle', idle: 'information-circle-outline' },
};

const SPRING = {
  stiffness: 520,
  damping: 38,
  mass: 0.5,
  restDisplacementThreshold: 0.5,
  restSpeedThreshold: 2,
};

/**
 * Нижний бар M3 Expressive: овальная пилюля активного пункта раскрывается пружиной.
 */
export function M3TabBar({ state, descriptors, emitter, navigateToTab }: BottomTabBarProps) {
  const { palette } = useTheme();
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  // Висота бара росте разом із системним шрифтом: у фіксованих 76 px підпис таба
  // при fontScale 2.0 уже не вміщався і обрізався.
  const barHeight = Math.round(76 * Math.min(Math.max(fontScale, 1), 1.5));
  const pillHeight = barHeight - 24;
  const [width, setWidth] = useState(0);

  const x = useSharedValue(0);
  const itemWidth = width > 0 ? width / state.routes.length : 0;

  useEffect(() => {
    if (itemWidth <= 0) return;
    x.value = withSpring(state.index * itemWidth, SPRING);
  }, [itemWidth, state.index, x]);

  const pillStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }],
  }));

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    setWidth(event.nativeEvent.layout.width);
  }, []);

  return (
    <View
      onLayout={onLayout}
      style={{
        height: barHeight + insets.bottom,
        paddingBottom: insets.bottom,
        backgroundColor: palette.surfaceContainer,
        borderTopColor: palette.hairline,
        borderTopWidth: 1,
      }}
    >
      {itemWidth > 0 ? (
        <Animated.View
          pointerEvents="none"
          // Пігулка — єдиний постійно анімований шар навігатора: Рендер її як окремої
          // GPU-текстури дешевше Mansion / Mali, ніж композитинг у спільному шарі.
          renderToHardwareTextureAndroid={true}
          style={[
            {
              position: 'absolute',
              top: 12,
              left: 10,
              height: pillHeight,
              width: itemWidth - 20,
              borderRadius: pillHeight / 2,
              backgroundColor: palette.primaryContainer,
              borderColor: palette.status.on.border,
              borderWidth: 1,
            },
            pillStyle,
          ]}
        />
      ) : null}

      <View className="flex-1 flex-row">
        {state.routes.map((route, index) => {
          const descriptor = descriptors[route.key];
          const label =
            typeof descriptor.options.tabBarLabel === 'string'
              ? descriptor.options.tabBarLabel
              : typeof descriptor.options.title === 'string'
                ? descriptor.options.title
                : route.name === 'monitor'
                  ? 'Графіки'
                  : route.name;

          const focused = state.index === index;
          const icon = ICONS[route.name]?.[focused ? 'active' : 'idle'] ?? 'ellipse-outline';

          const onPress = () => {
            triggerSoftHaptic();
            const event = emitter.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!focused && !event.defaultPrevented) {
              navigateToTab(route.key);
            }
          };

          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              accessibilityRole="tab"
              accessibilityState={focused ? { selected: true } : {}}
              accessibilityLabel={label}
              className="flex-1 items-center justify-center gap-1 active:opacity-80"
            >
              <Animated.View style={{ transform: [{ scale: focused ? 1.08 : 1 }] }}>
                <Ionicons name={icon} size={22} color={focused ? palette.primary : palette.mutedForeground} />
              </Animated.View>
              <Text
                // Подписи нижнього меню ніколи не обрізаються: «Головн», «Пошу», «Ін»
                // виникли через Yoga vs MiSans метрики fontWeight 600. Віддаємо тексту
                // всю ширину таба, центруємо, вимикаємо letterSpacing.
                className="font-semibold"
                style={{
                  fontSize: 11,
                  width: '100%',
                  textAlign: 'center',
                  includeFontPadding: false,
                  letterSpacing: 0,
                  color: focused ? palette.primary : palette.mutedForeground,
                }}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
