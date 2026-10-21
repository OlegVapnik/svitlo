CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
ALTER TABLE outages ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'unknown';
ALTER TABLE outages ADD COLUMN IF NOT EXISTS external_id text;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS external_id text UNIQUE;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS source_url text;
CREATE UNIQUE INDEX IF NOT EXISTS outages_source_external_id_uq ON outages (source, external_id) WHERE external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS telegram_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id text NOT NULL UNIQUE,
  post_text text NOT NULL,
  published_at timestamptz NOT NULL,
  link text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('outage_schedule', 'incident', 'news')),
  raw_snapshot_ref text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS telegram_posts_published_at_idx ON telegram_posts (published_at DESC);

CREATE TABLE IF NOT EXISTS addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('district', 'street', 'settlement')),
  name_uk text NOT NULL,
  name_ru text,
  name_normalized text NOT NULL,
  parent_id uuid REFERENCES addresses(id) ON DELETE SET NULL,
  city text,
  source text NOT NULL DEFAULT 'outage'
);
CREATE INDEX IF NOT EXISTS addresses_name_uk_trgm_idx ON addresses USING gin (name_uk gin_trgm_ops);
CREATE INDEX IF NOT EXISTS addresses_name_normalized_trgm_idx ON addresses USING gin (name_normalized gin_trgm_ops);
CREATE INDEX IF NOT EXISTS addresses_parent_idx ON addresses (parent_id);

CREATE OR REPLACE FUNCTION energy_normalize_address(input text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT trim(regexp_replace(
    translate(lower(unaccent(coalesce(input, ''))), 'ыэёїи', 'иееіі'),
    '^(вулиця|вул\.?|улица|ул\.?|проспект|просп\.?|провулок|пров\.?|переулок|пер\.?)\s+', '', 'i'
  ))
$$;

INSERT INTO addresses (type, name_uk, name_normalized, city, source)
SELECT DISTINCT 'street', s.name, energy_normalize_address(s.name), o.area_name, 'outage'
FROM outages o
CROSS JOIN LATERAL regexp_split_to_table(o.addresses_raw, '[;,\n]+') AS s(name)
WHERE length(trim(s.name)) >= 3
ON CONFLICT DO NOTHING;

