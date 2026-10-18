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

-- Индексы под самые частые чтения: слоты области за дату и слоты всех областей за дату.
-- Без них SQLite сканирует всю таблицу на каждый /regions, /status и /sync, а на бесплатном
-- D1 каждая прочитанная строка расходует дневной лимит rows_read.
CREATE INDEX IF NOT EXISTS idx_slots_region_date ON schedule_slots (region, date);
CREATE INDEX IF NOT EXISTS idx_slots_date ON schedule_slots (date);

-- Покрытие ГПВ: одна строка = «на эту дату оператор опубликовал график, и эта очередь в нём есть».
--
-- Зачем отдельная таблица, а не вывод из schedule_slots: в опубликованном ГПВ коды «светло по
-- графику» (1) и «отключение» (2) равноправны, а мы храним только отключения. Без покрытия
-- невозможно отличить «оператор опубликовал график без отключений» от «оператор ничего не
-- публиковал» — и приложение честно, но неверно писало «Немає даних» (Немає даних = нет данных)
-- областям, где график есть, а отключений нет.
CREATE TABLE IF NOT EXISTS schedule_coverage (
  region TEXT NOT NULL,
  date TEXT NOT NULL,
  queue TEXT NOT NULL,
  has_outages INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'mirror',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (region, date, queue)
);

CREATE INDEX IF NOT EXISTS idx_coverage_region_date ON schedule_coverage (region, date);

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

-- Точечные отключения оператора (порядок схемы совпадает с порядком CREATE из воркера).
CREATE TABLE IF NOT EXISTS outage_events (
  external_id TEXT PRIMARY KEY,
  region TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  area_name TEXT NOT NULL,
  addresses_raw TEXT NOT NULL,
  reason TEXT,
  kind TEXT NOT NULL DEFAULT 'repair',
  source_url TEXT,
  fetched_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_outage_events_starts ON outage_events (starts_at DESC);

-- Справочник населённых пунктов оператора: нужные идентификаторы узнаём в рантайме,
-- чтобы вручную не зашивать одно село и не создавать впечатления, что видим всю область.
CREATE TABLE IF NOT EXISTS provider_city_ids (
  provider TEXT NOT NULL,
  city_id TEXT NOT NULL,
  discovered_at TEXT NOT NULL,
  PRIMARY KEY (provider, city_id)
);

-- Географический справочник: НП и улицы, которые мы знаем, но для которых ещё НЕ известна очередь.
--
-- Отдельные таблицы — не избыточность. В `address_queues` лежит привязка «адрес → очередь», и
-- положить туда улицу без номера группы значило бы выдумать этот номер. Справочник позволяет
-- показать человеку его улицу в подсказках и честно сказать, что очередь ещё не зафиксирована.
CREATE TABLE IF NOT EXISTS directory_settlements (
  region TEXT NOT NULL,
  name TEXT NOT NULL,
  normalized TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'curated',
  -- Очередь на весь населённый пункт, если все его улицы относятся к одной группе.
  -- NULL означает «группы разные»: угадывать номер нельзя.
  default_queue TEXT,
  -- Все группы населённого пункта (JSON-массив), чтобы UI показал «тут є 2/1, 2/2».
  queues_json TEXT,
  streets_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (region, normalized)
);

CREATE TABLE IF NOT EXISTS directory_streets (
  region TEXT NOT NULL,
  settlement_normalized TEXT NOT NULL,
  name TEXT NOT NULL,
  normalized TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'curated',
  -- Имя НП как его отдал ОСР: нужно для карточки улицы без второго запроса.
  settlement_name TEXT,
  default_queue TEXT,
  -- Компактная карта «номер дома (или диапазон) → очередь»: {"1":"2/1","61-71":"5/1"}.
  houses_json TEXT,
  PRIMARY KEY (region, settlement_normalized, normalized)
);

-- Точний каталог будинків ОСР. NULL queue означає, що PDF призначає адресу кільком підчергам;
-- будинок лишається доступним у каскаді, але інтерфейс не обирає одну групу навмання.
CREATE TABLE IF NOT EXISTS directory_houses (
  region TEXT NOT NULL,
  settlement_normalized TEXT NOT NULL,
  street_normalized TEXT NOT NULL,
  house_number TEXT NOT NULL,
  house_normalized TEXT NOT NULL,
  queue TEXT,
  source TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (region, settlement_normalized, street_normalized, house_normalized),
  FOREIGN KEY (region, settlement_normalized)
    REFERENCES directory_settlements (region, normalized) ON DELETE CASCADE,
  FOREIGN KEY (region, settlement_normalized, street_normalized)
    REFERENCES directory_streets (region, settlement_normalized, normalized) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_directory_houses_street
  ON directory_houses (region, settlement_normalized, street_normalized, house_number);

-- Привязка адрес → очередь. Совпадает с таблицей в Node-бэкенде (миграция 0017).
-- `house_pattern` = '*' — вся улица; иначе «12», «2, 4, 6А» или «1-19».
CREATE TABLE IF NOT EXISTS address_queues (
  region TEXT NOT NULL,
  settlement_name TEXT NOT NULL,
  settlement_normalized TEXT NOT NULL,
  street_name TEXT NOT NULL DEFAULT '',
  street_normalized TEXT NOT NULL DEFAULT '',
  house_pattern TEXT NOT NULL DEFAULT '*',
  queue TEXT NOT NULL,
  source TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (region, settlement_normalized, street_normalized, house_pattern)
);

CREATE INDEX IF NOT EXISTS idx_aq_settlement ON address_queues (region, settlement_normalized);
CREATE INDEX IF NOT EXISTS idx_aq_queue ON address_queues (region, queue);

-- Голоса жителей за очередь дома. Один человек — один голос на адрес: `voter_hash` считается
-- на воркере из CF-Connecting-IP + User-Agent + clientInstallId, поэтому повторное нажатие
-- меняет собственный голос, а не накручивает счётчик. Официальные записи `address_queues`
-- (`source` не `community`) этими голосами никогда не перезаписываются: кворум нужен только
-- для домов, которых в справочнике оператора нет.
CREATE TABLE IF NOT EXISTS address_queue_votes (
  region TEXT NOT NULL,
  settlement_norm TEXT NOT NULL,
  street_norm TEXT NOT NULL,
  house_norm TEXT NOT NULL,
  voter_hash TEXT NOT NULL,
  queue TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (region, settlement_norm, street_norm, house_norm, voter_hash)
);

-- Справочные данные с. Деснянське: перенесены из apps/api 0004_desnyanske_streets.sql.
-- Идемпотентно (INSERT OR IGNORE по составному первичному ключу) — повторный прогон безопасен.
INSERT OR IGNORE INTO directory_settlements (region, name, normalized, source)
VALUES ('chernihivska-oblast', 'с. Деснянське', 'деснянське', 'curated');

INSERT OR IGNORE INTO directory_streets (region, settlement_normalized, name, normalized, source)
VALUES
  ('chernihivska-oblast', 'деснянське', 'вул. Зарічна',    'зарічна',    'curated'),
  ('chernihivska-oblast', 'деснянське', 'вул. Шевченка',   'шевченка',   'curated'),
  ('chernihivska-oblast', 'деснянське', 'вул. Центральна', 'центральна', 'curated'),
  ('chernihivska-oblast', 'деснянське', 'вул. Миру',       'миру',       'curated'),
  ('chernihivska-oblast', 'деснянське', 'вул. Садова',     'садова',     'curated'),
  ('chernihivska-oblast', 'деснянське', 'вул. Молодіжна',  'молодіжна',  'curated'),
  ('chernihivska-oblast', 'деснянське', 'вул. Лісова',     'лісова',     'curated'),
  ('chernihivska-oblast', 'деснянське', 'вул. Набережна',  'набережна',  'curated'),
  ('chernihivska-oblast', 'деснянське', 'вул. Шкільна',    'шкільна',    'curated'),
  ('chernihivska-oblast', 'деснянське', 'вул. Перемоги',   'перемоги',   'curated'),
  ('chernihivska-oblast', 'деснянське', 'вул. Сонячна',    'сонячна',    'curated'),
  ('chernihivska-oblast', 'деснянське', 'вул. Квіткова',   'квіткова',   'curated'),
  ('chernihivska-oblast', 'деснянське', 'вул. Козацька',   'козацька',   'curated'),
  ('chernihivska-oblast', 'деснянське', 'вул. Нова',       'нова',       'curated'),
  ('chernihivska-oblast', 'деснянське', 'вул. Старий шлях','старий шлях','curated'),
  ('chernihivska-oblast', 'деснянське', 'вул. Польова',    'польова',    'curated'),
  ('chernihivska-oblast', 'деснянське', 'вул. Вишнева',    'вишнева',    'curated'),
  ('chernihivska-oblast', 'деснянське', 'вул. Калинова',    'калинова',    'curated'),
  ('chernihivska-oblast', 'деснянське', 'вул. Паркова',    'паркова',    'curated'),
  ('chernihivska-oblast', 'деснянське', 'вул. Дружби',     'дружби',     'curated');


-- Таблица контактов была создана прежней версией схемы, поэтому CREATE IF NOT EXISTS её не
-- убирает: удаляем явно. Повторный прогон безопасен thanks IF EXISTS.
DROP TABLE IF EXISTS contacts;
