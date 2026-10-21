import { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, {
  FadeInDown,
  FadeOutDown,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { ArrowDownToLine, Check, Sparkles, X } from 'lucide-react-native';

import { useUpdates } from '@/context/UpdateContext';
import { useTheme } from '@/theme/ThemeProvider';
import { formatBytes } from '@/lib/updates';

/**
 * Плавающая капсула обновления над таб-баром.
 *
 * Живёт на всех вкладках (в layout табов), а не только на главной: человек мог открыть «Пошук»
 * и не увидеть, что бандл уже скачан. Стекло — полупрозрачный Obsidian-фон с изумрудным
 * свечением; blur-эффект не тянем отдельной нативной зависимостью ради одной капсулы.
 *
 * Кнопка «Застосувати» для APK сначала докачивает файл, для OTA — перезапускает процесс.
 */
export function DynamicUpdatePill() {
  const { palette } = useTheme();
  const { pending, dismissed, phase, progress, error, apkReady, openSheet, dismiss, apply } = useUpdates();

  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.value = withRepeat(
      withSequence(withTiming(1.16, { duration: 850 }), withTiming(1, { duration: 850 })),
      -1,
      false,
    );
    return () => cancelAnimation(pulse);
  }, [pulse]);

  const sparkStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));

  if (!pending || dismissed) return null;

  const verifying = phase === 'verifying';
  const downloading = phase === 'downloading' || verifying;
  const percent = Math.round(Math.max(0, Math.min(1, progress)) * 100);
  const actionLabel =
    pending.kind === 'ota'
      ? 'Застосувати'
      : apkReady
        ? 'Встановити'
        : verifying
          ? 'Перевірка файлу…'
          : downloading
            ? `Завантаження ${percent}%`
            : 'Завантажити';
  const detail =
    pending.kind === 'ota'
      ? 'Миттєве оновлення інтерфейсу · без перевстановлення'
      : `Повне оновлення застосунку${pending.sizeBytes ? ` · ${formatBytes(pending.sizeBytes)}` : ''}`;

  return (
    <Animated.View
      entering={FadeInDown.duration(280)}
      exiting={FadeOutDown.duration(160)}
      className="rounded-3xl border px-4 pb-3 pt-3"
      style={{
        backgroundColor: 'rgba(19, 19, 24, 0.94)',
        borderColor: 'rgba(16, 185, 129, 0.32)',
        shadowColor: palette.primary,
        shadowOpacity: 0.35,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 6 },
        elevation: 14,
      }}
    >
      <View className="flex-row items-start gap-3">
        <View
          style={{
            backgroundColor: palette.primaryContainer,
            borderColor: 'rgba(16, 185, 129, 0.35)',
            shadowColor: palette.primary,
            shadowOpacity: 0.6,
            shadowRadius: 10,
            shadowOffset: { width: 0, height: 0 },
            elevation: 6,
          }}
          className="h-9 w-9 items-center justify-center rounded-full border"
        >
          <Animated.View style={sparkStyle}>
            <Sparkles size={18} color={palette.primary} />
          </Animated.View>
        </View>

        <View className="flex-1 gap-0.5">
          <Text className="text-sm font-bold text-foreground">
            {apkReady && pending.kind === 'apk'
              ? `Оновлення v${pending.version} готове до встановлення`
              : `Оновлення v${pending.version} готове`}
          </Text>
          <Text className="text-[11px] leading-snug text-muted-foreground">{detail}</Text>
        </View>

        <Pressable
          onPress={dismiss}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Закрити повідомлення про оновлення"
          className="p-1 active:opacity-60"
        >
          <X size={16} color={palette.mutedForeground} />
        </Pressable>
      </View>

      {downloading ? (
        <View className="mt-2.5">
          <View className="h-1 overflow-hidden rounded-full" style={{ backgroundColor: palette.track }}>
            <View
              className="h-1 rounded-full"
              style={{ width: `${Math.max(2, percent)}%`, backgroundColor: palette.primary }}
            />
          </View>
          <Text className="mt-1 text-[10px] font-semibold text-muted-foreground">
            {verifying
              ? 'Файл завантажено · звіряємо SHA-256…'
              : pending.sizeBytes
                ? `${formatBytes(Math.round(pending.sizeBytes * (percent / 100)))} з ${formatBytes(pending.sizeBytes)}`
                : 'Завантаження…'}
          </Text>
        </View>
      ) : null}

      <View className="mt-2.5 flex-row items-center gap-2">
        <Pressable
          onPress={openSheet}
          accessibilityRole="button"
          className="min-h-10 flex-1 flex-row items-center justify-center gap-1.5 rounded-full border px-3 active:opacity-70"
          style={{ borderColor: 'rgba(255, 255, 255, 0.14)', backgroundColor: 'rgba(255, 255, 255, 0.04)' }}
        >
          <Sparkles size={13} color={palette.mutedForeground} />
          <Text className="text-xs font-semibold text-foreground">Що змінилось?</Text>
        </Pressable>

        <Pressable
          onPress={apply}
          disabled={downloading || phase === 'applying'}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          className="min-h-10 flex-1 flex-row items-center justify-center gap-1.5 rounded-full px-3 active:opacity-80"
          style={{ backgroundColor: palette.primary, opacity: downloading || phase === 'applying' ? 0.6 : 1 }}
        >
          {apkReady || phase === 'applying' ? (
            <Check size={14} color={palette.onPrimary} />
          ) : (
            <ArrowDownToLine size={14} color={palette.onPrimary} />
          )}
          <Text className="text-xs font-bold" style={{ color: palette.onPrimary }}>
            {phase === 'applying' ? 'Застосовуємо…' : actionLabel}
          </Text>
        </Pressable>
      </View>

      {error ? (
        <Text className="mt-2 text-[10px] leading-snug" style={{ color: palette.warning }}>
          {error}
        </Text>
      ) : null}
    </Animated.View>
  );
}
