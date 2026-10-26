import { Tabs } from 'expo-router';
import { View } from 'react-native';

import { M3TabBar } from '@/components/navigation/M3TabBar';
import { ChangelogSheet } from '@/components/updates/ChangelogSheet';
import { useTheme } from '@/theme/ThemeProvider';

export default function TabsLayout() {
  const { palette } = useTheme();

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
        <Tabs.Screen name="monitor" options={{ title: 'Графіки' }} />
        <Tabs.Screen name="info" options={{ title: 'Інфо' }} />
      </Tabs>

      <ChangelogSheet />
    </View>
  );
}
