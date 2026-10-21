/**
 * Сервіс збору та збереження новин з публічних джерел.
 *
 * Принципи:
 * - джерела читаються з таблиці `news_sources`;
 * - невдача одного зовнішнього джерела НІКОЛИ не роняє весь процес збору;
 * - помилка записується в `news_sources.last_error`, а успіх оновлює `last_ok_at`;
 * - повторний збір дедуплікується за `(content_hash, source_key)`;
 * - прапорець `dryRun` дозволяє протестувати парсинг без збереження в БД.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../db/connection.js';
import { newsItems, newsSources } from '../../db/schema.js';
import { logger } from '../../utils/logger.js';
import type { NewsCollectPerSource, NewsCollectResponse } from '@svitlo/shared';
import { detectNewsKind, detectRegionCpu, extractNewsTags, isUkraineWideNews } from './classifier.js';
import { computeNewsContentHash } from './dedup.js';
import { fetchNewsSourceRaw } from './http-client.js';
import { parseRssOrAtomXml } from './rss-parser.js';
import { parseTelegramChannelHtml } from './telegram-parser.js';
import type { RawParsedNewsItem } from './types.js';

export interface CollectNewsOptions {
  sourceKeys?: string[];
  dryRun?: boolean;
  fetchImpl?: typeof fetch;
}

export async function collectNews(options: CollectNewsOptions = {}): Promise<NewsCollectResponse> {
  const { sourceKeys, dryRun = false, fetchImpl } = options;

  let query = db.select().from(newsSources);
  let sourcesList = await (sourceKeys && sourceKeys.length > 0
    ? db.select().from(newsSources).where(inArray(newsSources.sourceKey, sourceKeys))
    : db.select().from(newsSources).where(eq(newsSources.enabled, true)));

  let totalCollected = 0;
  let totalInserted = 0;
  let totalSkipped = 0;
  const perSource: NewsCollectPerSource[] = [];

  for (const source of sourcesList) {
    let sourceCollected = 0;
    let sourceInserted = 0;
    let sourceSkipped = 0;
    let sourceError: string | null = null;

    try {
      if (!source.baseUrl) {
        throw new Error(`У джерела ${source.sourceKey} не вказано base_url`);
      }

      // 1. Отримуємо сирий контент джерела
      const rawBody = await fetchNewsSourceRaw(source.baseUrl, { fetchImpl });

      // 2. Парсимо за відповідним адаптером
      let rawItems: RawParsedNewsItem[] = [];
      if (source.kind === 'telegram') {
        rawItems = parseTelegramChannelHtml(rawBody, source.baseUrl);
      } else if (source.kind === 'rss') {
        rawItems = parseRssOrAtomXml(rawBody);
      } else {
        logger.warn({ sourceKey: source.sourceKey, kind: source.kind }, 'Невідомий тип адаптера джерела');
      }

      sourceCollected = rawItems.length;

      // 3. Збагачуємо класифікацією та дедуплікуємо
      for (const item of rawItems) {
        const fullText = `${item.title} ${item.summary ?? ''} ${item.body ?? ''}`;
        const isUkraineWide =
          source.sourceKey.includes('ukrenergo') || isUkraineWideNews(fullText, source.regionCpu);
        const regionCpu = detectRegionCpu(fullText, source.regionCpu);
        const kind = detectNewsKind(fullText);
        const tags = extractNewsTags(fullText, regionCpu, kind);
        const contentHash = computeNewsContentHash(item.title, item.url, item.publishedAt);

        if (dryRun) {
          // У режимі dryRun перевіряємо, чи є вже такий хеш у БД
          const [existing] = await db
            .select({ id: newsItems.id })
            .from(newsItems)
            .where(sql`${newsItems.contentHash} = ${contentHash} AND ${newsItems.sourceKey} = ${source.sourceKey}`)
            .limit(1);

          if (existing) {
            sourceSkipped += 1;
          } else {
            sourceInserted += 1;
          }
        } else {
          // Записуємо в БД з ON CONFLICT DO NOTHING
          const publishedAtDate = item.publishedAt ? new Date(item.publishedAt) : null;
          const insertedRows = await db
            .insert(newsItems)
            .values({
              sourceKey: source.sourceKey,
              url: item.url,
              title: item.title,
              summary: item.summary,
              body: item.body,
              publishedAt: publishedAtDate,
              regionCpu,
              kind,
              isUkraineWide,
              tags,
              imageUrls: item.imageUrls ?? [],
              contentHash,
              raw: item.raw ? (item.raw as Record<string, unknown>) : null,
            })
            .onConflictDoNothing({ target: [newsItems.contentHash, newsItems.sourceKey] })
            .returning({ id: newsItems.id });

          if (insertedRows.length > 0) {
            sourceInserted += 1;
          } else {
            sourceSkipped += 1;

            // Дедуплікація не має губити зображення: якщо пост уже в БД без картинок (зібраний до
            // появи поля `image_urls`), а зараз вони є — дозаповнюємо БЕЗ створення дубля.
            // Так графіки Чернігівобленерго з'являються в уже наявних записах після першого прогону.
            if (item.imageUrls && item.imageUrls.length > 0) {
              await db
                .update(newsItems)
                .set({ imageUrls: item.imageUrls })
                .where(
                  and(
                    eq(newsItems.contentHash, contentHash),
                    eq(newsItems.sourceKey, source.sourceKey),
                    sql`cardinality(${newsItems.imageUrls}) = 0`,
                  ),
                );
            }
          }
        }
      }

      // 4. Оновлюємо статус джерела при успішному зборі
      if (!dryRun) {
        await db
          .update(newsSources)
          .set({
            lastOkAt: sql`now()`,
            lastError: null,
            itemsCount: sql`${newsSources.itemsCount} + ${sourceInserted}`,
            updatedAt: sql`now()`,
          })
          .where(eq(newsSources.sourceKey, source.sourceKey));
      }
    } catch (err) {
      sourceError = err instanceof Error ? err.message : String(err);
      logger.warn({ sourceKey: source.sourceKey, err }, 'Помилка збору новин із джерела');

      if (!dryRun) {
        await db
          .update(newsSources)
          .set({
            lastError: sourceError,
            updatedAt: sql`now()`,
          })
          .where(eq(newsSources.sourceKey, source.sourceKey));
      }
    }

    totalCollected += sourceCollected;
    totalInserted += sourceInserted;
    totalSkipped += sourceSkipped;

    perSource.push({
      sourceKey: source.sourceKey,
      collected: sourceCollected,
      inserted: sourceInserted,
      skipped: sourceSkipped,
      error: sourceError,
    });
  }

  return {
    collected: totalCollected,
    inserted: totalInserted,
    skipped: totalSkipped,
    perSource,
  };
}
