-- Відкат (rollback):
-- DROP TABLE IF EXISTS news_items CASCADE;
-- DROP TABLE IF EXISTS news_sources CASCADE;

-- Таблиця джерел новин (news_sources)
CREATE TABLE IF NOT EXISTS news_sources (
    source_key text PRIMARY KEY,
    kind text NOT NULL,
    base_url text,
    region_cpu text NULL REFERENCES regions(cpu) ON DELETE SET NULL,
    enabled boolean NOT NULL DEFAULT true,
    last_ok_at timestamptz,
    last_error text,
    items_count integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Таблиця новин про відключення та енергосистему (news_items)
CREATE TABLE IF NOT EXISTS news_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_key text NOT NULL REFERENCES news_sources(source_key) ON DELETE CASCADE,
    url text NOT NULL,
    title text NOT NULL,
    summary text,
    body text,
    published_at timestamptz,
    first_seen_at timestamptz NOT NULL DEFAULT now(),
    region_cpu text NULL REFERENCES regions(cpu) ON DELETE SET NULL,
    kind text NOT NULL CHECK (kind IN ('outage','schedule-change','repair','emergency','ukraine','other')),
    is_ukraine_wide boolean NOT NULL DEFAULT false,
    tags text[] NOT NULL DEFAULT '{}',
    content_hash text NOT NULL,
    raw jsonb,
    CONSTRAINT news_items_content_source_uq UNIQUE (content_hash, source_key)
);

-- Індекси для швидкої фільтрації та сортування
CREATE INDEX IF NOT EXISTS news_items_published_at_idx ON news_items (published_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS news_items_region_published_idx ON news_items (region_cpu, published_at DESC);
CREATE INDEX IF NOT EXISTS news_items_kind_idx ON news_items (kind);
CREATE INDEX IF NOT EXISTS news_items_is_ukraine_wide_idx ON news_items (is_ukraine_wide);

-- Гарантуємо наявність базового регіону перед наповненням джерел (для зовнішнього ключа)
INSERT INTO regions (cpu, name_ua)
VALUES ('chernihivska-oblast', 'Чернігівська область')
ON CONFLICT (cpu) DO NOTHING;

-- Початкові джерела новин, підтверджені живою розвідкою (Фаза 1)
INSERT INTO news_sources (source_key, kind, base_url, region_cpu, enabled)
VALUES
    ('telegram:ukrenergo', 'telegram', 'https://t.me/s/ukrenergo', NULL, true),
    ('telegram:dtek_ua', 'telegram', 'https://t.me/s/dtek_ua', NULL, true),
    ('telegram:chernigivoblenergo', 'telegram', 'https://t.me/s/chernigivoblenergo', 'chernihivska-oblast', true),
    ('rss:epravda', 'rss', 'https://www.epravda.com.ua/rss/news.xml', NULL, true),
    ('rss:cheline', 'rss', 'https://cheline.com.ua/feed', 'chernihivska-oblast', true),
    ('rss:0462_ua', 'rss', 'https://www.0462.ua/rss', 'chernihivska-oblast', true)
ON CONFLICT (source_key) DO NOTHING;
