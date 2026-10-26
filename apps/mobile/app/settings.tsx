import { Linking, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';

import { useSettings } from '@/context/SettingsContext';
import { APP_VERSION, useUpdates } from '@/context/UpdateContext';
import { triggerSoftHaptic } from '@/lib/haptics';
import { useTheme, type Palette } from '@/theme/ThemeProvider';

/**
 * «Налаштування»: тумблери фіч, застосунок та оновлення, джерела підтримки.
 *
 * Це не таб, а Stack-роут: відкривається шестірнею з «Інфо», назад — `router.back()`.
 * Блоки «Застосунок» і «Джерела та підтримка» переїхали сюди з таба «Інфо», щоб той
 * лишився лише стрічкою новин. Значення тумблерів живуть у SettingsContext (kv-store),
 * тому переживають перезапуск.
 */

export default function SettingsScreen() {
  const { palette } = useTheme();
  const router = useRouter();
  const { liveNotification, setLiveNotification, earlyLightDetector, setEarlyLightDetector } =
    useSettings();
  const { pending, openSheet } = useUpdates();

  return (
    <SafeAreaView className="flex-1 bg-surface-dim" edges={['top']}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ gap: 16, paddingHorizontal: 16, paddingBottom: 48, paddingTop: 10 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Шапка: назад + заголовок (власна, бо це не таб і RegionPicker тут не потрібен) */}
        <View className="flex-row items-center gap-3">
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Назад"
            style={{ backgroundColor: palette.card, borderColor: palette.hairline }}
            className="h-9 w-9 items-center justify-center rounded-full border active:opacity-70"
          >
            <Ionicons name="arrow-back" size={16} color={palette.mutedForeground} />
          </Pressable>
          <Text className="text-2xl font-bold tracking-tight text-foreground">Налаштування</Text>
        </View>

        {/* ── Повідомлення ─────────────────────────────────────────── */}
        <View
          className="gap-3 rounded-3xl p-4"
          style={{ backgroundColor: palette.card, borderColor: palette.hairline, borderWidth: 1 }}
        >
          <Text className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Сповіщення</Text>

          <SettingsRow
            label="Живий індикатор у шторці"
            caption="Постійне повідомлення зі статусом світла й таймером"
            value={liveNotification}
            onValueChange={setLiveNotification}
            palette={palette}
          />

          <SettingsRow
            label="Детектор раннього світла"
            caption="Повідомлення, коли світло з'явилося раніше графіка — по зарядці"
            value={earlyLightDetector}
            onValueChange={setEarlyLightDetector}
            palette={palette}
          />
        </View>

        {/* ── Застосунок ───────────────────────────────────────────── */}
        <View
          className="gap-3 rounded-3xl p-4"
          style={{ backgroundColor: palette.card, borderColor: palette.hairline, borderWidth: 1 }}
        >
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-2.5">
              <View className="h-9 w-9 items-center justify-center rounded-xl" style={{ backgroundColor: palette.primaryContainer }}>
                <Ionicons name="sparkles" size={18} color={palette.primary} />
              </View>
              <Text className="text-sm font-bold text-foreground">Застосунок</Text>
            </View>
            <View className="rounded-full bg-surface-container-high px-2.5 py-1">
              <Text className="text-xs font-bold text-foreground">v{APP_VERSION}</Text>
            </View>
          </View>

          <Pressable
            onPress={openSheet}
            style={{ backgroundColor: palette.primary }}
            className="flex-row items-center justify-center gap-2 rounded-2xl py-3 active:opacity-80"
          >
            <Ionicons name="cloud-download-outline" size={16} color={palette.onPrimary} />
            <Text className="text-xs font-bold" style={{ color: palette.onPrimary }}>
              Оновлення та зміни
            </Text>
          </Pressable>

          {pending ? (
            <Text className="text-center text-xs font-semibold" style={{ color: palette.warning }}>
              Доступне оновлення {pending.version} ({pending.kind === 'ota' ? 'OTA' : 'APK'})
            </Text>
          ) : null}
        </View>

        {/* ── Джерела та підтримка ─────────────────────────────────── */}
        <View
          className="gap-2 rounded-3xl p-4"
          style={{ backgroundColor: palette.card, borderColor: palette.hairline, borderWidth: 1 }}
        >
          <Text className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Джерела та підтримка
          </Text>

          <View className="flex-row items-center justify-between rounded-2xl bg-surface-container-low p-3">
            <View className="flex-row items-center gap-2.5">
              <Ionicons name="paper-plane-outline" size={16} color={palette.primary} />
              <Text className="text-xs font-semibold text-foreground">Канал Svitlo в Telegram</Text>
            </View>
          </View>

          <Pressable
            onPress={() => void Linking.openURL('https://github.com/OlegVapnik/svitlo')}
            className="flex-row items-center justify-between rounded-2xl bg-surface-container-low p-3 active:opacity-75"
          >
            <View className="flex-row items-center gap-2.5">
              <Ionicons name="logo-github" size={16} color={palette.foreground} />
              <Text className="text-xs font-semibold text-foreground">Вихідний код на GitHub</Text>
            </View>
            <Ionicons name="open-outline" size={13} color={palette.mutedForeground} />
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/** Ряд-перемикач: підпис і опис зліва, тумблер праворуч. Хаптик — на саме перемикання. */
function SettingsRow({
  label,
  caption,
  value,
  onValueChange,
  palette,
}: {
  label: string;
  caption: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  palette: Palette;
}) {
  return (
    <View className="flex-row items-center justify-between gap-3 rounded-2xl bg-surface-container-low p-3">
      <View className="flex-1 gap-0.5">
        <Text className="text-xs font-semibold text-foreground">{label}</Text>
        <Text className="text-[11px] leading-snug text-muted-foreground">{caption}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={(next) => {
          triggerSoftHaptic();
          onValueChange(next);
        }}
        trackColor={{ false: palette.surfaceContainerHigh, true: palette.primary }}
      />
    </View>
  );
}
