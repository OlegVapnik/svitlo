import React, { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Linking, Modal, Pressable, RefreshControl, ScrollView, TextInput, View } from 'react-native';
import { Text } from '@/components/ui/AppText';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  Calendar,
  ChevronDown,
  Clock,
  CloudOff,
  ExternalLink,
  EyeOff,
  Globe,
  Maximize2,
  Newspaper,
  Plus,
  Rss,
  Search,
  Send,
  Settings,
  Trash,
  TriangleAlert,
  Wrench,
  X,
  Zap,
} from 'lucide-react-native';

import { useNews, useNewsSources } from '@svitlo/core/api/queries';
import { latestIso } from '@svitlo/core/lib/date';
import { regionCatalogName, type NewsItem } from '@svitlo/shared';

import { ScreenHeader } from '@/components/navigation/ScreenHeader';
import { SwipeableScreen } from '@/components/navigation/SwipeableScreen';
import { useRegion } from '@/context/RegionContext';
import { useSettings } from '@/context/SettingsContext';
import { useCustomNewsSources } from '@/hooks/useCustomNewsSources';
import { cleanNewsCardContent, formatSourceLabel } from '@/lib/news-format';
import { filterRecentNews } from '@/lib/news-recency';
import { useTheme, type Palette } from '@/theme/ThemeProvider';

/**
 * Фільтри стрічки новин:
 * - all: Усі новини для поточного регіону (включно з власними)
 * - outage: Лише про відключення світла
 * - schedule-change: Графіки погодинних відключень
 * - emergency: Аварійні та екстрені ситуації
 * - repair: Ремонтні роботи енергетиків
 * - ukraine: Загальноукраїнська стрічка новин
 * - custom: Додані користувачем Telegram-канали та RSS-джерела
 */
type FilterKey = 'all' | 'outage' | 'schedule-change' | 'emergency' | 'repair' | 'ukraine' | 'custom';

interface FilterDef {
  key: FilterKey;
  label: string;
  Icon?: typeof Zap;
}

const FILTERS: FilterDef[] = [
  { key: 'all', label: 'Усі' },
  { key: 'outage', label: 'Світло', Icon: Zap },
  { key: 'schedule-change', label: 'Графіки', Icon: Calendar },
  { key: 'emergency', label: 'Аварії', Icon: TriangleAlert },
  { key: 'repair', label: 'Ремонти', Icon: Wrench },
  { key: 'ukraine', label: 'Україна', Icon: Globe },
  { key: 'custom', label: 'Мої канали', Icon: Rss },
];

function kindMeta(palette: Palette, kind: string): { label: string; color: string; Icon: typeof Zap } {
  switch (kind) {
    case 'outage':
      return { label: 'Світло', color: palette.warning, Icon: Zap };
    case 'emergency':
      return { label: 'Аварія', color: palette.destructive, Icon: TriangleAlert };
    case 'schedule-change':
      return { label: 'Графік', color: palette.info, Icon: Calendar };
    case 'repair':
      return { label: 'Ремонт', color: palette.levelHigh, Icon: Wrench };
    default:
      return { label: 'Новина', color: palette.unknown, Icon: Globe };
  }
}

const sourceLabel = formatSourceLabel;

/** Короткий час українською: «щойно», «12 хв тому», «вчора, 21:04», «24.10, 09:30». */
function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const diffMinutes = Math.floor((Date.now() - date.getTime()) / 60_000);
  if (diffMinutes < 1) return 'щойно';
  if (diffMinutes < 60) return `${diffMinutes} хв тому`;
  if (diffMinutes < 24 * 60) return `${Math.floor(diffMinutes / 60)} год тому`;
  const pad = (value: number) => String(value).padStart(2, '0');
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const day = `${pad(date.getDate())}.${pad(date.getMonth() + 1)}`;
  const yesterday = new Date(Date.now() - 24 * 3600_000);
  if (date.toDateString() === yesterday.toDateString()) return `вчора, ${time}`;
  return `${day}, ${time}`;
}

export default function InfoScreen() {
  const { palette } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { currentRegion } = useRegion();
  const { newsDisabled } = useSettings();

  const [filter, setFilter] = useState<FilterKey>('all');
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [sourcesSheetOpen, setSourcesSheetOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null);

  const {
    sources: customSources,
    items: customItems,
    errors: customErrors,
    isRefetching: customIsRefetching,
    addSource,
    removeSource,
    refetchCustom,
  } = useCustomNewsSources();

  const isUkraineFilter = filter === 'ukraine';
  const isCustomFilter = filter === 'custom';
  const serverKind =
    filter === 'all' || isUkraineFilter || isCustomFilter ? undefined : filter;

  const { data, isLoading, isError, isRefetching, refetch } = useNews({
    region: currentRegion,
    kind: serverKind,
    ukraineWide: isUkraineFilter,
    limit: 50,
    enabled: !newsDisabled && !isCustomFilter,
  });

  const items = data?.data ?? [];

  // Регіон без власних джерел підхоплює загальну стрічку
  const useUkraineFallback =
    !isUkraineFilter && !isCustomFilter && items.length === 0 && !isLoading && !isError;
  const { data: fallbackData, isLoading: fallbackLoading } = useNews({
    region: currentRegion,
    kind: serverKind,
    ukraineWide: true,
    limit: 50,
    enabled: !newsDisabled && useUkraineFallback,
  });

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('uk-UA');
    let source: NewsItem[];
    if (isCustomFilter) {
      source = customItems;
    } else {
      const serverList = items.length > 0 ? items : fallbackData?.data ?? [];
      source = filter === 'all' ? [...serverList, ...customItems] : serverList;
    }

    // Стрічка показує лише свіжі новини: тиждень постів перетворювався на архів.
    source = filterRecentNews(source);

    if (!needle) return source;
    return source.filter((item) =>
      [item.title, item.summary, item.body]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase('uk-UA')
        .includes(needle),
    );
  }, [filter, isCustomFilter, items, fallbackData, customItems, query]);

  const refreshing = newsDisabled
    ? customIsRefetching
    : isRefetching || isLoading || fallbackLoading;
  const stale = data?.meta?.stale === true;

  const customFailedTitles = customSources
    .filter((source) => Boolean(customErrors[source.id]))
    .map((source) => source.title);

  return (
    <View style={{ flex: 1 }}>
      <SwipeableScreen>
        <SafeAreaView className="flex-1 bg-surface-dim" edges={['top']}>
          <ScrollView
            className="flex-1"
            contentContainerStyle={{
              gap: 14,
              paddingHorizontal: 16,
              paddingBottom: 48,
              paddingTop: 10,
            }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="always"
            removeClippedSubviews={true}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => {
                  void queryClient.invalidateQueries({ queryKey: ['news'] });
                  if (newsDisabled) {
                    refetchCustom();
                    return;
                  }
                  void refetch();
                  refetchCustom();
                }}
                tintColor={palette.primary}
                colors={[palette.primary]}
              />
            }
          >
            {/* ── Шапка з діями ───────────────────────────────────── */}
            <ScreenHeader
              title="Інфо"
              actions={
                <View className="flex-row items-center gap-1.5">
                  <Pressable
                    onPress={() => {
                      setSearchOpen((prev) => !prev);
                      if (searchOpen) setQuery('');
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Пошук у новинах"
                    style={{
                      backgroundColor: searchOpen ? palette.primaryContainer : palette.card,
                      borderColor: searchOpen ? palette.primary : palette.hairline,
                      borderWidth: 1,
                    }}
                    className="h-9 w-9 items-center justify-center rounded-full active:opacity-70"
                  >
                    <Search
                      size={16}
                      color={searchOpen ? palette.primary : palette.mutedForeground}
                    />
                  </Pressable>

                  <Pressable
                    onPress={() => setSourcesSheetOpen(true)}
                    accessibilityRole="button"
                    accessibilityLabel="Мої джерела"
                    style={{
                      backgroundColor: palette.card,
                      borderColor: palette.hairline,
                      borderWidth: 1,
                    }}
                    className="h-9 w-9 items-center justify-center rounded-full active:opacity-70"
                  >
                    <Rss
                      size={16}
                      color={customSources.length > 0 ? palette.primary : palette.mutedForeground}
                    />
                    {customSources.length > 0 && (
                      <View
                        className="absolute -right-0.5 -top-0.5 h-3.5 w-3.5 items-center justify-center rounded-full"
                        style={{ backgroundColor: palette.primary }}
                      >
                        <Text
                          className="text-[9px] font-bold"
                          style={{ color: palette.onPrimary }}
                        >
                          {customSources.length}
                        </Text>
                      </View>
                    )}
                  </Pressable>

                  <Pressable
                    onPress={() => router.push('/settings')}
                    accessibilityRole="button"
                    accessibilityLabel="Налаштування"
                    style={{
                      backgroundColor: palette.card,
                      borderColor: palette.hairline,
                      borderWidth: 1,
                    }}
                    className="h-9 w-9 items-center justify-center rounded-full active:opacity-70"
                  >
                    <Settings size={16} color={palette.mutedForeground} />
                  </Pressable>
                </View>
              }
            />

            {/* ── Пошук (розгортається за потреби) ────────────────── */}
            {searchOpen && (
              <View
                className="flex-row items-center gap-2 rounded-2xl px-3 py-2 border"
                style={{
                  backgroundColor: palette.surfaceContainerLow,
                  borderColor: palette.hairline,
                }}
              >
                <Search size={15} color={palette.mutedForeground} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Пошук у новинах"
                  placeholderTextColor={palette.mutedForeground}
                  className="flex-1 py-0.5 text-sm text-foreground"
                  returnKeyType="search"
                />
                {query.length > 0 && (
                  <Pressable onPress={() => setQuery('')} hitSlop={8} className="p-1">
                    <X size={14} color={palette.mutedForeground} />
                  </Pressable>
                )}
              </View>
            )}

            {/* ── Лаконічний ряд фільтрів ─────────────────────────── */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8, paddingVertical: 2 }}
              keyboardShouldPersistTaps="handled"
            >
              {FILTERS.map(({ key, label, Icon }) => {
                const active = filter === key;
                return (
                  <Pressable
                    key={key}
                    onPress={() => setFilter(key)}
                    className="flex-row items-center gap-1.5 rounded-full px-3.5 py-1.5 border active:opacity-80"
                    style={{
                      backgroundColor: active ? palette.primary : palette.card,
                      borderColor: active ? palette.primary : palette.hairline,
                    }}
                  >
                    {Icon ? (
                      <Icon
                        size={13}
                        color={active ? palette.onPrimary : palette.mutedForeground}
                      />
                    ) : null}
                    <Text
                      className="text-xs font-semibold"
                      style={{ color: active ? palette.onPrimary : palette.mutedForeground }}
                    >
                      {label}
                    </Text>
                    {key === 'custom' && customSources.length > 0 && (
                      <View
                        className="rounded-full px-1.5 py-0.5"
                        style={{
                          backgroundColor: active
                            ? 'rgba(0,0,0,0.22)'
                            : palette.surfaceContainerHigh,
                        }}
                      >
                        <Text
                          className="text-[10px] font-bold"
                          style={{ color: active ? palette.onPrimary : palette.mutedForeground }}
                        >
                          {customSources.length}
                        </Text>
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* Попередження про застарілі дані */}
            {stale && (
              <View
                className="flex-row items-center gap-2 rounded-2xl px-3.5 py-2.5 border"
                style={{
                  backgroundColor: `${palette.warning}1A`,
                  borderColor: `${palette.warning}44`,
                }}
              >
                <Clock size={14} color={palette.warning} />
                <Text className="flex-1 text-[11px]" style={{ color: palette.warning }}>
                  Свіжих публікацій немає понад добу — можливо, збір тимчасово недоступний.
                </Text>
              </View>
            )}

            {/* ── Стрічка новин ────────────────────────────────────── */}
            {newsDisabled ? (
              <>
                <StateCard
                  Icon={EyeOff}
                  title="Новини вимкнено"
                  subtitle="Увімкніть стрічку в налаштуваннях або додайте власні канали — вони читаються без звернення до сервера."
                  palette={palette}
                />
                {filtered.length > 0 && (
                  <View className="gap-2.5">
                    {filtered.map((item) => (
                      <NewsCard
                        key={item.contentHash}
                        item={item}
                        palette={palette}
                        expanded={expandedId === item.contentHash}
                        onToggle={() =>
                          setExpandedId((current) =>
                            current === item.contentHash ? null : item.contentHash,
                          )
                        }
                        onOpenImage={setSelectedImageUrl}
                      />
                    ))}
                  </View>
                )}
              </>
            ) : isError ? (
              <StateCard
                Icon={CloudOff}
                title="Новини не завантажилися"
                subtitle="Немає зв'язку із сервером. Перевірте з'єднання або спробуйте оновити ще раз."
                palette={palette}
                action={
                  <Pressable
                    onPress={() => void refetch()}
                    className="self-start rounded-xl px-4 py-2 mt-1 active:opacity-75"
                    style={{ backgroundColor: palette.primary }}
                  >
                    <Text className="text-xs font-bold" style={{ color: palette.onPrimary }}>
                      Спробувати ще раз
                    </Text>
                  </Pressable>
                }
              />
            ) : filtered.length === 0 ? (
              isLoading ? (
                <View className="items-center gap-2 py-12">
                  <ActivityIndicator color={palette.primary} />
                  <Text className="text-xs text-muted-foreground">Завантажуємо новини…</Text>
                </View>
              ) : (
                <StateCard
                  Icon={Newspaper}
                  title={
                    query
                      ? 'Нічого не знайдено'
                      : isCustomFilter
                        ? 'Немає власних джерел'
                        : 'Новин поки немає'
                  }
                  subtitle={
                    query
                      ? 'За вашим запитом нічого не знайдено. Спробуйте змінити ключові слова.'
                      : isCustomFilter
                        ? 'Додайте Telegram-канали або RSS-стрічки через кнопку джерел у верхній панелі.'
                        : 'Збір новин читає офіційні повідомлення операторів. Свіжі записи зʼявляться щойно зʼявиться нова інформація.'
                  }
                  palette={palette}
                  action={
                    isCustomFilter && customSources.length === 0 ? (
                      <Pressable
                        onPress={() => setSourcesSheetOpen(true)}
                        className="self-start rounded-xl px-4 py-2 mt-1 active:opacity-80"
                        style={{ backgroundColor: palette.primary }}
                      >
                        <Text className="text-xs font-bold" style={{ color: palette.onPrimary }}>
                          Додати джерело
                        </Text>
                      </Pressable>
                    ) : undefined
                  }
                />
              )
            ) : (
              <View className="gap-2.5">
                {filtered.map((item) => (
                  <NewsCard
                    key={item.contentHash}
                    item={item}
                    palette={palette}
                    expanded={expandedId === item.contentHash}
                    onToggle={() =>
                      setExpandedId((current) =>
                        current === item.contentHash ? null : item.contentHash,
                      )
                    }
                    onOpenImage={setSelectedImageUrl}
                  />
                ))}
              </View>
            )}

            {/* Тонкий статус джерел наприкінці стрічки */}
            {!newsDisabled && <ServerSourcesRow palette={palette} />}
          </ScrollView>
        </SafeAreaView>
      </SwipeableScreen>

      {/* ── Шторка управління джерелами ─────────────────────── */}
      <CustomSourcesSheet
        visible={sourcesSheetOpen}
        onClose={() => setSourcesSheetOpen(false)}
        sources={customSources}
        failedTitles={customFailedTitles}
        palette={palette}
        onAdd={addSource}
        onRemove={removeSource}
      />

      {/* ── Модальне вікно перегляду графіка / фото на весь екран ─ */}
      <Modal
        visible={Boolean(selectedImageUrl)}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedImageUrl(null)}
      >
        <SafeAreaView className="flex-1 bg-black/95">
          <View className="flex-row items-center justify-between p-4">
            <Text className="text-xs font-semibold text-white/70">Графік відключень</Text>
            <Pressable
              onPress={() => setSelectedImageUrl(null)}
              className="h-9 w-9 items-center justify-center rounded-full bg-white/10 active:opacity-70"
            >
              <X size={18} color="#FFFFFF" />
            </Pressable>
          </View>
          <View className="flex-1 items-center justify-center p-2">
            {selectedImageUrl ? (
              <Image
                source={{ uri: selectedImageUrl }}
                style={{ width: '100%', height: '100%' }}
                resizeMode="contain"
                accessibilityIgnoresInvertColors
              />
            ) : null}
          </View>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

/** Один пост новин у сучасному стилі без зайвого шуму. */
const NewsCard = React.memo(function NewsCard({
  item,
  palette,
  expanded,
  onToggle,
  onOpenImage,
}: {
  item: NewsItem;
  palette: Palette;
  expanded: boolean;
  onToggle: () => void;
  onOpenImage?: (url: string) => void;
}) {
  const meta = kindMeta(palette, item.kind);
  const { title, body } = cleanNewsCardContent(item.title, item.body || item.summary);
  const image = item.imageUrls[0];
  const badge = item.isUkraineWide ? 'Україна' : regionBadge(item.regionCpu);
  const isTg = item.sourceKey.startsWith('tg:') || item.sourceKey.includes('telegram');
  const SourceIcon = isTg ? Send : Rss;

  return (
    <Pressable
      onPress={onToggle}
      className="gap-2.5 rounded-3xl p-4 border active:opacity-90"
      style={{
        backgroundColor: palette.card,
        borderColor: palette.hairline,
      }}
    >
      {/* Верхній рядок: іконка джерела + назва + час і бейдж регіону */}
      <View className="flex-row items-center justify-between gap-2">
        <View className="flex-1 flex-row items-center gap-1.5">
          <SourceIcon size={12} color={palette.primary} />
          <Text numberOfLines={1} className="text-xs font-bold text-foreground">
            {sourceLabel(item.sourceKey)}
          </Text>
          <Text className="text-xs text-muted-foreground">·</Text>
          <Text className="text-[11px] text-muted-foreground">{formatTime(item.publishedAt)}</Text>
        </View>

        {badge && (
          <View
            className="rounded-full px-2 py-0.5"
            style={{ backgroundColor: palette.surfaceContainerHigh }}
          >
            <Text className="text-[10px] font-semibold text-muted-foreground">{badge}</Text>
          </View>
        )}
      </View>

      {/* Заголовок */}
      <Text className="text-sm font-semibold leading-snug text-foreground">
        {title}
      </Text>

      {/* Текст — рендериться лише якщо є непорожній body */}
      {body.length > 0 && (
        <Text
          className="text-xs leading-relaxed text-muted-foreground"
          numberOfLines={expanded ? undefined : 3}
        >
          {body}
        </Text>
      )}

      {/* Зображення з клікабельним збільшенням та contain */}
      {expanded && image ? (
        <Pressable
          onPress={() => onOpenImage?.(image)}
          className="relative mt-1 overflow-hidden rounded-2xl active:opacity-90"
          style={{ backgroundColor: 'rgba(0,0,0,0.3)', height: 260 }}
          accessibilityRole="button"
          accessibilityLabel="Відкрити графік на весь екран"
        >
          <Image
            source={{ uri: image }}
            style={{ width: '100%', height: '100%' }}
            resizeMode="contain"
            accessibilityIgnoresInvertColors
          />
          <View
            style={{ backgroundColor: 'rgba(0,0,0,0.65)' }}
            className="absolute bottom-2.5 right-2.5 flex-row items-center gap-1 rounded-full px-2.5 py-1"
          >
            <Maximize2 size={11} color="#FFFFFF" />
            <Text className="text-[10px] font-bold text-white">Збільшити</Text>
          </View>
        </Pressable>
      ) : null}

      {/* Нижній рядок: чип категорії з Lucide-іконкою + посилання на першоджерело */}
      <View className="flex-row items-center justify-between pt-1">
        <View
          className="flex-row items-center gap-1.5 rounded-full px-2.5 py-1"
          style={{ backgroundColor: `${meta.color}1E` }}
        >
          <meta.Icon size={11} color={meta.color} />
          <Text className="text-[11px] font-semibold" style={{ color: meta.color }}>
            {meta.label}
          </Text>
        </View>

        <View className="flex-row items-center gap-2">
          {expanded ? (
            <Pressable
              onPress={() => void Linking.openURL(item.url)}
              hitSlop={8}
              className="flex-row items-center gap-1.5 rounded-full px-3 py-1 active:opacity-75"
              style={{ backgroundColor: palette.primaryContainer }}
            >
              <ExternalLink size={12} color={palette.primary} />
              <Text className="text-[11px] font-bold" style={{ color: palette.primary }}>
                Першоджерело
              </Text>
            </Pressable>
          ) : (
            <View className="flex-row items-center gap-1">
              {item.imageUrls.length > 0 && (
                <Text className="text-[10px] text-muted-foreground">фото</Text>
              )}
              <ChevronDown size={14} color={palette.mutedForeground} />
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );
});

/** Шторка додавання та списку власних джерел новин. */
function CustomSourcesSheet({
  visible,
  onClose,
  sources,
  failedTitles,
  palette,
  onAdd,
  onRemove,
}: {
  visible: boolean;
  onClose: () => void;
  sources: Array<{ id: string; title: string; url: string; type: 'rss' | 'telegram' }>;
  failedTitles: string[];
  palette: Palette;
  onAdd: (input: string) => { ok: boolean; error?: string };
  onRemove: (id: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = () => {
    const trimmed = input.trim();
    if (!trimmed) {
      setError(null);
      return;
    }
    const res = onAdd(trimmed);
    if (!res.ok) {
      setError(res.error ?? 'Не вдалося додати джерело');
      return;
    }
    setInput('');
    setError(null);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View
        style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0, 0, 0, 0.65)' }}
      >
        <Pressable className="flex-1" onPress={onClose} accessibilityLabel="Закрити" />
        <View
          style={{
            maxHeight: '88%',
            backgroundColor: palette.surfaceContainer,
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            borderColor: palette.hairline,
            borderWidth: 1,
            paddingTop: 8,
          }}
        >
          {/* Індикатор перетягування */}
          <View
            className="mb-2 h-1 w-10 self-center rounded-full"
            style={{ backgroundColor: palette.borderStrong }}
          />

          {/* Заголовок шторки */}
          <View className="flex-row items-center gap-3 px-5 pb-3">
            <View
              className="h-10 w-10 items-center justify-center rounded-2xl border"
              style={{
                backgroundColor: palette.primaryContainer,
                borderColor: `${palette.primary}40`,
              }}
            >
              <Rss size={18} color={palette.primary} />
            </View>
            <View className="flex-1">
              <Text className="text-base font-bold text-foreground">Мої джерела</Text>
              <Text className="text-[11px] text-muted-foreground">
                Telegram-канали та RSS-стрічки
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Закрити"
              className="p-1 active:opacity-60"
            >
              <X size={20} color={palette.foreground} />
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={{
              gap: 12,
              paddingHorizontal: 16,
              paddingBottom: 24 + insets.bottom,
            }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Форма додавання */}
            <View className="gap-2">
              <View
                className="flex-row items-center gap-2 rounded-2xl px-3 py-1.5 border"
                style={{
                  backgroundColor: palette.surfaceContainerLow,
                  borderColor: error ? palette.destructive : palette.hairline,
                }}
              >
                <TextInput
                  value={input}
                  onChangeText={(val) => {
                    setInput(val);
                    if (error) setError(null);
                  }}
                  placeholder="Посилання на RSS або @канал"
                  placeholderTextColor={palette.mutedForeground}
                  autoCapitalize="none"
                  autoCorrect={false}
                  className="flex-1 py-1.5 text-sm text-foreground"
                  returnKeyType="done"
                  onSubmitEditing={handleSubmit}
                />
                <Pressable
                  onPress={handleSubmit}
                  className="h-8 w-8 items-center justify-center rounded-xl active:opacity-75"
                  style={{ backgroundColor: palette.primary }}
                  accessibilityRole="button"
                  accessibilityLabel="Додати джерело"
                >
                  <Plus size={16} color={palette.onPrimary} />
                </Pressable>
              </View>
              {error ? (
                <Text className="text-[11px] px-1" style={{ color: palette.destructive }}>
                  {error}
                </Text>
              ) : null}
            </View>

            {/* Джерела з помилками опитування */}
            {failedTitles.length > 0 && (
              <View
                className="flex-row items-center gap-2 rounded-2xl px-3 py-2 border"
                style={{
                  backgroundColor: `${palette.warning}1A`,
                  borderColor: `${palette.warning}44`,
                }}
              >
                <TriangleAlert size={14} color={palette.warning} />
                <Text className="flex-1 text-[11px]" style={{ color: palette.warning }}>
                  Не вдалося прочитати: {failedTitles.join(', ')}
                </Text>
              </View>
            )}

            {/* Список доданих */}
            {sources.length > 0 ? (
              <View className="gap-2 pt-1">
                <Text className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                  Підключені канали ({sources.length})
                </Text>
                {sources.map((source) => (
                  <View
                    key={source.id}
                    className="flex-row items-center gap-3 rounded-2xl p-3 border"
                    style={{
                      backgroundColor: palette.card,
                      borderColor: palette.hairline,
                    }}
                  >
                    <View
                      className="h-8 w-8 items-center justify-center rounded-xl"
                      style={{ backgroundColor: palette.surfaceContainerHigh }}
                    >
                      {source.type === 'rss' ? (
                        <Rss size={15} color={palette.primary} />
                      ) : (
                        <Send size={15} color={palette.primary} />
                      )}
                    </View>
                    <View className="flex-1">
                      <Text className="text-xs font-semibold text-foreground">
                        {source.title}
                      </Text>
                      <Text className="text-[10px] text-muted-foreground" numberOfLines={1}>
                        {source.url}
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => onRemove(source.id)}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={`Видалити ${source.title}`}
                      className="p-1.5 active:opacity-60"
                    >
                      <Trash size={15} color={palette.destructive} />
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : (
              <View
                className="items-center gap-2 rounded-2xl p-5 border mt-2"
                style={{
                  backgroundColor: palette.surfaceContainerLow,
                  borderColor: palette.hairline,
                }}
              >
                <Send size={20} color={palette.mutedForeground} />
                <Text className="text-xs font-semibold text-foreground text-center">
                  Немає доданих джерел
                </Text>
                <Text className="text-[11px] text-muted-foreground text-center leading-relaxed">
                  Введіть назву публічного Telegram-каналу (наприклад, @chernigivoblenergo) або
                  посилання на RSS. Вони опитуватимуться безпосередньо з телефону.
                </Text>
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function StateCard({
  Icon,
  title,
  subtitle,
  palette,
  action,
}: {
  Icon: typeof Newspaper;
  title: string;
  subtitle: string;
  palette: Palette;
  action?: React.ReactNode;
}) {
  return (
    <View
      className="items-center gap-2.5 rounded-3xl p-6 border"
      style={{ backgroundColor: palette.card, borderColor: palette.hairline }}
    >
      <View
        className="h-12 w-12 items-center justify-center rounded-2xl"
        style={{ backgroundColor: palette.surfaceContainerHigh }}
      >
        <Icon size={22} color={palette.mutedForeground} />
      </View>
      <Text className="text-sm font-bold text-foreground text-center">{title}</Text>
      <Text className="text-center text-xs leading-relaxed text-muted-foreground">
        {subtitle}
      </Text>
      {action}
    </View>
  );
}

/** Службовий рядок наприкінці стрічки: скільки джерел і коли перевіряли. */
function ServerSourcesRow({ palette }: { palette: Palette }) {
  const { data: sourcesData } = useNewsSources();
  const sources = sourcesData?.data ?? [];
  if (sources.length === 0) return null;

  const failedSources = sources.filter((source) => Boolean(source.lastError));
  const checkedAt = latestIso(sources.map((source) => source.lastPolledAt));

  return (
    <View className="items-center justify-center pt-2 pb-4 gap-1">
      <Text className="text-[11px] text-muted-foreground text-center">
        Джерел: {sources.length} · Перевірено {formatTime(checkedAt)}
      </Text>
      {failedSources.length > 0 && (
        <Text
          className="text-[11px] font-semibold text-center"
          style={{ color: palette.destructive }}
        >
          Не відповідає: {failedSources.map((source) => sourceLabel(source.sourceKey)).join(', ')}
        </Text>
      )}
    </View>
  );
}

function regionBadge(cpu: string | null | undefined): string | null {
  const name = cpu ? regionCatalogName(cpu) : null;
  return name ? name.replace(' область', ' обл.') : null;
}
