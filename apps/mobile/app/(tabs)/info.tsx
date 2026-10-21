import { useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import { ScreenHeader } from '@/components/navigation/ScreenHeader';
import { SwipeableScreen } from '@/components/navigation/SwipeableScreen';
import { APP_VERSION, useUpdates } from '@/context/UpdateContext';
import { useTheme } from '@/theme/ThemeProvider';

export default function InfoScreen() {
  const { palette } = useTheme();
  const { pending, openSheet } = useUpdates();

  return (
    <SwipeableScreen>
      <SafeAreaView className="flex-1 bg-surface-dim" edges={['top']}>
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ gap: 16, paddingHorizontal: 16, paddingBottom: 48, paddingTop: 10 }}
          showsVerticalScrollIndicator={false}
        >
          <ScreenHeader title="Інфо" />

          {/* Картка оновлень та версії */}
          <View
            style={{
              backgroundColor: palette.card,
              borderColor: palette.hairline,
              borderWidth: 1,
            }}
            className="items-center gap-4 rounded-3xl p-6 text-center shadow-sm"
          >
            <View className="h-16 w-16 items-center justify-center rounded-2xl bg-primary-container">
              <Ionicons name="sparkles" size={32} color={palette.primary} />
            </View>

            <View className="items-center gap-1.5">
              <Text className="text-center text-lg font-bold text-foreground">
                Розділ у процесі переробки
              </Text>
              <Text className="text-center text-xs leading-relaxed text-muted-foreground">
                Готуємо оновлений центр корисної інформації, аналітики відключень та зручних налаштувань сповіщень.
              </Text>
            </View>

            <View className="w-full border-t border-hairline pt-4">
              <View className="flex-row items-center justify-between">
                <Text className="text-xs font-semibold text-muted-foreground">Версія застосунку</Text>
                <View className="rounded-full bg-surface-container-high px-2.5 py-1">
                  <Text className="text-xs font-bold text-foreground">v{APP_VERSION}</Text>
                </View>
              </View>

              <Pressable
                onPress={openSheet}
                style={{
                  backgroundColor: palette.primary,
                }}
                className="mt-4 flex-row items-center justify-center gap-2 rounded-2xl py-3 active:opacity-80"
              >
                <Ionicons name="cloud-download-outline" size={18} color={palette.onPrimary} />
                <Text className="text-xs font-bold" style={{ color: palette.onPrimary }}>
                  {pending ? 'Переглянути оновлення' : 'Оновлення та зміни'}
                </Text>
              </Pressable>

              {pending ? (
                <Text className="mt-2 text-center text-xs font-semibold text-warning">
                  Доступне оновлення {pending.version} ({pending.kind === 'ota' ? 'OTA' : 'APK'})!
                </Text>
              ) : null}
            </View>
          </View>

          {/* Блок підтримки та інформації */}
          <View
            style={{
              backgroundColor: palette.card,
              borderColor: palette.hairline,
              borderWidth: 1,
            }}
            className="gap-2 rounded-3xl p-4"
          >
            <Text className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Джерела та підтримка
            </Text>

            <View className="flex-row items-center justify-between rounded-2xl bg-surface-container-low p-3">
              <View className="flex-row items-center gap-2.5">
                <Ionicons name="paper-plane-outline" size={18} color={palette.primary} />
                <Text className="text-xs font-semibold text-foreground">Канал Svitlo в Telegram</Text>
              </View>
            </View>

            <Pressable
              onPress={() => void Linking.openURL('https://github.com/OlegVapnik/svitlo')}
              className="flex-row items-center justify-between rounded-2xl bg-surface-container-low p-3 active:opacity-75"
            >
              <View className="flex-row items-center gap-2.5">
                <Ionicons name="logo-github" size={18} color={palette.foreground} />
                <Text className="text-xs font-semibold text-foreground">Вихідний код на GitHub</Text>
              </View>
              <Ionicons name="open-outline" size={14} color={palette.mutedForeground} />
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    </SwipeableScreen>
  );
}
