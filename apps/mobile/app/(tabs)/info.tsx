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
import { useRouter } from 'expo-router';
import Animated, { FadeIn } from 'react-native-reanimated';

import { useNews, useNewsSources } from '@svitlo/core/api/queries';
import type { NewsItem } from '@svitlo/shared';

import { ScreenHeader } from '@/components/navigation/ScreenHeader';
import { SwipeableScreen } from '@/components/navigation/SwipeableScreen';
import { useRegion } from '@/context/RegionContext';
import { useSettings } from '@/context/SettingsContext';
import { useCustomNewsSources } from '@/hooks/useCustomNewsSources';
import { useTheme, type Palette } from '@/theme/ThemeProvider';

/**
 * «Інфо»: лише стрічка новин операторів; налаштування й оновлення — у /settings.
 *
 * Дані — той самий `useNews`, що у веба: збір робить крон воркера, а `/news` віддається з
 * R2-снапшота, тому стрічка не витрачає квоту D1. Регіональна видача без записів підхоплює
 * загальноукраїнську — так область без своїх джерел не виглядає «зламаною».
 *
 * Режим «новини вимкнено» (тумблер у налаштуваннях): серверні запити взагалі не летять
 * (enabled: false у useNews, useNewsSources винесено в окремий компонент, який не монтується),
 * стрічка показує лише пости власних джерел, що читаються клієнтсько.
 */

type KindFilter = 'all' | 'outage' | 'emergency' | 'schedule-change' | 'repair' | 'ukraine' | 'other';

const KIND_LABEL: Record<KindFilter, string> = {
  all: 'Усі',
  outage: 'Відключення',
  emergency: 'Аварія',
  'schedule-change': 'Графік',
  repair: 'Ремонт',
  ukraine: 'Україна',
  other: 'Інше',
};

/** Колір чипа категорії — той самий сенс, що в бейджів веба. */
function kindColor(palette: Palette, kind: string): string {
  switch (kind) {
    case 'outage':
      return palette.warning;
    case 'emergency':
      return palette.destructive;
    case 'schedule-change':
      return palette.info;
    case 'repair':
      return palette.levelHigh;
    default:
      return palette.unknown;
  }
}

const sourceLabel = (sourceKey: string): string => {
  const [, name] = sourceKey.split(':');
  return name ?? sourceKey;
};

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

/** Час останнього непорожнього поля — «Перевірено»/«Останній пост» у рядку джерел. */
const latestIso = (values: Array<string | null | undefined>): string | null => {
  const times = values.filter(Boolean).map((value) => Date.parse(value as string));
  if (times.length === 0) return null;
  return new Date(Math.max(...times)).toISOString();
};

export default function InfoScreen() {
  const { palette } = useTheme();
  const router = useRouter();
  const { currentRegion } = useRegion();
  const { newsDisabled } = useSettings();

  const [kind, setKind] = useState<KindFilter>('all');
  const [ukraineWide, setUkraineWide] = useState(false);
  const [onlyPower, setOnlyPower] = useState(false);
  const [query, setQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAddSource, setShowAddSource] = useState(false);
  const [sourceInput, setSourceInput] = useState('');
  const [sourceError, setSourceError] = useState<string | null>(null);

  const {
    sources: customSources,
    items: customItems,
    errors: customErrors,
    isRefetching: customIsRefetching,
    addSource,
    removeSource,
    refetchCustom,
  } = useCustomNewsSources();

  const { data, isLoading, isError, isRefetching, refetch } = useNews({
    region: currentRegion,
    kind: kind === 'all' ? undefined : kind,
    // Загальні новини місцевих ЗМІ (kind='other') витісняють усе про світло з перших 50 рядків.
    excludeKind: onlyPower ? 'other' : undefined,
    ukraineWide: ukraineWide || undefined,
    limit: 50,
    // «Спасіння квот D1»: тумблер повністю вимикає серверні запити стрічки.
    enabled: !newsDisabled,
  });

  const items = data?.data ?? [];

  // Регіон без власних джерел не повинен виглядати порожнім: підхоплюємо загальну стрічку.
  const useUkraineFallback = !ukraineWide && items.length === 0 && !isLoading && !isError;
  const { data: fallbackData, isLoading: fallbackLoading } = useNews({
    region: currentRegion,
    kind: kind === 'all' ? undefined : kind,
    excludeKind: onlyPower ? 'other' : undefined,
    ukraineWide: true,
    limit: 50,
    enabled: !newsDisabled && useUkraineFallback,
  });

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('uk-UA');
    // Власні джерела користувача підмішуються в ту саму стрічку (kind 'other').
    // Коли новини вимкнено, серверна частина порожня — лишається лише customItems.
    const source = [
      ...(items.length > 0 ? items : (fallbackData?.data ?? [])),
      ...customItems,
    ];
    const relevant = onlyPower ? source.filter((item) => item.kind !== 'other') : source;
    if (!needle) return relevant;
    return relevant.filter((item) =>
      [item.title, item.summary, item.body]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase('uk-UA')
        .includes(needle),
    );
  }, [items, fallbackData, onlyPower, query, customItems]);

  const refreshing = newsDisabled ? customIsRefetching : isRefetching || isLoading || fallbackLoading;
  const stale = data?.meta?.stale === true;

  // Джерела, чий останній фетч впав — показуємо одним рядком-попередженням.
  const customFailedTitles = customSources
    .filter((source) => Boolean(customErrors[source.id]))
    .map((source) => source.title);

  /** Додати джерело з інлайн-форми; порожній ввід просто ховає форму. */
  const submitSource = () => {
    const trimmed = sourceInput.trim();
    if (!trimmed) {
      setShowAddSource(false);
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
    setShowAddSource(false);
  };

  const cancelSource = () => {
    setSourceInput('');
    setSourceError(null);
    setShowAddSource(false);
  };

  return (
    <SwipeableScreen>
      <SafeAreaView className="flex-1 bg-surface-dim" edges={['top']}>
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ gap: 16, paddingHorizontal: 16, paddingBottom: 48, paddingTop: 10 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                // Новини вимкнено — тягнути сервер немає сенсу, оновлюємо лише власні джерела.
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
          <ScreenHeader
            title="Інфо"
            actions={
              <Pressable
                onPress={() => router.push('/settings')}
                accessibilityRole="button"
                accessibilityLabel="Налаштування"
                style={{ backgroundColor: palette.card, borderColor: palette.hairline }}
                className="h-9 w-9 items-center justify-center rounded-full border active:opacity-70"
              >
                <Ionicons name="settings-outline" size={16} color={palette.mutedForeground} />
              </Pressable>
            }
          />

          {/* ── Мої джерела ────────────────────────────────────────── */}
          {/* Карточка всегда видима: с нулём источников это единственная точка входа в фичу. */}
          <View
            className="gap-3 rounded-3xl p-4"
            style={{ backgroundColor: palette.card, borderColor: palette.hairline, borderWidth: 1 }}
          >
            <View className="flex-row items-center gap-2">
              <Text className="text-sm font-bold text-foreground">Мої джерела</Text>
              {customSources.length > 0 && (
                <Text className="text-[11px] text-muted-foreground">
                  {customSources.length} {pluralSources(customSources.length)}
                </Text>
              )}
              <View className="flex-1" />
              <Pressable
                onPress={() => {
                  setSourceError(null);
                  setShowAddSource((value) => !value);
                }}
                accessibilityRole="button"
                accessibilityLabel="Додати джерело"
                className="h-7 w-7 items-center justify-center rounded-full active:opacity-70"
                style={{ backgroundColor: palette.surfaceContainerHigh }}
              >
                <Ionicons name="add" size={16} color={palette.foreground} />
              </Pressable>
            </View>

            {/* Пустое состояние: приглашение вместо скрытой карточки */}
            {customSources.length === 0 && !showAddSource && (
              <View className="gap-2">
                <View className="flex-row items-center gap-2">
                  <Ionicons name="paper-plane-outline" size={13} color={palette.primary} />
                  <Text className="flex-1 text-[11px] leading-snug text-muted-foreground">
                    Telegram-канал свого облэнерго, місцевий паблик або RSS — пости читаються прямо
                    з телефону, сервер не витрачає квоту бази.
                  </Text>
                </View>
                <Pressable
                  onPress={() => {
                    setSourceError(null);
                    setShowAddSource(true);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Додати джерело"
                  className="self-start rounded-full px-3.5 py-1.5 active:opacity-80"
                  style={{ backgroundColor: palette.primaryContainer }}
                >
                  <Text className="text-xs font-bold" style={{ color: palette.primary }}>
                    Додати джерело
                  </Text>
                </Pressable>
              </View>
            )}

              {/* Інлайн-форма додавання */}
              {showAddSource && (
                <Animated.View entering={FadeIn.duration(200)} className="gap-2">
                  <TextInput
                    value={sourceInput}
                    onChangeText={setSourceInput}
                    placeholder="RSS-посилання або @telegram-канал"
                    placeholderTextColor={palette.mutedForeground}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    className="rounded-2xl px-3 py-2.5 text-sm text-foreground"
                    style={{ backgroundColor: palette.surfaceContainerLow }}
                    returnKeyType="done"
                    onSubmitEditing={submitSource}
                  />
                  <View className="flex-row gap-2">
                    <Pressable
                      onPress={submitSource}
                      className="rounded-xl px-4 py-2 active:opacity-70"
                      style={{ backgroundColor: palette.primary }}
                    >
                      <Text className="text-xs font-bold" style={{ color: palette.onPrimary }}>
                        Додати
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={cancelSource}
                      className="rounded-xl px-4 py-2 active:opacity-70"
                      style={{ backgroundColor: palette.surfaceContainerHigh }}
                    >
                      <Text className="text-xs font-bold text-foreground">Скасувати</Text>
                    </Pressable>
                  </View>
                  {sourceError && (
                    <Text className="text-[11px]" style={{ color: palette.destructive }}>
                      {sourceError}
                    </Text>
                  )}
                </Animated.View>
              )}

              {/* Список доданих джерел */}
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

              {/* Джерела, що не читаються */}
              {customFailedTitles.length > 0 && (
                <View className="flex-row items-center gap-2">
                  <Ionicons name="warning-outline" size={13} color={palette.warning} />
                  <Text className="flex-1 text-[11px]" style={{ color: palette.warning }}>
                    Не вдалося прочитати: {customFailedTitles.join(', ')}
                  </Text>
                </View>
              )}

              {customSources.length > 0 && (
                <Text className="text-[11px] leading-relaxed text-muted-foreground">
                  Підтримуються RSS/Atom-стрічки та публічні Telegram-канали. Джерела читаються прямо
                  з телефону.
                </Text>
              )}
          </View>

          {/* ── Новини ─────────────────────────────────────────────── */}
          <View className="gap-3">
            <View className="flex-row items-center justify-between">
              <Text className="text-base font-bold text-foreground">Новини</Text>
              <Text className="text-[11px] text-muted-foreground">
                {filtered.length > 0 ? `${filtered.length} ${pluralPosts(filtered.length)}` : ''}
              </Text>
            </View>

            {/* Пошук */}
            <View
              className="flex-row items-center gap-2 rounded-2xl px-3 py-2.5"
              style={{ backgroundColor: palette.card, borderColor: palette.hairline, borderWidth: 1 }}
            >
              <Ionicons name="search" size={16} color={palette.mutedForeground} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Пошук у новинах…"
                placeholderTextColor={palette.mutedForeground}
                className="flex-1 text-sm text-foreground"
                returnKeyType="search"
              />
              {query.length > 0 && (
                <Pressable onPress={() => setQuery('')} hitSlop={8}>
                  <Ionicons name="close-circle" size={16} color={palette.mutedForeground} />
                </Pressable>
              )}
            </View>

            {/* Фільтри за категорією */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8 }}
              keyboardShouldPersistTaps="handled"
            >
              {(Object.keys(KIND_LABEL) as KindFilter[]).map((value) => {
                const active = kind === value;
                return (
                  <Pressable
                    key={value}
                    onPress={() => setKind(value)}
                    className="rounded-full px-3.5 py-1.5"
                    style={{
                      backgroundColor: active ? palette.primary : palette.card,
                      borderColor: active ? palette.primary : palette.hairline,
                      borderWidth: 1,
                    }}
                  >
                    <Text
                      className="text-xs font-semibold"
                      style={{ color: active ? palette.onPrimary : palette.mutedForeground }}
                    >
                      {KIND_LABEL[value]}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* Перемикачі: вся Україна та «лише про світло» */}
            <View className="flex-row gap-2">
              <TogglePill
                label="Вся Україна"
                active={ukraineWide}
                onPress={() => setUkraineWide((value) => !value)}
                palette={palette}
              />
              <TogglePill
                label="Лише про світло"
                active={onlyPower}
                onPress={() => setOnlyPower((value) => !value)}
                palette={palette}
              />
            </View>

            {/* Стан збору: коли перевіряли джерела й хто з них зламався.
                Окремий компонент з власним useNewsSources — у режимі «новини вимкнено»
                він не монтується, тож серверний запит джерел не летить узагалі. */}
            {!newsDisabled && <ServerSourcesRow palette={palette} />}

            {newsDisabled ? (
              <>
                <StateCard
                  icon="eye-off-outline"
                  title="Новини вимкнено"
                  subtitle="Увімкніть стрічку в налаштуваннях або додайте власні джерела — вони читаються без сервера"
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
                          setExpandedId((current) => (current === item.contentHash ? null : item.contentHash))
                        }
                      />
                    ))}
                  </View>
                )}
              </>
            ) : isError ? (
              <StateCard
                icon="cloud-offline-outline"
                title="Новини не завантажилися"
                subtitle="Немає зв'язку з сервером. Стрічка з'явиться одразу після відновлення — можна підтягнути вручну."
                palette={palette}
                action={
                  <Pressable
                    onPress={() => void refetch()}
                    className="self-start rounded-xl px-4 py-2"
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
                <View className="items-center gap-2 py-8">
                  <ActivityIndicator color={palette.primary} />
                  <Text className="text-xs text-muted-foreground">Шукаємо новини…</Text>
                </View>
              ) : (
                <StateCard
                  icon="newspaper-outline"
                  title="Новин поки немає"
                  subtitle="Збір новин читає публічні канали й стрічки. Порожній список означає, що збір ще не запускався або джерела недоступні — це не підтвердження, що все спокійно."
                  palette={palette}
                />
              )
            ) : (
              <View className="gap-2.5">
                {stale && (
                  <View
                    className="flex-row items-center gap-2 rounded-2xl px-3 py-2"
                    style={{ backgroundColor: `${palette.warning}1A`, borderColor: `${palette.warning}55`, borderWidth: 1 }}
                  >
                    <Ionicons name="time-outline" size={14} color={palette.warning} />
                    <Text className="flex-1 text-[11px]" style={{ color: palette.warning }}>
                      Свіжих публікацій немає понад добу — можливо, збір не працює.
                    </Text>
                  </View>
                )}
                {filtered.map((item) => (
                  <NewsCard
                    key={item.contentHash}
                    item={item}
                    palette={palette}
                    expanded={expandedId === item.contentHash}
                    onToggle={() =>
                      setExpandedId((current) => (current === item.contentHash ? null : item.contentHash))
                    }
                  />
                ))}
              </View>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    </SwipeableScreen>
  );
}

/**
 * Стан серверного збору: скільки джерел, коли перевіряли, хто не відповідає.
 * Виклик useNewsSources живе тут, а не в InfoScreen: компонент монтується лише коли
 * серверні новини увімкнені, тому тумблер «Вимкнути новини» прибирає і цей запит.
 */
function ServerSourcesRow({ palette }: { palette: Palette }) {
  const { data: sourcesData } = useNewsSources();
  const sources = sourcesData?.data ?? [];
  if (sources.length === 0) return null;

  const failedSources = sources.filter((source) => Boolean(source.lastError));
  const checkedAt = latestIso(sources.map((source) => source.lastPolledAt));

  return (
    <View className="flex-row flex-wrap items-center gap-x-3 gap-y-1">
      <Text className="text-[11px] text-muted-foreground">
        Джерел: {sources.length} · Перевірено {formatTime(checkedAt)}
      </Text>
      {failedSources.length > 0 && (
        <Text className="text-[11px] font-semibold" style={{ color: palette.destructive }}>
          Не відповідає: {failedSources.map((source) => sourceLabel(source.sourceKey)).join(', ')}
        </Text>
      )}
    </View>
  );
}

/** «1 новина / 2-4 новини / 5+ новин» — коротка форма для лічильника. */
function pluralPosts(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return 'новина';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'новини';
  return 'новин';
}

/** «1 джерело / 2-4 джерела / 5+ джерел» — лічильник розділу «Мої джерела». */
function pluralSources(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return 'джерело';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'джерела';
  return 'джерел';
}

function TogglePill({
  label,
  active,
  onPress,
  palette,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  palette: Palette;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center gap-1.5 rounded-full px-3 py-1.5"
      style={{
        backgroundColor: active ? palette.primaryContainer : palette.card,
        borderColor: active ? palette.primary : palette.hairline,
        borderWidth: 1,
      }}
    >
      <Ionicons
        name={active ? 'checkbox' : 'square-outline'}
        size={13}
        color={active ? palette.primary : palette.mutedForeground}
      />
      <Text
        className="text-xs font-semibold"
        style={{ color: active ? palette.primary : palette.mutedForeground }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function StateCard({
  icon,
  title,
  subtitle,
  palette,
  action,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  palette: Palette;
  action?: React.ReactNode;
}) {
  return (
    <View
      className="items-center gap-2 rounded-3xl p-6"
      style={{ backgroundColor: palette.card, borderColor: palette.hairline, borderWidth: 1 }}
    >
      <View
        className="h-12 w-12 items-center justify-center rounded-2xl"
        style={{ backgroundColor: palette.surfaceContainerHigh }}
      >
        <Ionicons name={icon} size={24} color={palette.mutedForeground} />
      </View>
      <Text className="text-sm font-bold text-foreground">{title}</Text>
      <Text className="text-center text-xs leading-relaxed text-muted-foreground">{subtitle}</Text>
      {action}
    </View>
  );
}

/** Один пост: чип категорії, джерело, час, текст і картинка з першоджерела. */
function NewsCard({
  item,
  palette,
  expanded,
  onToggle,
}: {
  item: NewsItem;
  palette: Palette;
  expanded: boolean;
  onToggle: () => void;
}) {
  const accent = kindColor(palette, item.kind);
  const text = item.body || item.summary || '';
  const image = item.imageUrls[0];

  return (
    <Pressable
      onPress={onToggle}
      className="gap-2 rounded-3xl p-4 active:opacity-90"
      style={{ backgroundColor: palette.card, borderColor: palette.hairline, borderWidth: 1 }}
    >
      <View className="flex-row items-center gap-2">
        <View
          className="rounded-full px-2 py-0.5"
          style={{ backgroundColor: `${accent}22` }}
        >
          <Text className="text-[10px] font-bold" style={{ color: accent }}>
            {KIND_LABEL[(item.kind as KindFilter) in KIND_LABEL ? (item.kind as KindFilter) : 'other']}
          </Text>
        </View>
        {item.isUkraineWide && (
          <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: palette.surfaceContainerHigh }}>
            <Text className="text-[10px] font-bold text-muted-foreground">Україна</Text>
          </View>
        )}
        <View className="flex-1" />
        <Text className="text-[10px] text-muted-foreground">{formatTime(item.publishedAt)}</Text>
      </View>

      <Text className="text-sm font-semibold leading-snug text-foreground">{item.title}</Text>

      {text.length > 0 && (
        <Text
          className="text-xs leading-relaxed text-muted-foreground"
          numberOfLines={expanded ? undefined : 3}
        >
          {text}
        </Text>
      )}

      {expanded && image ? (
        <Image
          source={{ uri: image }}
          className="h-44 w-full rounded-2xl"
          resizeMode="cover"
          accessibilityIgnoresInvertColors
        />
      ) : null}

      <View className="flex-row items-center justify-between">
        <Text className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {sourceLabel(item.sourceKey)}
        </Text>
        <View className="flex-row items-center gap-1">
          {expanded ? (
            <Pressable
              onPress={() => void Linking.openURL(item.url)}
              className="flex-row items-center gap-1 rounded-full px-2 py-0.5"
              style={{ backgroundColor: palette.primaryContainer }}
            >
              <Ionicons name="open-outline" size={11} color={palette.primary} />
              <Text className="text-[10px] font-bold" style={{ color: palette.primary }}>
                Першоджерело
              </Text>
            </Pressable>
          ) : (
            <Ionicons
              name={item.imageUrls.length > 0 ? 'image-outline' : 'chevron-down'}
              size={12}
              color={palette.mutedForeground}
            />
          )}
        </View>
      </View>
    </Pressable>
  );
}
