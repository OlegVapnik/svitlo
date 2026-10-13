import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, Globe2, Newspaper, Search, Zap } from 'lucide-react';
import { Card, CardContent } from '../components/ui/Card.js';
import { Badge } from '../components/ui/Badge.js';
import { Input } from '../components/ui/Input.js';
import { Skeleton } from '../components/ui/Skeleton.js';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/Tabs.js';
import { EmptyState } from '../components/common/EmptyState.js';
import { ErrorState } from '../components/common/ErrorState.js';
import { Button } from '../components/ui/Button.js';
import { formatDateTime } from '../lib/date.js';
import { useNews, useNewsSources } from '../api/queries.js';
import { useRegion } from '../hooks/useRegion.js';
import type { NewsItem, NewsKind } from '@svitlo/shared';

type KindFilter = 'all' | NewsKind;

/** Категорії, які має сенс давати як фільтр: решта ('other') видима лише у «Усі». */
const FILTERS: KindFilter[] = ['all', 'outage', 'emergency', 'schedule-change', 'repair', 'ukraine'];

const KIND_LABEL_KEY: Record<NewsKind, string> = {
  outage: 'news.kindOutage',
  'schedule-change': 'news.kindScheduleChange',
  repair: 'news.kindRepair',
  emergency: 'news.kindEmergency',
  ukraine: 'news.kindUkraine',
  other: 'news.kindOther',
};

/** Кольори взяті з токенів теми (не «сирі» Tailwind-палітри): інакше ламається темна тема. */
const KIND_VARIANT: Record<NewsKind, 'destructive' | 'warning' | 'info' | 'success' | 'muted'> = {
  outage: 'warning',
  'schedule-change': 'info',
  repair: 'info',
  emergency: 'destructive',
  ukraine: 'success',
  other: 'muted',
};

const sourceLabel = (sourceKey: string): string => {
  const [, name] = sourceKey.split(':');
  return name ?? sourceKey;
};

/**
 * «Новини»: публічні пости Telegram-каналів (оператор, Укренерго) та RSS місцевих ЗМІ,
 * які фоновий колектор складає в `news_items` (міграція 0014). Сторінка читає лише бекенд
 * (`GET /api/v1/news`) і не містить персональних даних — тільки текст публікації й першоджерело.
 */
export const NewsPage: React.FC = () => {
  const { t } = useTranslation();
  const { currentRegion } = useRegion();
  const [kind, setKind] = useState<KindFilter>('all');
  const [ukraineWide, setUkraineWide] = useState(false);
  const [onlyPower, setOnlyPower] = useState(true);
  const [query, setQuery] = useState('');

  const { data, isLoading, isError, refetch } = useNews({
    region: currentRegion,
    kind: kind === 'all' ? undefined : kind,
    // Сервер ховає загальні новини (kind='other') — інакше найсвіжіші записи стрічки
    // місцевих ЗМІ витискають усе про світло із перших 50 рядків.
    excludeKind: onlyPower ? 'other' : undefined,
    ukraineWide: ukraineWide || undefined,
    limit: 50,
  });
  const { data: sourcesData } = useNewsSources();

  const items = data?.data ?? [];
  const failedSources = (sourcesData?.data ?? []).filter((source) => Boolean(source.lastError));

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('uk-UA');
    // «Лише про світло» (типово увімкнено): сервер віддає вже без kind='other', тут лишається
    // страхувальна сітка — якщо перемикач щойно вимкнули, у кеші ще може бути стара вибірка.
    const relevant = onlyPower ? items.filter((item) => item.kind !== 'other') : items;
    if (!needle) return relevant;
    return relevant.filter((item) =>
      [item.title, item.summary, item.body]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase('uk-UA')
        .includes(needle),
    );
  }, [items, onlyPower, query]);

  return (
    <div className="mx-auto max-w-4xl space-y-4 pb-16 md:pb-6">
      <header className="space-y-0.5">
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-foreground sm:text-2xl">
          <Newspaper className="h-5 w-5 text-muted-foreground" aria-hidden />
          {t('news.title')}
        </h1>
        <p className="text-xs text-muted-foreground sm:text-sm">{t('news.subtitle')}</p>
      </header>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('news.searchPlaceholder')}
            aria-label={t('news.searchPlaceholder')}
            className="pl-9"
          />
        </div>
        <Button
          variant={ukraineWide ? 'default' : 'outline'}
          size="sm"
          aria-pressed={ukraineWide}
          onClick={() => setUkraineWide((value) => !value)}
          className="min-h-[44px]"
        >
          <Globe2 className="h-4 w-4" aria-hidden />
          {t('news.ukraineWide')}
        </Button>
        <Button
          variant={onlyPower ? 'default' : 'outline'}
          size="sm"
          aria-pressed={onlyPower}
          onClick={() => setOnlyPower((value) => !value)}
          className="min-h-[44px]"
        >
          <Zap className="h-4 w-4" aria-hidden />
          {t('news.onlyPower')}
        </Button>
      </div>

      <Tabs value={kind} onValueChange={(value) => setKind(value as KindFilter)}>
        <TabsList aria-label={t('news.title')}>
          {FILTERS.map((value) => (
            <TabsTrigger key={value} value={value}>
              {value === 'all' ? t('news.filterAll') : t(KIND_LABEL_KEY[value])}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>
          {t('news.foundCount')}: <span className="font-semibold text-foreground">{filtered.length}</span>
        </span>
        {sourcesData && (
          <span>
            · {t('news.sources')}: <span className="font-semibold text-foreground">{sourcesData.data.length}</span>
          </span>
        )}
        {data?.meta.stale && <Badge variant="warning">{t('news.staleChip')}</Badge>}
        {failedSources.length > 0 && (
          <Badge variant="destructive">
            {t('news.sourceFailed')}: {failedSources.map((source) => sourceLabel(source.sourceKey)).join(', ')}
          </Badge>
        )}
      </div>

      {data?.meta.stale && (
        <p className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground">
          {t('news.stale')}
        </p>
      )}

      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-24 w-full rounded-2xl" />
          ))}
        </div>
      )}

      {isError && <ErrorState onRetry={() => void refetch()} />}

      {!isLoading && !isError && filtered.length === 0 && (
        <EmptyState icon={Newspaper} title={t('news.noNews')} description={t('news.noNewsDesc')} />
      )}

      <div className="space-y-3">
        {filtered.map((item: NewsItem) => (
          <Card key={item.id}>
            <CardContent className="space-y-2 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={KIND_VARIANT[item.kind]}>{t(KIND_LABEL_KEY[item.kind])}</Badge>
                <span className="text-xs text-muted-foreground">{sourceLabel(item.sourceKey)}</span>
                {item.isUkraineWide && <Badge variant="muted">{t('news.kindUkraine')}</Badge>}
                <span className="ml-auto text-xs text-muted-foreground">
                  {formatDateTime(item.publishedAt ?? item.firstSeenAt)}
                </span>
              </div>
              <h2 className="text-sm font-semibold leading-snug text-foreground sm:text-base">{item.title}</h2>
              {(item.summary || item.body) && (
                <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground sm:text-sm">
                  {item.summary || item.body}
                </p>
              )}
              {item.imageUrls.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {item.imageUrls.map((src, index) => (
                    <a
                      key={src}
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block overflow-hidden rounded-xl border border-border transition-colors hover:border-primary/50"
                    >
                      {/* Графіки відключень Чернігівобленерго приходять картинками: показуємо їх,
                          щоб «зміна графіка» не зводилась до тексту без самого графіка. */}
                      <img
                        src={src}
                        alt={`${t('news.imageAlt')} ${index + 1}: ${item.title}`}
                        loading="lazy"
                        className="h-44 w-auto max-w-full object-cover"
                      />
                    </a>
                  ))}
                </div>
              )}
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                {t('news.openSource')}
              </a>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};