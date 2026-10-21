import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View, type ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Bug,
  Check,
  ChevronDown,
  Gauge,
  Package,
  ShieldCheck,
  Sparkles,
  X,
  Zap,
} from 'lucide-react-native';

import { useChangelog } from '@svitlo/core/api/queries';
import { formatDate } from '@svitlo/core/lib/date';
import type { ChangelogFile, ChangelogRelease } from '@svitlo/shared';

import { WavyProgressBar } from '@/components/ui/WavyProgressBar';
import { APP_VERSION, useUpdates } from '@/context/UpdateContext';
import { formatBytes } from '@/lib/updates';
import { useTheme } from '@/theme/ThemeProvider';
import { UPDATE_TONES, type UpdateTone } from '@/theme/update-tones';

type SectionKey = 'features' | 'fixes' | 'optimizations';

const SECTIONS: Array<{
  key: SectionKey;
  title: string;
  Icon: typeof Sparkles;
  tone: UpdateTone;
}> = [
  { key: 'features', title: 'Нові можливості', Icon: Sparkles, tone: UPDATE_TONES.feature },
  { key: 'fixes', title: 'Виправлення', Icon: Bug, tone: UPDATE_TONES.fix },
  { key: 'optimizations', title: 'Прискорення', Icon: Gauge, tone: UPDATE_TONES.optimization },
];

function totalChanges(release: ChangelogRelease): number {
  return release.features.length + release.fixes.length + release.optimizations.length;
}

/** Секции одного релиза: цветная пилюля-заголовок и список пунктов с точкой того же цвета. */
function ReleaseSections({ release }: { release: ChangelogRelease }) {
  return (
    <View className="gap-2">
      {SECTIONS.map(({ key, title, Icon, tone }) => {
        const items = release[key];
        if (items.length === 0) return null;
        return (
          <View
            key={key}
            className="rounded-2xl border p-3"
            style={{ backgroundColor: tone.soft, borderColor: tone.border }}
          >
            <View className="flex-row items-center gap-2">
              <Icon size={14} color={tone.dot} />
              <Text className="text-xs font-bold" style={{ color: tone.text }}>
                {title}
              </Text>
              <View
                className="ml-auto min-w-6 items-center justify-center rounded-full px-2 py-0.5"
                style={{ backgroundColor: 'rgba(255, 255, 255, 0.08)' }}
              >
                <Text className="text-[10px] font-bold text-foreground">{items.length}</Text>
              </View>
            </View>
            <View className="mt-2 gap-1.5">
              {items.map((text, index) => (
                <View key={`${key}-${index}`} className="flex-row gap-2">
                  <View className="mt-1.5 h-1.5 w-1.5 rounded-full" style={{ backgroundColor: tone.dot }} />
                  <Text className="flex-1 text-[13px] leading-snug text-foreground">{text}</Text>
                </View>
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
}

/**
 * Блок «є оновлення»: версия, тип доставки и единственное действие.
 *
 * Для APK здесь же живёт WavyProgressBar — та же фирменная волна, что в графике отключений:
 * 34 МБ по мобильной сети нельзя качать «молча», человек должен видеть проценты и то, что файл
 * ещё и сверяется по SHA-256.
 */
function UpdateBlock({ onClose }: { onClose: () => void }) {
  const { palette } = useTheme();
  const { pending, phase, progress, error, apkReady, apply } = useUpdates();

  if (!pending) {
    return (
      <View
        className="flex-row items-center gap-3 rounded-2xl border px-3 py-3"
        style={{ borderColor: 'rgba(16, 185, 129, 0.28)', backgroundColor: 'rgba(16, 185, 129, 0.08)' }}
      >
        <Check size={18} color={palette.primary} />
        <View className="flex-1">
          <Text className="text-sm font-semibold text-foreground">У вас актуальна версія · v{APP_VERSION}</Text>
          <Text className="text-[11px] text-muted-foreground">Нових збірок сервер поки не публікував.</Text>
        </View>
      </View>
    );
  }

  const isOta = pending.kind === 'ota';
  const percent = Math.round(Math.max(0, Math.min(1, progress)) * 100);
  const verifying = phase === 'verifying';
  const downloading = phase === 'downloading' || verifying;
  const DeliveryIcon = isOta ? Zap : Package;
  const deliveryTitle = isOta ? 'Миттєве оновлення інтерфейсу' : 'Повне оновлення застосунку';
  const deliveryHint = isOta
    ? 'JS-бандл уже на пристрої: застосунок перезапуститься за секунду, перевстановлювати APK не потрібно.'
    : `Нова збірка${pending.sizeBytes ? ` · ${formatBytes(pending.sizeBytes)}` : ''}. Перед встановленням файл звіряється за SHA-256.`;
  const primaryLabel = isOta
    ? 'Застосувати зараз'
    : apkReady
      ? 'Встановити'
      : verifying
        ? 'Звіряємо SHA-256…'
        : downloading
          ? `Завантаження ${percent}%`
          : 'Завантажити APK';

  return (
    <View
      className="gap-3 rounded-3xl border p-4"
      style={{ backgroundColor: palette.primaryContainer, borderColor: 'rgba(16, 185, 129, 0.32)' }}
    >
      <View className="flex-row items-center gap-3">
        <View
          className="h-11 w-11 items-center justify-center rounded-2xl border"
          style={{ borderColor: 'rgba(16, 185, 129, 0.4)', backgroundColor: 'rgba(16, 185, 129, 0.16)' }}
        >
          <DeliveryIcon size={20} color={palette.primary} />
        </View>
        <View className="flex-1 gap-0.5">
          <View className="flex-row items-center gap-2">
            <View className="rounded-lg border px-2 py-0.5" style={{ borderColor: 'rgba(16, 185, 129, 0.4)' }}>
              <Text className="text-xs font-bold" style={{ color: palette.primary }}>
                v{pending.version}
              </Text>
            </View>
            <Text className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {isOta ? 'OTA' : 'APK'}
            </Text>
          </View>
          <Text className="text-sm font-semibold text-foreground">{deliveryTitle}</Text>
        </View>
      </View>

      <Text className="text-xs leading-relaxed text-muted-foreground">{deliveryHint}</Text>

      {!isOta && downloading ? (
        <View className="gap-1">
          <WavyProgressBar
            progress={percent}
            tone="on"
            elapsedLabel={`${percent}%`}
            remainingLabel={pending.sizeBytes ? formatBytes(pending.sizeBytes) : undefined}
          />
          <Text className="text-[10px] font-semibold text-muted-foreground">
            {apkReady ? 'SHA-256 збігається' : verifying ? 'Звіряємо SHA-256…' : 'Після завантаження звіримо SHA-256 перед встановленням'}
          </Text>
        </View>
      ) : null}

      {!isOta && apkReady ? (
        <View className="flex-row items-center gap-1.5">
          <ShieldCheck size={13} color={palette.success} />
          <Text className="text-[11px] font-semibold text-foreground">
            Файл перевірено · SHA-256 {pending.sha256 ? `${pending.sha256.slice(0, 12)}…` : 'збігається'}
          </Text>
        </View>
      ) : null}

      <View className="flex-row gap-2">
        <Pressable
          onPress={apply}
          disabled={downloading || phase === 'applying'}
          accessibilityRole="button"
          className="min-h-11 flex-1 flex-row items-center justify-center gap-2 rounded-full px-4 active:opacity-80"
          style={{
            backgroundColor: palette.primary,
            opacity: downloading || phase === 'applying' ? 0.6 : 1,
          }}
        >
          {apkReady || phase === 'applying' ? (
            <Check size={16} color={palette.onPrimary} />
          ) : (
            <DeliveryIcon size={16} color={palette.onPrimary} />
          )}
          <Text className="text-sm font-bold" style={{ color: palette.onPrimary }}>
            {phase === 'applying' ? 'Застосовуємо…' : primaryLabel}
          </Text>
        </Pressable>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          className="min-h-11 items-center justify-center rounded-full border px-4 active:opacity-70"
          style={{ borderColor: palette.border }}
        >
          <Text className="text-sm font-semibold text-foreground">Пізніше</Text>
        </Pressable>
      </View>

      {error ? (
        <Text className="text-[11px] leading-snug" style={{ color: palette.warning }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}


/** Карточка одного релиза: свёрнутая строка с версией и датой, раскрытая — секции. */
function ReleaseCard({ release, defaultOpen = false }: { release: ChangelogRelease; defaultOpen?: boolean }) {
  const { palette } = useTheme();
  const [open, setOpen] = useState(defaultOpen);
  const changes = totalChanges(release);

  return (
    <View
      className="overflow-hidden rounded-2xl border"
      style={{ borderColor: palette.border, backgroundColor: palette.card }}
    >
      <Pressable
        onPress={() => setOpen((value) => !value)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        className="flex-row items-center gap-3 px-3 py-3 active:opacity-80"
      >
        <View
          className="items-center rounded-xl border px-2 py-1"
          style={{ borderColor: 'rgba(16, 185, 129, 0.3)', backgroundColor: 'rgba(16, 185, 129, 0.1)' }}
        >
          <Text className="text-[11px] font-bold" style={{ color: palette.primary }}>
            v{release.version}
          </Text>
        </View>
        <View className="flex-1 gap-0.5">
          <Text className="text-[13px] font-semibold text-foreground">
            {changes > 0 ? `${changes} ${changes === 1 ? 'зміна' : changes < 5 ? 'зміни' : 'змін'}` : 'Без опису'}
          </Text>
          <Text className="text-[11px] text-muted-foreground">
            {formatDate(release.date)} · {release.tag === 'Release' ? 'реліз' : 'оновлення'}
          </Text>
        </View>
        <View style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}>
          <ChevronDown size={16} color={palette.mutedForeground} />
        </View>
      </Pressable>
      {open ? (
        <View className="px-3 pb-3">
          <ReleaseSections release={release} />
        </View>
      ) : null}
    </View>
  );
}

/** Подпись под заголовком: версия последнего релиза и дата, когда сервер его собрал. */
function releaseSummary(version: string | undefined, generatedAt: string | null): string {
  if (!version) return 'Історія змін застосунку';
  if (!generatedAt) return `Останній реліз · v${version}`;
  return `Останній реліз · v${version} · ${formatDate(generatedAt)}`;
}


/**
 * Нижняя шторка «Що нового».
 *
 * Один экран отвечает на два вопроса: «что мне приедет» (версия, тип доставки, прогресс) и
 * «что уже изменилось» (серверный чейнджлог, сгруппированный по смыслу). Данные —
 * `GET /api/v1/changelog`: серверный фикс обязан быть виден в установленном приложении без
 * пересборки APK. Если сети нет — честное «історія недоступна», без выдуманного списка.
 */
export function ChangelogSheet() {
  const { palette } = useTheme();
  const insets = useSafeAreaInsets();
  const { sheetOpen, closeSheet } = useUpdates();
  const changelog = useChangelog();
  const file = changelog.data?.data as ChangelogFile | undefined;
  const releases = file?.releases ?? [];
  const [latest, ...older] = releases;
  const scrollRef = useRef<ScrollViewInstance>(null);

  // Modal не размонтируется между открытиями, поэтому ScrollView помнит позицию прошлой
  // сессии и шторка открывается на середине списка. Сбрасываем к блоку обновления.
  useEffect(() => {
    if (sheetOpen) scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [sheetOpen]);

  return (
    <Modal
      visible={sheetOpen}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={closeSheet}
    >
      {/* Нативная slide-анимация, а не Reanimated `entering`: при включённом в системе
          «уменьшении анимаций» layout-анимация внутри Modal не проигрывалась, и шторка
          открывалась невидимой, блокируя все тапы под собой. */}
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0, 0, 0, 0.65)' }}>
        <Pressable className="flex-1" onPress={closeSheet} accessibilityLabel="Закрити" />
        <View
          style={{
            maxHeight: '92%',
            backgroundColor: palette.surfaceContainer,
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            borderColor: palette.hairline,
            borderWidth: 1,
            paddingTop: 8,
          }}
        >
          <View
            className="mb-2 h-1 w-10 self-center rounded-full"
            style={{ backgroundColor: palette.borderStrong }}
          />

          <View className="flex-row items-center gap-3 px-5 pb-2">
            <View
              className="h-10 w-10 items-center justify-center rounded-2xl border"
              style={{ backgroundColor: palette.primaryContainer, borderColor: 'rgba(16, 185, 129, 0.32)' }}
            >
              <Sparkles size={18} color={palette.primary} />
            </View>
            <View className="flex-1">
              <Text className="text-lg font-bold text-foreground">Що нового</Text>
              <Text className="text-[11px] text-muted-foreground">
                {releaseSummary(latest?.version ?? file?.version, file?.generatedAt ?? null)}
              </Text>
            </View>
            <Pressable
              onPress={closeSheet}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Закрити"
              className="p-1 active:opacity-60"
            >
              <X size={20} color={palette.foreground} />
            </Pressable>
          </View>

          <ScrollView
            ref={scrollRef}
            contentContainerStyle={{ gap: 14, paddingHorizontal: 16, paddingBottom: 24 + insets.bottom }}
            showsVerticalScrollIndicator={false}
          >
            <UpdateBlock onClose={closeSheet} />
            {latest ? (
              <View className="gap-2">
                <Text className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                  Останні зміни
                </Text>
                <ReleaseCard release={latest} defaultOpen />
                {older.length > 0 ? (
                  <Text className="mt-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                    Попередні версії
                  </Text>
                ) : null}
                {older.map((release) => (
                  <ReleaseCard key={release.version} release={release} />
                ))}
              </View>
            ) : changelog.isLoading ? (
              <Text className="text-sm text-muted-foreground">Завантажуємо історію змін…</Text>
            ) : (
              <View
                className="rounded-2xl border px-3 py-3"
                style={{ borderColor: palette.border, backgroundColor: palette.card }}
              >
                <Text className="text-sm font-semibold text-foreground">Історія оновлень недоступна</Text>
                <Text className="mt-1 text-[11px] leading-snug text-muted-foreground">
                  Сервер не віддав список змін. Це не помилка застосунку — перевірте зв’язок і відкрийте шторку ще раз.
                </Text>
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
