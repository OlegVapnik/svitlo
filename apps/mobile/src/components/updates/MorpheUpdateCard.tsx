import { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import Animated, {
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { format } from 'date-fns';
import { Check, RefreshCw, Zap } from 'lucide-react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { useAppVersion, useChangelog } from '@svitlo/core/api/queries';
import { formatDate } from '@svitlo/core/lib/date';
import type { ChangelogRelease } from '@svitlo/shared';

import { APP_VERSION, useUpdates } from '@/context/UpdateContext';
import { formatBytes } from '@/lib/updates';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Карточка обновлений в стиле Morphe Manager.
 *
 * Заменяет прежнюю секцию «Застосунок» в «Налаштуваннях». Всё о состоянии доставки —
 * в одном месте: бейдж версий (моно), мета-строка релиза, структурированный чейнджлог
 * и многоступенчатый прогресс «Очікування → Завантаження → Перевірка SHA-256 → Готово».
 *
 * Палитра ограничена сознательно: зелёный #10B981 — только «идёт/готово», красный #F43F5E —
 * только ошибка. Без градиентов и свечений: карточка живёт в системном списке настроек.
 */
const GREEN = '#10B981';
const GREEN_SOFT_BG = 'rgba(16, 185, 129, 0.12)';
const GREEN_ON = '#05231a';
const RED = '#F43F5E';
const RED_SOFT_BG = 'rgba(244, 63, 94, 0.12)';

/** Моноширинный текст бейджей: у цифр одинаковая ширина, версии легко сличать взглядом. */
const MONO_FAMILY = Platform.select({ android: 'monospace', ios: 'Menlo', default: 'monospace' });

const STEPS = [
  { key: 'idle', label: 'Очікування' },
  { key: 'downloading', label: 'Завантаження' },
  { key: 'verifying', label: 'Перевірка SHA-256' },
  { key: 'ready', label: 'Готово до встановлення' },
] as const;

type StepState = 'done' | 'active' | 'pending' | 'failed';

interface ChangelogSection {
  icon: string;
  title: string;
  items: string[];
}

/** Одна ступень прогресса: кружок со статусом и подпись; активная — с процентами. */
function StepRow({
  label,
  state,
  percent,
  mutedColor,
}: {
  label: string;
  state: StepState;
  percent?: number | null;
  mutedColor: string;
}) {
  const accent = state === 'failed' ? RED : GREEN;
  const isPending = state === 'pending';
  return (
    <View className="flex-row items-center gap-2">
      <View
        className="h-4 w-4 items-center justify-center rounded-full"
        style={{
          backgroundColor: isPending ? 'transparent' : state === 'failed' ? RED_SOFT_BG : GREEN_SOFT_BG,
          borderWidth: isPending ? 1 : 0,
          borderColor: mutedColor,
        }}
      >
        {state === 'done' ? <Check size={11} color={accent} /> : null}
        {state === 'failed' ? <Ionicons name="close" size={12} color={accent} /> : null}
      </View>
      <Text
        className="flex-1 text-[11px] font-semibold"
        style={{ color: isPending ? mutedColor : accent }}
      >
        {label}
        {state === 'active' && percent != null ? ` · ${percent}%` : ''}
      </Text>
    </View>
  );
}

export function MorpheUpdateCard() {
  const { palette } = useTheme();
  const {
    pending,
    stage,
    stageProgress,
    stageKind,
    errorMessage,
    phase,
    apkReady,
    apply,
    startOtaUpdate,
    startApkUpdate,
    clearError,
  } = useUpdates();
  const versionQuery = useAppVersion();
  const changelog = useChangelog();
  const [expanded, setExpanded] = useState(false);

  const isAndroid = Platform.OS === 'android';
  const busy = stage === 'downloading' || stage === 'verifying' || phase === 'applying';

  // Смена целевой версии сбрасывает раскрытый список: новый релиз — свёрнутое состояние.
  const pendingVersion = pending?.version ?? null;
  useEffect(() => {
    setExpanded(false);
  }, [pendingVersion]);

  // Релиз чейнджлога, совпадающий с ожидающей версией; версии нормализуем на случай «v»-префикса.
  const release: ChangelogRelease | null = useMemo(() => {
    if (!pending) return null;
    const releases = changelog.data?.data.releases ?? [];
    const normalize = (value: string) => value.trim().replace(/^v/iu, '');
    return releases.find((item) => normalize(item.version) === normalize(pending.version)) ?? null;
  }, [changelog.data, pending]);

  const sections = useMemo<ChangelogSection[]>(() => {
    if (release) {
      return [
        { icon: '✨', title: 'Нові можливості', items: release.features },
        { icon: '🛠', title: 'Виправлення', items: release.fixes },
        { icon: '⚡', title: 'Оптимізації', items: release.optimizations },
      ].filter((section) => section.items.length > 0);
    }
    // Fallback: короткие тезисы из `/api/v1/version`, если чейнджлог не отдал релиз.
    if (pending && pending.notes.length > 0) {
      return [{ icon: '•', title: 'Зміни', items: pending.notes }];
    }
    return [];
  }, [pending, release]);

  const totalItems = sections.reduce((count, section) => count + section.items.length, 0);

  // Свёрнутый режим — максимум 3 пункта на все секции вместе.
  const visibleSections = useMemo(() => {
    let budget = expanded ? Number.POSITIVE_INFINITY : 3;
    return sections.map((section) => {
      const items = section.items.slice(0, Math.max(0, budget));
      budget -= items.length;
      return { ...section, items };
    });
  }, [expanded, sections]);

  // Индексы ступеней: при ошибке «подсвечивается» ступень, на которой всё сорвалось —
  // прогресс не дошёл до 100 % значит сорвалось скачивание, дошёл — сверка хэша.
  const failedIndex = stage === 'error' ? (stageProgress != null && stageProgress >= 100 ? 2 : 1) : -1;
  const activeIndex =
    failedIndex >= 0 ? -1 : stage === 'ready' ? 3 : stage === 'verifying' ? 2 : stage === 'downloading' ? 1 : 0;
  const showSteps = stage !== 'idle' || Boolean(errorMessage);

  const barWidth = useSharedValue(0);
  useEffect(() => {
    barWidth.value = withTiming(Math.max(0, Math.min(100, stageProgress ?? 0)), { duration: 260 });
  }, [barWidth, stageProgress]);
  const barStyle = useAnimatedStyle(() => ({ width: `${barWidth.value}%` }));

  const lastCheckedAt = versionQuery.dataUpdatedAt;
  const lastCheckLabel = lastCheckedAt > 0 ? format(lastCheckedAt, 'HH:mm') : null;
  const checkLabel = isAndroid ? 'Перевірити зараз' : 'Перевірити оновлення';

  return (
    <View
      className="gap-3 rounded-3xl border p-4"
      style={{ backgroundColor: palette.card, borderColor: palette.hairline }}
    >
      {/* Шапка секции: «Застосунок» + тип доставки ожидающего обновления */}
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-2.5">
          <View
            className="h-9 w-9 items-center justify-center rounded-xl"
            style={{ backgroundColor: palette.primaryContainer }}
          >
            <Ionicons name="sparkles" size={18} color={palette.primary} />
          </View>
          <Text className="text-sm font-bold text-foreground">Застосунок</Text>
        </View>
        {pending ? (
          <Text className="text-[10px] font-bold uppercase tracking-wide" style={{ color: GREEN }}>
            {pending.kind === 'ota' ? 'OTA' : 'APK'}
          </Text>
        ) : null}
      </View>

      {/* Бейдж версий (моно): текущая → доступная, либо «усе актуально» */}
      <View className="flex-row flex-wrap items-center gap-2">
        <View className="rounded-full bg-surface-container-high px-2.5 py-1">
          <Text className="text-[11px] font-bold text-foreground" style={{ fontFamily: MONO_FAMILY }}>
            Поточна: v{APP_VERSION}
          </Text>
        </View>
        {pending ? (
          <View className="flex-row items-center gap-2">
            <Text className="text-[11px]" style={{ color: palette.mutedForeground }}>
              →
            </Text>
            <View className="rounded-full px-2.5 py-1" style={{ backgroundColor: GREEN_SOFT_BG }}>
              <Text
                className="text-[11px] font-bold"
                style={{ fontFamily: MONO_FAMILY, color: GREEN }}
              >
                Доступна: v{pending.version}
              </Text>
            </View>
          </View>
        ) : (
          <Text className="text-[11px] text-muted-foreground">· Усе актуально</Text>
        )}
      </View>

      {/* Мета-строка: дата релиза · размер пакета · тип доставки */}
      {pending ? (
        <Text className="text-[11px] text-muted-foreground">
          {[
            pending.releasedAt ? formatDate(pending.releasedAt) : null,
            pending.sizeBytes ? formatBytes(pending.sizeBytes) : null,
            pending.kind === 'ota' ? 'OTA' : 'APK',
          ]
            .filter((part): part is string => Boolean(part))
            .join(' · ')}
        </Text>
      ) : null}

      {/* Структурированный чейнджлог ожидающей версии, свёрнутый до 3 пунктов */}
      {totalItems > 0 ? (
        <View className="gap-2">
          {visibleSections.map((section) =>
            section.items.length > 0 ? (
              <View key={section.title} className="gap-1">
                <Text className="text-[11px] font-bold text-foreground">
                  {section.icon} {section.title}
                </Text>
                {section.items.map((item, index) => (
                  <Text
                    key={`${section.title}-${index}`}
                    className="text-[11px] leading-snug text-muted-foreground"
                  >
                    • {item}
                  </Text>
                ))}
              </View>
            ) : null,
          )}
          {totalItems > 3 ? (
            <Pressable
              onPress={() => setExpanded((value) => !value)}
              accessibilityRole="button"
              accessibilityState={{ expanded }}
              className="self-start active:opacity-70"
            >
              <Text className="text-[11px] font-bold" style={{ color: GREEN }}>
                {expanded ? 'Згорнути' : 'Показати все'}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {/* Многоступенчатый прогресс: появляется, как только что-то начало происходить */}
      {showSteps ? (
        <Animated.View
          entering={FadeIn.duration(180)}
          className="gap-1.5 rounded-2xl p-3"
          style={{ backgroundColor: palette.surfaceContainerLow }}
        >
          {STEPS.map((step, index) => {
            const state: StepState =
              failedIndex >= 0
                ? index < failedIndex
                  ? 'done'
                  : index === failedIndex
                    ? 'failed'
                    : 'pending'
                : index < activeIndex
                  ? 'done'
                  : index === activeIndex
                    ? 'active'
                    : 'pending';
            return (
              <StepRow
                key={step.key}
                label={step.label}
                state={state}
                percent={stage === 'downloading' && index === 1 ? stageProgress : null}
                mutedColor={palette.mutedForeground}
              />
            );
          })}
          {stage === 'downloading' ? (
            <View className="mt-1 h-1 overflow-hidden rounded-full" style={{ backgroundColor: palette.track }}>
              <Animated.View style={[barStyle, { height: '100%', borderRadius: 999, backgroundColor: GREEN }]} />
            </View>
          ) : null}
        </Animated.View>
      ) : null}

      {/* Ошибка ступени: текст + «Повторити» тем же контуром (OTA или APK) */}
      {stage === 'error' && errorMessage ? (
        <View className="gap-2">
          <Text className="text-[11px] leading-snug" style={{ color: RED }}>
            {errorMessage}
          </Text>
          <Pressable
            onPress={stageKind === 'ota' ? startOtaUpdate : startApkUpdate}
            accessibilityRole="button"
            className="h-9 flex-row items-center justify-center gap-1.5 self-start rounded-full px-4 active:opacity-80"
            style={{ backgroundColor: RED_SOFT_BG }}
          >
            <RefreshCw size={13} color={RED} />
            <Text className="text-[11px] font-bold" style={{ color: RED }}>
              Повторити
            </Text>
          </Pressable>
        </View>
      ) : null}

      {/* Некритичное сообщение (например, «новіший JS-бандл не публікувався») */}
      {stage !== 'error' && errorMessage ? (
        <Text className="text-[11px] leading-snug text-muted-foreground">{errorMessage}</Text>
      ) : null}

      {/* Кнопки доставки: OTA + APK; на ступени «ready» — установка/перезапуск */}
      {isAndroid && pending && stage !== 'ready' ? (
        <View className="flex-row gap-2">
          <Pressable
            onPress={startOtaUpdate}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Швидке OTA-оновлення"
            className="h-11 flex-1 flex-row items-center justify-center gap-1.5 rounded-2xl bg-surface-container-high active:opacity-80"
            style={{ opacity: busy ? 0.5 : 1 }}
          >
            <Zap size={15} color={palette.foreground} />
            <Text className="text-xs font-bold text-foreground">Швидке OTA</Text>
          </Pressable>
          <Pressable
            onPress={startApkUpdate}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Завантажити повний APK"
            className="h-11 flex-1 flex-row items-center justify-center gap-1.5 rounded-2xl active:opacity-80"
            style={{ backgroundColor: GREEN, opacity: busy ? 0.5 : 1 }}
          >
            <Ionicons name="download-outline" size={15} color={GREEN_ON} />
            <Text className="text-xs font-bold" style={{ color: GREEN_ON }}>
              Завантажити APK
            </Text>
          </Pressable>
        </View>
      ) : null}

      {isAndroid && stage === 'ready' ? (
        <Pressable
          onPress={apply}
          disabled={phase === 'applying'}
          accessibilityRole="button"
          accessibilityLabel={stageKind === 'apk' ? 'Встановити APK' : 'Перезапустити застосунок'}
          className="h-11 flex-row items-center justify-center gap-1.5 rounded-2xl active:opacity-80"
          style={{ backgroundColor: GREEN, opacity: phase === 'applying' ? 0.5 : 1 }}
        >
          {stageKind === 'apk' ? (
            <Ionicons name="shield-checkmark-outline" size={15} color={GREEN_ON} />
          ) : (
            <RefreshCw size={14} color={GREEN_ON} />
          )}
          <Text className="text-xs font-bold" style={{ color: GREEN_ON }}>
            {phase === 'applying'
              ? 'Застосовуємо…'
              : stageKind === 'apk' && !apkReady
                ? 'Завантажити APK'
                : stageKind === 'apk'
                  ? 'Встановити'
                  : 'Перезапустити'}
          </Text>
        </Pressable>
      ) : null}

      {/* Без обновления: время последней проверки и ручной запрос `/api/v1/version` */}
      {!pending ? (
        <View className="gap-2">
          {lastCheckLabel ? (
            <Text className="text-[11px] text-muted-foreground">
              Остання перевірка: {lastCheckLabel}
            </Text>
          ) : null}
          <Pressable
            onPress={() => {
              clearError();
              void versionQuery.refetch();
            }}
            disabled={versionQuery.isFetching}
            accessibilityRole="button"
            accessibilityLabel={checkLabel}
            className="h-11 flex-row items-center justify-center gap-1.5 rounded-2xl bg-surface-container-high active:opacity-80"
            style={{ opacity: versionQuery.isFetching ? 0.5 : 1 }}
          >
            <RefreshCw size={14} color={palette.foreground} />
            <Text className="text-xs font-bold text-foreground">{checkLabel}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
