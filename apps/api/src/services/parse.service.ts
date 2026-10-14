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
import { markMissingEventsCancelled, upsertOutageEvent, upsertOutageEventAddress, type Database } from '../db/outage-events-writer.js';
import { clearSourcePause, recordSourceFailure, recordSourceSuccess } from './source-breaker-state.js';
import { importTelegramSchedule } from './telegram-schedule.service.js';
import { importMirrorScheduleFromSource } from './mirror-schedule.service.js';
import { syncProviderSchedules } from './provider-sync.service.js';
import { getRegisteredProviders } from '../providers/registry.js';
import { sanitizeSourceError } from './source-breaker.js';
import type { SourceFailureKind } from '../parsers/source-errors.js';
import { settlementsForRegion, type DirectorySettlement } from '../providers/settlement-directory.js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const CHERNIHIV_REGION = 'chernihivska-oblast';
const STATE_DIR = process.env.SVITLO_STATE_DIR ?? '/tmp';

/**
 * Порція НП на один прогін: спершу міста, потім села, із курсором між прогонами.
 *
 * Область — 1509 НП, а оператор витримує десятки запитів за раз, не тисячі (перевірено вживу:
 * ~1.8 с на запит, далі WAF). Тому за прогін береться порція, а села додаються поступово —
 * наступними прогонами. Курсор живе у файлі стану: це лише оптимізація темпу, втрата файлу
 * означає лише повторний обхід частини сіл, а не поломку сбору.
 */
function pickCityBatch(limit = Number.parseInt(process.env.CHERNIHIV_MAX_CITIES_PER_RUN ?? '30', 10)): string[] {
  const directory = settlementsForRegion(CHERNIHIV_REGION);
  if (directory.length === 0) return [];
  const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 200) : 30;
  const cities = directory.filter((item: DirectorySettlement) => item.priority === 1).map((item) => item.koatuu);
  const villages = directory.filter((item: DirectorySettlement) => item.priority !== 1).map((item) => item.koatuu);
  if (cities.length + villages.length <= safeLimit) return [...cities, ...villages];

  const cursorFile = path.join(STATE_DIR, 'chernihiv-city-cursor');
  let cursor = 0;
  try {
    const parsed = Number.parseInt(readFileSync(cursorFile, 'utf8').trim(), 10);
    if (Number.isInteger(parsed) && parsed >= 0 && parsed < villages.length) cursor = parsed;
  } catch {
    cursor = 0;
  }

  const batch = [...cities];
  let index = cursor;
  while (batch.length < safeLimit && index < villages.length) {
    batch.push(villages[index]!);
    index += 1;
  }
  const cursorNext = index >= villages.length ? 0 : index;
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(cursorFile, String(cursorNext));
  } catch {
    // Курсор — оптимізація; відсутність файлу не робить збір невдалим.
  }
  return batch;
}

function getAdapters(): ISourceAdapter[] {
  if (env.USE_MOCK_ADAPTER) return [new MockAdapter()];
  // Перелік НП: явний CHERNIHIV_CITY_IDS має пріоритет, інакше — довідник КОАТУУ з порцією
  // (див. pickCityBatch). Без цього в .env лишався один ручний код, і адаптер падав з
  // «CHERNIHIV_CITY_IDS порожній», не бачачи аварій у 1500+ НП области.
  const cityIds = env.CHERNIHIV_CITY_IDS.length > 0 ? env.CHERNIHIV_CITY_IDS : pickCityBatch();
  // Основне джерело — публічний веб-API оператора (/power_outages), якщо увімкнено.
  const primary: ISourceAdapter = env.CHERNIHIV_WEB_ENABLED
    ? new ChernihivWebAdapter(fetch, {
        baseUrl: env.CHERNIHIV_BASE_URL,
        cityIds,
        types: env.CHERNIHIV_OUTAGE_TYPES,
        timeoutMs: env.PARSE_TIMEOUT_MS,
        userAgent: env.CHERNIHIV_USER_AGENT,
        requestDelayMs: env.CHERNIHIV_REQUEST_DELAY_MS,
        retries: env.CHERNIHIV_RETRIES,
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
  options: { now?: Date; complete?: boolean; db?: Database } = {},
): Promise<IngestOutagesResult> {
  const now = options.now ?? new Date();
  // executor по умолчанию — глобальное соединение; тесты подменяют его соединением на *_test БД.
  const database = options.db ?? db;
  // Та же граница, что в runParse: событие можно отменять только если лента оператора ПОЛНАЯ.
  // При `complete: false` (часть настроенных порций не загрузилась) "исчезнувшее" окно —
  // это дырка в наших данных, а не отмена оператором.
  const feedIsComplete = options.complete ?? true;
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

  const cancelledMarked = await database.transaction(async (tx) => {
    for (const outage of feed) {
      const normArea = normalizeOutageLocation(outage.areaName, outage.addressesRaw);
      const normAddr = normalizeAddress(outage.addressesRaw);
      const hash = contentHash(
        `${sourceId}-${normArea}-${outage.addressesRaw}-${outage.startsAt.toISOString()}-${outage.endsAt.toISOString()}`,
      );

      const isCurrent = outage.startsAt <= now && outage.endsAt >= now;
      const initialStatus = isCurrent ? 'active' : outage.startsAt > now ? 'scheduled' : 'finished';

      // `outages` має ДВА унікальні індекси — (content_hash, source_id) і частковий (source, external_id) —
      // а `ON CONFLICT` вміє цілитись лише в один. Через це повторний ingest тієї самої стрічки падав
      // з `duplicate key value violates unique constraint "outages_source_external_id_uq"`: адаптер
      // згортає адресні рядки в одну подію й міняє addresses_raw (→ інший content_hash), а external_id
      // лишається від «дитини». Тому upsert робимо явно: шукаємо рядок за БУДЬ-ЯКИМ із ключів, далі
      // UPDATE (зберігає first_seen_at) або INSERT. Це і є умова «один і той самий фід можна парсити
      // повторно» — без неї живий прогон не проходив зовсім.
      const rowValues = {
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
      };
      // Збіг БУДЬ-ЯКОГО з двох унікальних ключів означає «рядок уже є»; params — лише рядки,
      // Date сюди не потрапляє (postgres.js падає саме на Date у сирому sql-шаблоні).
      const existingMatch = outage.externalId
        ? sql`(${outages.contentHash} = ${hash} OR (${outages.source} = ${sourceName} AND ${outages.externalId} = ${outage.externalId}))`
        : sql`${outages.contentHash} = ${hash}`;
      const [existing] = await tx
        .select({ id: outages.id })
        .from(outages)
        .where(and(eq(outages.sourceId, sourceId), existingMatch))
        .limit(1);

      if (existing) {
        await tx.update(outages).set({ ...rowValues, updatedAt: now }).where(eq(outages.id, existing.id));
      } else {
        // onConflictDoNothing — страховка від гонки двох ingest: друга вставка просто нічого не зробить.
        await tx.insert(outages).values({ ...rowValues, firstSeenAt: now, updatedAt: now }).onConflictDoNothing();
      }

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
    // Порожня стрічка нікого не скасовує (див. markMissingEventsCancelled), і неповна — теж.
    if (!feedIsComplete) return 0;
    return markMissingEventsCancelled(tx, sourceId, seenEventKeys, now);
  });

  // Діагностика dual-write: скільки подій та адрес реально лежить у нових таблицях за ключами цієї
  // стрічки. Query builder, а не сирий sql: у сирому шаблоні drizzle не мапить параметри під колонки.
  let counts = { events: 0, addresses: 0 };
  const uniqueEventKeys = [...new Set(seenEventKeys)];
  if (uniqueEventKeys.length > 0) {
    const [eventsRow] = await database
      .select({ count: sql<number>`count(*)::int` })
      .from(outageEvents)
      .where(and(eq(outageEvents.sourceId, sourceId), inArray(outageEvents.eventKey, uniqueEventKeys)));
    const [addressesRow] = await database
      .select({ count: sql<number>`count(*)::int` })
      .from(outageEventAddresses)
      .innerJoin(outageEvents, eq(outageEventAddresses.eventId, outageEvents.id))
      .where(and(eq(outageEvents.sourceId, sourceId), inArray(outageEvents.eventKey, uniqueEventKeys)));
    counts = { events: eventsRow?.count ?? 0, addresses: addressesRow?.count ?? 0 };
  }

  // Граница успеха для источника та ручного вызова ingest (тесты): полная лента с записями.
  // Такие же правила стоят в runParse — там в одном месте решается и про lastError.
  const runStatus = feedIsComplete && feed.length > 0 ? 'success' : 'partial';
  await database
    .update(sources)
    .set(
      runStatus === 'success'
        ? { lastSuccessAt: now, lastError: null }
        : { lastError: 'Ingest skipped: incomplete feed or no outage records' },
    )
    .where(eq(sources.id, sourceId));

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

  // Вид збою основного джерела (403/429/таймаут/обрив/…). Объявлен снаружи try, потому что нужен
  // и в catch того же try: флаг «circuit breaker уже записал ошибку — не перетирай её».
  let sourceFailureKind: SourceFailureKind | null = null;

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
      // Circuit breaker: блокування чи таймаут — це сигнал джерела, а не наш баг. У цьому прогоні
      // до джерела більше не звертаємось (адаптер такі збої теж не повторює), а саме джерело
      // стає на паузу 30 хв → 1 год → 3 год → 6 год; Retry-After поважається.
      const failure = await recordSourceFailure(sourceId, primaryError);
      sourceFailureKind = failure.kind;
      logger.warn(
        {
          adapter: adapter.name,
          sourceId,
          kind: failure.kind,
          consecutiveFailures: failure.consecutiveFailures,
          pausedUntil: failure.pausedUntil,
        },
        'Primary source failed; continuing with secondary sources',
      );
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
    // Полный успех — только когда основное (outage) джерело ответило ЦЕЛИКОМ и без ошибки.
    // `complete === false` значит, что хотя бы одна настроенная порция (cityId:type) не загрузилась:
    // в этом случае ни ingest, ни last_success_at, ни отмена событий не выполняются.
    const fullOutageFeed = !primaryError && primaryData.complete !== false;
    const partialReason = primaryError
      ? primaryError.message
      : primaryData.complete === false
        ? `Operator feed incomplete: loaded ${primaryData.completeScopeKeys?.length ?? 0} of ${(env.CHERNIHIV_CITY_IDS.length > 0 ? env.CHERNIHIV_CITY_IDS.length : settlementsForRegion(CHERNIHIV_REGION).length) * env.CHERNIHIV_OUTAGE_TYPES.length} configured portions`
        : 'No outage records in a complete operator feed';

    // Нічого не зібрали з жодного джерела — це помилка (не «порожній успіх»).
    // Наявні в БД дані при цьому не чіпаємо, тому втрати даних не буде.
    if (effectiveData.outages.length === 0 && effectiveData.incidents.length === 0 && telegramPosts.length === 0) {
      const err = primaryError ?? new Error('Parser returned 0 records. Keeping existing data to avoid data loss.');
      logger.warn({ sourceId, err: err.message }, 'Parse run produced no records');
      throw err;
    }

    const now = new Date();
    const { mkdir, writeFile } = await import('node:fs/promises');
    const { isAbsolute, resolve } = await import('node:path');
    const snapshotDirectory = isAbsolute(env.SNAPSHOT_DIR)
      ? env.SNAPSHOT_DIR
      : resolve(process.cwd(), env.SNAPSHOT_DIR);
    await mkdir(snapshotDirectory, { recursive: true });
    const snapshotFile = resolve(snapshotDirectory, `${run.id}.json`);
    const snapshotPath = `snapshots/${run.id}.json`;
    await writeFile(snapshotFile, JSON.stringify({ primary: primaryData.rawSnapshot, secondary: secondaryData.map(({ adapter: adapterName, data: result }) => ({ adapter: adapterName, snapshot: result.rawSnapshot, posts: result.posts })) }), 'utf8');

    // 1. Upsert Outages + dual-write канонічних подій в ОДНІЙ транзакції (крок 4 плану міграції).
    //    Читачі поки що читають стару таблицю — тут для них нічого не змінюється.
    // Пишем ВСЕ, что удалось собрать, даже если лента неполная: `complete` внутри ingestOutages
    // защищает ровно одну вещь — отмену событий, которых «больше нет». Раньше при complete=false
    // прогін не писал НИЧЕГО, и одна упавшая порция (например, оператор ответил ESOCKETTIMEDOUT
    // на Чернігів) викидала 210 зібраних записів по інших 23 НП. Втрата реальних даних заради
    // «чистої» семантики complete — неприйнятна: краще зберегти те, що є, і не скасовувати
    // зниклі вікна (саме це complete=false і робить).
    const ingest = await ingestOutages(sourceId, adapter.name, primaryData.outages, {
      now,
      complete: fullOutageFeed,
    });
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

    // АВТОМАТИЧНИЙ імпорт погодинного ГПВ у `schedule_slots`: «Моя черга» оновлюється при будь-якій
    // зміні графіка оператором, без кнопки в адмінці (HANDOFF §18.9.1).
    //
    // Читаємо не щойно зібрані пости в пам'яті, а базу за 14 діб (`importTelegramSchedule`): сторінка
    // каналу віддає лише останні ~20 постів, тож «зміна» на 6 жовтня в пам'ять уже не потрапляє, а
    // раніше записані слоти треба не втратити й перевірити повторно. Тому беремо надмножество з БД.
    // Імпорт ідемпотентний: рядки `source = 'telegram'` за тими ж чергою/датою перезаписуються, ручний
    // і операторський імпорт не чіпаються. Збій імпорту НЕ валить парсинг — слоти лишаються попередні.
    try {
      const scheduleImport = await importTelegramSchedule();
      logger.info(
        {
          sourceId,
          posts: scheduleImport.posts,
          matchedPosts: scheduleImport.matchedPosts,
          imported: scheduleImport.imported,
          queues: scheduleImport.queues,
          dates: scheduleImport.dates,
        },
        'Telegram schedule auto-import finished',
      );
    } catch (scheduleError) {
      logger.warn(
        { err: scheduleError, sourceId },
        'Telegram schedule auto-import failed; keeping existing schedule_slots',
      );
    }

    // АВТОМАТИЧНИЙ імпорт ПОВНОГО добового ГПВ із публічного «дзеркала» (MIRROR_SCHEDULE_URL).
    // Telegram пише лише «зміни» (окремі черги+час), а сайт оператора віддає заглушку/капчу
    // (HANDOFF §18.9), тому єдине джерело 48 півгодинних значень на кожну чергу — дзеркало.
    // Той самий формат читає Java-ядро `core/`. Імпорт ідемпотентний і пише лише `source='mirror'`,
    // ручні/операторські/telegram-рядки не затираються. Збій НЕ валить парсинг: слоти лишаються.
    if (env.MIRROR_SCHEDULE_ENABLED) {
      try {
        const mirrorImport = await importMirrorScheduleFromSource();
        if (mirrorImport.rejected && mirrorImport.rejected > 0) {
          logger.warn(
            { sourceId, rejected: mirrorImport.rejected },
            'Mirror schedule import: slots rejected by data quality validator',
          );
        }
        logger.info(
          { sourceId, imported: mirrorImport.imported, rejected: mirrorImport.rejected ?? 0, queues: mirrorImport.queues, dates: mirrorImport.dates },
          'Mirror schedule auto-import finished',
        );
      } catch (mirrorError) {
        logger.warn(
          { err: mirrorError, sourceId },
          'Mirror schedule auto-import failed; keeping existing schedule_slots',
        );
      }
    }

    // СИНХРОНІЗАЦІЯ ПРОВАЙДЕРІВ ГРАФІКІВ (мультирегіональність): провайдери (mirror, YASNO,
    // DTEK, e-svitlo, Чернігівобленерго) пишуть `schedule_slots` + довідник сіл/улиць кожен
    // зі своїм `source`, тому ручні/telegram-рядки не затираються. Падіння одного провайдера
    // НЕ валить парсинг: вище дані відключень завжди вже збережено.
    //
    // Викликаємо лише коли синхронізація провайдерів увімкнена (PROVIDER_SYNC_ENABLED=true):
    // реліз не має непомітно ходити до сторонніх API в бойовому режимі.
    if (env.PROVIDER_SYNC_ENABLED) {
      try {
        const { providers, skipped } = await getRegisteredProviders();
        if (providers.length > 0) {
          const reports = await syncProviderSchedules(providers);
          logger.info(
            { sourceId, providerCount: providers.length, skipped, reports },
            'Provider schedules synced during parse cycle',
          );
        } else {
          logger.warn({ sourceId, skipped }, 'Provider sync during parse: no providers registered');
        }
      } catch (providerError) {
        logger.warn(
          { err: providerError, sourceId },
          'Provider schedules sync failed during parse; keeping existing schedule_slots',
        );
      }
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
    if (fullOutageFeed) await updateOutageStatuses();

    // 5. Update Source & ParseRun
    //    `last_success_at` двигает ТОЛЬКО полный успех, в котором есть записи об отключениях
    //    (status='success' и records_found > 0). Обрыв основной ленты, частичный ответ оператора
    //    и легитимно пустой (но полный) фид оставляют прежнюю метку — «данные не обновлялись»
    //    должно быть видно в /status, а не маскироваться свежим last_success_at.
    const runStatus = fullOutageFeed && effectiveData.outages.length > 0 ? 'success' : 'partial';
    if (runStatus === 'success') {
      // Успіх скидає і серию невдач, і паузу circuit breaker.
      await recordSourceSuccess(sourceId, now);
    } else if (sourceFailureKind) {
      // Джерело вже позначене recordSourceFailure вище — повідомлення з видом збою не перетираємо.
      logger.warn(
        { sourceId, kind: sourceFailureKind },
        'Parse run partial: primary source failed earlier in this run',
      );
    } else {
      await db
        .update(sources)
        .set({ lastError: sanitizeSourceError(partialReason) })
        .where(eq(sources.id, sourceId));
      // Повна (але порожня) відповідь оператора означає, що джерело живе: серию невдач скидаємо,
      // last_success_at при цьому не рухаємо (див. коментар вище про часткові й порожні фіди).
      if (fullOutageFeed) await clearSourcePause(sourceId);
    }

    await db
      .update(parseRuns)
      .set({
        status: runStatus,
        finishedAt: now,
        recordsFound: effectiveData.outages.length,
        // Вид збою в тексті: parse_runs читають руками, коли «даних немає», і клас проблеми
        // (блок / таймаут / формат) економить час.
        errorMessage:
          runStatus === 'success'
            ? null
            : sourceFailureKind
              ? `[${sourceFailureKind}] ${partialReason}`
              : partialReason,
        rawSnapshotRef: snapshotPath,
      })
      .where(eq(parseRuns.id, run.id));

    logger.info(
      { sourceId, runStatus, recordsFound: effectiveData.outages.length, snapshotPath, telegramPosts: telegramPosts.length },
      'Parse run finished',
    );

    return effectiveData;
  } catch (err: any) {
    logger.error({ err, sourceId }, 'Parse run failed');
    await db
      .update(parseRuns)
      .set({
        status: 'error',
        finishedAt: new Date(),
        errorMessage: sanitizeSourceError(err.message),
      })
      .where(eq(parseRuns.id, run.id));

    // Збій основного джерела вже врахував circuit breaker (вище, до ingest). Тут пишемо лише
    // «наші» помилки (БД, «0 записів») — і теж без персональних даних.
    if (!sourceFailureKind) {
      await db
        .update(sources)
        .set({ lastError: sanitizeSourceError(err.message) })
        .where(eq(sources.id, sourceId));
    }

    throw err;
  }
}
