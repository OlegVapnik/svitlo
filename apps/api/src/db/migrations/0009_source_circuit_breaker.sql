-- Circuit breaker джерела (skills/scraper-adapter-hardening, §Run-level behaviour).
--
-- Стан живе в БД, а не в пам'яті процесу: контейнер пересоздається при кожному `docker compose up`
-- (і migrate-сервіс їде перед ним), тому in-memory пауза губилася б і планировщик знову почав би
-- стукати в WAF оператора, який щойно нас заблокував.
--
-- consecutive_failures — скільки невдач підряд (успішний повний збір скидає в 0);
-- paused_until        — момент, до якого планувальник пропускає джерело (NULL = не на паузі).
--
-- Ідемпотентно: IF NOT EXISTS — міграцію можна застосувати й до БД, де колонки вже є вручну.
ALTER TABLE sources
  ADD COLUMN IF NOT EXISTS consecutive_failures integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paused_until timestamptz;

COMMENT ON COLUMN sources.consecutive_failures IS
  'Невдач підряд при опитуванні джерела; скидається в 0 після повного успішного збору.';
COMMENT ON COLUMN sources.paused_until IS
  'До цього моменту планувальник пропускає джерело (circuit breaker); NULL = не на паузі.';
