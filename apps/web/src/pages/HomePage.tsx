import React, { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Timeline24h } from '../components/schedule/Timeline24h.js';
import { getKyivNowMinutes } from '../lib/timeline.js';
import { kyivDateOffsetKey } from '../lib/outage-dates.js';
import { formatDuration, formatMinutes, mergeIntervals, toIsoIntervals, type MinuteInterval } from '../lib/intervals.js';

/** Минуты от полуночи по Киеву для указанной даты — чтобы понять, какое окно «сейчас». */
const kyivNowMinutesFor = (date: string): number | null => getKyivNowMinutes(date, new Date());
import { ArrowRight, CalendarDays, ChevronDown, MapPin, RefreshCw, TriangleAlert, Zap, ZapOff, type LucideIcon } from 'lucide-react';
import { StatusIndicator } from '../components/status/StatusIndicator.js';
import { SourceHealthBanner } from '../components/status/SourceHealthBanner.js';
import { LastUpdated } from '../components/status/LastUpdated.js';
import { PowerSummaryCard } from '../components/status/PowerSummaryCard.js';
import { ReliabilityCard } from '../components/status/ReliabilityCard.js';
import { ChangelogCard } from '../components/changelog/ChangelogCard.js';
import { HomeHeroSection } from '../components/status/HomeHeroSection.js';
import { ConnectionProblem } from '../components/region/ConnectionProblem.js';
import { OfflineBanner, BuildStamp } from '../components/offline/OfflineBanner.js';
import { IncidentBanner } from '../components/incidents/IncidentBanner.js';
import { Skeleton } from '../components/ui/Skeleton.js';
import { Button } from '../components/ui/Button.js';
import { cn } from '../lib/cn.js';
import { useIncidents, useOutages, useStatus, useUpcomingGroupOutages } from '../api/queries.js';
import { useRegion } from '../hooks/useRegion.js';
import type { GroupOutageSummary, Outage } from '@svitlo/shared';

/** Скільки групп показываем до кнопки «показати ще N» — решта за кнопкою. */
const VISIBLE_GROUPS_LIMIT = 6;

/** Тон числа в компактній плитці: колір — лише підсвітка, підпис завжди є. */
const MINI_TONE = {
  danger: 'text-destructive',
  info: 'text-info',
  warning: 'text-warning',
} as const;

/**
 * Компактна плитка-метрика для правої колонки: іконка, число, підпис. Замінює велику картку
 * `StatCard` там, де три плитки стоять в один ряд у вузькій колонці — інакше підписи зрізалися б.
 */
const MiniStat: React.FC<{
  to: string;
  icon: LucideIcon;
  tone: keyof typeof MINI_TONE;
  label: string;
  value: number;
  isLoading?: boolean;
}> = ({ to, icon: Icon, tone, label, value, isLoading }) => (
  <Link
    to={to}
    className="flex flex-col items-center gap-1 rounded-xl border border-hairline bg-surface-container-high px-1.5 py-2 text-center transition-colors hover:bg-surface-container-highest"
  >
    <Icon className={cn('h-3.5 w-3.5', MINI_TONE[tone])} aria-hidden />
    {isLoading ? (
      <span className="my-0.5 inline-block h-4 w-7 animate-pulse rounded bg-muted" aria-hidden />
    ) : (
      <span className="tabular text-lg font-bold leading-none text-foreground">{value}</span>
    )}
    <span className="text-[10px] leading-tight text-muted-foreground">{label}</span>
  </Link>
);

/**
 * Одна строка «Найближчих відключень».
 *
 * Раньше это была двухэтажная карточка на всю ширину: дата в каждом заголовке, огромная
 * пустота справа и все слоты суток, включая давно прошедшие. Блок называется «найближчі»,
 * поэтому здесь остаётся только то, что ещё впереди: актуальный слот и следующий за ним.
 * Прошедшие не выбрасываем бесследно — они свёрнуты в «Минулі слоти», если человеку нужно
 * свериться.
 *
 * Группы с ОДИНАКОВЫМ набором слотов склеиваются в одну строку: у «1/1» и «1/2» часто одно и
 * то же окно 13:00–16:30, и две одинаковые карточки подряд — шум, а не информация.
 */
interface UpcomingGroup {
  date: string;
  queues: string[];
  intervals: GroupOutageSummary['intervals'];
  isActiveNow: boolean;
  settlements: string[];
  streetNames: string[];
}

const compareQueue = (a: string, b: string): number => {
  const parse = (value: string): [number, number] => {
    const [major, minor] = value.split('/');
    return [Number(major) || 0, Number(minor ?? 0) || 0];
  };
  const [aMajor, aMinor] = parse(a);
  const [bMajor, bMinor] = parse(b);
  return aMajor - bMajor || aMinor - bMinor;
};

const mergeUpcomingGroups = (items: GroupOutageSummary[]): UpcomingGroup[] => {
  const merged = new Map<string, UpcomingGroup>();
  for (const item of items) {
    const signature = item.intervals
      .map((interval) => `${interval.startsAt}-${interval.endsAt}`)
      .sort()
      .join(',');
    const key = `${item.date}|${signature}`;
    const existing = merged.get(key);
    if (existing) {
      if (!existing.queues.includes(item.queue)) existing.queues.push(item.queue);
      existing.isActiveNow = existing.isActiveNow || item.isActiveNow;
      for (const name of item.streetNames) {
        if (!existing.streetNames.includes(name)) existing.streetNames.push(name);
      }
      for (const name of item.settlements) {
        if (!existing.settlements.includes(name)) existing.settlements.push(name);
      }
      continue;
    }
    merged.set(key, {
      date: item.date,
      queues: [item.queue],
      intervals: item.intervals,
      isActiveNow: item.isActiveNow,
      streetNames: [...item.streetNames],
      settlements: [...item.settlements],
    });
  }
  return [...merged.values()].map((group) => ({
    ...group,
    queues: [...group.queues].sort(compareQueue),
  }));
};

/** «Сьогодні, 19 жовтня» — дата один раз на всю секцию, а не в каждой карточке. */
const formatUpcomingDay = (date: string, now: Date): string => {
  const day = new Intl.DateTimeFormat('uk-UA', {
    timeZone: 'Europe/Kyiv',
    day: 'numeric',
    month: 'long',
  }).format(new Date(`${date}T12:00:00+03:00`));
  const todayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(now);
  const tomorrowKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(
    new Date(now.getTime() + 24 * 60 * 60 * 1000),
  );
  if (date === todayKey) return `Сьогодні, ${day}`;
  if (date === tomorrowKey) return `Завтра, ${day}`;
  return day;
};

const GroupOutageCard: React.FC<{ group: UpcomingGroup }> = ({ group }) => {
  const { t } = useTranslation();
  const nowMs = Date.now();
  const future = group.intervals.filter((interval) => Date.parse(interval.endsAt) > nowMs);
  const past = group.intervals.filter((interval) => Date.parse(interval.endsAt) <= nowMs);

  return (
    <article className="rounded-2xl border border-border bg-card px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            'inline-flex min-h-8 flex-wrap items-center gap-1.5 rounded-full px-2.5 text-xs font-bold',
            group.isActiveNow ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary',
          )}
        >
          {group.isActiveNow ? (
            <ZapOff className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <Zap className="h-3.5 w-3.5" aria-hidden />
          )}
          {group.queues.map((queue) => (
            <span key={queue} className="whitespace-nowrap">
              {t('home.queueGroup', { queue })}
            </span>
          ))}
        </span>
        <span className="shrink-0 text-[11px] font-semibold text-muted-foreground">
          {group.isActiveNow ? t('home.groupOutageActive') : t('home.groupOutagePlanned')}
        </span>
      </div>

      {/* Только актуальное и следующее: прошедшее окно в «найближчих» — шум. */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {future.length === 0 ? (
          <span className="text-xs text-muted-foreground">{t('home.groupNothingAhead')}</span>
        ) : (
          future.slice(0, 2).map((interval, index) => (
            <span
              key={`${interval.startsAt}-${index}`}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold tabular',
                index === 0 ? 'bg-primary/10 text-foreground' : 'bg-muted/60 text-foreground',
              )}
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: interval.stateColor }}
                aria-hidden
              />
              {interval.localTimeFrom}–{interval.localTimeTo}
            </span>
          ))
        )}
      </div>

      {past.length > 0 && (
        <details className="group/past mt-1.5">
          <summary className="flex cursor-pointer list-none items-center gap-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground">
            <ChevronDown className="h-3 w-3 transition-transform group-open/past:rotate-180" aria-hidden />
            {t('home.groupPastSlots', { n: past.length })}
          </summary>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {past.map((interval, index) => (
              <span
                key={`${interval.startsAt}-${index}`}
                className="rounded-lg bg-muted/30 px-2 py-0.5 text-[11px] font-semibold tabular text-muted-foreground line-through opacity-70"
              >
                {interval.localTimeFrom}–{interval.localTimeTo}
              </span>
            ))}
          </div>
        </details>
      )}

      {group.streetNames.length > 0 && (
        <details className="group/places mt-1.5 border-t border-border/60 pt-1.5">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground">
            <ChevronDown className="h-3 w-3 transition-transform group-open/places:rotate-180" aria-hidden />
            {t('home.groupStreetsToggle', { n: group.streetNames.length })}
          </summary>
          <ul className="mt-1.5 grid gap-1 sm:grid-cols-2">
            {group.streetNames.map((name) => (
              <li key={name} className="flex items-center gap-1.5 text-xs text-foreground">
                <MapPin className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
                {name}
              </li>
            ))}
          </ul>
          <Link to="/streets" className="mt-2 inline-block text-xs font-semibold text-primary hover:underline">
            {t('queues.allStreetsLink')}
          </Link>
        </details>
      )}

      {group.settlements.length > 0 && (
        <div className="mt-1.5 border-t border-border/60 pt-1.5">
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {group.settlements.map((name) => (
              <span key={name} className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-foreground">
                {name}
              </span>
            ))}
          </p>
        </div>
      )}
    </article>
  );
};


/** Сколько мест показываем до кнопки «показать все». */
const PLACES_PREVIEW = 5;

interface ReasonBucket {
  key: string;
  reason: string;
  items: Outage[];
  /** Склеенные непрерывные окна в минутах от полуночи по Киеву. */
  windows: MinuteInterval[];
  /** Дата, к которой относятся окна — для 24-часовой шкалы. */
  date: string;
}

/**
 * Внутри одного места записи одного оператора отличаются только получасовым слотом ГПВ.
 * Раньше каждая запись рисовалась отдельной карточкой, и блок из 277 записей превращался в
 * кладбище одинаковых плиток. Теперь записи склеиваются по причине, а внутри — по времени:
 * смежные получасовки объединяются в непрерывное окно (`mergeIntervals`), потому что
 * человеку нужно «6 год без світла», а не 12 кнопок `18:00–18:30`, `18:30–19:00`, …
 */
function groupReasonBuckets(items: Outage[]): ReasonBucket[] {
  const buckets = new Map<string, ReasonBucket>();
  for (const item of items) {
    const reason = item.reason?.trim() || '';
    const key = `${item.kind ?? ''}|${reason}`;
    const existing = buckets.get(key);
    if (existing) existing.items.push(item);
    else buckets.set(key, { key, reason, items: [item], windows: [], date: '' });
  }

  for (const bucket of buckets.values()) {
    bucket.date = kyivDateOffsetKey(0);
    bucket.windows = mergeIntervals(bucket.items);
  }

  // Больше всего повторов — первым, чтобы развернутая группа была осмысленной.
  return [...buckets.values()].sort((a, b) => b.windows.length - a.windows.length);
}

/**
 * Компактная замена 277 полноразмерных карточек: 24-часовая шкала плюс один-два акцентных
 * окна с длительностью и статусом. Счётчик в шапке группы уже назван числом записей, поэтому
 * здесь показываем число окон, а не сырых строк из базы.
 */
const PointOutageBucket: React.FC<{ bucket: ReasonBucket }> = ({ bucket }) => {
  const { t } = useTranslation();
  const [nowMin] = useState(() => kyivNowMinutesFor(bucket.date));
  const offStateName = t('home.heroOff');

  const intervals = useMemo(
    () => toIsoIntervals(bucket.windows, bucket.date).map((interval) => ({ ...interval, stateName: offStateName })),
    [bucket.windows, bucket.date, offStateName],
  );
  const totalOffMinutes = bucket.windows.reduce((sum, w) => sum + (w.endMin - w.startMin), 0);

  return (
    <div className="space-y-2.5 rounded-xl border border-border/60 bg-muted/40 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-sm font-semibold text-foreground">
          {bucket.reason || t('home.unknownPlace')}
        </span>
        <span className="text-xs font-semibold text-muted-foreground tabular">
          {t('home.pointOutagesTotalOff', {
            duration: formatDuration(totalOffMinutes),
          })}
        </span>
      </div>

      {intervals.length > 0 && (
        <Timeline24h intervals={intervals} date={bucket.date} className="space-y-2" />
      )}

      {/* Плашки окон, а не сетка пополам: за день отключение обычно одно, и в сетке на две
          колонки оно одиноко висело бы слева от пустоты. Одна окно — строка во всю ширину,
          несколько — перенос по flex. */}
      <ul className={cn('flex gap-2', bucket.windows.length > 1 && 'flex-wrap')}>
        {bucket.windows.map((window) => {
          const active = nowMin !== null && nowMin >= window.startMin && nowMin < window.endMin;
          const past = nowMin !== null && nowMin >= window.endMin;
          return (
            <li
              key={`${window.startMin}-${window.endMin}`}
              className={cn(
                'flex flex-wrap items-baseline gap-x-2 rounded-lg border px-3 py-2',
                active ? 'border-destructive/40 bg-destructive/10' : 'border-border bg-background',
                // Единственное окно занимает всю строку — так суммарное время читается
                // как заголовок, а не как одна из двух одинаковых плиток.
                bucket.windows.length === 1 && 'w-full',
              )}
            >
              <span className="text-sm font-bold text-foreground tabular">
                {formatMinutes(window.startMin)} – {formatMinutes(window.endMin)}
              </span>
              <span className="text-xs font-semibold text-muted-foreground tabular">
                {formatDuration(window.endMin - window.startMin)}
              </span>
              <span className="text-xs text-muted-foreground">
                {active
                  ? t('home.pointOutagesNow')
                  : past
                    ? t('home.pointOutagesFinished')
                    : t('home.pointOutagesUpcoming')}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

/**
 * Точкові ремонтні відключення, згруповані за місцем (вулиці з `outage_event_addresses`,
 * назва НП як запасний варіант). Без групування всі записи одного.operator мають одну й ту саму
 * `areaName`, і блок виглядає як одне відключення, повторене N разів.
 */
const PointOutagesByPlace: React.FC<{ outages: Outage[] }> = ({ outages }) => {
  const { t } = useTranslation();
  const [allPlacesShown, setAllPlacesShown] = useState(false);
  const groups = new Map<string, { label: string; items: Outage[] }>();
  for (const outage of outages) {
    const streets = outage.streets ?? [];
    // Ключ групи — первая улица из `outage_event_addresses`. Для ремонта это настоящий адрес
    // («вул. Шевченка»), а не область: иначе все работы области слипались в одну плашку.
    const key = streets[0] ?? (outage.areaName || t('home.unknownPlace'));
    const existing = groups.get(key);
    if (existing) existing.items.push(outage);
    else groups.set(key, { label: key, items: [outage] });
  }

  const places = [...groups.values()].sort((a, b) => b.items.length - a.items.length);
  // Первыми открываем места с самыми близкими работами, а не самые многочисленные:
  // человеку важнее то, что происходит сейчас на его улице.
  const bySoonest = [...places].sort((a, b) => {
    const firstA = Math.min(...a.items.map((item) => Date.parse(item.startsAt) || Infinity));
    const firstB = Math.min(...b.items.map((item) => Date.parse(item.startsAt) || Infinity));
    return firstA - firstB;
  });
  const visible = allPlacesShown ? bySoonest : bySoonest.slice(0, PLACES_PREVIEW);

  return (
    <div className="space-y-2 pt-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {t('home.pointOutages')}
      </p>
      <p className="text-xs text-muted-foreground">
        {t('home.pointOutagesSummary', { n: outages.length, places: places.length })}
      </p>

      {visible.map((group) => {
        // Улицы всего события, а не только первой: у группы они общие по сутям.
        const streets = group.items[0]?.streets ?? [];
        const buckets = groupReasonBuckets(group.items);
        // Счётчик в шапке — это число непрерывных окон, а не число строк в базе.
        // Раньше здесь стояли 277 сырых записей, и человек думал, что у него 277 отключений.
        const windowsCount = buckets.reduce((sum, bucket) => sum + bucket.windows.length, 0);
        return (
          <details
            key={group.label}
            className="group/place rounded-2xl border border-border bg-card p-4 shadow-xs"
            // Свёрнуто по умолчанию: ремонтов бывает много, и раскрытая простыня
            // снова превращается в «кладбище» — человек сам откроет своё место.
          >
            <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-sm font-bold text-foreground">
                <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                {group.label}
              </span>
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground">
                <ChevronDown className="h-3.5 w-3.5 transition-transform group-open/place:rotate-180" aria-hidden />
                {t('home.pointOutagesCount', { n: windowsCount })}
              </span>
            </summary>

            {streets.length > 1 && (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {streets.map((street) => (
                  <li key={street} className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-foreground">
                    {street}
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-2.5 space-y-2">
              {buckets.map((bucket) => (
                <PointOutageBucket key={bucket.key} bucket={bucket} />
              ))}
            </div>
          </details>
        );
      })}

      {places.length > PLACES_PREVIEW && (
        <button
          type="button"
          onClick={() => setAllPlacesShown((value) => !value)}
          aria-expanded={allPlacesShown}
          className="mx-auto block rounded-full border border-border px-4 py-2 text-xs font-semibold text-primary transition-colors hover:bg-muted"
        >
          {allPlacesShown
            ? t('home.hideAllPlaces')
            : t('home.showAllPlaces', { n: places.length - PLACES_PREVIEW })}
        </button>
      )}
    </div>
  );
};

/**
 * Главная отвечает на вопрос «что с электричеством сейчас». На десктопе — две колонки:
 * слева график (закладки → Hero → выбор очереди и 24-часовая шкала), справа цифры
 * (статистика → состояние сети). На телефоне тот же порядок идёт одной лентой, а «Що нового»
 * лежит внизу свёрнутым аккордеоном, чтобы не отбирать первый экран у графика.
 */
export const HomePage: React.FC = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const { currentRegionData } = useRegion();

  const { data: statusData, isLoading: statusLoading } = useStatus(currentRegionData.cpu);
  const { data: outagesData, isLoading: outagesLoading } = useOutages({ limit: 5, region: currentRegionData.cpu });
  // Планові відключення по групах — з schedule_slots оператора (не з outage_events, де лише
  // точкові ремонтні записи одного села). Без них блок «Найближчі відключення» не відповідав би
  // на запитання «які саме групи гасять сьогодні».
  const { data: groupOutagesData, isLoading: groupOutagesLoading } = useUpcomingGroupOutages(currentRegionData.cpu, 2);
  const groupOutages = groupOutagesData?.data ?? [];
  // Показываем 6 групп, решта — за кнопкою «показати ще N груп» (усі 12 не вміщуються на
  // першому екрані, але ховати їх назавжди теж неправильно: людина шукає СВЕЮ чергу).
  const [allGroupsShown, setAllGroupsShown] = useState(false);
  // Склеиваем очередь с одинаковым расписанием и выбрасываем группы, у которых все окна уже
  // прошли: блок «Найближчі» не должен показывать утренние слоты вечером.
  const upcomingGroups = useMemo(() => {
    const nowMs = Date.now();
    return mergeUpcomingGroups(
      groupOutages.filter((item) =>
        item.intervals.some((interval) => Date.parse(interval.endsAt) > nowMs),
      ),
    );
  }, [groupOutages]);

  const visibleGroupOutages = allGroupsShown
    ? upcomingGroups
    : upcomingGroups.slice(0, VISIBLE_GROUPS_LIMIT);

  // Дата один раз на секцию: карточки уже не повторяют «2026-10-19» каждая.
  const upcomingByDate = useMemo(() => {
    const byDate = new Map<string, UpcomingGroup[]>();
    for (const group of visibleGroupOutages) {
      const list = byDate.get(group.date) ?? [];
      list.push(group);
      byDate.set(group.date, list);
    }
    return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [visibleGroupOutages]);
  const { data: incidentsData } = useIncidents();

  const status = statusData?.data;
  const activeIncidents = (incidentsData?.data ?? []).filter((incident) => incident.status === 'active');

  // Карточка отключения на главной показывает нормализованный адрес.
  const allOutages = (outagesData?.data ?? []).map((item) => ({
    ...item,
    addressesRaw: item.addressesNormalized,
    sourceId: '',
    contentHash: '',
    firstSeenAt: item.startsAt,
    updatedAt: item.startsAt,
  })) as Outage[];

  /**
   * Блок «Найближчі відключення» уже показывает плановые ГПВ по очередям, и всё, что
   * приходит из `schedule_slots`, — это те же самые слоты. Поэтому в «точечные
   * відключення» пропускаем только настоящие ремонты и аварии (`kind: 'repair'`).
   *
   * Без этой фильтрации блок печатал 277 сырых слотов ГПВ под заголовком про ремонты:
   * данные подменялись сами собой и выглядели как реальные аварии, которых нет.
   */
  const outages = allOutages.filter((item) => item.kind === 'repair');

  /**
   * Ручное обновление без перезагрузки страницы: инвалидирует всё, что видно на экране
   * (отключения, статус, инциденты, график) и дожидается повторных запросов.
   * Данные берутся из базы, куда планировщик пишет снимки оператора.
   */
  const refresh = async () => {
    setRefreshing(true);
    try {
      await queryClient.invalidateQueries();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5 pb-8">
      {activeIncidents.length > 0 && <IncidentBanner incident={activeIncidents[0]!} />}

      {/* Оновлений головний блок: першокласний селектор області, вибір черги для області,
          24-годинний горизонтальний таймлайн із півгодинними комірками та поточним станом */}
      {/* Показывается только при отказе загрузки каталога областей: без него приложение молча
          откатывается на область по умолчанию и выглядит как «нечего выбирать». */}
      {/* Показує, що дані з локального кешу: мовчати про устарілий графік не можна. */}
      <OfflineBanner />

      <ConnectionProblem />

      {/* Десктоп: дві колонки Bento — графік ліворуч, цифри праворуч. Мобільний:
          Hero → статистика → стан мережі → «Що нового». DOM-порядок один, колонки задає сітка,
          тому на телефоні нічого не доводиться переставляти умовним рендером. */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-start">
        <div className="min-w-0">
          <HomeHeroSection />
        </div>

        <div className="min-w-0 space-y-3">
          <ReliabilityCard />

          {/* Компактний стан енергосистеми: три числа й статус мережі без великої картки. */}
          <section className="space-y-3 rounded-2xl border border-hairline bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-foreground">{t('home.title')}</h2>
                <p className="mt-0.5 truncate text-[11px] text-on-surface-variant">
                  {currentRegionData.nameUa || t('home.subtitle')}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {status?.lastUpdatedAt && <LastUpdated timestamp={status.lastUpdatedAt} />}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={refresh}
                  disabled={refreshing}
                  aria-label={t('common.refresh')}
                  className="gap-1.5"
                >
                  <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} aria-hidden />
                  {refreshing ? t('common.refreshing') : t('common.refresh')}
                </Button>
              </div>
            </div>

            {/* ОПЦИОНАЛЬНАЯ ЦЕПОЧКА ДО КОНЦА: `status?.grid.level` защищает только `status`,
                и если в ответе нет объекта grid, обращение к `.level` роняет React в белый
                экран. Ровно это и случилось при подключении к облаку, где маршрут отдавал
                другой набор полей. */}
            <StatusIndicator level={status?.grid?.level ?? 'stable'} message={status?.grid?.message} />

            {/* Три числа — группами за графіком ГПВ, а не точковими ремонтними записами:
                саме групове відключення люди називають «відключенням». */}
            <div className="grid grid-cols-3 gap-2">
              <MiniStat
                to="/queues"
                icon={ZapOff}
                tone="danger"
                label={t('home.statActive')}
                value={status?.activeGroups ?? status?.activeOutages ?? 0}
                isLoading={statusLoading}
              />
              <MiniStat
                to="/queues"
                icon={CalendarDays}
                tone="info"
                label={t('home.statScheduled')}
                value={status?.scheduledGroups ?? status?.scheduledOutages ?? 0}
                isLoading={statusLoading}
              />
              <MiniStat
                to="/incidents"
                icon={TriangleAlert}
                tone="warning"
                label={t('home.statIncidents')}
                value={status?.totalIncidents ?? 0}
                isLoading={statusLoading}
              />
            </div>
          </section>

          <PowerSummaryCard summary={status?.powerSummary} isLoading={statusLoading} />
        </div>
      </div>

      <SourceHealthBanner />

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-foreground">{t('home.upcoming')}</h2>
          <Link to="/outages" className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
            {t('home.allOutages')}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>

        {outagesLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} className="h-24 w-full rounded-2xl" />
            ))}
          </div>
        ) : (
          <div className="space-y-2.5">
            {/* Групи без відключень на найближчі дні — не показуємо: блок про відключення, а не про график. */}
            {groupOutagesLoading ? (
              <Skeleton className="h-28 w-full rounded-2xl" />
            ) : upcomingGroups.length === 0 ? (
              outages.length === 0 ? (
                <div className="flex items-center justify-center gap-2 rounded-2xl border border-hairline bg-surface-container-high/50 px-6 py-8 text-sm text-on-surface-variant">
                  <ZapOff className="h-4 w-4" aria-hidden />
                  {t('outages.noOutages')}
                </div>
              ) : null
            ) : (
              <>
                {upcomingByDate.map(([date, groups]) => (
                  <div key={date} className="space-y-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {formatUpcomingDay(date, new Date())}
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {groups.map((group) => (
                        <GroupOutageCard
                          key={`${group.date}-${group.queues.join(',')}-${group.intervals[0]?.startsAt ?? ''}`}
                          group={group}
                        />
                      ))}
                    </div>
                  </div>
                ))}
                {upcomingGroups.length > VISIBLE_GROUPS_LIMIT && (
                  <button
                    type="button"
                    onClick={() => setAllGroupsShown((value) => !value)}
                    className="mx-auto block rounded-full border border-border px-4 py-2 text-xs font-semibold text-primary transition-colors hover:bg-muted"
                    aria-expanded={allGroupsShown}
                  >
                    {allGroupsShown
                      ? t('home.hideAllGroups')
                      : t('home.showAllGroups', { n: upcomingGroups.length - VISIBLE_GROUPS_LIMIT })}
                  </button>
                )}
              </>
            )}

            {/* Точкові ремонтні/аварійні відключення згруповані за вулицями/районами.
                Раніше всі 28 записів мали одну areaName («Деснянське») і виглядали як одне й
                те саме відключення; тепер видно реальні вулиці з outage_event_addresses. */}
            {outages.length > 0 && <PointOutagesByPlace outages={outages} />}
          </div>
        )}
      </section>

      {/* «Що нового» — в самому низу й згорнуте: список змін не має змагатися з графіком
          за перший екран, але мусить бути там, де його шукають. */}
      <ChangelogCard />

      {/* Версия сборки: видно сразу, без поиска по меню. */}
      <BuildStamp />
    </div>
  );
};
