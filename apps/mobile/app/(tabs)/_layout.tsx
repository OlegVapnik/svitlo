import { Tabs } from 'expo-router';

import { M3TabBar } from '@/components/navigation/M3TabBar';
import { useTheme } from '@/theme/ThemeProvider';

export default function TabsLayout() {
  const { palette } = useTheme();

  return (
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
  );
}
