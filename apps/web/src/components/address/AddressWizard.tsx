import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Briefcase, Building2, Check, Home, MapPin, Search, Star, Zap, ZapOff } from 'lucide-react';
import { useRegion } from '../../hooks/useRegion.js';
import { useBookmarks } from '../../hooks/useBookmarks.js';
import {
  useAddressHouses,
  useAddressLookup,
  useAddressSettlements,
  useAddressStreets,
  useContributeAddress,
} from '../../api/queries.js';
import {
  offlineSettlementStats,
  searchOfflineSettlements,
  topOfflineSettlements,
} from '../../api/offline-sync.js';
import { QueueScheduleBar } from '../schedule/QueueScheduleBar.js';
import { Button } from '../ui/Button.js';
import { Skeleton } from '../ui/Skeleton.js';
import { cn } from '../../lib/cn.js';
import { formatKyivTime } from '../../lib/date.js';
import type { AddressHouseOption, QueueScheduleData } from '@svitlo/shared';

/** Что вернул бэкенд на поиск группы. */
interface ResolveResponse {
  queue: string | null;
  options: AddressHouseOption[];
  reason: 'exact-house' | 'whole-street' | 'whole-settlement' | 'not-found';
  source: string | null;
  schedule: QueueScheduleData | null;
}

/**
 * Главные города областей — только реальные названия, без рейтинга и «похожих» подстановок.
 * Это быстрый вход для тех, кто ищет адрес в областном центре или крупном городе.
 */
const MAIN_CITIES: Record<string, string[]> = {
  'chernihivska-oblast': ['Чернігів', 'Ніжин', 'Прилуки', 'Бахмач'],
  'kyiv-city': ['Київ'],
  'kyivska-oblast': ['Біла Церква', 'Бровари', 'Ірпінь'],
  'dnipropetrovska-oblast': ['Дніпро'],
  'lvivska-oblast': ['Львів'],
  'poltavska-oblast': ['Полтава'],
  'cherkaska-oblast': ['Черкаси'],
  'kharkivska-oblast': ['Харків'],
  'zhytomyrska-oblast': ['Житомир'],
};

/**
 * Пошаговый поиск своей группы ГПВ: область → населённый пункт → улица → дом.
 *
 * Ключевой принцип прежний: номер группы не угадывается. Если привязки нет, мастер говорит об
 * этом и предлагает либо назвать очередь самому, либо сохранить адрес локально. Все чипы городов,
 * улиц и домов — это реальные записи справочника, а не декоративные подсказки.
 */
export const AddressWizard: React.FC = () => {
  const { t } = useTranslation();
  const { currentRegion, setRegion, regions } = useRegion();
  const { addBookmark, setPrimaryBookmark } = useBookmarks();

  const [settlement, setSettlement] = useState('');
  const [street, setStreet] = useState('');
  const [house, setHouse] = useState('');
  const [result, setResult] = useState<ResolveResponse | null>(null);
  const [savedLabel, setSavedLabel] = useState<string | null>(null);

  const resolve = useAddressLookup();
  const streetsQuery = useAddressStreets(currentRegion, settlement, street);
  const housesQuery = useAddressHouses(currentRegion, settlement, street);

  const submit = async (overrides: { settlement?: string; street?: string; house?: string } = {}) => {
    const nextSettlement = (overrides.settlement ?? settlement).trim();
    if (!nextSettlement) return;
    setSavedLabel(null);
    const found = await resolve.mutateAsync({
      region: currentRegion,
      settlement: nextSettlement,
      street: (overrides.street ?? street).trim() || undefined,
      house: (overrides.house ?? house).trim() || undefined,
    });
    setResult(found);
  };

  const chooseSettlement = (name: string) => {
    setSettlement(name);
    setStreet('');
    setHouse('');
    setResult(null);
    setSavedLabel(null);
  };

  const chooseStreet = (name: string) => {
    setStreet(name);
    setHouse('');
    setSavedLabel(null);
    void submit({ street: name, house: '' });
  };

  const chooseHouse = (value: string) => {
    setHouse(value);
    setSavedLabel(null);
    void submit({ house: value });
  };

  const saveAs = (label: 'Дім' | 'Робота', makePrimary = false) => {
    if (!result?.queue) return;
    const id = addBookmark({
      label: `${t(label === 'Дім' ? 'addressWizard.labelHome' : 'addressWizard.labelWork')} · ${settlement}, ${street} ${house}`.trim(),
      regionCpu: currentRegion,
      settlementName: settlement.trim(),
      streetName: [street, house].filter(Boolean).join(' ').trim() || undefined,
      queue: result.queue,
      allowDuplicate: true,
    });
    if (id && makePrimary) setPrimaryBookmark(id);
    setSavedLabel(label);
  };

  const queue = result?.queue ?? null;
  const schedule = result?.schedule ?? null;
  const source = result?.source ?? null;
  const intervals = schedule?.intervals ?? [];
  const nowMs = Date.now();
  const currentOff = intervals.find(
    (interval) => Date.parse(interval.startsAt) <= nowMs && nowMs < Date.parse(interval.endsAt),
  );
  const hasScheduleData = intervals.length > 0 || schedule?.allClear === true;
  const statusText = !queue
    ? null
    : !hasScheduleData
      ? t('addressWizard.statusUnknown')
      : currentOff
        ? t('addressWizard.offUntil', { time: formatKyivTime(currentOff.endsAt) })
        : t('addressWizard.lightOn');

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
              setResult(null);
              setSavedLabel(null);
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
            onChange={(event) => chooseSettlement(event.target.value)}
            className="h-11 w-full rounded-xl border border-input bg-transparent px-3 text-sm shadow-xs focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
          />
          <SettlementSuggestions region={currentRegion} query={settlement} onPick={chooseSettlement} />
          <CityChips region={currentRegion} current={settlement} onPick={chooseSettlement} />
        </div>
      </StepCard>

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
              setHouse('');
              setResult(null);
              setSavedLabel(null);
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
              {t('addressWizard.wholeSettlementQueue', { queue: streetsQuery.data.wholeSettlementQueue })}
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
              setResult(null);
              setSavedLabel(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void submit();
            }}
            className="h-11 w-full rounded-xl border border-input bg-transparent px-3 text-sm shadow-xs focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
          />
          <HouseChips
            options={housesQuery.data?.data ?? []}
            wholeStreetQueue={housesQuery.data?.wholeStreetQueue ?? null}
            onPick={chooseHouse}
            loading={housesQuery.isFetching}
          />
        </div>
      </StepCard>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => void submit()} disabled={!settlement.trim() || resolve.isPending} className="gap-2">
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

      {result && !queue && (
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-sm font-semibold text-foreground">{t('addressWizard.notFoundTitle')}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t('addressWizard.notFoundDesc')}</p>
          {result.options.length > 0 && (
            <div className="mt-3 space-y-1.5">
              <p className="text-xs font-semibold text-foreground">{t('addressWizard.variants')}</p>
              <div className="flex flex-wrap gap-1.5">
                {result.options.map((option) => (
                  <span key={option.housePattern} className="rounded-lg bg-muted px-2 py-1 text-xs font-semibold text-foreground">
                    {option.housePattern} → {option.queue}
                  </span>
                ))}
              </div>
            </div>
          )}

          <ContributeBlock
            region={currentRegion}
            settlement={settlement.trim()}
            street={street.trim()}
            house={house.trim()}
            onContributed={(contributedQueue) => {
              addBookmark({
                label: [settlement, street, house].filter(Boolean).join(', '),
                regionCpu: currentRegion,
                settlementName: settlement.trim(),
                streetName: [street, house].filter(Boolean).join(' ').trim() || undefined,
                queue: contributedQueue,
                allowDuplicate: true,
              });
              void submit();
            }}
          />
        </div>
      )}

      {queue && (
        <section className="overflow-hidden rounded-3xl border border-success/30 bg-card shadow-xs">
          <div className="flex items-start gap-3 border-b border-success/20 bg-success/8 p-4">
            <span className="inline-flex min-h-12 min-w-16 items-center justify-center rounded-2xl bg-success px-3 font-display text-xl font-bold text-success-foreground">
              {queue}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-success">{t('addressWizard.yourQueue')}</p>
              <p className="truncate text-sm font-semibold text-foreground">
                {[settlement, street, house].filter(Boolean).join(', ')}
              </p>
              <p className={cn('mt-1 inline-flex items-center gap-1 text-xs font-semibold', currentOff ? 'text-destructive' : hasScheduleData ? 'text-success' : 'text-muted-foreground')}>
                {currentOff ? <ZapOff className="h-3.5 w-3.5" aria-hidden /> : <Zap className="h-3.5 w-3.5" aria-hidden />}
                {statusText}
              </p>
            </div>
          </div>

          <div className="space-y-3 p-4">
            {schedule && intervals.length > 0 ? (
              <QueueScheduleBar intervals={intervals} date={schedule.date} showSummary={false} />
            ) : schedule?.allClear ? (
              <p className="text-xs font-medium text-success">{t('schedule.allClearTitle')}</p>
            ) : (
              <p className="text-xs text-muted-foreground">{t('addressWizard.noScheduleToday')}</p>
            )}

            <Button onClick={() => saveAs('Дім', true)} className="w-full gap-2">
              <Star className={cn('h-4 w-4', savedLabel === 'Дім' && 'fill-current')} aria-hidden />
              {t('addressWizard.makePrimary')}
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={() => saveAs('Дім')} className="gap-2">
                <Home className="h-4 w-4" aria-hidden />
                {t('addressWizard.saveHome')}
              </Button>
              <Button variant="outline" onClick={() => saveAs('Робота')} className="gap-2">
                <Briefcase className="h-4 w-4" aria-hidden />
                {t('addressWizard.saveWork')}
              </Button>
            </div>
            {savedLabel && (
              <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-success">
                <Check className="h-4 w-4" aria-hidden />
                {t('addressWizard.savedAs', { label: savedLabel })}
              </p>
            )}
            {source && <p className="text-[11px] text-muted-foreground/80">{t('addressWizard.source', { source })}</p>}
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
  const offline = useMemo(() => searchOfflineSettlements(region, query, 6), [region, query]);
  const stats = useMemo(() => offlineSettlementStats(region), [region]);

  const names = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const item of [...offline.map((entry) => entry.name), ...(server.data?.data ?? []).map((entry) => entry.name)]) {
      const key = item.toLocaleLowerCase('uk-UA');
      if (key === query.trim().toLocaleLowerCase('uk-UA') || seen.has(key)) continue;
      seen.add(key);
      result.push(item);
      if (result.length >= 6) break;
    }
    return result;
  }, [offline, query, server.data]);

  if (query.trim().length < 2 || names.length === 0) return null;

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1.5">
        {names.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => onPick(name)}
            className="min-h-9 rounded-full border border-border bg-muted px-3 text-xs font-semibold text-foreground transition-colors hover:bg-accent"
          >
            {highlight(name, query)}
          </button>
        ))}
      </div>
      {stats && stats.total > stats.shown && (
        <p className="text-[11px] text-muted-foreground">
          {t('offline.suggestionsPartial', { shown: stats.shown, total: stats.total })}
        </p>
      )}
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
    const curated = MAIN_CITIES[region] ?? [];
    if (curated.length > 0) return curated;
    return topOfflineSettlements(region, 5).map((item) => item.name);
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

/** Дома выбранной улицы: «12 → 2/2». Если домов нет — чипов нет, и это честно. */
const HouseChips: React.FC<{
  options: AddressHouseOption[];
  wholeStreetQueue: string | null;
  onPick: (house: string) => void;
  loading: boolean;
}> = ({ options, wholeStreetQueue, onPick, loading }) => {
  const { t } = useTranslation();
  if (loading && options.length === 0) {
    return <p className="text-[11px] text-muted-foreground">{t('addressWizard.loadingHouses')}</p>;
  }
  if (options.length === 0) {
    return wholeStreetQueue ? (
      <p className="text-[11px] font-semibold text-success">
        {t('addressWizard.wholeStreetQueue', { queue: wholeStreetQueue })}
      </p>
    ) : null;
  }

  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-semibold text-muted-foreground">{t('addressWizard.quickHouses')}</p>
      <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
        {options.slice(0, 40).map((option) => (
          <button
            key={`${option.housePattern}-${option.queue}`}
            type="button"
            onClick={() => onPick(option.housePattern)}
            className="min-h-9 rounded-full border border-border bg-card px-3 text-xs font-semibold text-foreground transition-colors hover:bg-accent"
          >
            {option.housePattern}
            <span className="ml-1 text-[10px] font-bold text-primary">{option.queue}</span>
          </button>
        ))}
      </div>
      {wholeStreetQueue && (
        <p className="text-[11px] text-muted-foreground">
          {t('addressWizard.wholeStreetQueue', { queue: wholeStreetQueue })}
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


/** Групи, які воркер/бекенд приймають до запису. Рівно ті, що трапляються в графіку ДТЕК. */
const CONTRIBUTE_QUEUES = ['1/1', '1/2', '2/1', '2/2', '3/1', '3/2', '4/1', '4/2', '5/1', '5/2', '6/1', '6/2'];

/**
 * Народна прив'язка: якщо своєї черги в базі немає, людина може назвати її сама.
 *
 * Прив'язки «адреса → черга» неможливо вивести з графіка оператора: у ньому є групи, але немає
 * того, яка вулиця до якої належить. Номер групи написаний у квитанції та застосунку оператора,
 * тому найчесніше джерело цих даних — сама людина. Ім'я й телефон не питаємо: для прив'язки
 * вони не потрібні.
 *
 * Якщо мережі немає, кнопка «Зберегти лише на пристрої» кладе адресу в закладки локально:
 * пошук продовжить працювати для цієї людини, навіть коли сервер недоступний.
 */
const ContributeBlock: React.FC<{
  region: string;
  settlement: string;
  street: string;
  house: string;
  onContributed: (queue: string) => void;
}> = ({ region, settlement, street, house, onContributed }) => {
  const { t } = useTranslation();
  const [queue, setQueue] = useState('');
  const [localSaved, setLocalSaved] = useState(false);
  const contribute = useContributeAddress();

  return (
    <div className="mt-4 space-y-2 rounded-xl border border-border bg-muted/30 p-3">
      <p className="text-xs text-muted-foreground">{t('addressWizard.contributeHint')}</p>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="address-contribute-queue" className="sr-only">
          {t('addressWizard.contributeQueueLabel')}
        </label>
        <select
          id="address-contribute-queue"
          value={queue}
          onChange={(event) => setQueue(event.target.value)}
          className="h-10 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
        >
          <option value="">{t('addressWizard.contributeQueuePlaceholder')}</option>
          {CONTRIBUTE_QUEUES.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          disabled={!queue || contribute.isPending}
          onClick={() => {
            void contribute
              .mutateAsync({ region, settlement, street: street || undefined, house: house || undefined, queue })
              .then((saved) => {
                if (saved) onContributed(saved);
              });
          }}
        >
          {contribute.isPending ? t('addressWizard.contributing') : t('addressWizard.contributeSubmit')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!queue}
          onClick={() => {
            onContributed(queue);
            setLocalSaved(true);
          }}
        >
          {t('addressWizard.contributeLocal')}
        </Button>
      </div>
      {contribute.isError && (
        <p role="alert" className="text-xs text-destructive">
          {t('addressWizard.contributeFailed')}
        </p>
      )}
      {(contribute.isSuccess || localSaved) && (
        <p className="text-xs font-semibold text-success">
          {localSaved ? t('addressWizard.contributeLocalDone') : t('addressWizard.contributeDone')}
        </p>
      )}
    </div>
  );
};
