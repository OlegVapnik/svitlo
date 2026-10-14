-- Схема D1 для Cloudflare Worker.
-- Применяется один раз: ./deploy-cf.sh или `npm run d1:init` в cf-worker/.
-- Все CREATE IF NOT EXISTS — повторный прогон безопасен.

-- Слоты графика: одна строка = одна получасовка отключения для группы и даты.
CREATE TABLE IF NOT EXISTS schedule_slots (
  region TEXT NOT NULL,
  queue TEXT NOT NULL,
  date TEXT NOT NULL,
  time_from TEXT NOT NULL,
  time_to TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'mirror',
  PRIMARY KEY (region, queue, date, time_from)
);

-- Снимок с последнего успешного обхода зеркала.
CREATE TABLE IF NOT EXISTS snapshot_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Публикации операторов из Telegram/RSS.
CREATE TABLE IF NOT EXISTS news (
  id TEXT PRIMARY KEY,
  source_key TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  published_at TEXT,
  first_seen_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_news_published ON news (published_at DESC);
