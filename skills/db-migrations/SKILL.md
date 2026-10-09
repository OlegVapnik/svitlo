---
name: db-migrations
description: "How to change the PostgreSQL schema in EnergyMonitor safely: SQL migrations in apps/api/src/db/migrations, the custom runner db/migrate.ts, Drizzle schema.ts sync, the energy_normalize_address function, seeds vs migrations, backups and rollback. Use for any new/changed table, column, index, extension, SQL function, or data fix. Триггеры: миграция, новая таблица, колонка, индекс, схема БД, schema.ts, drizzle, seed, unaccent, pg_trgm."
---

# Database migrations (EnergyMonitor)

## How it works here

- Raw SQL files `apps/api/src/db/migrations/000N_name.sql`, applied in name order by the custom runner `db/migrate.ts`.
  Each file runs in a transaction; applied names are recorded in `__energy_migrations`.
- `apps/api/src/db/schema.ts` (Drizzle) is hand-maintained to match. `drizzle-kit generate` exists but is NOT the source of truth.
  Therefore **schema drift is your job to prevent**.
- In Docker the `migrate` service runs `node dist/db/migrate.js`; the Dockerfile copies `.sql` into `dist/db/migrations`.
  If you add a migration you must rebuild the api image: `docker compose up -d --build`.

## Checklist for a schema change

1. Back up: `docker compose exec -T db pg_dump -U energymon -d energymon -Fc > backup_$(date +%F_%H%M).dump` and check the file is not empty.
2. Next number: `ls apps/api/src/db/migrations | sort | tail -3` → create `000(N+1)_<snake_case_topic>.sql`. Never edit an applied migration.
3. Write idempotent SQL: `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `CREATE OR REPLACE VIEW/FUNCTION`.
4. Update `schema.ts` to match, and the shared zod/types in `packages/shared/src/index.ts` if the API shape changes.
5. Test on a throwaway database, twice (idempotency):
   ```bash
   pnpm --filter @energy-monitor/api db:migrate
   pnpm --filter @energy-monitor/api db:migrate   # must be a no-op
   docker compose exec -T db psql -U energymon -d energymon -c '\d <table>'
   ```
6. Typecheck + tests: `bash skills/energymon-onboarding/scripts/verify.sh`.
7. Write the rollback statement as a comment at the top of the file (even if it is "none, data migration").

## Rules

- **Additive first.** Add new tables/columns, switch code, and drop old things in a *later* migration after a release cycle.
- **Destructive statements** (`DROP`, `TRUNCATE`, `DELETE` without a narrow WHERE, `ALTER ... TYPE`) need explicit human approval and a fresh backup.
- **Seeds are not migrations.** Reference data (streets, contacts, sources) belongs in `db/seed.ts` or an admin API. History: `0004` seeded streets and `0005` had to remove personal data that leaked in via seed — do not repeat that. Never put names, phones or account numbers of private people into SQL.
- **Extensions** (`uuid-ossp`, `pg_trgm`, `unaccent`) are created in a migration, not only in `docker/init.sql` (init.sql runs only on an empty volume). Prefer `gen_random_uuid()` (built in since PG13) for new tables.
- **`energy_normalize_address(text)`** is `IMMUTABLE` and is used for stored `name_normalized` and for search.
  Changing it requires: a new migration with `CREATE OR REPLACE FUNCTION`, then recomputation of every column and expression index that depends on it
  (`UPDATE addresses SET name_normalized = energy_normalize_address(name_uk)`, then `REINDEX`). Add a test with real examples
  (`вул. Шевченка`, `ул. Шевченко`, `Шевченка`, `шевченка` must normalise equally). Do not "improve" the translate map casually.
- **Indexes on large tables**: use `CREATE INDEX CONCURRENTLY` outside a transaction only if the runner supports it; otherwise keep tables small or schedule downtime. This DB is small, so plain `CREATE INDEX` is fine.
- **Time columns** are `timestamptz` storing UTC. "Kyiv day" logic uses `at time zone 'Europe/Kyiv'` (see `kyiv-time`).
- **Constraints** (`CHECK`, `UNIQUE`, FK) are preferred to application-side checks; they are the last line of defence for dedupe.

## Drift check (run before finishing)

```bash
# tables/columns in DB vs schema.ts: compare names manually or with drizzle-kit
pnpm --filter @energy-monitor/api exec drizzle-kit introspect   # if configured; otherwise: psql '\d+ <table>' and diff by eye
```
List any difference under "Assumptions / not verified" in your report.

## Definition of done

Migration runs twice cleanly, `schema.ts` matches, types/tests pass, rollback note written, backup exists, and the api image was rebuilt when running in Docker.
