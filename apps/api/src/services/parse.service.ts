import { env } from '../config.js';
import { MockAdapter } from '../parsers/mock.adapter.js';
import { ChernihivAdapter } from '../parsers/chernihiv.adapter.js';
import { ChernihivWebAdapter } from '../parsers/chernihiv-web.adapter.js';
import { TelegramChannelAdapter } from '../parsers/telegram-channel.adapter.js';
import { TelegramBotAdapter } from '../parsers/telegram-bot.adapter.js';
import { ISourceAdapter, NormalizedOutage, ParseResult } from '../parsers/adapter.js';
import { db } from '../db/connection.js';
import { parseRuns, outages, sources, incidents, gridStatus, telegramPosts as telegramPostsTable, outageEvents, outageEventAddresses } from '../db/schema.js';
import { contentHash } from '../utils/hash.js';
import { normalizeAddress, normalizeOutageLocation } from '../parsers/normalizer.js';
import { updateOutageStatuses } from './outage.service.js';
import { logger } from '../utils/logger.js';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { mergeDuplicateOutages, outageEventKey } from './outage-grouping.js';
import { outageCategoryFromReason } from './outage-classification.js';
import { markMissingEventsCancelled, upsertOutageEvent, upsertOutageEventAddress } from '../db/outage-events-writer.js';

function getAdapters(): ISourceAdapter[] {
  if (env.USE_MOCK_ADAPTER) return [new MockAdapter()];
  // Основне джерело — публічний веб-API оператора (/power_outages), якщо увімкнено.
  const primary: ISourceAdapter = env.CHERNIHIV_WEB_ENABLED
    ? new ChernihivWebAdapter(fetch, {
        baseUrl: env.CHERNIHIV_BASE_URL,
        cityIds: env.CHERNIHIV_CITY_IDS,
        types: env.CHERNIHIV_OUTAGE_TYPES,
        timeoutMs: env.PARSE_TIMEOUT_MS,
        userAgent: env.CHERNIHIV_USER_AGENT,
        requestDelayMs: env.CHERNIHIV_REQUEST_DELAY_MS,
        sessionWarmup: env.CHERNIHIV_SESSION_WARMUP,
      })
    : new ChernihivAdapter();
  const adapters: ISourceAdapter[] = [primary, new TelegramChannelAdapter()];
  if (env.TELEGRAM_BOT_ENABLED) adapters.push(new TelegramBotAdapter());
  return adapters;
}

/** Підсумок dual-write одного прогону: скільки подій дає старий шлях і скільки їх у новій таблиці. */
export interface IngestOutagesResult {
  /** Рядків у стрічці оператора (рядок = адреса). */
  rowsInFeed: number;
  /** Скільки подій дає СТАРИЙ шлях згортання на цій самій стрічці. */
  eventsOldPath: number;
  /** Скільки унікальних ключів подій дала нова таблиця (логіка ingest). */
  eventsNewPath: number;
  /** Скільки рядків outage_events лежить у БД за ключами цієї стрічки. */
  eventsInTable: number;
  /** Скільки адрес у outage_event_addresses за ключами цієї стрічки. */
  addressesInTable: number;
  /** Скільки подій позначено скасованими цим прогоном. */
  cancelledMarked: number;
  /** Причини, які класифікатор не відніс до відомої категорії ('other') — для warn, без адрес. */
  unclassifiedReasons: string[];
}

/**
 * Dual-write (крок 4 плану міграції): ОДНА транзакція пише і старі рядки `outages` (рядок = адреса,
 * як і раніше), і канонічну подію в `outage_events` разом з її адресами. Ключ події та категорію
 * беруть ті самі функції, що й backfill (`outageEventKey`/`outageCategoryFromReason`): друга копія
 * логіки означала б два джерела правди (invariant 3 у skills/outage-data-core).
 *
 * Читачів не перемикає: усе, що бачить застосунок, досі приходить зі старої таблиці.
 */
export async function ingestOutages(
  sourceId: string,
  sourceName: string,
  feed: NormalizedOutage[],
  options: { now?: Date } = {},
): Promise<IngestOutagesResult> {
  const now = options.now ?? new Date();
  const seenEventKeys: string[] = [];
  const unclassifiedReasons = new Set<string>();

  // Число подій по СТАРОМУ шляху — та сама функція, що стоїть у /outages. Це тимчасовий
  // діагностичний виклик: він зникає разом із mergeDuplicateOutages на кроці 6 плану.
  const eventsOldPath = mergeDuplicateOutages(
    feed.map((outage) => ({
      startsAt: outage.startsAt,
      endsAt: outage.endsAt,
      areaName: normalizeOutageLocation(outage.areaName, outage.addressesRaw),
      addressesRaw: outage.addressesRaw,
      reason: outage.reason,
    })),
  ).length;

  const cancelledMarked = await db.transaction(async (tx) => {
    for (const outage of feed) {
      const normArea = normalizeOutageLocation(outage.areaName, outage.addressesRaw);
      const normAddr = normalizeAddress(outage.addressesRaw);
      const hash = contentHash(
        `${sourceId}-${normArea}-${outage.addressesRaw}-${outage.startsAt.toISOString()}-${outage.endsAt.toISOString()}`,
      );

      const isCurrent = outage.startsAt <= now && outage.endsAt >= now;
      const initialStatus = isCurrent ? 'active' : outage.startsAt > now ? 'scheduled' : 'finished';

      await tx
        .insert(outages)
        .values({
          sourceId,
          source: sourceName,
          externalId: outage.externalId ?? null,
          startsAt: outage.startsAt,
          endsAt: outage.endsAt,
          areaName: normArea,
          addressesRaw: outage.addressesRaw,
          addressesNormalized: normAddr,
          reason: outage.reason,
          queue: outage.queue,
          contentHash: hash,
          status: initialStatus,
          firstSeenAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [outages.contentHash, outages.sourceId],
          set: {
            areaName: normArea,
            addressesRaw: outage.addressesRaw,
            addressesNormalized: normAddr,
            reason: outage.reason,
            queue: outage.queue,
            status: initialStatus,
            updatedAt: now,
          },
        });

      // Канонічна подія: ключ БЕЗ адрес — саме він згортає 30 адресних рядків у 6 подій.
      const eventKey = outageEventKey({
        startsAt: outage.startsAt,
        endsAt: outage.endsAt,
        areaName: normArea,
        addressesRaw: outage.addressesRaw,
        reason: outage.reason,
      });
      const category = outageCategoryFromReason(outage.reason);
      if (category === 'other') unclassifiedReasons.add((outage.reason ?? '(порожня причина)').slice(0, 120));

      const eventId = await upsertOutageEvent(tx, {
        sourceId,
        eventKey,
        category,
        reason: outage.reason,
        areaName: normArea,
        startsAt: outage.startsAt,
        endsAt: outage.endsAt,
        // Dual-write не вигадує історію: скасування ставить блок нижче, за фактом зникнення вікна.
        cancelledAt: null,
        externalId: outage.externalId ?? null,
      });
      await upsertOutageEventAddress(tx, eventId, outage.addressesRaw);
      seenEventKeys.push(eventKey);
    }

    // Події, яких більше немає у стрічці, хоч вони ще не почалися: оператор їх скасував.
    // Порожня стрічка нікого не скасовує (див. markMissingEventsCancelled).
    return markMissingEventsCancelled(tx, sourceId, seenEventKeys, now);
  });

  // Діагностика dual-write: скільки подій та адрес реально лежить у нових таблицях за ключами цієї
  // стрічки. Query builder, а не сирий sql: у сирому шаблоні drizzle не мапить параметри під колонки.
  let counts = { events: 0, addresses: 0 };
  const uniqueEventKeys = [...new Set(seenEventKeys)];
  if (uniqueEventKeys.length > 0) {
    const [eventsRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(outageEvents)
      .where(and(eq(outageEvents.sourceId, sourceId), inArray(outageEvents.eventKey, uniqueEventKeys)));
    const [addressesRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(outageEventAddresses)
      .innerJoin(outageEvents, eq(outageEventAddresses.eventId, outageEvents.id))
      .where(and(eq(outageEvents.sourceId, sourceId), inArray(outageEvents.eventKey, uniqueEventKeys)));
    counts = { events: eventsRow?.count ?? 0, addresses: addressesRow?.count ?? 0 };
  }

  return {
    rowsInFeed: feed.length,
    eventsOldPath,
    eventsNewPath: new Set(seenEventKeys).size,
    eventsInTable: counts.events,
    addressesInTable: counts.addresses,
    cancelledMarked,
    unclassifiedReasons: [...unclassifiedReasons],
  };
}

/** Лог звірки dual-write: обидва шляхи мусять бачити однакову кількість подій (крок 4 плану). */
function logDualWriteComparison(sourceId: string, result: IngestOutagesResult): void {
  logger.info(
    {
      sourceId,
      rowsInFeed: result.rowsInFeed,
      eventsOldPath: result.eventsOldPath,
      eventsNewPath: result.eventsNewPath,
      eventsInTable: result.eventsInTable,
      addressesInTable: result.addressesInTable,
      cancelledMarked: result.cancelledMarked,
    },
    'Outage dual-write: events by old path vs outage_events',
  );

  if (result.eventsOldPath !== result.eventsInTable) {
    logger.warn(
      { sourceId, eventsOldPath: result.eventsOldPath, eventsInTable: result.eventsInTable },
      'Outage dual-write MISMATCH: old path and outage_events disagree',
    );
  }

  // Категорія 'other' — не помилка, а сигнал: регекси класифікатора треба розширити.
  // Пишемо лише причини (без адрес), щоб не тягнути персональні дані в логи.
  if (result.unclassifiedReasons.length > 0) {
    logger.warn(
      { sourceId, count: result.unclassifiedReasons.length, samples: result.unclassifiedReasons.slice(0, 5) },
      'Outage dual-write: reasons without a known category',
    );
  }
}

export async function runParse(sourceId: string) {
  const adapters = getAdapters();
  const adapter = adapters[0]!;

  const [run] = await db
    .insert(parseRuns)
    .values({
      sourceId,
      status: 'running',
    })
    .returning();

  if (!run) {
    throw new Error('Failed to create parse_runs record');
  }

  try {
    logger.info({ sourceId, adapter: adapter.name }, 'Starting parse run');

    // 1. Основне джерело. Якщо воно недоступне (напр., WAF оператора блокує наш IP),
    //    НЕ валимо весь цикл — нижче все одно зберемо дані допоміжних джерел.
    let primaryData: ParseResult;
    let primaryError: Error | null = null;
    try {
      primaryData = await adapter.fetch();
    } catch (error) {
      primaryError = error instanceof Error ? error : new Error(String(error));
      logger.warn({ err: primaryError, adapter: adapter.name }, 'Primary source failed; continuing with secondary sources');
      primaryData = { outages: [], incidents: [], gridLevel: 'stable', gridMessage: '', rawSnapshot: '' };
    }

    const secondaryData = [];
    for (const secondaryAdapter of adapters.slice(1)) {
      try {
        const secondary = await secondaryAdapter.fetch();
        secondaryData.push({ adapter: secondaryAdapter.name, data: secondary });
        if (primaryData.outages.length && secondary.outages.length) {
          const primaryKeys = new Set(primaryData.outages.map((item) => `${item.areaName}|${item.startsAt.toISOString()}|${item.endsAt.toISOString()}`));
          const conflicts = secondary.outages.filter((item) => !primaryKeys.has(`${item.areaName}|${item.startsAt.toISOString()}|${item.endsAt.toISOString()}`));
          if (conflicts.length) logger.warn({ primary: adapter.name, secondary: secondaryAdapter.name, conflictingRecords: conflicts.length }, 'Outage source discrepancy; retaining primary source data');
        }
      } catch (secondaryError) {
        logger.warn({ err: secondaryError, secondary: secondaryAdapter.name }, 'Secondary outage source failed; primary remains authoritative');
      }
    }
    const telegramPosts = secondaryData.flatMap(({ data: secondary }) => secondary.posts ?? []);
    const telegramIncidents = secondaryData.flatMap(({ data: secondary }) => secondary.incidents ?? []);
    const effectiveData = { ...primaryData, incidents: [...primaryData.incidents, ...telegramIncidents], posts: telegramPosts };

    // Нічого не зібрали з жодного джерела — це помилка (не «порожній успіх»).
    // Наявні в БД дані при цьому не чіпаємо, тому втрати даних не буде.
    if (effectiveData.outages.length === 0 && effectiveData.incidents.length === 0 && telegramPosts.length === 0) {
      const err = primaryError ?? new Error('Parser returned 0 records. Keeping existing data to avoid data loss.');
      logger.warn({ sourceId, err: err.message }, 'Parse run produced no records');
      throw err;
    }

    const now = new Date();
    const snapshotPath = `snapshots/${run.id}.json`;
    const { mkdir, writeFile } = await import('node:fs/promises');
    const snapshotDirectory = new URL('../snapshots/', import.meta.url);
    await mkdir(snapshotDirectory, { recursive: true });
    await writeFile(new URL(`${run.id}.json`, snapshotDirectory), JSON.stringify({ primary: primaryData.rawSnapshot, secondary: secondaryData.map(({ adapter: adapterName, data: result }) => ({ adapter: adapterName, snapshot: result.rawSnapshot, posts: result.posts })) }), 'utf8');

    // 1. Upsert Outages + dual-write канонічних подій в ОДНІЙ транзакції (крок 4 плану міграції).
    //    Читачі поки що читають стару таблицю — тут для них нічого не змінюється.
    const ingest = await ingestOutages(sourceId, adapter.name, primaryData.outages, { now });
    logDualWriteComparison(sourceId, ingest);

    // Persist Telegram post IDs in their own table; channel content never becomes an outage record.
    for (const post of telegramPosts) {
      await db.insert(telegramPostsTable).values({
        postId: post.id,
        postText: post.text,
        publishedAt: post.date,
        link: post.link,
        kind: post.kind,
        rawSnapshotRef: snapshotPath,
      }).onConflictDoNothing();
    }

    // Upsert / update source incidents without discarding outage announcements.
    for (const inc of effectiveData.incidents) {
      if (inc.externalId) {
        const [existingIncident] = await db.select({ id: incidents.id }).from(incidents).where(eq(incidents.externalId, inc.externalId)).limit(1);
        if (existingIncident) continue;
      }
      await db.insert(incidents).values({
        sourceId,
        externalId: inc.externalId ?? null,
        sourceUrl: inc.sourceUrl ?? null,
        title: inc.title,
        description: inc.description,
        startedAt: inc.startedAt,
        etaAt: inc.etaAt,
        severity: inc.severity,
        status: 'active',
      }).onConflictDoNothing();
    }

    // 3. Update Grid Status (лише якщо основне джерело відповіло — інакше не псуємо
    //    останній відомий стан порожнім повідомленням).
    if (!primaryError && effectiveData.gridLevel) {
      const [previousStatus] = await db.select().from(gridStatus).orderBy(sql`${gridStatus.updatedAt} desc`).limit(1);
      const message = effectiveData.gridMessage?.trim() ? effectiveData.gridMessage : (previousStatus?.message ?? '');
      await db.insert(gridStatus).values({
        sourceId,
        level: effectiveData.gridLevel,
        message,
        updatedAt: now,
      });
    }

    // 4. Update status transitions for all outages
    await updateOutageStatuses();

    // 5. Update Source & ParseRun
    //    'partial' — впало основне джерело, але допоміжні дані збережено.
    await db
      .update(sources)
      .set({ lastSuccessAt: now, lastError: primaryError ? primaryError.message : null })
      .where(eq(sources.id, sourceId));

    await db
      .update(parseRuns)
      .set({
        status: primaryError ? 'partial' : 'success',
        finishedAt: now,
        recordsFound: effectiveData.outages.length,
        errorMessage: primaryError ? primaryError.message : null,
        rawSnapshotRef: snapshotPath,
      })
      .where(eq(parseRuns.id, run.id));

    logger.info(
      { sourceId, recordsFound: effectiveData.outages.length, snapshotPath, telegramPosts: telegramPosts.length },
      'Parse run completed successfully',
    );

    return effectiveData;
  } catch (err: any) {
    logger.error({ err, sourceId }, 'Parse run failed');
    await db
      .update(parseRuns)
      .set({
        status: 'error',
        finishedAt: new Date(),
        errorMessage: err.message,
      })
      .where(eq(parseRuns.id, run.id));

    await db
      .update(sources)
      .set({ lastError: err.message })
      .where(eq(sources.id, sourceId));

    throw err;
  }
}
