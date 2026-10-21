-- 0013_street_queues_region.sql — мультирегіональність для довідника прив'язок «вулиця → черга» (street_queues).
--
-- Навіщо:
-- Раніше таблиця street_queues описувала лише Чернігівщину (Деснянське), а первинним ключем
-- було street_normalized. Для підтримки інших областей без конфліктів однакових назв вулиць
-- додається колонка `region`, а первинний ключ розширюється до (region, street_normalized).
--
-- Безпека даних та ідемпотентність:
-- 1. Нова колонка `region` має DEFAULT 'chernihivska-oblast' і NOT NULL. Існуючі рядки
--    автоматично закріплюються за Чернігівською областю.
-- 2. Первинний ключ оновлюється з (street_normalized) до (region, street_normalized), що дозволяє
--    однакові назви вулиць у різних регіонах (наприклад, вул. Шевченка).
-- 3. Додається індекс (region, queue) під частий запит підрахунку прив'язаних вулиць за чергами області.
-- 4. Додається індекс (region, street_name) для вибірки та сортування вулиць певної області.
--
-- Rollback:
--   DROP INDEX IF EXISTS street_queues_region_street_name_idx;
--   DROP INDEX IF EXISTS street_queues_region_queue_idx;
--   ALTER TABLE street_queues DROP CONSTRAINT IF EXISTS street_queues_pkey;
--   ALTER TABLE street_queues ADD CONSTRAINT street_queues_pkey PRIMARY KEY (street_normalized);
--   ALTER TABLE street_queues DROP COLUMN IF EXISTS region;

ALTER TABLE street_queues ADD COLUMN IF NOT EXISTS region text NOT NULL DEFAULT 'chernihivska-oblast';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_name = 'street_queues' AND constraint_name = 'street_queues_pkey'
  ) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.key_column_usage
      WHERE table_name = 'street_queues' AND constraint_name = 'street_queues_pkey' AND column_name = 'region'
    ) THEN
      ALTER TABLE street_queues DROP CONSTRAINT street_queues_pkey;
      ALTER TABLE street_queues ADD CONSTRAINT street_queues_pkey PRIMARY KEY (region, street_normalized);
    END IF;
  ELSE
    ALTER TABLE street_queues ADD CONSTRAINT street_queues_pkey PRIMARY KEY (region, street_normalized);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS street_queues_region_queue_idx ON street_queues (region, queue);
CREATE INDEX IF NOT EXISTS street_queues_region_street_name_idx ON street_queues (region, street_name);
