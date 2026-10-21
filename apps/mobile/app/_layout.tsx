import 'react-native-gesture-handler';
import '../global.css';

import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { configureAddressPacks, configureCoreApi } from '@svitlo/core';
import { hydrateOfflineStartup } from '@svitlo/core/api/offline-sync';
import { queryClient } from '@svitlo/core/api/query-client';

import { RegionProvider } from '@/context/RegionContext';
import { SettingsProvider } from '@/context/SettingsContext';
import { SyncProvider } from '@/context/SyncContext';
import { UpdateProvider } from '@/context/UpdateContext';
import { NotificationBannerHost } from '@/components/notifications/NotificationBannerHost';
import { registerNotificationActions } from '@/lib/notification-actions';
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

/**
 * Статические паки адресов живут на Cloudflare Pages (тот же деплой, что и веб).
 * У приложения нет origin, поэтому путь абсолютный; при необходимости стенд подменяется
 * через `EXPO_PUBLIC_ADDRESS_PACKS_BASE_URL`.
 */
const ADDRESS_PACKS_BASE_URL =
  process.env.EXPO_PUBLIC_ADDRESS_PACKS_BASE_URL ?? 'https://svitlo-ua-4ze.pages.dev/data/address';

installStorage();
configureCoreApi({ apiBaseUrl: API_BASE_URL });
configureAddressPacks({ baseUrl: ADDRESS_PACKS_BASE_URL });
// Гидратация офлайн-пакета ДО первого рендера: экраны запускают запросы сразу при монтировании,
// и без этого первый кадр в офлайне был бы пустым («немає даних»), а график приезжал бы вторым.
hydrateOfflineStartup();

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <UpdateProvider>
        <SafeAreaProvider>
          <ThemeProvider>
            <RegionProvider>
              <SyncProvider>
                <SettingsProvider>
                  <RootNavigator />
                  {/* Скрытая карточка для шторки: живёт рядом с экранами, но вне их layout. */}
                  <NotificationBannerHost />
                </SettingsProvider>
              </SyncProvider>
            </RegionProvider>
          </ThemeProvider>
        </SafeAreaProvider>
        </UpdateProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

function RootNavigator() {
  const { mode } = useTheme();

  // Единая подписка на кнопки шторки: foreground-событие + нажатие при холодном старте.
  useEffect(() => registerNotificationActions(), []);

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
