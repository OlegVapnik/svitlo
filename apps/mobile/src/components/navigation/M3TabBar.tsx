import Ionicons from '@expo/vector-icons/Ionicons';
import type { BottomTabBarProps } from 'expo-router/build/layouts/Tabs';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useState } from 'react';
import { LayoutChangeEvent, Pressable, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/theme/ThemeProvider';

const ICONS: Record<string, { active: keyof typeof Ionicons.glyphMap; idle: keyof typeof Ionicons.glyphMap }> = {
  index: { active: 'home', idle: 'home-outline' },
  search: { active: 'search', idle: 'search-outline' },
  monitor: { active: 'calendar', idle: 'calendar-outline' },
  info: { active: 'information-circle', idle: 'information-circle-outline' },
};

const SPRING = { damping: 18, stiffness: 220, mass: 0.9 };

/**
 * Нижний бар M3 Expressive: овальная пилюля активного пункта раскрывается пружиной.
 */
export function M3TabBar({ state, descriptors, emitter, navigateToTab }: BottomTabBarProps) {
  const { palette } = useTheme();
  const insets = useSafeAreaInsets();
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
        height: 76 + insets.bottom,
        paddingBottom: insets.bottom,
        backgroundColor: palette.surfaceContainer,
        borderTopColor: palette.hairline,
        borderTopWidth: 1,
      }}
    >
      {itemWidth > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              top: 12,
              left: 10,
              height: 52,
              width: itemWidth - 20,
              borderRadius: 26,
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
            void Haptics.selectionAsync();
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
              <Ionicons name={icon} size={22} color={focused ? palette.primary : palette.mutedForeground} />
              <Text
                className="text-[11px] font-semibold"
                style={{ color: focused ? palette.primary : palette.mutedForeground }}
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
