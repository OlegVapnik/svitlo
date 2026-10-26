import { useState } from 'react';
import { Linking, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';

import { useSettings } from '@/context/SettingsContext';
import { useCustomNewsSources } from '@/hooks/useCustomNewsSources';
import { triggerSoftHaptic } from '@/lib/haptics';
import { MorpheUpdateCard } from '@/components/updates/MorpheUpdateCard';
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
  const { liveNotification, setLiveNotification, earlyLightDetector, setEarlyLightDetector, newsDisabled, setNewsDisabled } =
    useSettings();
  const { sources: customSources, addSource, removeSource } = useCustomNewsSources();
  const [sourceInput, setSourceInput] = useState('');
  const [sourceError, setSourceError] = useState<string | null>(null);

  /** Додати джерело з інлайн-форми; успіх — очищає поле, помилка — показуємо під формою. */
  const submitSource = () => {
    const trimmed = sourceInput.trim();
    if (!trimmed) {
      setSourceError(null);
      return;
    }
    const result = addSource(trimmed);
    if (!result.ok) {
      setSourceError(result.error ?? 'Не вдалося додати джерело');
      return;
    }
    setSourceInput('');
    setSourceError(null);
  };

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

        {/* ── Джерело новин ───────────────────────────────────────── */}
        <View
          className="gap-3 rounded-3xl p-4"
          style={{ backgroundColor: palette.card, borderColor: palette.hairline, borderWidth: 1 }}
        >
          <Text className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Джерело новин
          </Text>

          <SettingsRow
            label="Вимкнути новини"
            caption="Повністю вимикає серверні запити стрічки — читайте лише власні джерела без витрати квоти бази"
            value={newsDisabled}
            onValueChange={setNewsDisabled}
            palette={palette}
          />

          {newsDisabled && (
            <Text className="text-[11px] leading-snug text-muted-foreground">
              Стрічка в «Інфо» показуватиме лише ваші джерела
            </Text>
          )}

          {/* Інлайн-форма додавання власного джерела */}
          <View className="gap-2">
            <View className="flex-row items-center gap-2">
              <TextInput
                value={sourceInput}
                onChangeText={(value) => {
                  setSourceInput(value);
                  if (sourceError) setSourceError(null);
                }}
                placeholder="@канал або RSS-посилання"
                placeholderTextColor={palette.mutedForeground}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                className="flex-1 rounded-2xl px-3 py-2.5 text-sm text-foreground"
                style={{ backgroundColor: palette.surfaceContainerLow }}
                returnKeyType="done"
                onSubmitEditing={submitSource}
              />
              <Pressable
                onPress={submitSource}
                accessibilityRole="button"
                accessibilityLabel="Додати джерело"
                className="rounded-xl px-4 py-2.5 active:opacity-70"
                style={{ backgroundColor: palette.primary }}
              >
                <Text className="text-xs font-bold" style={{ color: palette.onPrimary }}>
                  Додати
                </Text>
              </Pressable>
            </View>
            {sourceError && (
              <Text className="text-[11px]" style={{ color: palette.destructive }}>
                {sourceError}
              </Text>
            )}
          </View>

          {/* Список доданих джерел — ті самі ряди, що в «Інфо» */}
          {customSources.map((source) => (
            <View
              key={source.id}
              className="flex-row items-center gap-2.5 rounded-2xl p-3"
              style={{ backgroundColor: palette.surfaceContainerLow }}
            >
              <Ionicons
                name={source.type === 'rss' ? 'logo-rss' : 'paper-plane-outline'}
                size={16}
                color={palette.primary}
              />
              <View className="flex-1">
                <Text className="text-xs font-semibold text-foreground">{source.title}</Text>
                <Text className="text-[10px] text-muted-foreground" numberOfLines={1}>
                  {source.url}
                </Text>
              </View>
              <Pressable
                onPress={() => removeSource(source.id)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Видалити ${source.title}`}
              >
                <Ionicons name="trash-outline" size={14} color={palette.destructive} />
              </Pressable>
            </View>
          ))}
        </View>

        {/* ── Застосунок (карточка обновлений в стиле Morphe Manager) ─ */}
        <MorpheUpdateCard />

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
