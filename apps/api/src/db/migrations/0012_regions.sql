-- 0012_regions.sql — перехід на мультирегіональність графіків погодинних відключень (ГПВ).
--
-- Навіщо:
-- Дзеркало ГПВ (відкритий фід) віддає одним запитом графіки для всіх областей України.
-- Щоб підтримувати не лише Чернігівську область без дублювання сервісів та баз даних,
-- створюється каталог областей і черг, а таблиця schedule_slots стає мультирегіональною.
--
-- Безпека даних та ідемпотентність:
-- 1. Нова колонка `schedule_slots.region` має DEFAULT 'chernihivska-oblast' і NOT NULL.
--    Усі існуючі слоти в базі автоматично отримують значення 'chernihivska-oblast'.
--    Легасі-імпортери (telegram, оператор, ручний імпорт) продовжують працювати без помилок.
-- 2. Стара унікальність (queue, date, time_from) забороняла різним областям мати однаковий
--    код черги на ту саму дату й час. Новий унікальний індекс включає `region`.
--    Оскільки старі дані вже були унікальними за (queue, date, time_from), колізій при оновленні не виникає.
-- 3. Заміна індексу пошуку (queue, date) на (region, queue, date) оптимізує запити вибірки графіка
--    конкретної області.
--
-- Rollback (безпечний лише за умови, що в базі ще немає слотів інших областей):
--   DROP TABLE IF EXISTS region_queues;
--   DROP TABLE IF EXISTS regions;
--   DROP INDEX IF EXISTS schedule_slots_region_queue_date_idx;
--   DROP INDEX IF EXISTS schedule_slots_region_queue_date_time_from_uq;
--   ALTER TABLE schedule_slots DROP COLUMN IF EXISTS region;
--   CREATE UNIQUE INDEX IF NOT EXISTS schedule_slots_queue_date_time_from_uq ON schedule_slots (queue, date, time_from);
--   CREATE INDEX IF NOT EXISTS schedule_slots_queue_date_idx ON schedule_slots (queue, date);

CREATE TABLE IF NOT EXISTS regions (
  -- `cpu` — стабільний ідентифікатор області з фіда (наприклад, 'chernihivska-oblast', 'kyiv-city').
  -- Слугує ключем у REST API та зовнішніх контрактах.
  cpu           text PRIMARY KEY,
  name_ua       text NOT NULL,
  name_en       text,
  -- Якщо область тимчасово відсутня у фіді (технічні роботи чи зміна формату), прапорець
  -- вимикає її показ, але не видаляє рядки, щоб не порушувати цілісність прив'язаних слотів.
  is_active     boolean NOT NULL DEFAULT true,
  discovered_at timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS region_queues (
  cpu           text NOT NULL REFERENCES regions (cpu) ON DELETE CASCADE,
  -- Формат черги застосунку («1/1», «2/2»), який бачить користувач і очікують клієнти.
  queue         text NOT NULL,
  -- Оригінальний ключ групи з фіда («1.1», «2.2»): зберігаємо для зіставлення під час парсингу.
  group_key     text NOT NULL,
  is_active     boolean NOT NULL DEFAULT true,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cpu, queue)
);

-- Пошук черги без прив'язки до області (наприклад, валідація чи фільтрація).
-- Первинний ключ (cpu, queue) починається з cpu і не підходить для пошуку лише за queue.
CREATE INDEX IF NOT EXISTS region_queues_queue_idx ON region_queues (queue);

-- Додаємо регіон до розкладу. DEFAULT захищає існуючі рядки та джерела без підтримки регіонів.
ALTER TABLE schedule_slots ADD COLUMN IF NOT EXISTS region text NOT NULL DEFAULT 'chernihivska-oblast';

-- Заміна унікального обмеження: старе (queue, date, time_from) блокувало багаторегіональність.
-- Новий індекс (region, queue, date, time_from) дозволяє різним областям мати однакові часові інтервали черг.
ALTER TABLE schedule_slots DROP CONSTRAINT IF EXISTS schedule_slots_queue_date_time_from_uq;
DROP INDEX IF EXISTS schedule_slots_queue_date_time_from_uq;
CREATE UNIQUE INDEX IF NOT EXISTS schedule_slots_region_queue_date_time_from_uq
  ON schedule_slots (region, queue, date, time_from);

-- Заміна пошукового індексу для основного читацького сценарію: «вибірка графіка області по черзі на дату».
DROP INDEX IF EXISTS schedule_slots_queue_date_idx;
CREATE INDEX IF NOT EXISTS schedule_slots_region_queue_date_idx
  ON schedule_slots (region, queue, date);
