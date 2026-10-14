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

-- Публичные контакты операторов. Перенесены из миграции apps/api 0010_operator_contacts.sql:
-- без них страница «Контакти» в облаке была бы пустой, а это самые нужные телефоны при отключении.
CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  label TEXT NOT NULL,
  value TEXT NOT NULL,
  region TEXT
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
  PRIMARY KEY (region, normalized)
);

CREATE TABLE IF NOT EXISTS directory_streets (
  region TEXT NOT NULL,
  settlement_normalized TEXT NOT NULL,
  name TEXT NOT NULL,
  normalized TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'curated',
  PRIMARY KEY (region, settlement_normalized, normalized)
);

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

-- Контакты: те же 7 публичных каналов, что и в Node-бэкенде. Персональных данных нет.
INSERT OR IGNORE INTO contacts (id, type, label, value, region) VALUES
  ('phone:0800210310',    'phone',    'Кол-центр (безкоштовно по Україні)', '0800210310',                   'Чернігівська область'),
  ('phone:0462772901',    'phone',    'Міський телефон Чернігів',           '0462772901',                   'Чернігів'),
  ('telegram:chernigivoblenergo', 'telegram', 'Telegram-канал з новинами',        'https://t.me/chernigivoblenergo', NULL),
  ('telegram:ChernigivOEbot',     'telegram', 'Telegram-бот для перевірки черги', 'https://t.me/ChernigivOEbot',     NULL),
  ('viber:in_viber',      'viber',    'Viber-бот АТ «Чернігівобленерго»',   'https://chernihivoblenergo.com.ua/in_viber', NULL),
  ('link:site',           'link',     'Офіційний сайт',                     'https://chernihivoblenergo.com.ua', NULL),
  ('link:feedback',       'link',     'Онлайн-звернення споживачів',        'https://chernihivoblenergo.com.ua/feedback_new', NULL);
