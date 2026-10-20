import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import { useNews, useNewsSources } from '@svitlo/core/api/queries';
import { formatDateTime } from '@svitlo/core/lib/date';
import type { NewsItem, NewsKind, NewsSource } from '@svitlo/shared';

import { RegionPicker } from '@/components/home/RegionPicker';
import { SwipeableScreen } from '@/components/navigation/SwipeableScreen';
import { useRegion } from '@/context/RegionContext';
import { useSettings } from '@/context/SettingsContext';
import { requestNotificationPermission } from '@/lib/notifications';
import { useTheme } from '@/theme/ThemeProvider';

type FeedFilter = 'all' | 'region' | 'ukrenergo' | 'emergency';

const FILTERS: Array<{ id: FeedFilter; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { id: 'all', label: 'Усі новини', icon: 'newspaper-outline' },
  { id: 'region', label: 'Моя область', icon: 'location-outline' },
  { id: 'ukrenergo', label: 'Укренерго', icon: 'flash-outline' },
  { id: 'emergency', label: 'Аварії', icon: 'warning-outline' },
];

const KIND_LABEL: Record<NewsKind, string> = {
  outage: 'Відключення',
  'schedule-change': 'Зміна графіка',
  repair: 'Ремонт',
  emergency: 'Аварія',
  ukraine: 'Україна',
  other: 'Інше',
};

/**
 * «Інфо»: стрічка новин операторів і Укренерго.
 *
 * Фильтры реально уходят на сервер (`/news?region&kind`), а «Укренерго» дополнительно
 * уточняется по `sourceKey` — зеркало не хранит отдельную категорию для канала. Источники
 * читаются из `/news/sources`: зелёная точка и список — честный признак живого сбора, а не
 * выдуманное «всё хорошо». Карточка открывает нижнюю шторку с полным текстом: сырой пост
 * Telegram не влезает в три строки, а ссылка на первоисточник остаётся отдельной кнопкой.
 */
export default function InfoScreen() {
  const { currentRegion } = useRegion();
  const { palette } = useTheme();
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<FeedFilter>('all');
  const [query, setQuery] = useState('');
  const [openItem, setOpenItem] = useState<NewsItem | null>(null);
  const { liveNotification, earlyLightDetector, setLiveNotification, setEarlyLightDetector } = useSettings();

  const news = useNews(
    filter === 'all' || filter === 'ukrenergo'
      ? { limit: 100 }
      : filter === 'emergency'
        ? { kind: 'emergency', limit: 100 }
        : { region: currentRegion, ukraineWide: true, limit: 100 },
  );
  const sourcesQuery = useNewsSources();

  const items = news.data?.data ?? [];
  const sources = sourcesQuery.data?.data ?? [];

  const filtered = useMemo(() => {
    const base =
      filter === 'ukrenergo'
        ? items.filter((item) => item.sourceKey.toLocaleLowerCase('uk-UA').includes('ukrenergo'))
        : items;
    const needle = query.trim().toLocaleLowerCase('uk-UA');
    if (!needle) return base;
    return base.filter((item) =>
      [item.title, item.summary, item.body]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase('uk-UA')
        .includes(needle),
    );
  }, [filter, items, query]);

  const refreshing = news.isFetching && !news.isLoading;
  const error = news.isError && items.length === 0;

  return (
    <SwipeableScreen>
      <SafeAreaView className="flex-1 bg-surface-dim" edges={['top']}>
        <ScrollView
          contentContainerStyle={{ gap: 14, paddingHorizontal: 16, paddingBottom: 32, paddingTop: 12 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                void news.refetch();
                void sourcesQuery.refetch();
              }}
              tintColor={palette.mutedForeground}
            />
          }
        >
          <View className="flex-row items-center justify-between">
            <View className="flex-1 gap-1 pr-3">
              <Text className="text-2xl font-bold tracking-tight text-foreground">Новини</Text>
              <Text className="text-xs text-muted-foreground">Повідомлення операторів і Укренерго.</Text>
            </View>
            <RegionPicker />
          </View>

          <SourceBar sources={sources} loading={sourcesQuery.isLoading} updatedAt={news.dataUpdatedAt} />

          <View className="flex-row items-center gap-2 rounded-xl border border-border bg-surface-container-low px-3">
            <Ionicons name="search" size={16} color={palette.mutedForeground} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Пошук у новинах"
              placeholderTextColor={palette.mutedForeground}
              autoCorrect={false}
              className="min-h-11 flex-1 py-2 text-sm text-foreground"
            />
            {query ? (
              <Pressable onPress={() => setQuery('')} accessibilityLabel="Очистити пошук" className="p-1 active:opacity-70">
                <Ionicons name="close-circle" size={18} color={palette.mutedForeground} />
              </Pressable>
            ) : null}
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, paddingRight: 8 }}
          >
            {FILTERS.map(({ id, label, icon }) => {
              const active = filter === id;
              return (
                <Pressable
                  key={id}
                  onPress={() => setFilter(id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={
                    active
                      ? { backgroundColor: palette.primaryContainer, borderColor: palette.status.on.border }
                      : { backgroundColor: palette.surfaceContainerLow, borderColor: palette.border }
                  }
                  className="min-h-10 flex-row items-center gap-1.5 rounded-full border px-3 active:opacity-80"
                >
                  <Ionicons name={icon} size={14} color={active ? palette.primary : palette.mutedForeground} />
                  <Text
                    className="text-xs font-semibold"
                    style={{ color: active ? palette.primary : palette.mutedForeground }}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <View className="flex-row flex-wrap items-center gap-2">
            <Text className="text-xs text-muted-foreground">
              Знайдено: <Text className="font-semibold text-foreground">{filtered.length}</Text>
            </Text>
            {news.data?.meta?.stale ? (
              <View className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5">
                <Text className="text-[10px] font-semibold text-warning">Немає свіжих за 24 год</Text>
              </View>
            ) : null}
          </View>

          <View
            style={{ backgroundColor: palette.card, borderColor: palette.hairline }}
            className="gap-1 rounded-2xl border px-4 py-2"
          >
            <Text className="pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Налаштування
            </Text>
            <SettingRow
              title="Постійний індикатор у шторці"
              hint="Статус, прогрес і зворотний відлік прямо в повідомленнях."
              value={liveNotification}
              onChange={async (next) => {
                if (next) await requestNotificationPermission();
                setLiveNotification(next);
              }}
            />
            <SettingRow
              title="Детектор раннього світла"
              hint="Пуш, якщо телефон став на зарядку під час відключення за графіком."
              value={earlyLightDetector}
              onChange={setEarlyLightDetector}
            />
          </View>

          {news.isLoading && items.length === 0 ? (
            <ActivityIndicator color={palette.mutedForeground} />
          ) : error ? (
            <View className="items-center gap-2 rounded-2xl border border-border bg-card px-4 py-6">
              <Text className="text-center text-sm text-muted-foreground">
                Не вдалося завантажити новини. Перевірте звʼязок.
              </Text>
              <Pressable onPress={() => void news.refetch()} className="rounded-full border border-border px-4 py-2 active:opacity-70">
                <Text className="text-xs font-semibold text-foreground">Спробувати ще</Text>
              </Pressable>
            </View>
          ) : filtered.length === 0 ? (
            <Text className="rounded-2xl border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
              {filter === 'region'
                ? 'Для цієї області новин поки немає. Перемкніться на «Усі новини».'
                : 'Новин поки немає.'}
            </Text>
          ) : (
            filtered.map((item) => <NewsCard key={item.id} item={item} onOpen={setOpenItem} />)
          )}
        </ScrollView>

        <NewsSheet item={openItem} onClose={() => setOpenItem(null)} bottomInset={insets.bottom} />
      </SafeAreaView>
    </SwipeableScreen>
  );
}

/** Название источника без технического префикса `telegram:` / `rss:`. */
function sourceLabel(sourceKey: string): string {
  const [, name] = sourceKey.split(':');
  return name ?? sourceKey;
}

/** «10 хв тому» — компактный возраст данных для строки источников. */
function timeAgo(iso: string | null | undefined): string {
  if (!iso) return 'щойно';
  const diff = Date.now() - Date.parse(iso);
  if (!Number.isFinite(diff) || diff < 0) return 'щойно';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'щойно';
  if (minutes < 60) return `${minutes} хв тому`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} год тому`;
  return `${Math.floor(hours / 24)} дн тому`;
}

function SourceBar({
  sources,
  loading,
  updatedAt,
}: {
  sources: NewsSource[];
  loading: boolean;
  updatedAt: number;
}) {
  const { palette } = useTheme();
  const alive = sources.filter((source) => source.itemsCount > 0 && !source.lastError);
  const names = alive.slice(0, 3).map((source) => sourceLabel(source.sourceKey));
  const lastOk = alive
    .map((source) => source.lastOkAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
  const updated = lastOk ?? (updatedAt ? new Date(updatedAt).toISOString() : null);

  return (
    <View className="flex-row items-center gap-2 rounded-xl border border-hairline bg-card px-3 py-2">
      <View
        className="h-2 w-2 rounded-full"
        style={{
          backgroundColor: alive.length > 0 ? palette.status.on.color : palette.status.unknown.color,
          shadowColor: alive.length > 0 ? palette.status.on.color : palette.status.unknown.color,
          shadowOpacity: 0.9,
          shadowRadius: 5,
          shadowOffset: { width: 0, height: 0 },
          elevation: 3,
        }}
      />
      {loading && sources.length === 0 ? (
        <Text className="flex-1 text-[11px] text-muted-foreground">Перевіряємо джерела…</Text>
      ) : (
        <Text className="flex-1 text-[11px] text-muted-foreground" numberOfLines={2}>
          <Text className="font-semibold text-foreground">Читаємо: </Text>
          {names.length > 0 ? names.join(', ') : 'джерела недоступні'}
          {updated ? <Text> · оновлено {timeAgo(updated)}</Text> : null}
        </Text>
      )}
    </View>
  );
}

/**
 * Очистка сырого поста Telegram: markdown-звёздочки, обратные кавычки, склеенные ссылки
 * и повторные пустые строки. Ссылку не теряем — она живёт в отдельной кнопке карточки.
 */
function cleanNewsText(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .replace(/\r\n/gu, '\n')
    // Telegram отдаёт HTML-сущности (&#10; = перевод строки), и без декодирования они
    // попадают в карточку буквальным текстом.
    .replace(/&#(\d+);/gu, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/giu, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&nbsp;/gu, ' ')
    .replace(/&quot;/gu, '"')
    .replace(/&#39;|&apos;/gu, "'")
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&amp;/gu, '&')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/gu, '$1')
    .replace(/https?:\/\/t\.me\/\S+/giu, '')
    .replace(/[*_`~]+/gu, '')
    .replace(/[\u200b-\u200d\ufeff]/gu, '')
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .replace(/[ \t]{2,}/gu, ' ')
    .trim();
}

function NewsCard({ item, onOpen }: { item: NewsItem; onOpen: (item: NewsItem) => void }) {
  const { palette } = useTheme();
  const tone =
    item.kind === 'emergency'
      ? palette.status.off
      : item.kind === 'outage'
        ? palette.status.warning
        : item.kind === 'ukraine'
          ? palette.status.on
          : item.kind === 'other'
            ? palette.status.unknown
            : palette.status.warning;

  // Регрессия из веба: у части постов severity = null. Вызывать .toUpperCase() без проверки
  // нельзя — экран падал. Метка опциональна и появляется только у реального значения.
  const severity = (item as NewsItem & { severity?: string | null }).severity;
  const severityLabel = typeof severity === 'string' && severity.length > 0 ? severity.toUpperCase() : null;
  const summary = cleanNewsText(item.summary || item.body);
  const rawTitle = cleanNewsText(item.title);
  // У части постов Telegram заголовка нет — берём первую строку текста, иначе карточка
  // выглядит пустой. Превью тогда не дублируем.
  const title = rawTitle || summary.split('\n').find((line) => line.trim().length > 0)?.slice(0, 140) || 'Повідомлення';
  const preview = summary && summary !== title ? summary : '';

  return (
    <Pressable
      onPress={() => onOpen(item)}
      accessibilityRole="button"
      accessibilityLabel={`Відкрити новину: ${item.title}`}
      style={{ backgroundColor: palette.card, borderColor: palette.hairline }}
      className="gap-2 overflow-hidden rounded-2xl border px-4 py-3 active:opacity-85"
    >
      <View className="flex-row flex-wrap items-center gap-2">
        <View
          className="rounded-full px-2 py-0.5"
          style={{ backgroundColor: tone.soft, borderColor: tone.border, borderWidth: 1 }}
        >
          <Text className="text-[10px] font-semibold" style={{ color: tone.text }}>
            {KIND_LABEL[item.kind] ?? 'Інше'}
          </Text>
        </View>
        {severityLabel ? (
          <View className="rounded-full border border-border px-2 py-0.5">
            <Text className="text-[10px] font-semibold text-muted-foreground">{severityLabel}</Text>
          </View>
        ) : null}
        <Text className="flex-1 text-[11px] text-muted-foreground" numberOfLines={1}>
          {sourceLabel(item.sourceKey)}
        </Text>
        <Text className="text-[11px] text-muted-foreground">
          {formatDateTime(item.publishedAt ?? item.firstSeenAt)}
        </Text>
      </View>

      <Text className="text-sm font-semibold leading-snug text-foreground">{title}</Text>

      {preview ? (
        <Text className="text-xs leading-relaxed text-muted-foreground" numberOfLines={3}>
          {preview}
        </Text>
      ) : null}

      {item.imageUrls.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {item.imageUrls.slice(0, 4).map((src) => (
            <Image
              key={src}
              source={{ uri: src }}
              resizeMode="cover"
              style={{ height: 120, width: 160, borderRadius: 12, backgroundColor: palette.surfaceContainerHigh }}
            />
          ))}
        </ScrollView>
      ) : null}

      <View className="flex-row items-center gap-1">
        <Text className="text-xs font-semibold text-primary">Читати далі</Text>
        <Ionicons name="chevron-forward" size={13} color={palette.primary} />
      </View>
    </Pressable>
  );
}

function NewsSheet({
  item,
  onClose,
  bottomInset,
}: {
  item: NewsItem | null;
  onClose: () => void;
  bottomInset: number;
}) {
  const { palette } = useTheme();
  if (!item) return null;
  const body = cleanNewsText(item.body || item.summary);
  const title = cleanNewsText(item.title);

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View className="flex-1 justify-end" style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}>
        <Pressable className="flex-1" onPress={onClose} accessibilityLabel="Закрити" />
        <View
          style={{
            backgroundColor: palette.surfaceContainer,
            borderColor: palette.hairline,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            maxHeight: '86%',
            paddingBottom: 16 + bottomInset,
          }}
          className="border-t px-5 pt-3"
        >
          <View className="mb-3 h-1 w-10 self-center rounded-full" style={{ backgroundColor: palette.borderStrong }} />
          <View className="flex-row items-start gap-3">
            <View className="flex-1 gap-1">
              <Text className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {sourceLabel(item.sourceKey)} · {formatDateTime(item.publishedAt ?? item.firstSeenAt)}
              </Text>
              <Text className="text-lg font-bold leading-snug text-foreground">{title}</Text>
            </View>
            <Pressable onPress={onClose} className="p-1 active:opacity-70" accessibilityLabel="Закрити">
              <Ionicons name="close" size={22} color={palette.foreground} />
            </Pressable>
          </View>

          <ScrollView className="mt-3" contentContainerStyle={{ gap: 12, paddingBottom: 8 }}>
            {body ? <Text className="text-sm leading-relaxed text-foreground">{body}</Text> : null}
            {item.imageUrls.map((src) => (
              <Image
                key={src}
                source={{ uri: src }}
                resizeMode="cover"
                style={{ width: '100%', height: 220, borderRadius: 14, backgroundColor: palette.surfaceContainerHigh }}
              />
            ))}
          </ScrollView>

          <View className="mt-3 flex-row gap-2">
            <Pressable
              onPress={() => void Linking.openURL(item.url)}
              className="min-h-11 flex-1 flex-row items-center justify-center gap-2 rounded-full px-4 active:opacity-80"
              style={{ backgroundColor: palette.primary }}
            >
              <Ionicons name="open-outline" size={16} color={palette.onPrimary} />
              <Text className="text-sm font-semibold" style={{ color: palette.onPrimary }}>
                Відкрити джерело
              </Text>
            </Pressable>
            <Pressable
              onPress={onClose}
              className="min-h-11 items-center justify-center rounded-full border px-4 active:opacity-70"
              style={{ borderColor: palette.border }}
            >
              <Text className="text-sm font-semibold text-foreground">Закрити</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}


function SettingRow({
  title,
  hint,
  value,
  onChange,
}: {
  title: string;
  hint: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  const { palette } = useTheme();
  return (
    <View className="flex-row items-center gap-3 py-2">
      <View className="flex-1 gap-0.5">
        <Text className="text-sm font-semibold text-foreground">{title}</Text>
        <Text className="text-[11px] leading-snug text-muted-foreground">{hint}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={(next) => void onChange(next)}
        trackColor={{ false: palette.surfaceContainerHighest, true: palette.primary }}
        thumbColor={value ? palette.onPrimary : palette.mutedForeground}
      />
    </View>
  );
}
