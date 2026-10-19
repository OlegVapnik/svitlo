import '../global.css';

import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { installStorage } from '@/lib/storage';
import { queryClient } from '@/lib/query-client';
import { ThemeProvider, useTheme } from '@/theme/ThemeProvider';

// Хранилище подключаем до первого рендера: офлайн-слой и закладки читаются синхронно.
installStorage();

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <ThemeProvider>
          <RootNavigator />
        </ThemeProvider>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}

function RootNavigator() {
  const { mode } = useTheme();

  return (
    <>
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="+not-found" options={{ headerShown: true, title: 'Не знайдено' }} />
      </Stack>
    </>
  );
}
