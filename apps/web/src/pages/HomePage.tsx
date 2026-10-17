import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
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
import { OutageCard } from '../components/outages/OutageCard.js';
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
 * Карточка ближайшего отключения одной группы: код черги, интервалы «10:00–11:00», статус
 * (идёт сейчас / запланировано) и — если источник её отдал — привязанные к группе населённые
 * пункты и улицы. Пустые списки НЕ заполняем вымышленными районами: зеркало ГПВ номера групп
 * с районами не связывает, и догадка здесь опаснее пустоты (AGENTS.md).
 */
const GroupOutageCard: React.FC<{ item: GroupOutageSummary }> = ({ item }) => {
  const { t } = useTranslation();
  return (
    <article className="rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-xs font-bold',
              item.isActiveNow ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary',
            )}
          >
            {item.isActiveNow ? <ZapOff className="h-3.5 w-3.5" aria-hidden /> : <Zap className="h-3.5 w-3.5" aria-hidden />}
            {t('home.queueGroup', { queue: item.queue })}
          </span>
          <span className="text-xs font-semibold text-muted-foreground">
            {item.isActiveNow ? t('home.groupOutageActive') : t('home.groupOutagePlanned')}
          </span>
        </div>
        <span className="text-xs font-semibold text-muted-foreground">{item.date}</span>
      </div>

      <ul className="mt-3 flex flex-wrap gap-2">
        {item.intervals.map((interval, index) => (
          <li
            key={`${interval.startsAt}-${index}`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-muted/60 px-2.5 py-1 text-xs font-semibold tabular text-foreground"
          >
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: interval.stateColor }} aria-hidden />
            {interval.localTimeFrom}–{interval.localTimeTo}
          </li>
        ))}
      </ul>

{/* Розкриття списку вулиць групи. Показуємо тільки реальні назви зі street_queues/settlements:
          якщо джерело географію не віддало — блоку немає, а не «ймовірно, сусідні райони». */}
      {item.streetNames.length > 0 && (
        <details className="group/places mt-3 border-t border-border/60 pt-3">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground">
            <ChevronDown className="h-3.5 w-3.5 transition-transform group-open/places:rotate-180" aria-hidden />
            {t('home.groupStreetsToggle', { n: item.streetNames.length })}
          </summary>
          <ul className="mt-2 grid gap-1 sm:grid-cols-2">
            {item.streetNames.map((name) => (
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

      {item.settlements.length > 0 && (
        <div className="mt-3 border-t border-border/60 pt-3">
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {item.settlements.map((name) => (
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


/**
 * Точкові ремонтні відключення, згруповані за місцем (вулиці з `outage_event_addresses`,
 * назва НП як запасний варіант). Без групування всі записи одного.operator мають одну й ту саму
 * `areaName`, і блок виглядає як одне відключення, повторене N разів.
 */
const PointOutagesByPlace: React.FC<{ outages: Outage[] }> = ({ outages }) => {
  const { t } = useTranslation();
  const groups = new Map<string, { label: string; items: Outage[] }>();
  for (const outage of outages) {
    const streets = outage.streets ?? [];
    // Ключ групи — перша вулиця: вулиці конкретні, тож це точніше, ніж одне НП на всю область.
    const key = streets[0] ?? (outage.areaName || t('home.unknownPlace'));
    const existing = groups.get(key);
    if (existing) existing.items.push(outage);
    else groups.set(key, { label: key, items: [outage] });
  }

  return (
    <div className="space-y-2 pt-1">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {t('home.pointOutages')}
      </p>
      {[...groups.values()].map((group) => {
        // Улицы всего события, а не только первой: у группы они общие по сутям.
        const streets = group.items[0]?.streets ?? [];
        return (
          <details key={group.label} className="group/place rounded-2xl border border-border bg-card p-4 shadow-xs" open={group.items.length === 1}>
            <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-sm font-bold text-foreground">
                <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                {group.label}
              </span>
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground">
                <ChevronDown className="h-3.5 w-3.5 transition-transform group-open/place:rotate-180" aria-hidden />
                {t('home.pointOutagesCount', { n: group.items.length })}
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
              {group.items.map((outage) => (
                <OutageCard key={outage.id} outage={outage} />
              ))}
            </div>
          </details>
        );
      })}
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
  const visibleGroupOutages = allGroupsShown ? groupOutages : groupOutages.slice(0, VISIBLE_GROUPS_LIMIT);
  const { data: incidentsData } = useIncidents();

  const status = statusData?.data;
  const activeIncidents = (incidentsData?.data ?? []).filter((incident) => incident.status === 'active');

  // Карточка отключения на главной показывает нормализованный адрес.
  const outages = (outagesData?.data ?? []).map((item) => ({
    ...item,
    addressesRaw: item.addressesNormalized,
    sourceId: '',
    contentHash: '',
    firstSeenAt: item.startsAt,
    updatedAt: item.startsAt,
  })) as Outage[];

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
            ) : groupOutages.length === 0 ? (
              outages.length === 0 ? (
                <div className="flex items-center justify-center gap-2 rounded-2xl border border-hairline bg-surface-container-high/50 px-6 py-8 text-sm text-on-surface-variant">
                  <ZapOff className="h-4 w-4" aria-hidden />
                  {t('outages.noOutages')}
                </div>
              ) : null
            ) : (
              <>
                {visibleGroupOutages.map((item) => (
                  <GroupOutageCard key={`${item.date}-${item.queue}`} item={item} />
                ))}
                {groupOutages.length > VISIBLE_GROUPS_LIMIT && (
                  <button
                    type="button"
                    onClick={() => setAllGroupsShown((value) => !value)}
                    className="mx-auto block rounded-full border border-border px-4 py-2 text-xs font-semibold text-primary transition-colors hover:bg-muted"
                    aria-expanded={allGroupsShown}
                  >
                    {allGroupsShown
                      ? t('home.hideAllGroups')
                      : t('home.showAllGroups', { n: groupOutages.length - VISIBLE_GROUPS_LIMIT })}
                  </button>
                )}
              </>
            )}

            {/* Точкові ремонтні/аварійні відключення згруповані за вулицями/районами.
                Раніше всі 28 записів мали одну areaName («Деснянське») і виглядали як одне й
                те саме відключення; тепер видно реальні вулиці з outage_event_addresses. */}
            {outages.length > 0 && (
              <PointOutagesByPlace outages={outages} />
            )}
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
