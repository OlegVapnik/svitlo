-- 0016: зображення постів Telegram + популярніші джерела новин.
--
-- Відкат (rollback):
--   ALTER TABLE news_items DROP COLUMN IF EXISTS image_urls;
--   DELETE FROM news_sources WHERE source_key IN
--     ('telegram:suspilnenews','rss:pravda','rss:unian','rss:ukrinform','rss:tsn');
--   INSERT INTO news_sources (source_key, kind, base_url, region_cpu, enabled)
--     VALUES ('rss:0462_ua','rss','https://www.0462.ua/rss','chernihivska-oblast',true);
--
-- Навіщо:
-- 1) Чернігівобленерго публікує графіки відключень КАРТИНКАМИ. Раніше парсер Telegram брав лише
--    текст і пропускав зображення, тому пости-графіки в стрічці виглядали порожніми.
-- 2) rss:0462_ua — не популярне місцеве джерело (стрічка оголошень), і воно віддавало ~380 записів
--    за прогін, витісняючи зі стрічки все про світло. Прибрано за рішенням власника.
-- 3) Додано популярні загальноукраїнські джерела (перевірено живими запитами 11.10.2026).

ALTER TABLE news_items ADD COLUMN IF NOT EXISTS image_urls text[] NOT NULL DEFAULT '{}';

-- Джерело-шум прибираємо разом із його публікаціями (news_items.source_key → ON DELETE CASCADE).
DELETE FROM news_sources WHERE source_key = 'rss:0462_ua';

INSERT INTO news_sources (source_key, kind, base_url, region_cpu, enabled)
VALUES
    ('telegram:suspilnenews', 'telegram', 'https://t.me/s/suspilnenews',           NULL, true),
    ('rss:pravda',    'rss', 'https://www.pravda.com.ua/rss/',                     NULL, true),
    ('rss:unian',     'rss', 'https://rss.unian.net/site/news_ukr.rss',            NULL, true),
    ('rss:ukrinform', 'rss', 'https://www.ukrinform.ua/rss/block-lastnews',        NULL, true),
    ('rss:tsn',       'rss', 'https://tsn.ua/rss/full.rss',                        NULL, true)
ON CONFLICT (source_key) DO NOTHING;
