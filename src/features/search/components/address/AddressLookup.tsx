import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native';
import { Text } from '@/components/ui/AppText';
import Ionicons from '@expo/vector-icons/Ionicons';

import { searchOfflineSettlements, topOfflineSettlements } from '@svitlo/core/api/offline-sync';
import { storage } from '@svitlo/core';
import {
  useAddressHouses,
  useAddressLookup,
  useAddressSettlements,
  useAddressStreets,
  useQueueSchedule,
} from '@svitlo/core/api/queries';
import {
  filterHousesByQuery,
  findSettlementByName,
  housePatternStart,
  matchExactStreetName,
  mergeSettlementOptions,
} from '@svitlo/core/lib/address';
import { formatKyivTime, formatTimeRange } from '@svitlo/core/lib/date';
import { formatMinutesUk, scheduleWindow } from '@svitlo/core/lib/scheduleWindow';
import { formatQueueLabel } from '@svitlo/core/lib/queue-label';
import type { AddressHouseOption, AddressResolveResult, QueueScheduleData } from '@svitlo/shared';

import { useRegion } from '@/context/RegionContext';
import { useKyivDayKeys } from '@/hooks/useKyivDayKeys';
import { useMinuteTicker } from '@/hooks/useMinuteTicker';
import { useSavedPlaces } from '@/hooks/useSavedPlaces';
import { defaultPlaceLabel, type PlaceIcon } from '@svitlo/core/lib/saved-places';
import { PlaceEditor } from '@/components/places/PlaceEditor';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Поиск своей группы по адресу: область → населённый пункт → улица → дом.
 *
 * Результат не угадывается. Адрес вводится текстом или выбирается из подсказок,
 * ответ — код группы и её интервалы из того же ядра, что и на Главной.
 */
export function AddressLookup() {
  const { currentRegion } = useRegion();
  const { palette } = useTheme();
  const { places, addPlace } = useSavedPlaces();
  const [settlement, setSettlement] = useState('');
  const [street, setStreet] = useState('');
  const [house, setHouse] = useState('');
  const [result, setResult] = useState<AddressResolveResult | null>(null);
  const [selectedSettlementQueue, setSelectedSettlementQueue] = useState<string | null>(null);
  const [manualQueue, setManualQueue] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);
  const autoResolved = useRef<string | null>(null);
  const autoResolvedStreet = useRef<string | null>(null);

  const now = useMinuteTicker(60_000);
  const { today } = useKyivDayKeys(now);
  const settlementsQuery = useAddressSettlements(currentRegion, settlement);
  const streetsQuery = useAddressStreets(currentRegion, settlement, street);
  // Дома запрашиваем только когда введённая улица точно совпала с известной: иначе каждый
  // символ «Хрещатик» уходил бы в серверный справочник и читал до 200 строк D1.
  const exactStreet = useMemo(
    () => matchExactStreetName(streetsQuery.data?.data ?? [], street),
    [street, streetsQuery.data],
  );
  const housesQuery = useAddressHouses(currentRegion, settlement, exactStreet);
  const resolve = useAddressLookup();
  const manualScheduleQuery = useQueueSchedule(manualQueue ?? undefined, today, currentRegion);
  // Пак даёт группу без расписания; график читаем точечно по найденной группе.
  const resultScheduleQuery = useQueueSchedule(result?.queue ?? undefined, today, currentRegion);

  useEffect(() => {
    setSettlement(currentRegion === 'kyiv-city' ? 'Київ' : '');
    setStreet('');
    setHouse('');
    setSelectedSettlementQueue(null);
    setResult(null);
    setManualQueue(null);
    setSaveOpen(false);
    setSaveFeedback(null);
    autoResolved.current = null;
    autoResolvedStreet.current = null;
  }, [currentRegion]);

  const submit = async (overrides: { settlement?: string; street?: string; house?: string } = {}) => {
    const nextSettlement = (overrides.settlement ?? settlement).trim();
    const nextStreet = (overrides.street ?? street).trim();
    const nextHouse = (overrides.house ?? house).trim();
    if (!nextSettlement) return;
    setResult(null);
    setManualQueue(null);
    setSaveOpen(false);
    setSaveFeedback(null);
    try {
      const found = await resolve.mutateAsync({
        region: currentRegion,
        settlement: nextSettlement,
        street: nextStreet || undefined,
        house: nextHouse || undefined,
      });
      setResult(found);
      if (found?.queue) {
        try {
          const cacheKey = `@svitlo:recent_addresses:${currentRegion}`;
          const existingRaw = storage.getItem(cacheKey);
          const existing = existingRaw ? JSON.parse(existingRaw) : [];
          const entry = {
            settlement: nextSettlement,
            street: nextStreet,
            house: nextHouse,
            queue: found.queue,
          };
          const filtered = existing.filter(
            (e: any) =>
              !(e.settlement === nextSettlement && e.street === nextStreet && e.house === nextHouse),
          );
          storage.setItem(cacheKey, JSON.stringify([entry, ...filtered].slice(0, 5)));
        } catch {
          // Ігноруємо помилки локального сховища
        }
      }
    } catch {
      // resolve.isError ниже покажет честную ошибку; пустой результат не подменяем.
    }
  };

  const wholeSettlementQueue = !street.trim() ? selectedSettlementQueue : null;
  const wholeStreetQueue = housesQuery.data?.wholeStreetQueue ?? null;

  useEffect(() => {
    if (!settlement.trim() || !wholeSettlementQueue || street.trim() || result || resolve.isPending) return;
    const key = `${currentRegion}|${settlement}`;
    if (autoResolved.current === key) return;
    autoResolved.current = key;
    void submit({ settlement });
  }, [settlement, wholeSettlementQueue, street, result, resolve.isPending, currentRegion]);

  // Єдина черга на всю вулицю: після вибору вулиці одразу показуємо графік, не змушуючи
  // вводити номер будинку. Якщо людина все ж введе будинок, звичайний submit його уточнить.
  useEffect(() => {
    if (!settlement.trim() || !street.trim() || !wholeStreetQueue || result || resolve.isPending) return;
    const key = `${currentRegion}|${settlement}|${street}`;
    if (autoResolvedStreet.current === key) return;
    autoResolvedStreet.current = key;
    void submit();
  }, [settlement, street, wholeStreetQueue, result, resolve.isPending, currentRegion]);

  // Автопошук при введенні номера будинку вручну (з невеликою затримкою)
  useEffect(() => {
    const trimmedHouse = house.trim();
    if (!settlement.trim() || !street.trim() || !trimmedHouse || result || resolve.isPending) return;
    const timer = setTimeout(() => {
      void submit({ house: trimmedHouse });
    }, 600);
    return () => clearTimeout(timer);
  }, [settlement, street, house, result, resolve.isPending]);

  const settlementOptions = useMemo(() => {
    const query = settlement.trim();
    const offline =
      query.length >= 2
        ? searchOfflineSettlements(currentRegion, query, 6)
        : currentRegion === 'kyiv-city'
          ? []
          : topOfflineSettlements(currentRegion, 6);
    return mergeSettlementOptions(
      offline.map((item) => item.name),
      (settlementsQuery.data?.data ?? []).map((item) => item.name),
      8,
    );
  }, [currentRegion, settlement, settlementsQuery.data]);

  const streetOptions = useMemo(
    () => (streetsQuery.data?.data ?? []).slice(0, 18),
    [streetsQuery.data],
  );

  const houseOptions = useMemo(
    () => filterHousesByQuery(housesQuery.data?.data ?? [], house).slice(0, 24),
    [housesQuery.data, house],
  );

  const activeQueue = manualQueue ?? result?.queue ?? null;
  const activeSchedule: QueueScheduleData | null = manualQueue
    ? (manualScheduleQuery.data?.data ?? null)
    : (result?.schedule ?? resultScheduleQuery.data?.data ?? null);

  const intervals = activeSchedule?.intervals ?? [];
  const schedule = scheduleWindow(intervals, today, now);
  const currentOff = schedule.isOff ? schedule.current : null;
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

  const alreadySavedPlace = useMemo(() => {
    if (!activeQueue) return null;
    const cSettlement = settlement.trim().toLowerCase();
    const cStreet = street.trim().toLowerCase();
    const cHouse = house.trim().toLowerCase();
    return (
      places.find((p) => {
        if (p.regionCpu !== currentRegion) return false;
        const sSettlement = (p.settlementName ?? '').trim().toLowerCase();
        const sStreet = (p.streetName ?? '').trim().toLowerCase();
        const sHouse = (p.house ?? '').trim().toLowerCase();
        if (cHouse && sHouse === cHouse && sStreet === cStreet && sSettlement === cSettlement) {
          return true;
        }
        if (!cHouse && cStreet && sStreet === cStreet && sSettlement === cSettlement) {
          return true;
        }
        return false;
      }) ?? null
    );
  }, [places, currentRegion, settlement, street, house, activeQueue]);

  const currentSettlementMatch = useMemo(
    () => findSettlementByName(settlementsQuery.data?.data ?? [], settlement),
    [settlementsQuery.data, settlement],
  );

  const recentAddresses = useMemo(() => {
    try {
      const cacheKey = `@svitlo:recent_addresses:${currentRegion}`;
      const raw = storage.getItem(cacheKey);
      return raw ? (JSON.parse(raw) as Array<{ settlement: string; street?: string; house?: string; queue: string }>) : [];
    } catch {
      return [];
    }
  }, [currentRegion, result]);

  const savePlace = (label: string, icon: PlaceIcon) => {
    if (!activeQueue) return;
    const saved = addPlace({
      label: label || defaultPlaceLabel(places),
      icon,
      regionCpu: currentRegion,
      settlementName: settlement.trim() || undefined,
      streetName: street.trim() || undefined,
      house: house.trim() || undefined,
      queue: activeQueue,
      addressConfirmed: manualQueue === activeQueue,
      makePrimary: places.length === 0,
    });
    if (saved.ok) {
      setSaveOpen(false);
      setSaveFeedback(`Збережено як «${saved.place.label}».`);
      return;
    }
    if (saved.reason === 'duplicate' && saved.duplicate) {
      setSaveOpen(false);
      setSaveFeedback(`Ця адреса вже є як «${saved.duplicate.label}».`);
      return;
    }
    if (saved.reason === 'limit') {
      setSaveFeedback('Можна зберегти не більше 10 місць. Видаліть одне на екрані пошуку.');
    }
  };

  const chooseSettlement = (name: string) => {
    const match = findSettlementByName(settlementsQuery.data?.data ?? [], name);
    const queue =
      match?.wholeSettlementQueue ??
      (match?.queues?.length === 1 ? match.queues[0]! : null);
    setSettlement(name);
    setStreet('');
    setHouse('');
    setSelectedSettlementQueue(queue);
    setResult(null);
    setManualQueue(null);
    autoResolved.current = null;
    autoResolvedStreet.current = null;
  };

  const chooseStreet = (name: string) => {
    setStreet(name);
    setHouse('');
    setResult(null);
    setManualQueue(null);
    autoResolvedStreet.current = null;
  };

  const chooseHouse = (value: string) => {
    const selected = housePatternStart(value) ?? value;
    setHouse(selected);
    setResult(null);
    setManualQueue(null);
    void submit({ house: selected });
  };

  return (
    <View className="gap-4">
      {/* Нещодавні збережені/знайдені адреси (офлайн доступ) */}
      {recentAddresses.length > 0 && !street.trim() && !result ? (
        <View className="flex-col gap-1.5 rounded-2xl bg-surface-container-high/60 p-3">
          <View className="flex-row items-center gap-1.5">
            <Ionicons name="time-outline" size={13} color={palette.mutedForeground} />
            <Text className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
              Нещодавні пошуки адреси (офлайн)
            </Text>
          </View>
          <View className="flex-row flex-wrap gap-1.5 pt-1">
            {recentAddresses.map((item, idx) => {
              const fullLabel = [item.settlement, item.street, item.house].filter(Boolean).join(', ');
              return (
                <Pressable
                  key={idx}
                  onPress={() => {
                    setSettlement(item.settlement);
                    if (item.street) setStreet(item.street);
                    if (item.house) setHouse(item.house);
                    void submit({ settlement: item.settlement, street: item.street, house: item.house });
                  }}
                  className="flex-row items-center gap-1.5 rounded-xl border border-hairline bg-surface-container-low px-2.5 py-1 active:opacity-70"
                >
                  <Ionicons name="location-outline" size={11} color={palette.primary} />
                  <Text className="text-2xs font-medium text-foreground">{fullLabel}</Text>
                  <Text className="text-2xs font-bold text-primary">({item.queue})</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      <StepCard step={1} title="Населений пункт">
        <Field
          label="Населений пункт"
          value={settlement}
          editable={currentRegion !== 'kyiv-city'}
          placeholder="Ваш населений пункт"
          onChangeText={(value) => {
            setSettlement(value);
            setStreet('');
            setHouse('');
            setSelectedSettlementQueue(null);
            setResult(null);
            setManualQueue(null);
            autoResolved.current = null;
            autoResolvedStreet.current = null;
          }}
        />
        {currentSettlementMatch && (currentSettlementMatch.dominantQueue || currentSettlementMatch.dominantQueues?.length) ? (
          <View className="flex-row items-center justify-between rounded-xl bg-surface-container-high/80 px-3 py-1.5">
            <View className="flex-row items-center gap-1.5">
              <Ionicons name="flash-outline" size={12} color={palette.primary} />
              <Text className="text-2xs font-semibold text-foreground">
                Основна черга міста:{' '}
                <Text className="font-bold text-primary">
                  {currentSettlementMatch.dominantQueue || currentSettlementMatch.dominantQueues?.[0]}
                </Text>
              </Text>
            </View>
            {currentSettlementMatch.operator ? (
              <Text className="text-2xs text-muted-foreground" numberOfLines={1}>
                {currentSettlementMatch.operator}
              </Text>
            ) : null}
          </View>
        ) : null}
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
            placeholder={settlement.trim() ? 'Назва вулиці' : 'Спочатку виберіть населений пункт'}
            onChangeText={(value) => {
              setStreet(value);
              setHouse('');
              setResult(null);
              setManualQueue(null);
              autoResolvedStreet.current = null;
            }}
          />
          {streetOptions.length > 0 ? (
            <Chips
              options={streetOptions.map((item) => item.name)}
              onPick={chooseStreet}
              active={street}
              title={street.trim() ? 'Вулиці' : 'Популярні вулиці'}
            />
          ) : streetsQuery.isFetching ? (
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
            returnKeyType="search"
            onSubmitEditing={() => void submit()}
            onChangeText={(value) => {
              setHouse(value);
              setResult(null);
              setManualQueue(null);
            }}
          />
          {houseOptions.length > 0 ? (
            <View className="gap-1.5">
              <Text className="text-xs font-semibold text-muted-foreground">Відомі будинки</Text>
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

      {resolve.isPending ? (
        <View className="items-center justify-center py-3">
          <ActivityIndicator color={palette.primary} />
          <Text className="mt-1 text-xs text-muted-foreground">Шукаємо групу…</Text>
        </View>
      ) : null}

      {resolve.isError ? (
        <Text className="rounded-2xl border border-destructive/30 bg-card px-4 py-3 text-sm text-destructive">
          Не вдалося виконати пошук. Перевірте звʼязок і спробуйте ще раз.
        </Text>
      ) : null}

      {activeQueue ? (
        <View
          style={{
            backgroundColor: palette.card,
            borderColor: currentOff ? palette.status.off.border : palette.hairline,
            borderWidth: 1,
            borderRadius: 24,
            padding: 16,
            gap: 12,
            shadowColor: '#000',
            shadowOpacity: 0.1,
            shadowRadius: 10,
            shadowOffset: { width: 0, height: 2 },
          }}
        >
          {/* Шапка результату */}
          <View className="flex-row items-start gap-3">
            <View
              style={{
                backgroundColor: currentOff ? palette.status.off.soft : palette.primaryContainer,
                borderColor: currentOff ? palette.status.off.border : palette.primary,
                borderWidth: 1,
              }}
              className="min-w-16 items-center justify-center rounded-2xl px-3 py-2.5"
            >
              <Text
                className="text-xl font-extrabold"
                style={{ color: currentOff ? palette.status.off.text : palette.primary }}
              >
                {activeQueue}
              </Text>
            </View>

            <View className="flex-1 gap-1">
              <View className="flex-row items-center justify-between">
                <Text className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  {manualQueue ? 'Обрано вручну' : 'Ваша черга'}
                </Text>
                <View
                  style={{
                    backgroundColor: currentOff
                      ? palette.status.off.soft
                      : hasSchedule
                        ? palette.status.on.soft
                        : palette.surfaceContainerHigh,
                    borderColor: currentOff
                      ? palette.status.off.border
                      : hasSchedule
                        ? palette.status.on.border
                        : palette.border,
                  }}
                  className="rounded-full border px-2.5 py-0.5"
                >
                  <Text
                    className="text-xs font-bold"
                    style={{
                      color: currentOff
                        ? palette.status.off.text
                        : hasSchedule
                          ? palette.status.on.text
                          : palette.mutedForeground,
                    }}
                  >
                    {statusText}
                  </Text>
                </View>
              </View>

              <Text className="text-base font-bold text-foreground">
                {formatQueueLabel(activeQueue, currentRegion)}
              </Text>

              <Text className="text-xs text-muted-foreground" numberOfLines={2}>
                {[settlement, street, house].filter(Boolean).join(', ')}
              </Text>

              {result?.confidence === 'community_pending' ? (
                <Text className="text-xs text-warning">
                  Спільнота: {result.votesCount ?? 0} голос(ів). Це підказка, а не підтверджений факт.
                </Text>
              ) : null}
              {result?.confidence === 'community_verified' ? (
                <Text className="text-xs font-semibold text-primary">
                  Підтверджено спільнотою: {result.votesCount ?? 0} голос(ів)
                </Text>
              ) : null}
            </View>
          </View>

          {/* Інтервали відключень */}
          {manualQueue && manualScheduleQuery.isLoading ? (
            <ActivityIndicator color={palette.mutedForeground} />
          ) : intervals.length > 0 ? (
            <View className="gap-1.5">
              <Text className="text-xs font-semibold text-foreground">Графік на сьогодні</Text>
              {intervals.map((interval) => {
                const startMs = Date.parse(interval.startsAt);
                const endMs = Date.parse(interval.endsAt);
                const minutes = Math.max(0, Math.round((endMs - startMs) / 60_000));
                return (
                  <View
                    key={`${interval.startsAt}-${interval.endsAt}`}
                    style={{
                      backgroundColor: palette.surfaceContainerLow,
                      borderColor: palette.hairline,
                    }}
                    className="flex-row items-center justify-between rounded-xl border px-3 py-1.5"
                  >
                    <View className="flex-row items-center gap-2">
                      <View className="h-2 w-2 rounded-full bg-destructive" />
                      <Text className="text-xs font-semibold tabular-nums text-foreground">
                        {formatTimeRange(interval.startsAt, interval.endsAt)}
                      </Text>
                    </View>
                    <Text className="text-xs tabular-nums text-muted-foreground">
                      {formatMinutesUk(minutes)}
                    </Text>
                  </View>
                );
              })}
            </View>
          ) : activeSchedule?.allClear ? (
            <View
              style={{ backgroundColor: palette.status.on.soft, borderColor: palette.status.on.border }}
              className="rounded-xl border p-2.5"
            >
              <Text className="text-xs font-medium" style={{ color: palette.status.on.text }}>
                На сьогодні відключень не заплановано
              </Text>
            </View>
          ) : (
            <View
              style={{ backgroundColor: palette.surfaceContainerLow, borderColor: palette.hairline }}
              className="rounded-xl border p-2.5"
            >
              <Text className="text-xs text-muted-foreground">
                Графік на сьогодні ще не опубліковано
              </Text>
            </View>
          )}

          {/* Блок збереження адреси */}
          {saveOpen ? (
            <View className="border-t border-hairline pt-3">
              <PlaceEditor
                initialLabel={defaultPlaceLabel(places)}
                initialIcon="home"
                autoFocus
                submitLabel="Зберегти місце"
                onSave={savePlace}
                onCancel={() => setSaveOpen(false)}
              />
            </View>
          ) : alreadySavedPlace ? (
            <View
              style={{
                backgroundColor: 'rgba(16, 185, 129, 0.10)',
                borderColor: 'rgba(16, 185, 129, 0.35)',
              }}
              className="flex-row items-center justify-between rounded-2xl border px-3.5 py-2.5"
            >
              <View className="flex-row items-center gap-2">
                <Ionicons name="bookmark" size={15} color="#10B981" />
                <Text className="text-xs font-semibold text-foreground">
                  Збережено як «{alreadySavedPlace.label}»
                </Text>
              </View>
              <Pressable
                onPress={() => {
                  setSaveFeedback(null);
                  setSaveOpen(true);
                }}
                accessibilityRole="button"
                className="rounded-lg px-2.5 py-1 active:opacity-70"
              >
                <Text className="text-xs font-bold" style={{ color: '#10B981' }}>
                  Змінити
                </Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              onPress={() => {
                setSaveFeedback(null);
                setSaveOpen(true);
              }}
              accessibilityRole="button"
              style={{
                backgroundColor: 'rgba(16, 185, 129, 0.12)',
                borderColor: 'rgba(16, 185, 129, 0.40)',
              }}
              className="min-h-11 flex-row items-center justify-center gap-2 rounded-2xl border px-4 active:opacity-80"
            >
              <Ionicons name="star-outline" size={16} color="#10B981" />
              <Text className="text-xs font-bold" style={{ color: '#10B981' }}>
                Зберегти адресу
              </Text>
            </Pressable>
          )}
        </View>
      ) : null}

      {result && !result.queue && !manualQueue && house.trim() ? (
        <View className="rounded-2xl border border-hairline bg-surface-container-low px-4 py-3">
          <Text className="text-center text-xs text-muted-foreground">
            За вказаною адресою групу не знайдено в довіднику.
          </Text>
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
  returnKeyType,
  onSubmitEditing,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  editable?: boolean;
  keyboardType?: 'default' | 'numeric';
  returnKeyType?: 'done' | 'search' | 'next';
  onSubmitEditing?: () => void;
}) {
  const { palette } = useTheme();
  return (
    <View className="gap-1">
      <Text className="text-xs font-semibold text-muted-foreground">{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={palette.mutedForeground}
        editable={editable}
        autoCapitalize="words"
        autoCorrect={false}
        keyboardType={keyboardType}
        returnKeyType={returnKeyType}
        onSubmitEditing={onSubmitEditing}
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
      <Text className="text-xs font-semibold text-muted-foreground">{title}</Text>
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
