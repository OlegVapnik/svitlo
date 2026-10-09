import { pgTable, text, boolean, timestamp, uuid, integer, doublePrecision, index, uniqueIndex, date, smallint } from 'drizzle-orm/pg-core';
import { sql, relations } from 'drizzle-orm';

export const sources = pgTable('sources', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  url: text('url').notNull(),
  type: text('type').notNull(),
  isActive: boolean('is_active').default(true),
  lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
  lastError: text('last_error')
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

export const scheduleSlots = pgTable('schedule_slots', {
  id: uuid('id').primaryKey().defaultRandom(),
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
  uniqueSlot: uniqueIndex('schedule_slots_queue_date_time_from_uq').on(table.queue, table.date, table.timeFrom),
  queueDateIdx: index('schedule_slots_queue_date_idx').on(table.queue, table.date),
}));

export const streetQueues = pgTable('street_queues', {
  /** Нормализованное имя улицы (см. energy_normalize_address) — естественный ключ. */
  streetNormalized: text('street_normalized').primaryKey(),
  /** Отображаемое название улицы (как ввёл пользователь / из seed). */
  streetName: text('street_name').notNull(),
  /** Привязанная очередь, например "3" или "2/2". */
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
  parseRuns: many(parseRuns)
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
