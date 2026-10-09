-- DRAFT: 0008_outage_events.sql
-- Adapt ids/types to apps/api/src/db/schema.ts before use (e.g. sources.id type).
-- Idempotent on purpose (repo convention: IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS outage_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id      uuid NOT NULL REFERENCES sources (id),
  event_key      text NOT NULL,                       -- from outageEventKey(); identity WITHOUT addresses
  category       text NOT NULL
                 CHECK (category IN ('emergency', 'repair', 'regime', 'planned', 'other')),
  reason         text,
  area_name      text,
  starts_at      timestamptz NOT NULL,
  ends_at        timestamptz,                         -- NULL = open ended
  cancelled_at   timestamptz,
  external_id    text,                                -- operator id if present (diagnostics only)
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outage_events_range_chk CHECK (ends_at IS NULL OR ends_at >= starts_at),
  CONSTRAINT outage_events_identity_uq UNIQUE (source_id, event_key)
);

CREATE INDEX IF NOT EXISTS outage_events_range_idx    ON outage_events (starts_at, ends_at);
CREATE INDEX IF NOT EXISTS outage_events_category_idx ON outage_events (category);
CREATE INDEX IF NOT EXISTS outage_events_area_idx     ON outage_events (area_name);

CREATE TABLE IF NOT EXISTS outage_event_addresses (
  event_id            uuid NOT NULL REFERENCES outage_events (id) ON DELETE CASCADE,
  address_raw         text NOT NULL,
  address_normalized  text NOT NULL,                  -- energy_normalize_address(address_raw)
  PRIMARY KEY (event_id, address_normalized)
);

CREATE INDEX IF NOT EXISTS outage_event_addresses_trgm_idx
  ON outage_event_addresses USING gin (address_normalized gin_trgm_ops);

-- Status is COMPUTED. This view is a convenience for SQL readers; the app may compute the same in TS.
CREATE OR REPLACE VIEW outage_events_v AS
SELECT
  e.*,
  CASE
    WHEN e.cancelled_at IS NOT NULL                    THEN 'cancelled'
    WHEN now() < e.starts_at                           THEN 'scheduled'
    WHEN e.ends_at IS NULL OR now() < e.ends_at        THEN 'active'
    ELSE 'finished'
  END AS status
FROM outage_events e;

-- Example reader: paginated list with a total that matches the filter
-- SELECT e.*, count(*) OVER () AS total
-- FROM outage_events_v e
-- WHERE e.starts_at < $1 AND (e.ends_at IS NULL OR e.ends_at > $2)
-- ORDER BY e.starts_at DESC, e.id
-- LIMIT $3 OFFSET $4;
