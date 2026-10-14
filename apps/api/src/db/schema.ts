import { pgTable, text, boolean, timestamp, uuid, integer, doublePrecision, index, uniqueIndex, check, primaryKey, date, smallint, jsonb } from 'drizzle-orm/pg-core';
import { sql, relations } from 'drizzle-orm';

export const sources = pgTable('sources', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  url: text('url').notNull(),
  type: text('type').notNull(),
  isActive: boolean('is_active').default(true),
  lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
  lastError: text('last_error'),
  /** Невдач підряд (міграція 0009); скидається після повного успішного збору. */
  consecutiveFailures: integer('consecutive_failures').notNull().default(0),
  /** До цього моменту планувальник пропускає джерело (circuit breaker); null = не на паузі. */
  pausedUntil: timestamp('paused_until', { withTimezone: true })
});

export const outages = pgTable('outages', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceId: uuid('source_id').references(() => sources.id).notNull(),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  areaName: text('area_name').notNull(),
  addressesRaw: text('addresses_raw').notNull(),
  addressesNormalized: text('addresses_normalized').notNull().default(''),
  reason: text('reason'),
  status: text('status').notNull().default('scheduled'),
  queue: integer('queue'),
  source: text('source').notNull().default('unknown'),
  externalId: text('external_id'),
  contentHash: text('content_hash').notNull(),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => {
  return {
    startsEndsIdx: index('outages_starts_ends_idx').on(table.startsAt, table.endsAt),
    addressesGistIdx: index('outages_addresses_trgm_idx').using('gist', sql`${table.addressesNormalized} gist_trgm_ops`),
    contentSourceUniqueIdx: uniqueIndex('outages_content_source_idx').on(table.contentHash, table.sourceId),
    statusIdx: index('outages_status_idx').on(table.status),
    areaIdx: index('outages_area_idx').on(table.areaName),
    externalSourceIdx: uniqueIndex('outages_source_external_id_uq').on(table.source, table.externalId)
  };
});

/**
 * Канонічна подія відключення: один рядок на РЕАЛЬНУ подію, а не на адресу
 * (див. skills/outage-data-core). event_key — з outageEventKey(), тобто ідентичність БЕЗ адрес;
 * перелік адрес живе в outage_event_addresses, а не в текстовому блобі.
 */
export const outageEvents = pgTable('outage_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceId: uuid('source_id').references(() => sources.id).notNull(),
  eventKey: text('event_key').notNull(),
  /** emergency | repair | regime | planned | other — CHECK у міграції 0008_outage_events.sql. */
  category: text('category').notNull(),
  reason: text('reason'),
  areaName: text('area_name'),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  externalId: text('external_id'),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  identityUq: uniqueIndex('outage_events_identity_uq').on(table.sourceId, table.eventKey),
  rangeIdx: index('outage_events_range_idx').on(table.startsAt, table.endsAt),
  categoryIdx: index('outage_events_category_idx').on(table.category),
  areaIdx: index('outage_events_area_idx').on(table.areaName),
  categoryChk: check('outage_events_category_chk', sql`${table.category} IN ('emergency', 'repair', 'regime', 'planned', 'other')`),
  rangeChk: check('outage_events_range_chk', sql`${table.endsAt} IS NULL OR ${table.endsAt} >= ${table.startsAt}`)
}));

/** Адреси події (багато на одну подію): address_normalized = energy_normalize_address(address_raw). */
export const outageEventAddresses = pgTable('outage_event_addresses', {
  eventId: uuid('event_id').notNull().references(() => outageEvents.id, { onDelete: 'cascade' }),
  addressRaw: text('address_raw').notNull(),
  addressNormalized: text('address_normalized').notNull()
}, (table) => ({
  pk: primaryKey({ columns: [table.eventId, table.addressNormalized] }),
  trgmIdx: index('outage_event_addresses_trgm_idx').using('gin', sql`${table.addressNormalized} gin_trgm_ops`)
}));

export const addresses = pgTable('addresses', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: text('type').notNull(),
  nameUk: text('name_uk').notNull(),
  nameRu: text('name_ru'),
  nameNormalized: text('name_normalized').notNull(),
  parentId: uuid('parent_id'),
  city: text('city'),
  source: text('source').notNull().default('outage'),
}, (table) => ({
  nameUkTrgmIdx: index('addresses_name_uk_trgm_idx').using('gin', sql`${table.nameUk} gin_trgm_ops`),
  nameNormalizedTrgmIdx: index('addresses_name_normalized_trgm_idx').using('gin', sql`${table.nameNormalized} gin_trgm_ops`),
  parentIdx: index('addresses_parent_idx').on(table.parentId),
}));

export const telegramPosts = pgTable('telegram_posts', {
  id: uuid('id').primaryKey().defaultRandom(),
  postId: text('post_id').notNull().unique(),
  postText: text('post_text').notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }).notNull(),
  link: text('link').notNull(),
  kind: text('kind').notNull(),
  rawSnapshotRef: text('raw_snapshot_ref'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  publishedAtIdx: index('telegram_posts_published_at_idx').on(table.publishedAt.desc()),
}));

export const incidents = pgTable('incidents', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceId: uuid('source_id').references(() => sources.id).notNull(),
  externalId: text('external_id').unique(),
  sourceUrl: text('source_url'),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  etaAt: timestamp('eta_at', { withTimezone: true }),
  severity: text('severity').notNull().default('medium'),
  status: text('status').notNull().default('active')
});

export const regions = pgTable('regions', {
  cpu: text('cpu').primaryKey(),
  nameUa: text('name_ua').notNull(),
  nameEn: text('name_en'),
  isActive: boolean('is_active').notNull().default(true),
  discoveredAt: timestamp('discovered_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const regionQueues = pgTable('region_queues', {
  cpu: text('cpu').notNull().references(() => regions.cpu, { onDelete: 'cascade' }),
  queue: text('queue').notNull(),
  groupKey: text('group_key').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  pk: primaryKey({ columns: [table.cpu, table.queue] }),
  queueIdx: index('region_queues_queue_idx').on(table.queue),
}));

export const scheduleSlots = pgTable('schedule_slots', {
  id: uuid('id').primaryKey().defaultRandom(),
  region: text('region').notNull().default('chernihivska-oblast'),
  queue: text('queue').notNull(),
  date: date('date', { mode: 'string' }).notNull(), // YYYY-MM-DD (Kyiv local date)
  timeFrom: text('time_from').notNull(),
  timeTo: text('time_to').notNull(),
  stateCode: smallint('state_code').notNull(),
  stateName: text('state_name').notNull(),
  stateColor: text('state_color').notNull(),
  source: text('source').notNull().default('manual'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  uniqueSlot: uniqueIndex('schedule_slots_region_queue_date_time_from_uq').on(table.region, table.queue, table.date, table.timeFrom),
  queueDateIdx: index('schedule_slots_region_queue_date_idx').on(table.region, table.queue, table.date),
}));

export const streetQueues = pgTable('street_queues', {
  region: text('region').notNull().default('chernihivska-oblast'),
  /** Нормализованное имя улицы (см. energy_normalize_address). */
  streetNormalized: text('street_normalized').notNull(),
  /** Отображаемое название улицы (как ввёл пользователь / из seed). */
  streetName: text('street_name').notNull(),
  /** Привязанная очередь, например "3" или "2/2". */
  queue: text('queue').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  pk: primaryKey({ columns: [table.region, table.streetNormalized] }),
  regionQueueIdx: index('street_queues_region_queue_idx').on(table.region, table.queue),
  regionStreetNameIdx: index('street_queues_region_street_name_idx').on(table.region, table.streetName),
}));

/**
 * Привязка адреса к группе ГПВ (миграция 0017): область → НП → улица → дом → черга.
 *
 * Отличие от `street_queues`: здесь есть область и номера домов. На одной улице группы
 * различаются по домам («2/2 до 15-го, 3/2 с 16-го»), поэтому плоский ключ «улица → черга»
 * принципиально не мог ответить на вопрос человека «какая у меня группа».
 *
 * Пустые `settlementName`/`streetName` означают «на весь НП», а `housePattern = '*'` — «на всю
 * улицу». Это осмысленные значения из источника, а не «неизвестно»: пустое в этих полях и
 * отсутствие строки — разные вещи, и UI обязан их различать.
 */
export const addressQueues = pgTable('address_queues', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** cpu области: 'kyiv', 'chernihivska-oblast' и т.п. */
  region: text('region').notNull(),
  settlementName: text('settlement_name').notNull(),
  /** energy_normalize_address(settlementName) — по нему поиск и индексы. */
  settlementNormalized: text('settlement_normalized').notNull(),
  /** '' = группа действует на весь НП целиком. */
  streetName: text('street_name').notNull().default(''),
  streetNormalized: text('street_normalized').notNull().default(''),
  /** '*' = вся улица; иначе «12», «14А», «2, 4, 6А» или «1-19». */
  housePattern: text('house_pattern').notNull().default('*'),
  /** Каноничный код группы: «3» или «2/2». */
  queue: text('queue').notNull(),
  /** Происхождение привязки: 'curated' | 'operator' | 'dtek' | 'manual'. */
  source: text('source').notNull().default('curated'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  // Одна запись на адрес; повторный импорт того же адреса апсертится по этому индексу.
  uniqueAddr: uniqueIndex('address_queues_unique_idx')
    .on(table.region, table.settlementNormalized, table.streetNormalized, table.housePattern),
  regionSettlementIdx: index('address_queues_region_settlement_idx').on(table.region, table.settlementNormalized),
  regionQueueIdx: index('address_queues_region_queue_idx').on(table.region, table.queue),
  settlementTrgmIdx: index('settlement_trgm_idx').using('gin', table.settlementNormalized.op('gin_trgm_ops')),
  streetTrgmIdx: index('street_trgm_idx').using('gin', table.streetNormalized.op('gin_trgm_ops')),
}));

/**
 * Довідник «особовий рахунок → вулица + черга» (міграція 0011). Наповнюється з даних оператора
 * через адмін-маршрут; ПІБ та номери квартир тут не зберігаються.
 */
export const subscriberPlaces = pgTable('subscriber_places', {
  account: text('account').primaryKey(),
  street: text('street').notNull(),
  queue: text('queue').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const gridStatus = pgTable('grid_status', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceId: uuid('source_id').references(() => sources.id).notNull(),
  level: text('level').notNull().default('stable'),
  message: text('message').notNull().default(''),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export const contacts = pgTable('contacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: text('type').notNull(),
  label: text('label').notNull(),
  value: text('value').notNull(),
  region: text('region')
});

export const parseRuns = pgTable('parse_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceId: uuid('source_id').references(() => sources.id).notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  status: text('status').notNull().default('running'),
  recordsFound: integer('records_found').notNull().default(0),
  errorMessage: text('error_message'),
  rawSnapshotRef: text('raw_snapshot_ref')
}, (table) => {
  return {
    sourceStartedIdx: index('parse_runs_source_started_idx').on(table.sourceId, table.startedAt.desc())
  };
});

export const geocodeCache = pgTable('geocode_cache', {
  id: uuid('id').primaryKey().defaultRandom(),
  addressQuery: text('address_query').notNull().unique(),
  lat: doublePrecision('lat').notNull(),
  lon: doublePrecision('lon').notNull(),
  cachedAt: timestamp('cached_at', { withTimezone: true }).notNull().defaultNow()
});

export const sourceRelations = relations(sources, ({ many }) => ({
  outages: many(outages),
  incidents: many(incidents),
  parseRuns: many(parseRuns),
  outageEvents: many(outageEvents)
}));

export const outageEventsRelations = relations(outageEvents, ({ one, many }) => ({
  source: one(sources, { fields: [outageEvents.sourceId], references: [sources.id] }),
  addresses: many(outageEventAddresses)
}));

export const outageEventAddressRelations = relations(outageEventAddresses, ({ one }) => ({
  event: one(outageEvents, { fields: [outageEventAddresses.eventId], references: [outageEvents.id] })
}));

export const outageRelations = relations(outages, ({ one }) => ({
  source: one(sources, { fields: [outages.sourceId], references: [sources.id] })
}));

export const incidentRelations = relations(incidents, ({ one }) => ({
  source: one(sources, { fields: [incidents.sourceId], references: [sources.id] })
}));

export const parseRunRelations = relations(parseRuns, ({ one }) => ({
  source: one(sources, { fields: [parseRuns.sourceId], references: [sources.id] })
}));

/**
 * Довідник населених пунктів (міграція 0015). Наповнюється провайдерами графіків
 * (services/provider-sync.service.ts). Персональних даних немає: лише назви й коди черг.
 */
export const settlements = pgTable('settlements', {
  id: uuid('id').primaryKey().defaultRandom(),
  region: text('region').notNull().default('chernihivska-oblast'),
  /** Назва так, як її показуємо людині («Деснянське», «Новгород-Сіверський»). */
  name: text('name').notNull(),
  /** Нормалізована назва для пошуку й дедуплікації (див. normalizeSettlementName). */
  nameNormalized: text('name_normalized').notNull(),
  /** 'місто' | 'смт' | 'село' або NULL, якщо джерело тип не вказує (не вигадуємо). */
  kind: text('kind'),
  /** Джерело: id провайдера ('esvitlo-cn', 'chernihivoblenergo', 'yasno', 'mirror') або 'manual'. */
  source: text('source').notNull(),
  /** Ідентифікатор у джерелі (напр. cityId довідника оператора). */
  sourceRef: text('source_ref'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  regionNameNormalizedUq: uniqueIndex('settlements_region_name_normalized_uq').on(table.region, table.nameNormalized),
  regionNameIdx: index('settlements_region_name_idx').on(table.region, table.name),
}));

/** Прив'язка «населений пункт → черга (група ГПВ)» з джерелом і часом останньої перевірки. */
export const settlementQueues = pgTable('settlement_queues', {
  region: text('region').notNull().default('chernihivska-oblast'),
  settlementId: uuid('settlement_id').notNull().references(() => settlements.id, { onDelete: 'cascade' }),
  /** Черга у форматі застосунку: '3', '2/2'. */
  queue: text('queue').notNull(),
  /** Джерело прив'язки — без нього не зрозуміло, кому вірити при розбіжностях. */
  source: text('source').notNull(),
  sourceRef: text('source_ref'),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  pk: primaryKey({ columns: [table.settlementId, table.queue, table.source] }),
  regionQueueIdx: index('settlement_queues_region_queue_idx').on(table.region, table.queue),
  settlementIdx: index('settlement_queues_settlement_idx').on(table.settlementId),
}));

/**
 * Новини (міграція 0014): джерела (Telegram-канали, RSS) і самі публікації про відключення
 * та стан енергосистеми. Персональних даних немає — лише публічні пости/стрічки, посилання й текст.
 */
export const newsSources = pgTable('news_sources', {
  sourceKey: text('source_key').primaryKey(),
  kind: text('kind').notNull(),
  baseUrl: text('base_url'),
  regionCpu: text('region_cpu').references(() => regions.cpu, { onDelete: 'set null' }),
  enabled: boolean('enabled').notNull().default(true),
  lastOkAt: timestamp('last_ok_at', { withTimezone: true }),
  lastError: text('last_error'),
  itemsCount: integer('items_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const newsItems = pgTable('news_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceKey: text('source_key').notNull().references(() => newsSources.sourceKey, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  title: text('title').notNull(),
  summary: text('summary'),
  body: text('body'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  regionCpu: text('region_cpu').references(() => regions.cpu, { onDelete: 'set null' }),
  kind: text('kind').notNull(),
  isUkraineWide: boolean('is_ukraine_wide').notNull().default(false),
  tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
  /** URL зображень поста (Telegram-графіки опубліковані картинками); порожньо — текстовий пост. */
  imageUrls: text('image_urls').array().notNull().default(sql`'{}'::text[]`),
  contentHash: text('content_hash').notNull(),
  raw: jsonb('raw'),
}, (table) => ({
  contentSourceUniqueIdx: uniqueIndex('news_items_content_source_uq').on(table.contentHash, table.sourceKey),
  publishedAtIdx: index('news_items_published_at_idx').on(table.publishedAt.desc().nullsLast()),
  regionPublishedIdx: index('news_items_region_published_idx').on(table.regionCpu, table.publishedAt.desc()),
  kindIdx: index('news_items_kind_idx').on(table.kind),
  isUkraineWideIdx: index('news_items_is_ukraine_wide_idx').on(table.isUkraineWide),
  kindChk: check('news_items_kind_check', sql`${table.kind} IN ('outage','schedule-change','repair','emergency','ukraine','other')`),
}));

export const newsSourcesRelations = relations(newsSources, ({ many }) => ({
  items: many(newsItems),
}));

export const newsItemsRelations = relations(newsItems, ({ one }) => ({
  source: one(newsSources, { fields: [newsItems.sourceKey], references: [newsSources.sourceKey] }),
  region: one(regions, { fields: [newsItems.regionCpu], references: [regions.cpu] }),
}));

