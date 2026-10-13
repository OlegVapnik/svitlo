/**
 * Сервіс запиту новин та переліку джерел для публічного API.
 *
 * Особливості:
 * - читає ТІЛЬКИ БД, ніколи мережу;
 * - валідація регіону через спільний readRegionParam;
 * - невідома валідна область повертає 200 з data: [];
 * - сортування: published_at DESC NULLS LAST, id DESC;
 * - повертає точні метадані { count, limit, stale }.
 */
import { and, desc, eq, gte, ne, or, sql } from 'drizzle-orm';
import { db } from '../../db/connection.js';
import { newsItems, newsSources } from '../../db/schema.js';
import type { NewsItem, NewsListResponse, NewsQuery, NewsSource, NewsSourcesResponse } from '@svitlo/shared';
import { readRegionParam } from '../regions.service.js';

export async function queryNews(rawQuery: NewsQuery): Promise<NewsListResponse> {
  const limit = Math.min(Math.max(rawQuery.limit ?? 30, 1), 100);

  // Валідація регіону: якщо передано, перевіряємо через readRegionParam (сміття -> 400 AppError)
  let regionCpu: string | undefined;
  if (rawQuery.region !== undefined && rawQuery.region !== '') {
    regionCpu = readRegionParam(rawQuery.region);
  }

  const conditions = [];

  // Фільтр за регіоном та загальноукраїнськими новинами
  if (regionCpu) {
    if (rawQuery.ukraineWide) {
      // Якщо увімкнено ukraineWide: показуємо новини цього регіону АБО загальноукраїнські
      conditions.push(
        or(
          eq(newsItems.regionCpu, regionCpu),
          eq(newsItems.isUkraineWide, true),
        ),
      );
    } else {
      // Тільки новини конкретного регіону
      conditions.push(eq(newsItems.regionCpu, regionCpu));
    }
  } else if (rawQuery.ukraineWide) {
    // Регіон не вказаний, але requested тільки ukraineWide
    conditions.push(eq(newsItems.isUkraineWide, true));
  }

  // Фільтр за категорією kind
  if (rawQuery.kind) {
    conditions.push(eq(newsItems.kind, rawQuery.kind));
  }

  // Виключення категорії (типово `other` — загальні новини місцевих стрічок, не про світло)
  if (rawQuery.excludeKind) {
    conditions.push(ne(newsItems.kind, rawQuery.excludeKind));
  }

  // Фільтр за датою since (YYYY-MM-DD за київським часом: від початку цієї доби)
  if (rawQuery.since) {
    // Дата YYYY-MM-DD 00:00:00 за київським часом у UTC
    conditions.push(
      gte(
        newsItems.publishedAt,
        sql`(${rawQuery.since} || ' 00:00:00 Europe/Kyiv')::timestamptz`,
      ),
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select({
      id: newsItems.id,
      sourceKey: newsItems.sourceKey,
      url: newsItems.url,
      title: newsItems.title,
      summary: newsItems.summary,
      body: newsItems.body,
      publishedAt: newsItems.publishedAt,
      firstSeenAt: newsItems.firstSeenAt,
      regionCpu: newsItems.regionCpu,
      kind: newsItems.kind,
      isUkraineWide: newsItems.isUkraineWide,
      tags: newsItems.tags,
      imageUrls: newsItems.imageUrls,
      contentHash: newsItems.contentHash,
    })
    .from(newsItems)
    .where(whereClause)
    .orderBy(desc(newsItems.publishedAt), desc(newsItems.id))
    .limit(limit);

  const data: NewsItem[] = rows.map((r) => ({
    id: r.id,
    sourceKey: r.sourceKey,
    url: r.url,
    title: r.title,
    summary: r.summary,
    body: r.body,
    publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
    firstSeenAt: r.firstSeenAt.toISOString(),
    regionCpu: r.regionCpu,
    kind: r.kind as NewsItem['kind'],
    isUkraineWide: r.isUkraineWide,
    tags: r.tags,
    imageUrls: r.imageUrls ?? [],
    contentHash: r.contentHash,
  }));

  // Перевірка свіжості: чи є публікації за останні 24 години
  const latestPublished = data[0]?.publishedAt ? new Date(data[0].publishedAt).getTime() : 0;
  const isStale = data.length === 0 || Date.now() - latestPublished > 24 * 3600 * 1000;

  return {
    data,
    meta: {
      count: data.length,
      limit,
      stale: isStale,
    },
  };
}

export async function queryNewsSources(): Promise<NewsSourcesResponse> {
  const rows = await db
    .select({
      sourceKey: newsSources.sourceKey,
      kind: newsSources.kind,
      baseUrl: newsSources.baseUrl,
      regionCpu: newsSources.regionCpu,
      enabled: newsSources.enabled,
      lastOkAt: newsSources.lastOkAt,
      lastError: newsSources.lastError,
      itemsCount: newsSources.itemsCount,
    })
    .from(newsSources)
    .orderBy(newsSources.sourceKey);

  const data: NewsSource[] = rows.map((r) => ({
    sourceKey: r.sourceKey,
    kind: r.kind,
    baseUrl: r.baseUrl,
    regionCpu: r.regionCpu,
    enabled: r.enabled,
    lastOkAt: r.lastOkAt ? r.lastOkAt.toISOString() : null,
    lastError: r.lastError,
    itemsCount: r.itemsCount,
  }));

  return { data };
}
