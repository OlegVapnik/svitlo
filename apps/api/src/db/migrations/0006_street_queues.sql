-- Пары «улица → очередь» для села Деснянське.
-- Ключ — нормализованное имя улицы (та же функция, что и в addresses).
CREATE TABLE IF NOT EXISTS street_queues (
  street_normalized text PRIMARY KEY,
  street_name text NOT NULL,
  queue text NOT NULL CHECK (queue ~ '^\d+(\/\d+)?$'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
