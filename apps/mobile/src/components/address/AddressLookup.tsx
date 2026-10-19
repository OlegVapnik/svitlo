import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';

import { searchOfflineSettlements, topOfflineSettlements } from '@svitlo/core/api/offline-sync';
import {
  useAddressHouses,
  useAddressLookup,
  useAddressSettlements,
  useAddressStreets,
  useQueues,
  useQueueSchedule,
} from '@svitlo/core/api/queries';
import { formatKyivTime, formatTimeRange } from '@svitlo/core/lib/date';
import { formatQueueLabel } from '@svitlo/core/lib/queue-label';
import type { AddressHouseOption, AddressResolveResult, QueueScheduleData } from '@svitlo/shared';

import { useRegion } from '@/context/RegionContext';
import { useTheme } from '@/theme/ThemeProvider';

function kyivToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(new Date());
}

function knownHouses(options: AddressHouseOption[], query: string): AddressHouseOption[] {
  const needle = query.trim().toLocaleLowerCase('uk-UA');
  if (!needle) return options;
  return options.filter((option) => {
    if (option.housePattern.toLocaleLowerCase('uk-UA').includes(needle)) return true;
    const range = option.housePattern.match(/^(\d{1,5})\s*[-–—]\s*(\d{1,5})$/u);
    const numeric = Number.parseInt(needle, 10);
    if (!range || !Number.isFinite(numeric) || String(numeric) !== needle) return false;
    const start = Number.parseInt(range[1]!, 10);
    const end = Number.parseInt(range[2]!, 10);
    return numeric >= Math.min(start, end) && numeric <= Math.max(start, end);
  });
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = value.trim().toLocaleLowerCase('uk-UA');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

/**
 * Поиск своей группы по адресу: область → населённый пункт → улица → дом.
 *
 * Результат не угадывается. Если точного дома нет, показываем известные соседние дома и
 * ручной выбор из реальных групп области. Карта не нужна: адрес вводится текстом, ответ —
 * код группы и её интервалы из того же ядра, что и на Главной.
 */
export function AddressLookup() {
  const { currentRegion, currentRegionData } = useRegion();
  const { palette } = useTheme();
  const [settlement, setSettlement] = useState('');
  const [street, setStreet] = useState('');
  const [house, setHouse] = useState('');
  const [result, setResult] = useState<AddressResolveResult | null>(null);
  const [manualQueue, setManualQueue] = useState<string | null>(null);
  const autoResolved = useRef<string | null>(null);

  const today = useMemo(() => kyivToday(), []);
  const settlementsQuery = useAddressSettlements(currentRegion, settlement);
  const streetsQuery = useAddressStreets(currentRegion, settlement, street);
  const housesQuery = useAddressHouses(currentRegion, settlement, street);
  const queuesQuery = useQueues(currentRegionData.cpu);
  const resolve = useAddressLookup();
  const manualScheduleQuery = useQueueSchedule(manualQueue ?? undefined, today, currentRegion);
  // Пак даёт группу без расписания; график читаем точечно по найденной группе.
  const resultScheduleQuery = useQueueSchedule(result?.queue ?? undefined, today, currentRegion);

  useEffect(() => {
    setSettlement(currentRegion === 'kyiv-city' ? 'Київ' : '');
    setStreet('');
    setHouse('');
    setResult(null);
    setManualQueue(null);
    autoResolved.current = null;
  }, [currentRegion]);

  const submit = async (overrides: { settlement?: string; street?: string; house?: string } = {}) => {
    const nextSettlement = (overrides.settlement ?? settlement).trim();
    const nextStreet = (overrides.street ?? street).trim();
    const nextHouse = (overrides.house ?? house).trim();
    if (!nextSettlement) return;
    setResult(null);
    setManualQueue(null);
    try {
      const found = await resolve.mutateAsync({
        region: currentRegion,
        settlement: nextSettlement,
        street: nextStreet || undefined,
        house: nextHouse || undefined,
      });
      setResult(found);
    } catch {
      // resolve.isError ниже покажет честную ошибку; пустой результат не подменяем.
    }
  };

  const wholeSettlementQueue = streetsQuery.data?.wholeSettlementQueue ?? null;
  const wholeStreetQueue = housesQuery.data?.wholeStreetQueue ?? null;

  useEffect(() => {
    if (!settlement.trim() || !wholeSettlementQueue || street.trim() || result || resolve.isPending) return;
    const key = `${currentRegion}|${settlement}`;
    if (autoResolved.current === key) return;
    autoResolved.current = key;
    void submit({ settlement });
  }, [settlement, wholeSettlementQueue, street, result, resolve.isPending, currentRegion]);

  const settlementOptions = useMemo(() => {
    const query = settlement.trim();
    const offline =
      query.length >= 2
        ? searchOfflineSettlements(currentRegion, query, 6)
        : currentRegion === 'kyiv-city'
          ? []
          : topOfflineSettlements(currentRegion, 6);
    const server = settlementsQuery.data?.data ?? [];
    return dedupe([
      ...offline.map((item) => item.name),
      ...server.map((item) => item.name),
    ]).slice(0, 8);
  }, [currentRegion, settlement, settlementsQuery.data]);

  const streetOptions = useMemo(
    () => (streetsQuery.data?.data ?? []).slice(0, 18),
    [streetsQuery.data],
  );

  const houseOptions = useMemo(
    () => knownHouses(housesQuery.data?.data ?? [], house).slice(0, 24),
    [housesQuery.data, house],
  );

  const queueOptions = useMemo(
    () =>
      dedupe([
        ...(queuesQuery.data?.data ?? []).map((item) => item.queue),
        ...(currentRegionData.queues ?? []),
      ]),
    [queuesQuery.data, currentRegionData.queues],
  );

  const activeQueue = manualQueue ?? result?.queue ?? null;
  const activeSchedule: QueueScheduleData | null = manualQueue
    ? (manualScheduleQuery.data?.data ?? null)
    : (result?.schedule ?? resultScheduleQuery.data?.data ?? null);

  const now = Date.now();
  const intervals = activeSchedule?.intervals ?? [];
  const currentOff = intervals.find(
    (interval) => Date.parse(interval.startsAt) <= now && now < Date.parse(interval.endsAt),
  );
  const hasSchedule = intervals.length > 0 || activeSchedule?.allClear === true;
  const statusText = !activeQueue
    ? null
    : !hasSchedule
      ? 'Немає даних про відключення'
      : currentOff
        ? `Світла немає до ${formatKyivTime(currentOff.endsAt)}`
        : intervals.length > 0
          ? 'Світло є за графіком'
          : 'Відключень немає';

  const chooseSettlement = (name: string) => {
    setSettlement(name);
    setStreet('');
    setHouse('');
    setResult(null);
    setManualQueue(null);
    autoResolved.current = null;
  };

  const chooseStreet = (name: string) => {
    setStreet(name);
    setHouse('');
    setResult(null);
    setManualQueue(null);
  };

  const chooseHouse = (value: string) => {
    const rangeStart = value.match(/^(\d{1,5})\s*[-–—]\s*\d{1,5}$/u)?.[1];
    const selected = rangeStart ?? value;
    setHouse(selected);
    setResult(null);
    setManualQueue(null);
    void submit({ house: selected });
  };

  return (
    <View className="gap-4">
      <StepCard step={1} title="Населений пункт">
        <Field
          label="Населений пункт"
          value={settlement}
          editable={currentRegion !== 'kyiv-city'}
          placeholder="Наприклад, Чернігів"
          onChangeText={(value) => {
            setSettlement(value);
            setStreet('');
            setHouse('');
            setResult(null);
            setManualQueue(null);
            autoResolved.current = null;
          }}
        />
        {currentRegion !== 'kyiv-city' && settlementOptions.length > 0 ? (
          <Chips
            options={settlementOptions}
            onPick={chooseSettlement}
            active={settlement}
            title={settlement.trim().length >= 2 ? 'Підказки' : 'Є в офлайн-пакеті'}
          />
        ) : settlementsQuery.isFetching && settlement.trim().length >= 2 ? (
          <ActivityIndicator color={palette.mutedForeground} />
        ) : null}
      </StepCard>

      {!(wholeSettlementQueue && !street.trim()) ? (
        <StepCard step={2} title="Вулиця та будинок" muted={!settlement.trim()}>
          <Field
            label="Вулиця"
            value={street}
            editable={Boolean(settlement.trim())}
            placeholder={settlement.trim() ? 'Наприклад, Хрещатик' : 'Спочатку виберіть населений пункт'}
            onChangeText={(value) => {
              setStreet(value);
              setHouse('');
              setResult(null);
              setManualQueue(null);
            }}
          />
          {streetOptions.length > 0 ? (
            <Chips options={streetOptions.map((item) => item.name)} onPick={chooseStreet} active={street} title="Вулиці" />
          ) : streetsQuery.isFetching && street.length >= 2 ? (
            <ActivityIndicator color={palette.mutedForeground} />
          ) : null}
          {wholeSettlementQueue ? (
            <Text className="text-xs font-semibold text-primary">
              На весь населений пункт: {formatQueueLabel(wholeSettlementQueue, currentRegion)}
            </Text>
          ) : null}

          <Field
            label="Будинок"
            value={house}
            editable={Boolean(street.trim())}
            placeholder={street.trim() ? 'Номер будинку' : 'Спочатку виберіть вулицю'}
            onChangeText={(value) => {
              setHouse(value);
              setResult(null);
              setManualQueue(null);
            }}
          />
          {houseOptions.length > 0 ? (
            <View className="gap-1.5">
              <Text className="text-[11px] font-semibold text-muted-foreground">Відомі будинки</Text>
              <View className="flex-row flex-wrap gap-2">
                {houseOptions.map((option) => (
                  <Pressable
                    key={`${option.housePattern}-${option.queue}`}
                    onPress={() => chooseHouse(option.housePattern)}
                    className="rounded-full border border-border bg-surface-container-high px-3 py-2 active:opacity-70"
                  >
                    <Text className="text-xs font-semibold text-foreground">
                      {option.housePattern}
                      {option.queue ? <Text className="text-xs font-bold text-primary"> · {option.queue}</Text> : null}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
          {wholeStreetQueue ? (
            <Text className="text-xs text-muted-foreground">
              На всю вулицю: {formatQueueLabel(wholeStreetQueue, currentRegion)}
            </Text>
          ) : null}
        </StepCard>
      ) : null}

      {settlementsQuery.isError || streetsQuery.isError || housesQuery.isError ? (
        <View className="gap-2 rounded-2xl border border-border bg-card px-4 py-3">
          <Text className="text-sm font-semibold text-foreground">Довідник адрес зараз недоступний</Text>
          <Text className="text-xs text-muted-foreground">
            Підказки населених пунктів, вулиць і будинків не завантажились. Введіть адресу вручну —
            пошук групи спробує знайти її на сервері.
          </Text>
          <Pressable
            onPress={() => {
              void settlementsQuery.refetch();
              void streetsQuery.refetch();
              void housesQuery.refetch();
            }}
            accessibilityRole="button"
            className="min-h-9 self-start rounded-full border border-border px-3 py-1.5 active:opacity-70"
          >
            <Text className="text-xs font-semibold text-primary">Повторити</Text>
          </Pressable>
        </View>
      ) : null}

      <Pressable
        onPress={() => void submit()}
        disabled={!settlement.trim() || resolve.isPending}
        accessibilityRole="button"
        className={
          !settlement.trim() || resolve.isPending
            ? 'min-h-11 items-center justify-center rounded-xl bg-primary-container px-4 opacity-50'
            : 'min-h-11 items-center justify-center rounded-xl bg-primary px-4 active:opacity-80'
        }
      >
        <Text className="text-sm font-bold text-on-primary">
          {resolve.isPending ? 'Шукаємо…' : 'Знайти мою групу'}
        </Text>
      </Pressable>

      {resolve.isError ? (
        <Text className="rounded-2xl border border-destructive/30 bg-card px-4 py-3 text-sm text-destructive">
          Не вдалося виконати пошук. Перевірте звʼязок і спробуйте ще раз.
        </Text>
      ) : null}

      {activeQueue ? (
        <View className="gap-3 rounded-3xl border border-primary/30 bg-card px-4 py-4">
          <View className="flex-row items-start gap-3">
            <View className="min-w-16 items-center rounded-2xl bg-primary-container px-3 py-2">
              <Text className="text-xl font-bold text-primary">{activeQueue}</Text>
            </View>
            <View className="flex-1 gap-1">
              <Text className="text-[11px] font-semibold uppercase tracking-wide text-primary">
                {manualQueue ? 'Обрано вручну' : 'Ваша група'}
              </Text>
              <Text className="text-sm font-bold text-foreground">
                {formatQueueLabel(activeQueue, currentRegion)}
              </Text>
              <Text className="text-xs text-muted-foreground" numberOfLines={2}>
                {[settlement, street, house].filter(Boolean).join(', ')}
              </Text>
              <Text
                className="text-xs font-semibold"
                style={{ color: currentOff ? palette.destructive : hasSchedule ? palette.success : palette.mutedForeground }}
              >
                {statusText}
              </Text>
              {result?.confidence === 'community_pending' ? (
                <Text className="text-[11px] text-warning">
                  Спільнота: {result.votesCount ?? 0} голос(ів). Це підказка, а не підтверджений факт.
                </Text>
              ) : null}
              {result?.confidence === 'community_verified' ? (
                <Text className="text-[11px] font-semibold text-primary">
                  Підтверджено спільнотою: {result.votesCount ?? 0} голос(ів)
                </Text>
              ) : null}
            </View>
          </View>

          {manualQueue && manualScheduleQuery.isLoading ? (
            <ActivityIndicator color={palette.mutedForeground} />
          ) : intervals.length > 0 ? (
            <View className="gap-1">
              <Text className="text-xs font-semibold text-foreground">Графік на сьогодні</Text>
              {intervals.map((interval) => (
                <Text key={`${interval.startsAt}-${interval.endsAt}`} className="text-sm text-muted-foreground">
                  {formatTimeRange(interval.startsAt, interval.endsAt)}
                </Text>
              ))}
            </View>
          ) : activeSchedule?.allClear ? (
            <Text className="text-sm font-medium text-primary">На сьогодні відключень немає.</Text>
          ) : (
            <Text className="text-sm text-muted-foreground">На сьогодні графіка немає.</Text>
          )}

          {result?.source ? (
            <Text className="text-[11px] text-muted-foreground">Джерело: {result.source}</Text>
          ) : null}
        </View>
      ) : null}

      {result && !result.queue && !manualQueue ? (
        <View className="gap-3 rounded-2xl border border-border bg-card px-4 py-4">
          <Text className="text-sm font-semibold text-foreground">Точного будинку немає в довіднику</Text>
          <Text className="text-xs text-muted-foreground">
            Оберіть відомий сусідній будинок або свою групу зі списку. Номер групи не вгадуємо.
          </Text>

          {result.options.length > 0 ? (
            <View className="gap-2">
              <Text className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Сусідні будинки
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {result.options.slice(0, 8).map((option) => (
                  <Pressable
                    key={`${option.housePattern}-${option.queue}`}
                    onPress={() => setManualQueue(option.queue)}
                    className="rounded-full border border-border bg-surface-container-high px-3 py-2 active:opacity-70"
                  >
                    <Text className="text-xs font-semibold text-foreground">
                      №{option.housePattern} · {option.queue}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}

          {queueOptions.length > 0 ? (
            <View className="gap-2">
              <Text className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Моя група
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {queueOptions.map((queue) => (
                  <Pressable
                    key={queue}
                    onPress={() => setManualQueue(queue)}
                    className="rounded-full border border-border bg-surface-container-high px-3 py-2 active:opacity-70"
                  >
                    <Text className="text-xs font-semibold text-foreground">{queue}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : (
            <Text className="text-xs text-muted-foreground">Для цієї області переліку груп немає.</Text>
          )}
        </View>
      ) : null}
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  editable = true,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  editable?: boolean;
  keyboardType?: 'default' | 'numeric';
}) {
  const { palette } = useTheme();
  return (
    <View className="gap-1">
      <Text className="text-[11px] font-semibold text-muted-foreground">{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={palette.mutedForeground}
        editable={editable}
        autoCapitalize="words"
        autoCorrect={false}
        keyboardType={keyboardType}
        className={
          editable
            ? 'min-h-11 rounded-xl border border-border bg-surface-container-low px-3 py-2 text-sm text-foreground'
            : 'min-h-11 rounded-xl border border-border bg-surface-container-low px-3 py-2 text-sm text-muted-foreground opacity-60'
        }
      />
    </View>
  );
}

function Chips({
  options,
  onPick,
  active,
  title,
}: {
  options: string[];
  onPick: (value: string) => void;
  active?: string;
  title: string;
}) {
  return (
    <View className="gap-1.5">
      <Text className="text-[11px] font-semibold text-muted-foreground">{title}</Text>
      <View className="flex-row flex-wrap gap-2">
        {options.map((option) => (
          <Pressable
            key={option}
            onPress={() => onPick(option)}
            className={
              active === option
                ? 'rounded-full border border-primary bg-primary-container px-3 py-2 active:opacity-80'
                : 'rounded-full border border-border bg-surface-container-high px-3 py-2 active:opacity-70'
            }
          >
            <Text className={active === option ? 'text-xs font-semibold text-primary' : 'text-xs font-semibold text-foreground'}>
              {option}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function StepCard({
  step,
  title,
  muted,
  children,
}: {
  step: number;
  title: string;
  muted?: boolean;
  children: ReactNode;
}) {
  return (
    <View className={muted ? 'gap-3 rounded-2xl border border-border bg-card px-4 py-4 opacity-70' : 'gap-3 rounded-2xl border border-border bg-card px-4 py-4'}>
      <View className="flex-row items-center gap-2">
        <View className="h-7 w-7 items-center justify-center rounded-full border border-primary/30 bg-primary-container">
          <Text className="text-xs font-bold text-primary">{step}</Text>
        </View>
        <Text className="text-sm font-bold text-foreground">{title}</Text>
      </View>
      {children}
    </View>
  );
}
