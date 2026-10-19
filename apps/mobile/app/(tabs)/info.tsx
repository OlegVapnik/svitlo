import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import { useNews } from '@svitlo/core/api/queries';
import { formatDateTime } from '@svitlo/core/lib/date';
import type { NewsItem, NewsKind } from '@svitlo/shared';

import { RegionPicker } from '@/components/home/RegionPicker';
import { useRegion } from '@/context/RegionContext';
import { useTheme } from '@/theme/ThemeProvider';

type KindFilter = 'all' | NewsKind;

const FILTERS: KindFilter[] = ['all', 'outage', 'schedule-change', 'repair', 'emergency', 'ukraine'];

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
 * Джерело — `GET /news`, той самий хук ядра, що у вебі. Офлайн пакет `/sync` кладе останні
 * новини області в кеш, тому перший екран не порожній без звʼязку. Карт і контактів тут немає:
 * це стрічка повідомлень, а не географія.
 */
export default function InfoScreen() {
  const { currentRegion } = useRegion();
  const { palette } = useTheme();
  const [kind, setKind] = useState<KindFilter>('all');
  const [ukraineWide, setUkraineWide] = useState(false);
  const [onlyPower, setOnlyPower] = useState(false);
  const [query, setQuery] = useState('');

  const news = useNews({
    region: currentRegion,
    kind: kind === 'all' ? undefined : kind,
    excludeKind: onlyPower ? 'other' : undefined,
    ukraineWide: ukraineWide || undefined,
    limit: 50,
  });
  const items = news.data?.data ?? [];

  // Область без власних джерел не повинна виглядати зламаною: підхоплюємо загальноукраїнську
  // стрічку тим самим запитом, що й веб.
  const useFallback = !ukraineWide && items.length === 0 && !news.isLoading && !news.isError;
  const fallback = useNews({
    region: currentRegion,
    kind: kind === 'all' ? undefined : kind,
    excludeKind: onlyPower ? 'other' : undefined,
    ukraineWide: true,
    limit: 50,
    enabled: useFallback,
  });

  const filtered = useMemo(() => {
    const source = items.length > 0 ? items : (fallback.data?.data ?? []);
    const relevant = onlyPower ? source.filter((item) => item.kind !== 'other') : source;
    const needle = query.trim().toLocaleLowerCase('uk-UA');
    if (!needle) return relevant;
    return relevant.filter((item) =>
      [item.title, item.summary, item.body]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase('uk-UA')
        .includes(needle),
    );
  }, [items, fallback.data, onlyPower, query]);

  const refreshing = (news.isFetching || fallback.isFetching) && !news.isLoading;
  // Ошибка запасной ленты тоже ошибка: иначе экран вечно писал бы «Шукаємо новини…».
  const error = (news.isError && items.length === 0) || (useFallback && fallback.isError);

  return (
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
              if (useFallback) void fallback.refetch();
            }}
            tintColor={palette.mutedForeground}
          />
        }
      >
        <View className="flex-row items-center justify-between">
          <View className="flex-1 gap-1 pr-3">
            <Text className="text-2xl font-bold tracking-tight text-foreground">Інфо</Text>
            <Text className="text-xs text-muted-foreground">Повідомлення операторів і Укренерго.</Text>
          </View>
          <RegionPicker />
        </View>

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

        <View className="flex-row flex-wrap gap-2">
          <Toggle
            label="Уся Україна"
            icon="globe-outline"
            active={ukraineWide}
            onPress={() => setUkraineWide((value) => !value)}
          />
          <Toggle
            label="Лише про світло"
            icon="flash-outline"
            active={onlyPower}
            onPress={() => setOnlyPower((value) => !value)}
          />
        </View>

        <View className="flex-row flex-wrap gap-2">
          {FILTERS.map((value) => {
            const active = kind === value;
            return (
              <Pressable
                key={value}
                onPress={() => setKind(value)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                className={
                  active
                    ? 'rounded-full border border-primary bg-primary-container px-3 py-2 active:opacity-80'
                    : 'rounded-full border border-border bg-surface-container-low px-3 py-2 active:opacity-70'
                }
              >
                <Text className={active ? 'text-xs font-semibold text-primary' : 'text-xs font-semibold text-muted-foreground'}>
                  {value === 'all' ? 'Усі' : KIND_LABEL[value]}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text className="text-xs text-muted-foreground">
          Знайдено: <Text className="font-semibold text-foreground">{filtered.length}</Text>
          {useFallback && (fallback.data?.data.length ?? 0) > 0 ? ' · загальноукраїнська стрічка' : ''}
        </Text>

        {news.isLoading && items.length === 0 ? (
          <ActivityIndicator color={palette.mutedForeground} />
        ) : error ? (
          <Text className="rounded-2xl border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
            Не вдалося завантажити новини. Перевірте звʼязок.
          </Text>
        ) : filtered.length === 0 ? (
          <Text className="rounded-2xl border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
            {fallback.isLoading ? 'Шукаємо новини…' : 'Новин поки немає.'}
          </Text>
        ) : (
          filtered.map((item) => <NewsCard key={item.id} item={item} />)
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Toggle({
  label,
  icon,
  active,
  onPress,
}: {
  label: string;
  icon: 'globe-outline' | 'flash-outline';
  active: boolean;
  onPress: () => void;
}) {
  const { palette } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      className={
        active
          ? 'min-h-11 flex-row items-center gap-1.5 rounded-full border border-primary bg-primary-container px-3 active:opacity-80'
          : 'min-h-11 flex-row items-center gap-1.5 rounded-full border border-border bg-surface-container-low px-3 active:opacity-70'
      }
    >
      <Ionicons name={icon} size={15} color={active ? palette.primary : palette.mutedForeground} />
      <Text className={active ? 'text-xs font-semibold text-primary' : 'text-xs font-semibold text-muted-foreground'}>
        {label}
      </Text>
    </Pressable>
  );
}

function NewsCard({ item }: { item: NewsItem }) {
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

  return (
    <Pressable
      onPress={() => void Linking.openURL(item.url)}
      accessibilityRole="link"
      className="gap-2 rounded-2xl border border-border bg-surface-container-low px-4 py-3 active:opacity-80"
    >
      <View className="flex-row flex-wrap items-center gap-2">
        <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: tone.soft, borderColor: tone.border, borderWidth: 1 }}>
          <Text className="text-[10px] font-semibold" style={{ color: tone.text }}>
            {KIND_LABEL[item.kind]}
          </Text>
        </View>
        <Text className="flex-1 text-[11px] text-muted-foreground" numberOfLines={1}>
          {sourceName(item.sourceKey)}
        </Text>
        <Text className="text-[11px] text-muted-foreground">
          {formatDateTime(item.publishedAt ?? item.firstSeenAt)}
        </Text>
      </View>
      <Text className="text-sm font-semibold leading-snug text-foreground">{item.title}</Text>
      {item.summary || item.body ? (
        <Text className="text-xs leading-relaxed text-muted-foreground" numberOfLines={3}>
          {item.summary || item.body}
        </Text>
      ) : null}
      {item.imageUrls.length > 0 ? (
        <View className="flex-row flex-wrap gap-2">
          {item.imageUrls.slice(0, 3).map((src) => (
            <Image
              key={src}
              source={{ uri: src }}
              resizeMode="cover"
              style={{ height: 120, width: 160, borderRadius: 12, backgroundColor: palette.surfaceContainerHigh }}
            />
          ))}
        </View>
      ) : null}
      <View className="flex-row items-center gap-1">
        <Text className="text-xs font-semibold text-primary">Джерело</Text>
        <Ionicons name="open-outline" size={13} color={palette.primary} />
      </View>
    </Pressable>
  );
}

function sourceName(sourceKey: string): string {
  const [, name] = sourceKey.split(':');
  return name ?? sourceKey;
}
