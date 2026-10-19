import '../global.css';

import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { configureCoreApi } from '@svitlo/core';
import { hydrateOfflineStartup } from '@svitlo/core/api/offline-sync';
import { queryClient } from '@svitlo/core/api/query-client';

import { RegionProvider } from '@/context/RegionContext';
import { installStorage } from '@/lib/storage';
import { ThemeProvider, useTheme } from '@/theme/ThemeProvider';

/**
 * Адрес API. В вебе это относительный `/api/v1` (тот же домен), в мобильном — абсолютный URL:
 * у приложения нет своего origin, поэтому относительный путь никуда не ведёт. Значение
 * подставляется на сборке через `EXPO_PUBLIC_API_BASE_URL`; по умолчанию — прод-воркер, чтобы
 * dev-сборка «из коробки» показывала реальные данные.
 */
const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://svitlo-api.olegvapnik45.workers.dev/api/v1';

installStorage();
configureCoreApi({ apiBaseUrl: API_BASE_URL });
// Гидратация офлайн-пакета ДО первого рендера: экраны запускают запросы сразу при монтировании,
// и без этого первый кадр в офлайне был бы пустым («немає даних»), а график приезжал бы вторым.
hydrateOfflineStartup();

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <ThemeProvider>
          <RegionProvider>
            <RootNavigator />
          </RegionProvider>
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
