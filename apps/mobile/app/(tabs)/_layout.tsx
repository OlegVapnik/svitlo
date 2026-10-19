import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

function tabIcon(name: IoniconName) {
  return ({ color, size }: { color: ColorValue; size: number }) => (
    <Ionicons name={name} color={typeof color === 'string' ? color : undefined} size={size} />
  );
}

export default function TabsLayout() {
  const { palette } = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: palette.primary,
        tabBarInactiveTintColor: palette.mutedForeground,
        tabBarStyle: {
          backgroundColor: palette.surfaceContainer,
          borderTopColor: palette.border,
        },
        sceneStyle: { backgroundColor: palette.surfaceDim },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Головна', tabBarIcon: tabIcon('home-outline') }} />
      <Tabs.Screen name="search" options={{ title: 'Пошук', tabBarIcon: tabIcon('search-outline') }} />
      <Tabs.Screen name="monitor" options={{ title: 'Монітор', tabBarIcon: tabIcon('pulse-outline') }} />
      <Tabs.Screen name="info" options={{ title: 'Інфо', tabBarIcon: tabIcon('information-circle-outline') }} />
    </Tabs>
  );
}
