import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BadgeCheck,
  BookmarkPlus,
  Building2,
  Check,
  ChevronDown,
  ExternalLink,
  ListFilter,
  MapPin,
  Search,
  Users,
  Zap,
  ZapOff,
} from 'lucide-react';
import { useRegion } from '../../hooks/useRegion.js';
import { useBookmarks } from '../../hooks/useBookmarks.js';
import {
  useAddressHouses,
  useAddressLookup,
  useAddressSettlements,
  useAddressStreets,
  useQueues,
  useQueueSchedule,
} from '../../api/queries.js';
import { QueueScheduleBar } from '../schedule/QueueScheduleBar.js';
import { PlaceNameEditor } from '../places/PlaceNameEditor.js';
import { Button } from '../ui/Button.js';
import { Badge } from '../ui/Badge.js';
import { Skeleton } from '../ui/Skeleton.js';
import { cn } from '../../lib/cn.js';
import { formatKyivTime } from '../../lib/date.js';
import { formatQueueLabel } from '../../lib/queue-label.js';
import { operatorLink } from '../../lib/operator-links.js';
import { hapticTick } from '../../lib/haptics.js';
import { MAX_SAVED_PLACES, type PlaceIcon } from '../../lib/saved-places.js';
import type { AddressHouseOption, AddressResolveResult, QueueScheduleData } from '@svitlo/shared';

/**
 * Главные города областей — только реальные названия, без рейтинга и «похожих» подстановок.
 * Это быстрый вход для тех, кто ищет адрес в областном центре или крупном городе.
 */
const MAIN_CITIES: Record<string, string[]> = {
  'vinnytska-oblast': ['Вінниця'],
  'volynska-oblast': ['Луцьк'],
  'chernihivska-oblast': ['Чернігів', 'Ніжин', 'Прилуки', 'Бахмач'],
  'kyiv-city': ['Київ'],
  'kyivska-oblast': ['Біла Церква', 'Бровари', 'Бориспіль', 'Ірпінь'],
  'dnipropetrovska-oblast': ['Дніпро', 'Кривий Ріг', 'Камʼянське'],
  'donetska-oblast': ['Краматорськ', 'Словʼянськ'],
  'zhytomyrska-oblast': ['Житомир'],
  'zakarpatska-oblast': ['Ужгород', 'Мукачево'],
  'zaporizka-oblast': ['Запоріжжя', 'Мелітополь'],
  'ivano-frankivska-oblast': ['Івано-Франківськ', 'Коломия'],
  'kirovohradska-oblast': ['Кропивницький', 'Олександрія'],
  'luhanska-oblast': ['Сєвєродонецьк', 'Лисичанськ'],
  'lvivska-oblast': ['Львів'],
  'mykolaivska-oblast': ['Миколаїв'],
  'odeska-oblast': ['Одеса', 'Ізмаїл'],
  'poltavska-oblast': ['Полтава'],
  'cherkaska-oblast': ['Черкаси'],
  'kharkivska-oblast': ['Харків'],
  'khersonska-oblast': ['Херсон'],
  'khmelnytska-oblast': ['Хмельницький', 'Камʼянець-Подільський'],
  'rivnenska-oblast': ['Рівне'],
  'sumska-oblast': ['Суми', 'Конотоп'],
  'ternopilska-oblast': ['Тернопіль', 'Чортків'],
  'chernivetska-oblast': ['Чернівці'],
};

function kyivToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(new Date());
}

/** Числовая часть дома для сортировки «соседних» вариантов; буква и раскладка не важны. */
function houseNumberValue(value: string): number | null {
  const match = String(value ?? '').trim().match(/^(\d{1,5})/u);
  if (!match) return null;
  const parsed = Number.parseInt(match[1]!, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Одиночный номер дома, а не диапазон/список: только такие показываем чипами. */
function isSingleHouse(value: string): boolean {
  return /^\d{1,5}(?:\s*[a-zа-яіїє])?(?:(?:\s*[\/\\]\s*\d{1,5}(?:[a-zа-яіїє])?)|(?:\s+к\.?\s*\d{1,5}))?$/iu.test(
    String(value ?? '').trim(),
  );
}

function sortQueues(left: string, right: string): number {
  const [aLow, aHigh] = left.split('/').map((part) => Number.parseInt(part, 10) || 0);
  const [bLow, bHigh] = right.split('/').map((part) => Number.parseInt(part, 10) || 0);
  return aLow - bLow || aHigh - bHigh;
}

/**
 * Пошаговый поиск своей группы ГПВ: область → населённый пункт → улица → дом.
 *
 * Ключевой принцип: номер группы не угадывается. Если точного дома нет, мастер показывает
 * соседние известные дома, ручной выбор из реального списка групп области и официальную ссылку
 * оператора. Локально подтверждённая человеком группа сохраняется с отдельной пометкой.
 */
/** Результат спроби зберегти місце: показуємо причину відмови, а не мовчимо. */
type SaveFeedback =
  | { kind: 'saved'; label: string }
  | { kind: 'duplicate'; label: string; queueDiffers: boolean }
  | { kind: 'limit' };

/**
 * Ответ на голос «це моя черга».
 *
 * `protected` — дом уже есть в официальном справочнике, поэтому голос не применён: человек
 * должен видеть правду, а не «збережено», после которого ничего не изменилось.
 */
type VoteFeedback =
  | { kind: 'saved'; verified: boolean; votes: number }
  | { kind: 'protected'; queue: string }
  | { kind: 'error' };

export const AddressWizard: React.FC = () => {
  const { t } = useTranslation();
  const { currentRegion, setRegion, regions } = useRegion();
  const { addPlace, setPrimaryBookmark } = useBookmarks();

  const [settlement, setSettlement] = useState('');
  const [selectedSettlement, setSelectedSettlement] = useState<string | null>(null);
  const [street, setStreet] = useState('');
  const [selectedStreet, setSelectedStreet] = useState<string | null>(null);
  const [house, setHouse] = useState('');
  const [selectedHouse, setSelectedHouse] = useState<string | null>(null);
  const [result, setResult] = useState<AddressResolveResult | null>(null);
  const [manualQueue, setManualQueue] = useState<string | null>(null);
  const [groupDraft, setGroupDraft] = useState('');
  const [confirmedQueue, setConfirmedQueue] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [draftLabel, setDraftLabel] = useState('');
  const [draftIcon, setDraftIcon] = useState<PlaceIcon>('home');
  const [draftPrimary, setDraftPrimary] = useState(true);
  const [saveFeedback, setSaveFeedback] = useState<SaveFeedback | null>(null);

  const resolve = useAddressLookup();
  const streetsQuery = useAddressStreets(currentRegion, settlement, street);
  const housesQuery = useAddressHouses(currentRegion, settlement, street);
  const queuesQuery = useQueues(currentRegion);
  const today = kyivToday();
  const manualScheduleQuery = useQueueSchedule(manualQueue ?? undefined, today, currentRegion);

  const resetAddressResult = () => {
    setResult(null);
    setManualQueue(null);
    setGroupDraft('');
    setConfirmedQueue(null);
    setSaveOpen(false);
    setSaveFeedback(null);
  };

  // Київ — єдиний НП регіону kyiv-city, тому вибір фіксується без введення назви.
  useEffect(() => {
    setSettlement(currentRegion === 'kyiv-city' ? 'Київ' : '');
    setSelectedSettlement(currentRegion === 'kyiv-city' ? 'Київ' : null);
    setStreet('');
    setSelectedStreet(null);
    setHouse('');
    setSelectedHouse(null);
    resetAddressResult();
  }, [currentRegion]);

  const submit = async (overrides: { settlement?: string; street?: string; house?: string } = {}) => {
    const nextSettlement = (overrides.settlement ?? settlement).trim();
    const nextStreet = (overrides.street ?? street).trim();
    const nextHouse = (overrides.house ?? house).trim();
    if (!nextSettlement) return;
    setSaveFeedback(null);
    setSaveOpen(false);
    setManualQueue(null);
    setConfirmedQueue(null);
    const found = await resolve.mutateAsync({
      region: currentRegion,
      settlement: nextSettlement,
      street: nextStreet || undefined,
      house: nextHouse || undefined,
    });
    setResult(found);
  };

  const chooseSettlement = (name: string) => {
    setSettlement(name);
    setSelectedSettlement(name);
    setStreet('');
    setSelectedStreet(null);
    setHouse('');
    setSelectedHouse(null);
    resetAddressResult();
  };

  // НП, у которого на всё поселение одна очередь: `resolve` отдаёт
  // `reason: "whole-settlement"` вместе с готовым расписанием. Дополнительный шаг
  // «улица» тут ничего не различает, поэтому сразу показываем подгруппу и график.
  const wholeSettlementQueue = streetsQuery.data?.wholeSettlementQueue ?? null;
  useEffect(() => {
    if (!settlement.trim() || !wholeSettlementQueue || street.trim() || result) return;
    void submit({ settlement });
  }, [settlement, wholeSettlementQueue, street, result]);

  const chooseStreet = (name: string) => {
    setStreet(name);
    setSelectedStreet(name);
    setHouse('');
    setSelectedHouse(null);
    resetAddressResult();
  };

  const chooseHouse = (value: string) => {
    const rangeStart = value.match(/^(\d{1,5})\s*[-–—]\s*\d{1,5}$/u)?.[1];
    const selected = rangeStart ?? value;
    setHouse(selected);
    setSelectedHouse(selected);
    setManualQueue(null);
    setConfirmedQueue(null);
    setSaveFeedback(null);
    void submit({ house: selected });
  };

  const queueOptions = useMemo(
    () => (queuesQuery.data?.data ?? []).map((item) => item.queue).sort(sortQueues),
    [queuesQuery.data],
  );

  const activeQueue = manualQueue ?? result?.queue ?? null;
  const activeSchedule: QueueScheduleData | null = manualQueue
    ? manualScheduleQuery.data?.data ?? null
    : result?.schedule ?? null;
  const activeSource = manualQueue
    ? t('addressWizard.sourceManual')
    : result?.source ?? null;

  const intervals = activeSchedule?.intervals ?? [];
  const nowMs = Date.now();
  const currentOff = intervals.find(
    (interval) => Date.parse(interval.startsAt) <= nowMs && nowMs < Date.parse(interval.endsAt),
  );
  const hasScheduleData = intervals.length > 0 || activeSchedule?.allClear === true;
  const statusText = !activeQueue
    ? null
    : !hasScheduleData
      ? t('addressWizard.statusUnknown')
      : currentOff
        ? t('addressWizard.offUntil', { time: formatKyivTime(currentOff.endsAt) })
        : t('addressWizard.lightOn');

  /** Ближайшие известные дома улицы: до 4, по разнице номера. */
  const nearbyHouses = useMemo(() => {
    const known = (housesQuery.data?.data ?? []).filter((item) => isSingleHouse(item.housePattern));
    if (known.length === 0) return [];
    const wanted = houseNumberValue(house);
    return [...known]
      .sort((left, right) => {
        if (wanted === null) {
          return left.housePattern.localeCompare(right.housePattern, 'uk', { numeric: true });
        }
        const a = houseNumberValue(left.housePattern);
        const b = houseNumberValue(right.housePattern);
        return Math.abs((a ?? Number.MAX_SAFE_INTEGER) - wanted) -
          Math.abs((b ?? Number.MAX_SAFE_INTEGER) - wanted);
      })
      .slice(0, 4);
  }, [house, housesQuery.data]);

  const openSavePanel = () => {
    setDraftLabel(t('places.iconHome'));
    setDraftIcon('home');
    setDraftPrimary(true);
    setSaveFeedback(null);
    setSaveOpen(true);
    hapticTick('tick');
  };

  /**
   * Зберігає місце з власною назвою та іконкою.
   *
   * Дублікат адреси — не помилка введення: людина могла вже зберегти цей будинок як «Дім».
   * Тому показуємо, під якою назвою адреса вже є, і не створюємо другу копію. Якщо група
   * відрізняється, підказуємо оновити її в місці, а не плодити «Дім» і «Дім 2».
   */
  const savePlace = () => {
    if (!activeQueue) return;
    const result = addPlace({
      label: draftLabel,
      icon: draftIcon,
      regionCpu: currentRegion,
      settlementName: settlement.trim(),
      streetName: street.trim() || undefined,
      house: house.trim() || undefined,
      queue: activeQueue,
      addressConfirmed: confirmedQueue === activeQueue,
    });

    if (result.ok) {
      if (draftPrimary) setPrimaryBookmark(result.place.id);
      setSaveFeedback({ kind: 'saved', label: result.place.label });
      setSaveOpen(false);
      hapticTick('confirm');
      return;
    }

    if (result.reason === 'duplicate' && result.duplicate) {
      setSaveFeedback({
        kind: 'duplicate',
        label: result.duplicate.label,
        queueDiffers: result.duplicate.queue !== activeQueue,
      });
      return;
    }

    if (result.reason === 'limit') setSaveFeedback({ kind: 'limit' });
  };

  /**
   * «Це моя група» більше не зберігає місце мовчки: раніше тут з'являвся запис «Дім» без
   * назви, який потім доводилось перейменовувати. Тепер група лише підтверджується, а місце
   * людина зберігає сама — з назвою та іконкою.
   */
  const confirmNearbyGroup = (option: AddressHouseOption) => {
    setManualQueue(option.queue);
    setConfirmedQueue(option.queue);
    setSaveFeedback(null);
  };

  const applyManualGroup = () => {
    if (!groupDraft) return;
    setManualQueue(groupDraft);
    setConfirmedQueue(null);
    setSaveFeedback(null);
  };


  const operator = operatorLink(currentRegion);
  const showNotFound = Boolean(result && !result.queue && !manualQueue);


  return (
    <div className="space-y-4">
      <StepCard step={1} title={t('addressWizard.settlement')} icon={MapPin}>
        <div className="space-y-1.5">
          <label htmlFor="address-region" className="block text-[11px] font-semibold text-muted-foreground">
            {t('addressWizard.region')}
          </label>
          <select
            id="address-region"
            value={currentRegion}
            onChange={(event) => {
              setRegion(event.target.value);
              setSettlement('');
              setStreet('');
              setHouse('');
              resetAddressResult();
            }}
            className="h-11 w-full rounded-xl border border-input bg-transparent px-3 text-sm shadow-xs focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
          >
            {regions.map((region) => (
              <option key={region.cpu} value={region.cpu}>
                {region.nameUa}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="address-settlement" className="block text-[11px] font-semibold text-muted-foreground">
            {t('addressWizard.settlement')}
          </label>
          <input
            id="address-settlement"
            type="text"
            value={settlement}
            placeholder={t('addressWizard.settlementPlaceholder')}
            autoComplete="off"
            readOnly={currentRegion === 'kyiv-city'}
            onChange={(event) => {
              setSettlement(event.target.value);
              setSelectedSettlement(null);
              setStreet('');
              setSelectedStreet(null);
              setHouse('');
              setSelectedHouse(null);
              resetAddressResult();
            }}
            className="h-11 w-full rounded-xl border border-input bg-transparent px-3 text-sm shadow-xs focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
          />
          <SettlementSuggestions region={currentRegion} query={settlement} onPick={chooseSettlement} />
          <CityChips region={currentRegion} current={settlement} onPick={chooseSettlement} />
        </div>
      </StepCard>

        {/* НП обслуживает одна очередь: шаг «улица» ничего не различает, поэтому прячем его
            и сразу показываем подгруппу с её графиком. Различать имеет смысл только если
            наsettlement действительно больше одной очереди. */}
          {!(wholeSettlementQueue && !street.trim()) && (
        <StepCard step={2} title={t('addressWizard.street')} icon={Building2} muted={!settlement.trim()}>
          <div className="space-y-1.5">
            <label htmlFor="address-street" className="block text-[11px] font-semibold text-muted-foreground">
              {t('addressWizard.street')}
            </label>
            <input
              id="address-street"
              type="text"
              value={street}
              placeholder={settlement.trim() ? t('addressWizard.streetPlaceholder') : t('addressWizard.pickSettlementFirst')}
              autoComplete="off"
              disabled={!settlement.trim()}
              onChange={(event) => {
                setStreet(event.target.value);
                setSelectedStreet(null);
                setHouse('');
                setSelectedHouse(null);
                resetAddressResult();
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void submit();
              }}
              className="h-11 w-full rounded-xl border border-input bg-transparent px-3 text-sm shadow-xs focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
            />
            <StreetChips
              options={streetsQuery.data?.data ?? []}
              query={street}
              onPick={chooseStreet}
              loading={streetsQuery.isFetching}
            />
            {streetsQuery.data?.wholeSettlementQueue && !street && (
              <p className="text-[11px] font-semibold text-success">
                {t('addressWizard.wholeSettlementQueue', {
                  queue: formatQueueLabel(streetsQuery.data.wholeSettlementQueue, currentRegion),
                })}
              </p>
            )}
  
            <label htmlFor="address-house" className="mt-2 block text-[11px] font-semibold text-muted-foreground">
              {t('addressWizard.house')}
            </label>
            <input
              id="address-house"
              type="text"
              value={house}
              placeholder={street.trim() ? t('addressWizard.housePlaceholder') : t('addressWizard.pickStreetFirst')}
              autoComplete="off"
              disabled={!street.trim()}
              onChange={(event) => {
                setHouse(event.target.value);
                setSelectedHouse(null);
                setResult(null);
                setManualQueue(null);
                setConfirmedQueue(null);
                setSaveFeedback(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void submit();
              }}
              className="h-11 w-full rounded-xl border border-input bg-transparent px-3 text-sm shadow-xs focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
            />
            <HouseChips
              key={`${settlement}|${street}`}
              options={housesQuery.data?.data ?? []}
              query={house}
              wholeStreetQueue={housesQuery.data?.wholeStreetQueue ?? null}
              regionCpu={currentRegion}
              onPick={chooseHouse}
              loading={housesQuery.isFetching}
            />
          </div>
        </StepCard>
          )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={() => void submit()}
          disabled={!settlement.trim() || resolve.isPending}
          className="gap-2"
        >
          <Search className="h-4 w-4" aria-hidden />
          {resolve.isPending ? t('addressWizard.searching') : t('addressWizard.find')}
        </Button>
        {result?.options.length ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <MapPin className="h-3.5 w-3.5" aria-hidden />
            {t('addressWizard.hintEnterHouse')}
          </span>
        ) : null}
      </div>

      {resolve.isPending && <Skeleton className="h-28 w-full rounded-2xl" />}

      {resolve.isError && (
        <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {t('addressWizard.searchFailed')}
        </p>
      )}


      {showNotFound && (
        <div className="space-y-4 rounded-2xl border border-border bg-card p-4">
          <div>
            <p className="text-sm font-semibold text-foreground">{t('addressWizard.noExactHouse')}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t('addressWizard.noExactHouseDesc')}</p>
          </div>

          {nearbyHouses.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                {t('addressWizard.nearbyTitle')}
              </h3>
              <div className="space-y-1.5">
                {nearbyHouses.map((option) => (
                  <div
                    key={`${option.housePattern}-${option.queue}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-muted/30 px-3 py-2"
                  >
                    <span className="text-sm font-semibold text-foreground">
                      №{option.housePattern} — {formatQueueLabel(option.queue, currentRegion)}
                    </span>
                    <Button size="sm" variant="outline" onClick={() => confirmNearbyGroup(option)}>
                      {t('addressWizard.thisIsMyGroup')}
                    </Button>
                  </div>
                ))}
              </div>
              <p className="text-[11px] leading-snug text-warning">{t('addressWizard.nearbyConfirmedHint')}</p>
            </section>
          )}

          <section className="space-y-2 border-t border-hairline pt-3">
            <h3 className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
              <ListFilter className="h-3.5 w-3.5" aria-hidden />
              {t('addressWizard.manualTitle')}
            </h3>
            <p className="text-xs text-muted-foreground">{t('addressWizard.manualDesc')}</p>
            {queueOptions.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor="address-manual-group" className="sr-only">
                  {t('addressWizard.manualSelect')}
                </label>
                <select
                  id="address-manual-group"
                  value={groupDraft}
                  onChange={(event) => setGroupDraft(event.target.value)}
                  className="h-10 min-w-48 rounded-xl border border-input bg-transparent px-3 text-sm shadow-xs focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="">{t('addressWizard.manualSelect')}</option>
                  {queueOptions.map((queue) => (
                    <option key={queue} value={queue}>
                      {formatQueueLabel(queue, currentRegion)}
                    </option>
                  ))}
                </select>
                <Button size="sm" onClick={applyManualGroup} disabled={!groupDraft}>
                  {t('addressWizard.manualShow')}
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">{t('addressWizard.noRegionQueues')}</p>
            )}
          </section>

          <a
            href={operator.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary underline-offset-4 hover:underline"
          >
            {operator.isRegistry ? t('addressWizard.registryLink') : t('addressWizard.howToFind')}
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
        </div>
      )}


      {activeQueue && (
        <section className="overflow-hidden rounded-3xl border border-success/30 bg-card shadow-xs">
          <div className="flex items-start gap-3 border-b border-success/20 bg-success/8 p-4">
            <span className="inline-flex min-h-12 min-w-16 items-center justify-center rounded-2xl bg-success px-3 font-display text-xl font-bold text-success-foreground">
              {activeQueue}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-success">
                {t('addressWizard.yourQueue')}
              </p>
              <p className="text-sm font-bold text-foreground">{formatQueueLabel(activeQueue, currentRegion)}</p>
              <p className="truncate text-sm font-semibold text-foreground">
                {[settlement, street, house].filter(Boolean).join(', ')}
              </p>
              <p className={cn('mt-1 inline-flex items-center gap-1 text-xs font-semibold', currentOff ? 'text-destructive' : hasScheduleData ? 'text-success' : 'text-muted-foreground')}>
                {currentOff ? <ZapOff className="h-3.5 w-3.5" aria-hidden /> : <Zap className="h-3.5 w-3.5" aria-hidden />}
                {statusText}
              </p>
              {confirmedQueue === activeQueue && (
                <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-primary">
                  <BadgeCheck className="h-3.5 w-3.5" aria-hidden />
                  {t('addressWizard.confirmedByYou')}
                </p>
              )}
              {result?.confidence === 'community_verified' && (
                <p className="mt-1">
                  <Badge variant="success" className="gap-1">
                    <BadgeCheck className="h-3 w-3" aria-hidden />
                    {t('addressWizard.communityVerified', { count: result.votesCount ?? 0 })}
                  </Badge>
                </p>
              )}
              {result?.confidence === 'community_pending' && result.queue && (
                <div className="mt-2 space-y-2">
                  <Badge variant="warning" className="gap-1 whitespace-normal text-left">
                    <Users className="h-3 w-3 shrink-0" aria-hidden />
                    {t('addressWizard.communityPending', {
                      queue: formatQueueLabel(result.queue, currentRegion),
                      count: result.votesCount ?? 0,
                    })}
                  </Badge>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        // Возвращаемся к ручному выбору группы: человек не согласен с подсказкой.
                        setResult(null);
                        setManualQueue(null);
                                          }}
                    >
                      {t('addressWizard.specifyOther')}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-3 p-4">
            {manualQueue && manualScheduleQuery.isLoading ? (
              <Skeleton className="h-12 w-full rounded-xl" />
            ) : activeSchedule && intervals.length > 0 ? (
              <QueueScheduleBar intervals={intervals} date={activeSchedule.date} showSummary={false} />
            ) : activeSchedule?.allClear ? (
              <p className="text-xs font-medium text-success">{t('schedule.allClearTitle')}</p>
            ) : (
              <p className="text-xs text-muted-foreground">{t('addressWizard.noScheduleToday')}</p>
            )}

            {saveOpen ? (
              <div className="space-y-3 rounded-2xl border border-primary/30 bg-primary-container/10 p-3">
                <PlaceNameEditor
                  label={draftLabel}
                  icon={draftIcon}
                  autoFocus
                  onLabelChange={setDraftLabel}
                  onIconChange={setDraftIcon}
                  onSubmit={savePlace}
                  onCancel={() => setSaveOpen(false)}
                  submitLabel={t('places.save')}
                />
                <label className="flex items-center gap-2 text-xs font-semibold text-foreground">
                  <input
                    type="checkbox"
                    checked={draftPrimary}
                    onChange={(event) => setDraftPrimary(event.target.checked)}
                    className="h-4 w-4 accent-primary"
                  />
                  {t('addressWizard.makePrimary')}
                </label>
              </div>
            ) : (
              <Button onClick={openSavePanel} className="w-full gap-2">
                <BookmarkPlus className="h-4 w-4" aria-hidden />
                {t('places.save')}
              </Button>
            )}

            {saveFeedback?.kind === 'saved' && (
              <p
                role="status"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-success"
              >
                <Check className="h-4 w-4" aria-hidden />
                {t('addressWizard.savedAs', { label: saveFeedback.label })}
              </p>
            )}
            {saveFeedback?.kind === 'duplicate' && (
              <p role="alert" className="rounded-xl bg-warning/10 px-3 py-2 text-xs text-foreground">
                <span className="font-semibold">{t('places.duplicateTitle')}. </span>
                {saveFeedback.queueDiffers
                  ? t('places.duplicateQueue')
                  : t('places.duplicateDesc', { label: saveFeedback.label })}
              </p>
            )}
            {saveFeedback?.kind === 'limit' && (
              <p role="alert" className="rounded-xl bg-warning/10 px-3 py-2 text-xs font-semibold text-foreground">
                {t('places.limit', { max: MAX_SAVED_PLACES })}
              </p>
            )}
            {activeSource && (
              <p className="text-[11px] text-muted-foreground/80">
                {t('addressWizard.source', { source: activeSource })}
              </p>
            )}
          </div>
        </section>
      )}
    </div>
  );
};


/** Шаг мастера с номером и иконкой: визуально отделяет адресные шаги от результата. */
const StepCard: React.FC<{
  step: number;
  title: string;
  icon: typeof MapPin;
  muted?: boolean;
  children: React.ReactNode;
}> = ({ step, title, icon: Icon, muted, children }) => (
  <section className={cn('rounded-2xl border border-border bg-card p-4 shadow-xs', muted && 'opacity-70')}>
    <div className="mb-3 flex items-center gap-2">
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-primary/30 bg-primary/12 text-xs font-bold text-primary">
        {step}
      </span>
      <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
      <h2 className="text-sm font-bold text-foreground">{title}</h2>
    </div>
    <div className="space-y-3">{children}</div>
  </section>
);

/** Подсказки НП: офлайн-пакет + серверный справочник, без дублей. */
const SettlementSuggestions: React.FC<{
  region: string;
  query: string;
  onPick: (name: string) => void;
}> = ({ region, query, onPick }) => {
  const { t } = useTranslation();
  const server = useAddressSettlements(region, query);
  const names = useMemo(() => {
    const serverNames = (server.data?.data ?? []).map((entry) => entry.name);
    const baseName = (value: string) => {
      const parts = value.split(' · ');
      return parts[parts.length - 1]!.trim();
    };
    const qualifiedCounts = new Map<string, number>();
    for (const name of serverNames) {
      if (!name.includes(' · ')) continue;
      const base = baseName(name).toLocaleLowerCase('uk-UA');
      qualifiedCounts.set(base, (qualifiedCounts.get(base) ?? 0) + 1);
    }

    const seen = new Set<string>();
    const result: Array<{ label: string; value: string }> = [];
    for (const item of serverNames) {
      const base = baseName(item);
      const key = base.toLocaleLowerCase('uk-UA');
      const isQualified = item.includes(' · ');
      const isAmbiguous = (qualifiedCounts.get(key) ?? 0) > 1;
      if (isAmbiguous && !isQualified) continue;
      const label = isAmbiguous && isQualified
        ? item
        : base.charAt(0).toLocaleUpperCase('uk-UA') + base.slice(1).toLocaleLowerCase('uk-UA');
      const value = isAmbiguous && isQualified ? item : base;
      const labelKey = label.toLocaleLowerCase('uk-UA');
      if (labelKey === query.trim().toLocaleLowerCase('uk-UA') || seen.has(labelKey)) continue;
      seen.add(labelKey);
      result.push({ label, value });
      if (result.length >= 6) break;
    }
    return result;
  }, [query, server.data]);

  if (query.trim().length < 2 || names.length === 0) return null;

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1.5">
        {names.map(({ label, value }) => (
          <button
            key={value}
            type="button"
            onClick={() => onPick(value)}
            className="min-h-9 rounded-full border border-border bg-muted px-3 text-xs font-semibold text-foreground transition-colors hover:bg-accent"
          >
            {highlight(label, query)}
          </button>
        ))}
      </div>
    </div>
  );
};

/** Быстрые города области: реальные названия, один тап выбирает НП. */
const CityChips: React.FC<{ region: string; current: string; onPick: (name: string) => void }> = ({
  region,
  current,
  onPick,
}) => {
  const { t } = useTranslation();
  const cities = useMemo(() => {
    return MAIN_CITIES[region] ?? [];
  }, [region]);

  if (cities.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-semibold text-muted-foreground">{t('addressWizard.quickCities')}</p>
      <div className="flex flex-wrap gap-1.5">
        {cities.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => onPick(name)}
            className={cn(
              'min-h-9 rounded-full border px-3 text-xs font-semibold transition-colors',
              current === name
                ? 'border-primary/50 bg-primary/15 text-primary'
                : 'border-border bg-card text-foreground hover:bg-accent',
            )}
          >
            {name}
          </button>
        ))}
      </div>
    </div>
  );
};


/** Улицы выбранного НП: чипы с подсветкой введённого фрагмента. */
const StreetChips: React.FC<{
  options: Array<{ name: string; normalized: string }>;
  query: string;
  onPick: (name: string) => void;
  loading: boolean;
}> = ({ options, query, onPick, loading }) => {
  const { t } = useTranslation();
  if (loading && options.length === 0) {
    return <p className="text-[11px] text-muted-foreground">{t('addressWizard.loadingStreets')}</p>;
  }
  if (options.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-semibold text-muted-foreground">{t('addressWizard.quickStreets')}</p>
      <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
        {options.slice(0, 18).map((option) => (
          <button
            key={option.normalized || option.name}
            type="button"
            onClick={() => onPick(option.name)}
            className={cn(
              'min-h-9 rounded-full border px-3 text-xs font-semibold transition-colors',
              query === option.name
                ? 'border-primary/50 bg-primary/15 text-primary'
                : 'border-border bg-card text-foreground hover:bg-accent',
            )}
          >
            {highlight(option.name, query)}
          </button>
        ))}
      </div>
    </div>
  );
};

/** Дома выбранной улицы: 24 чипа + «показати ще». Ручной ввод остаётся всегда доступным. */
const HouseChips: React.FC<{
  options: AddressHouseOption[];
  query: string;
  wholeStreetQueue: string | null;
  regionCpu: string;
  onPick: (house: string) => void;
  loading: boolean;
}> = ({ options, query, wholeStreetQueue, regionCpu, onPick, loading }) => {
  const { t } = useTranslation();
  const [showAll, setShowAll] = useState(false);
  // Сервер уже прибрав повтори й відсортував числово — тут лише пошук за введеним номером.
  const houses = useMemo(() => options, [options]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('uk-UA');
    if (!needle) return houses;
    return houses.filter((option) => {
      if (option.housePattern.toLocaleLowerCase('uk-UA').includes(needle)) return true;
      const range = option.housePattern.match(/^(\d{1,5})\s*[-–—]\s*(\d{1,5})$/u);
      const numericQuery = Number.parseInt(needle, 10);
      if (!range || !Number.isFinite(numericQuery) || String(numericQuery) !== needle) return false;
      const [start, end] = range.slice(1).map((value) => Number.parseInt(value!, 10));
      return numericQuery >= Math.min(start!, end!) && numericQuery <= Math.max(start!, end!);
    });
  }, [houses, query]);

  if (loading && houses.length === 0) {
    return <p className="text-[11px] text-muted-foreground">{t('addressWizard.loadingHouses')}</p>;
  }
  if (filtered.length === 0) {
    return wholeStreetQueue ? (
      <p className="text-[11px] font-semibold text-success">
        {t('addressWizard.wholeStreetQueue', { queue: formatQueueLabel(wholeStreetQueue, regionCpu) })}
      </p>
    ) : null;
  }

  const visible = showAll ? filtered : filtered.slice(0, 24);

  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-semibold text-muted-foreground">{t('addressWizard.quickHouses')}</p>
      <div className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto">
        {visible.map((option) => (
          <button
            key={`${option.housePattern}-${option.queue}`}
            type="button"
            onClick={() => {
              const range = option.housePattern.match(/^(\d{1,5})\s*[-–—]\s*(\d{1,5})$/u);
              const needle = query.trim();
              const numericQuery = Number.parseInt(needle, 10);
              if (range && Number.isFinite(numericQuery) && String(numericQuery) === needle) {
                onPick(String(numericQuery));
              } else {
                onPick(range?.[1] ?? option.housePattern);
              }
            }}
            className="min-h-9 rounded-full border border-border bg-card px-3 text-xs font-semibold text-foreground transition-colors hover:bg-accent"
          >
            {option.housePattern}
            <span className={cn('ml-1 text-[10px] font-bold', option.queue ? 'text-primary' : 'text-muted-foreground')}>
              {option.queue || t('addressWizard.houseQueueUnknown')}
            </span>
          </button>
        ))}
      </div>
      {filtered.length > 24 && (
        <button
          type="button"
          onClick={() => setShowAll((value) => !value)}
          className="inline-flex min-h-9 items-center gap-1 rounded-full px-2 text-[11px] font-bold text-primary"
        >
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', showAll && 'rotate-180')} aria-hidden />
          {showAll ? t('addressWizard.showLessHouses') : t('addressWizard.showMoreHouses')}
        </button>
      )}
      {wholeStreetQueue && (
        <p className="text-[11px] text-muted-foreground">
          {t('addressWizard.wholeStreetQueue', { queue: formatQueueLabel(wholeStreetQueue, regionCpu) })}
        </p>
      )}
    </div>
  );
};

/** Подсветка совпадения в чипе — тот же приём, что в основном автокомплите. */
function highlight(name: string, query: string) {
  const needle = query.trim();
  if (!needle) return name;
  const at = name.toLocaleLowerCase('uk-UA').indexOf(needle.toLocaleLowerCase('uk-UA'));
  if (at < 0) return name;
  return (
    <>
      {name.slice(0, at)}
      <mark className="rounded bg-primary/20 text-inherit">{name.slice(at, at + needle.length)}</mark>
      {name.slice(at + needle.length)}
    </>
  );
}

