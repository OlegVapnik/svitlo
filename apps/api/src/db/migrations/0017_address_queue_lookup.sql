-- 0017: привязка адреса к группе ГПВ — «область → населённый пункт → улица → дом → черга».
--
-- Зачем эта таблица, а не доработка street_queues:
--   street_queues отвечала на плохой вопрос «улица → черга» и не знала ни области, ни номера
--   домов. На деле одна улица может иметь разные группы на разных домах (2/2 до 15-го дома,
--   3/2 с 16-го), а соседние улицы могут совпадать по имени в разных селах. Плоский ключ
--   (region, street_normalized) этого не выражает, и поиск своей группы по адресу был невозможен.
--
-- НИКАКИХ выдуманных данных: строки появляются только из проверенных источников (источник
-- оператора, DTEK, ручная выгрузка). Пустой street_normalized означает «группа на всё
-- село целиком» — это осмысленное значение из источника, а не неизвестность.
--
-- Идемпотентность: IF NOT EXISTS во всех DDL, ON CONFLICT при переносе данных — файл можно
-- применять повторно без побочных эффектов.

CREATE TABLE IF NOT EXISTS address_queues (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- cpu области из каталога regions, напр. 'kyiv', 'chernihivska-oblast'.
  region        text NOT NULL,
  -- Название НП так, как его показываем: «м. Київ», «с. Деснянське».
  settlement_name        text NOT NULL,
  -- Нормализованное имя НП (energy_normalize_address) — по нему ищем и строим индексы.
  settlement_normalized  text NOT NULL,
  -- Название улицы; '' = группа действует на всё село целиком (см. комментарий выше).
  street_name            text NOT NULL DEFAULT '',
  street_normalized      text NOT NULL DEFAULT '',
  -- '*' = вся улица; иначе конкретный дом («12», «14А»), список («2, 4, 6А») или
  -- диапазон («1-19»). Разбор паттерна — в services/address-lookup.service.ts
  -- (matchHouseNumber), он обязан совпадать с семантикой здесь.
  house_pattern          text NOT NULL DEFAULT '*',
  -- Каноничный код группы: «3» или «2/2» (тот же формат, что у schedule_slots.queue).
  queue                  text NOT NULL,
  -- Происхождение привязки: без него непонятно, кому верить при конфликте записей.
  source                 text NOT NULL DEFAULT 'curated',
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- Одна запись на адрес. ВАЖНО: здесь НЕТ id в ключе, поэтому перезапись с того же источника
-- делается апсертом по этому индексу, а запись из другого источника с тем же адресом будет
-- конфликтовать — сознательно: при конфликте источников решает приоритет при импорте, а молча
-- перетирать данные оператора записью из выгрузки нельзя.
CREATE UNIQUE INDEX IF NOT EXISTS address_queues_unique_idx
  ON address_queues (region, settlement_normalized, street_normalized, house_pattern);
CREATE INDEX IF NOT EXISTS address_queues_region_settlement_idx
  ON address_queues (region, settlement_normalized);
CREATE INDEX IF NOT EXISTS address_queues_region_queue_idx
  ON address_queues (region, queue);
-- Поиск по подстроке названий НП/улиц: pg_trgm нужен для автодополнения «Сос» → «Соснівка».
CREATE INDEX IF NOT EXISTS address_queues_settlement_trgm_idx
  ON address_queues USING gin (settlement_normalized gin_trgm_ops);
CREATE INDEX IF NOT EXISTS address_queues_street_trgm_idx
  ON address_queues USING gin (street_normalized gin_trgm_ops);

COMMENT ON TABLE address_queues IS
  'Привязка адреса к группе ГПВ. Пустые settlement/street означают «на весь НП», звёздочка в house_pattern — «на всю улицу».';
COMMENT ON COLUMN address_queues.house_pattern IS
  'Закономерования домов: ''*'' = вся улица; ''12'' = дом; ''2, 4, 6А'' = список; ''1-19'' = диапазон.';

-- Перенос уже собранных данных.
--
-- Единственный достоверный источник по с. Деснянское — выгрузка отключений оператора, а в ней
-- указаны улицы и дома, но НЕ коды групп. Поэтому переносим ТОЛЬКО те улицы, у которых в
-- street_queues уже есть подтверждённая привязка к очереди: выдумывать группу нельзя
-- (человеку покажут неверную «его группу»). Пока street_queues пуст, миграция не переносит
-- ничего — и это правильно: отсутствие данных честнее вымышленной привязки.
INSERT INTO address_queues (
  region, settlement_name, settlement_normalized, street_name, street_normalized, house_pattern, queue, source
)
SELECT DISTINCT
  sq.region,
  'с. Деснянське',
  energy_normalize_address('с. Деснянське'),
  a.name_uk,
  a.name_normalized,
  '*',
  sq.queue,
  'operator'
FROM street_queues sq
JOIN addresses a
  ON a.name_normalized = sq.street_normalized
 AND a.type = 'street'
 AND (a.city IS NULL OR a.city = '' OR lower(a.city) LIKE '%деснянськ%')
WHERE sq.region = 'chernihivska-oblast'
  AND sq.queue IS NOT NULL
  AND sq.queue <> ''
ON CONFLICT (region, settlement_normalized, street_normalized, house_pattern) DO NOTHING;