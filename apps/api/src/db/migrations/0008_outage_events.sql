-- 0008_outage_events.sql — канонічна модель подій відключень (крок 2 плану
-- skills/outage-data-core/references/migration-plan.md). Тільки додавання: таблиця outage-ів
-- та читачі поки не змінюються (dual-write/switch readers — наступні кроки).
--
-- Rollback (безпечний лише доки читачі ще не використовують ці об'єкти):
--   DROP VIEW IF EXISTS outage_events_v;
--   DROP TABLE IF EXISTS outage_event_addresses;
--   DROP TABLE IF EXISTS outage_events;
--
-- Типи звірено з apps/api/src/db/schema.ts: sources.id — uuid, тому source_id/event_id також uuid;
-- час — timestamptz (UTC); gen_random_uuid() вбудований у PG13+ (див. skills/db-migrations).
-- Ідемпотентно: IF NOT EXISTS / CREATE OR REPLACE.

CREATE TABLE IF NOT EXISTS outage_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id      uuid NOT NULL REFERENCES sources (id),
  event_key      text NOT NULL,                       -- з outageEventKey(): ідентичність події БЕЗ адрес
  category       text NOT NULL,
  reason         text,
  area_name      text,
  starts_at      timestamptz NOT NULL,
  ends_at        timestamptz,                         -- NULL = без дати завершення
  cancelled_at   timestamptz,
  external_id    text,                                -- id оператора, лише для діагностики
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outage_events_category_chk CHECK (category IN ('emergency', 'repair', 'regime', 'planned', 'other')),
  CONSTRAINT outage_events_range_chk CHECK (ends_at IS NULL OR ends_at >= starts_at),
  CONSTRAINT outage_events_identity_uq UNIQUE (source_id, event_key)
);

CREATE INDEX IF NOT EXISTS outage_events_range_idx    ON outage_events (starts_at, ends_at);
CREATE INDEX IF NOT EXISTS outage_events_category_idx ON outage_events (category);
CREATE INDEX IF NOT EXISTS outage_events_area_idx     ON outage_events (area_name);

-- Адреси події: багато рядків на одну подію, більше жодних текстових блобів.
CREATE TABLE IF NOT EXISTS outage_event_addresses (
  event_id            uuid NOT NULL REFERENCES outage_events (id) ON DELETE CASCADE,
  address_raw         text NOT NULL,
  address_normalized  text NOT NULL,                  -- energy_normalize_address(address_raw)
  PRIMARY KEY (event_id, address_normalized)
);

CREATE INDEX IF NOT EXISTS outage_event_addresses_trgm_idx
  ON outage_event_addresses USING gin (address_normalized gin_trgm_ops);

-- Статус обчислюється, а не зберігається (invariant 4 у SKILL.md). В'ю — зручність для SQL-читачів,
-- застосунок може рахувати те саме в TS.
CREATE OR REPLACE VIEW outage_events_v AS
SELECT
  e.*,
  CASE
    WHEN e.cancelled_at IS NOT NULL             THEN 'cancelled'
    WHEN now() < e.starts_at                    THEN 'scheduled'
    WHEN e.ends_at IS NULL OR now() < e.ends_at THEN 'active'
    ELSE 'finished'
  END AS status
FROM outage_events e;
