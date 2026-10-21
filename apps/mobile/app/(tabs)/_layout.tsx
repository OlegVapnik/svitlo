import { Tabs } from 'expo-router';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { M3TabBar } from '@/components/navigation/M3TabBar';
import { ChangelogSheet } from '@/components/updates/ChangelogSheet';
import { DynamicUpdatePill } from '@/components/updates/DynamicUpdatePill';
import { useTheme } from '@/theme/ThemeProvider';

export default function TabsLayout() {
  const { palette } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1 }}>
      <Tabs
        tabBar={(props) => <M3TabBar {...props} />}
        screenOptions={{
          headerShown: false,
          sceneStyle: { backgroundColor: palette.surfaceDim },
        }}
      >
        <Tabs.Screen name="index" options={{ title: 'Головна' }} />
        <Tabs.Screen name="search" options={{ title: 'Пошук' }} />
        <Tabs.Screen name="monitor" options={{ title: 'Монітор' }} />
        <Tabs.Screen name="info" options={{ title: 'Інфо' }} />
      </Tabs>

      {/* Капсула висит над таб-баром на всех вкладках: обновление не должно теряться, если
          человек ушёл с главной. `box-none` пропускает тапы мимо самой капсулы. */}
      <View
        pointerEvents="box-none"
        style={{ position: 'absolute', left: 12, right: 12, bottom: 76 + insets.bottom + 12 }}
      >
        <DynamicUpdatePill />
      </View>
      <ChangelogSheet />
    </View>
  );
}
