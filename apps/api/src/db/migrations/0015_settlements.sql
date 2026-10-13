-- 0015_settlements.sql — довідник населених пунктів та їхніх черг (ГПВ): «моє село → моя черга».
--
-- Навіщо:
-- ГПВ задається не вулицею, а населеним пунктом + чергою (групою). Людині треба знайти своє село
-- й побачити саме свою чергу незалежно від того, з якого джерела прийшли дані (дзеркало, YASNO,
-- e-svitlo, сайт оператора). Тому з'являється окремий довідник:
--   settlements       — населені пункти (область + назва + тип + джерело),
--   settlement_queues — прив'язка «населений пункт → черга» з джерелом і часом останньої перевірки.
--
-- Безпека та ідемпотентність:
-- 1. `IF NOT EXISTS` для таблиць та індексів — повторний запуск безпечний.
-- 2. Унікальність (region, name_normalized) не дає дублів одного села з різних джерел.
-- 3. Персональних даних немає: лише назви НП та коди черг (жодних рахунків, адрес, ПІБ).
--
-- Rollback:
--   DROP INDEX IF EXISTS settlement_queues_settlement_idx;
--   DROP INDEX IF EXISTS settlement_queues_region_queue_idx;
--   DROP TABLE IF EXISTS settlement_queues;
--   DROP INDEX IF EXISTS settlements_region_name_idx;
--   DROP INDEX IF EXISTS settlements_region_name_normalized_uq;
--   DROP TABLE IF EXISTS settlements;

CREATE TABLE IF NOT EXISTS settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- cpu області з каталогу `regions` (той самий формат, що в schedule_slots/street_queues).
  region text NOT NULL DEFAULT 'chernihivska-oblast',
  -- Назва так, як її варто показати людині («Деснянське», «Новгород-Сіверський»).
  name text NOT NULL,
  -- Нормалізована назва для пошуку й дедуплікації (нижній регістр, без «с.»/«смт», апострофи уніфіковані).
  name_normalized text NOT NULL,
  -- 'місто' | 'смт' | 'село' або NULL, якщо джерело типу не каже (не вигадуємо).
  kind text,
  -- Джерело: id провайдера ('esvitlo-cn', 'chernihivoblenergo', 'yasno', 'mirror') або 'manual'.
  source text NOT NULL,
  -- Ідентифікатор у джерелі (напр. cityId у довіднику оператора), щоб повторно звертатися саме до нього.
  source_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS settlements_region_name_normalized_uq ON settlements (region, name_normalized);
-- Під сортування й вибірку списку населених пунктів області.
CREATE INDEX IF NOT EXISTS settlements_region_name_idx ON settlements (region, name);

CREATE TABLE IF NOT EXISTS settlement_queues (
  region text NOT NULL DEFAULT 'chernihivska-oblast',
  settlement_id uuid NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  -- Черга у форматі застосунку: '3', '2/2' (кома/точка джерела нормалізується на межі парсера).
  queue text NOT NULL,
  -- Джерело прив'язки: без нього неможливо зрозуміти, кому вірити при розбіжностях.
  source text NOT NULL,
  source_ref text,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (settlement_id, queue, source)
);

CREATE INDEX IF NOT EXISTS settlement_queues_region_queue_idx ON settlement_queues (region, queue);
CREATE INDEX IF NOT EXISTS settlement_queues_settlement_idx ON settlement_queues (settlement_id);
