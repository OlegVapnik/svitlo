# EnergyMonitor — all instructions in one file
How to use: the section 'AGENTS' is always active. For each task, apply the matching 'SKILL' section(s). References to `skills/<name>/SKILL.md` mean the section with that name below.

---

# AGENTS

# AGENTS.md — EnergyMonitor (read this first)

You are working in the **EnergyMonitor** repository (PWA for power outages, Chernihiv oblast; Fastify + PostgreSQL API, React + Vite web, pnpm monorepo, Docker Compose).
This file is deliberately short. Detailed procedures live in `skills/<name>/SKILL.md`: **read the matching skill file before you start the task** (open it with your file-reading tool; do not guess its content).

## Always

1. Read `skills/agent-discipline/SKILL.md` and follow its loop: restate → orient (read before edit) → backup/branch → small plan → small steps → verify with evidence → fixed report.
2. Read `skills/energymon-onboarding/SKILL.md` (project facts, 15 golden rules, where things live).
3. Never invent paths, functions, versions or results. Unknown means unknown: say how to find out.
4. Never print or commit secrets, operator raw responses, account numbers.
5. Answer in the user's language (Russian/Ukrainian), keep code identifiers in English.

## Router — which skill for which task

| If the task is about… | Read |
|---|---|
| numbers disagree, dedupe, outage/incident model, categories, stats, reliability | `skills/outage-data-core/SKILL.md` |
| tables, columns, indexes, migrations, seeds, `energy_normalize_address` | `skills/db-migrations/SKILL.md` |
| API routes, response shapes, pagination, admin endpoints, client/hook wiring | `skills/api-endpoint-change/SKILL.md` |
| operator/Telegram parsers, blocked IP, empty data, snapshots, scheduler | `skills/scraper-adapter-hardening/SKILL.md` |
| React pages, Tailwind tokens, transparent/invisible elements, i18n, PWA, charts | `skills/frontend-ui-change/SKILL.md` |
| dates, "today", DST, queue intervals, time zones | `skills/kyiv-time/SKILL.md` |
| tokens, passwords, `.env`, `.gitignore`, account numbers, fixtures, leaks | `skills/secrets-pii-hygiene/SKILL.md` |
| docker, nginx, HTTPS, containers down, backups, production readiness | `skills/ops-deploy-check/SKILL.md` |
| writing/fixing tests, CI | `skills/test-strategy/SKILL.md` |
| "review the project", weak spots, rework plan | `skills/code-audit/SKILL.md` |

If a task spans several rows, read all matching skills (order: discipline → onboarding → domain skills).

## Hard stops (never without explicit approval from the human)

- Running `generate-frontend.js` (overwrites `apps/web`).
- Destructive SQL / `docker compose down -v` / deleting volumes.
- Rotating IPs, spoofing headers or otherwise evading the operator's WAF/ban.
- Setting `SCHEDULE_DEMO=true` or `rejectUnauthorized:false` anywhere that ships.
- Editing an already applied migration.

## Standard check before saying "done"

```bash
bash skills/energymon-onboarding/scripts/verify.sh          # typecheck + tests (add --build, --docker as needed)
python3 skills/secrets-pii-hygiene/scripts/scan_secrets.py .
python3 skills/frontend-ui-change/scripts/check_tailwind_tokens.py .   # when web styles changed
```


---

# SKILL: agent-discipline

When to use: Universal working protocol for ANY task that edits files, runs commands, or makes claims about code, data or servers: read before editing, verify before claiming, small reversible steps, explicit stop conditions, fixed report format. Use at the start of EVERY coding, refactoring, bug-fixing, debugging or analysis task, especially with fast/small models that tend to guess file names, APIs and results. Триггеры: исправь, добавь, переделай, рефакторинг, багфикс, проверь, почини, сделай.

# Agent discipline

Why this exists: the costly failures of coding agents are not "wrong algorithm", they are
(1) editing from a guess instead of from the file, (2) saying "done" without running anything,
(3) wide diffs nobody can review, (4) destructive commands. This protocol removes those four.

## The loop (follow in order, do not skip)

1. **Restate** the task in one sentence and write the *observable* success criterion
   ("`pnpm --filter @energy-monitor/api test` passes and `GET /outages` returns `meta.total == 6`").
   If you cannot state a criterion, ask exactly one clarifying question, then continue.
2. **Orient** before touching anything:
   - list the directory, read every file you will change, read its direct importers/callers;
   - `grep -rn "<symbol>"` for every function/type you will rename or change;
   - never edit a file you have not read in this session;
   - never invent file paths, function names, package versions, CLI flags or env vars.
     Confirm with `ls`, `grep`, `<tool> --help`, `package.json`, lockfile, or the type definitions.
3. **Safety net**:
   - if the repo has git: `git status` must be understood; work on a branch `ai/<topic>`;
   - if there is no git: copy the files you will change to `.ai-backup/<YYYYMMDD-HHMM>/` first.
4. **Plan**: at most 7 bullets, list the files to touch. Choose the *smallest* diff that meets the criterion.
   If the plan touches more than 5 files, or contains any risky action (below), show the plan and wait for approval when a human is present.
5. **Implement in small steps.** After each step run the cheapest relevant check
   (typecheck of the package, the one test file, a `curl`). Fix before moving on.
6. **Verify with evidence**: run the commands and quote the actual output lines.
   Label each claim as one of: `verified` (you ran it), `reasoned` (not run, derived from code), `assumed`.
7. **Report** using the template at the bottom.

## Risky actions: ask first, always

Deleting or overwriting many files; `rm -rf`; `git reset --hard`; `git push --force`; dropping/truncating tables;
destructive migrations; rotating or printing secrets; editing `.env`; running a script you have not read;
calls to third-party production APIs; anything that cannot be undone from the backup/branch.

## Anti-hallucination rules

- Unknown means unknown. Write "unknown — to find out run `<command>`" instead of guessing.
- Numbers, versions, line counts: copy from tool output, never from memory.
- Library APIs: check the installed version (lockfile or `node_modules/<pkg>/package.json`) and read its `.d.ts`
  or docs for the exact signature before using it.
- Do not weaken a test to make it pass. If an assertion is wrong, say why and fix the assertion explicitly.
- Do not silence errors (`any`, `@ts-ignore`, empty `catch`, `|| true`) without a one-line comment explaining why.
- No drive-by refactors. Put them under "Noticed but not changed".
- Do not claim a file exists, a test passes, or a service is running unless you just observed it.

## When something fails

- Same error twice: stop editing. Re-read the full error. Write at least two hypotheses and test the cheapest first.
- The third attempt must use a different approach from the first two.
- After 5 tool calls on one sub-problem without progress, stop and report what you know and what you tried.

## Context hygiene (important for small context windows)

- `grep` first, then read only the relevant line range of big files (>300 lines).
- Keep a running "facts" list of at most 10 lines (paths, decisions, commands that worked) and refer to it.
- Pipe long output through `head`/`tail`/`grep`.

## Report template (always use)

```
Done: <1–2 lines>
Changed: <file> — <why> (one line per file)
Verified: <command> → <result>   (or "not run: <reason>")
Assumptions / not verified:
Noticed but not changed:
Next step (if any):
```

Reply in the user's language. Keep identifiers and code in English, keep domain terms (відключення, черга, ГПВ) as they appear in the code.


---

# SKILL: energymon-onboarding

When to use: Project context and golden rules for the EnergyMonitor repo (PWA for power outages in Chernihiv oblast, Desnianske village): Fastify 5 + Drizzle + PostgreSQL API, React 18 + Vite + Tailwind web, pnpm monorepo, Docker Compose. Read this FIRST for any task inside this repository, even a small one, because it lists forbidden actions, invariants and where each thing lives. Триггеры: EnergyMonitor, відключення, отключения, график, черга, ГПВ, outages, incidents, schedule, /api/v1, apps/api, apps/web, packages/shared.

# EnergyMonitor — onboarding for an AI agent

Read `PROJECT_MAP.md` in the repo root for the full map and `PROJECT_AUDIT.md` for the known problems.
This file is the short version: facts, golden rules, where to look.

## What it is

PWA "EnergyMonitor — Чернігів": shows power outages (planned / emergency / repair), hourly queue schedules
(ГПВ), incident messages, reliability stats and contacts. Real coverage today: village Desnianske
(`CHERNIHIV_CITY_IDS=7422288601`), ~20 curated streets.

| Layer | Tech | Path |
|---|---|---|
| Monorepo | pnpm workspaces | `/package.json`, `/pnpm-workspace.yaml` |
| API | Fastify 5, Drizzle, postgres.js, zod, pino, node-cron | `/apps/api` |
| Web | React 18, Vite 6, TS, Router 7, TanStack Query 5, Tailwind 3, ECharts, Leaflet, i18next | `/apps/web` |
| Shared | zod schemas + TS types, consumed as source | `/packages/shared/src/index.ts` |
| DB | PostgreSQL 16, extensions `uuid-ossp`, `pg_trgm`, `unaccent`, SQL function `energy_normalize_address` | docker service `db` |
| Run | Docker Compose `db → migrate (one-shot) → api + web(nginx)` | `/docker-compose.yml`, `/docker/*` |

## Three entities that people confuse

- **Outage** — a source record (table `outages`): time range, area, addresses, reason, queue, status.
- **Incident** — a feed item: a projection of outages (`kind:'outage'`) plus messages (`kind:'report'`).
- **Schedule (ГПВ)** — `schedule_slots`, `street_queues`; hourly intervals per queue. `schedule-mock.service` = DEMO only.

## Golden rules (violating any of these has already caused bugs)

1. **Never run `generate-frontend.js`.** It overwrites `apps/web` with templates.
2. **There may be no git history.** Check `git status` first. If there is no `.git`, back up before editing (see `agent-discipline`).
3. **Types first**: change `packages/shared/src/index.ts`, then API, then web.
4. **Time**: UTC in DB and API; Kyiv-day math only via the existing helpers. Read `kyiv-time` before touching dates.
5. **`energy_normalize_address()`** may change only through a *new* migration and a recomputation of `name_normalized`.
6. **Do not add new calls to `mergeDuplicateOutages`.** Deduplication belongs at ingest — see `outage-data-core`.
7. **Secrets/PII**: never print, commit or log `ADMIN_TOKEN`, operator raw responses, account numbers (`лицевой счёт`). See `secrets-pii-hygiene`.
8. **Tailwind semantic classes** (`bg-card`, `text-muted-foreground`, …) work only if the token exists in BOTH `globals.css` and `tailwind.config.ts`.
9. **All browser HTTP goes through `apps/web/src/api/client.ts`.** No bare `fetch('/api/v1/…')` in pages.
10. **API envelope**: success `{ data, meta? }`, error `{ error: { code, message, details? } }` via `AppError`.
11. **Imports** in both apps use the `.js` extension on relative paths; web alias `@/` → `apps/web/src`.
12. **Admin routes** (`/api/v1/admin/*`) require `Authorization: Bearer ${ADMIN_TOKEN}`.
13. **Docker**: `x-api-env` in compose overrides `.env`; `VITE_API_BASE_URL` is baked into the web bundle (rebuild web after changing it); after a web rebuild do a hard reload (PWA cache) — do not "fix" that in code.
14. **Demo data is never real data.** Do not ship `SCHEDULE_DEMO=true` to production; anything demo must carry `demo:true` and be shown as such.
15. Rate limit is 100 req/min per IP — check `trustProxy` before load-testing or deploying behind nginx.

## Where to look

| I want to understand… | Look at |
|---|---|
| where data comes from | `apps/api/src/services/parse.service.ts`, `apps/api/src/parsers/chernihiv-web.adapter.ts` |
| why an event is not shown as an emergency | `apps/api/src/services/outage-classification.ts` |
| why the list has fewer rows than the DB | `apps/api/src/services/outage-grouping.ts` (`mergeDuplicateOutages`) |
| "light on/off" and reliability | `power-summary*.ts`, `reliability.ts` |
| empty "My schedule" | `apps/api/src/routes/schedules.ts` (`demo`, `SCHEDULE_DEMO`), table `schedule_slots` |
| the outage timeline chart | `apps/web/src/pages/OutagesPage.tsx` (tab `chart`) → `components/outages/OutageTimeline.tsx` |
| an element without background/border | `components/ui/*`, `styles/globals.css`, `tailwind.config.ts` |
| street → queue | table `street_queues`, `StreetsPage.tsx`, `AddressCombobox.tsx` |

## Commands

```bash
pnpm --filter @energy-monitor/api  lint    # = tsc --noEmit (there is no ESLint yet)
pnpm --filter @energy-monitor/web  lint
pnpm --filter @energy-monitor/api  test    # vitest
pnpm --filter @energy-monitor/web  test
pnpm --filter @energy-monitor/api  db:migrate
docker compose up -d --build && docker compose ps
docker compose logs --tail=200 api web
docker compose exec -T db psql -U energymon -d energymon -c 'select count(*) from outages'
bash skills/energymon-onboarding/scripts/verify.sh      # runs the standard checks and prints a summary
```

## Which skill next

| Task | Skill |
|---|---|
| any edit at all | `agent-discipline` |
| outages / incidents / stats numbers disagree, dedupe, categories | `outage-data-core` |
| new/changed table or migration | `db-migrations` |
| new/changed endpoint | `api-endpoint-change` |
| operator/Telegram parsing | `scraper-adapter-hardening` |
| React, Tailwind, i18n, PWA | `frontend-ui-change` |
| dates, "today", DST, queues by hour | `kyiv-time` |
| tokens, account numbers, `.gitignore`, snapshots | `secrets-pii-hygiene` |
| docker, nginx, HTTPS, restarts, backups | `ops-deploy-check` |
| writing tests | `test-strategy` |
| "review the project / find weak spots" | `code-audit` |


---

# SKILL: outage-data-core

When to use: Rework of the EnergyMonitor data core: one canonical outage EVENT model, deduplication and categorisation at ingest (not at read time), one source for /outages, /incidents, /status, /reliability and /outages/stats, computed status, real pagination. Use whenever numbers in the UI or API disagree (30 vs 6), when touching mergeDuplicateOutages, outage-classification, outageCategory, outages/incidents tables, stats or reliability, or when asked to 'fix the data model / dedupe / categories'. Триггеры: дедупликация, не совпадают цифры, статистика, категория аварии, события, outage_events, склеивание, пагинация.

# Outage data core

## The problem in one paragraph

The same real-world event is stored as many rows (one per address). Deduplication
(`mergeDuplicateOutages`) runs at read time in 4 endpoints but not in `/outages/stats`, so counts differ
(30 raw vs 6 events). Category (emergency/repair/regime) is computed by regexes in two places
(API `outage-classification.ts` and web `outageCategory`). Status is stored (`updateOutageStatuses`) *and*
computed (`outageIncidentState`). Pagination slices the first ≤1000 rows after dedupe, so `meta.total` is wrong
and rows beyond 1000 are silently lost.

## Target model (invariants — do not break them)

1. **One event = one row** in `outage_events`, identified by `(source_id, event_key)`; `event_key` comes from the
   existing `outageEventKey()` (identity of the event *without* addresses).
2. **Addresses live in `outage_event_addresses`** (many per event). Never store address lists as a text blob again.
3. **Category is a column** (`emergency | repair | regime | planned | other`), computed **once at ingest** by the
   server. The web app only displays it. Delete regexes from the web.
4. **Status is computed**, never trusted from storage: `cancelled` if `cancelled_at`, else from `starts_at/ends_at/now`.
5. **Every aggregate reads events**: `/outages`, `/incidents` (projection), `/status`, `/reliability`, `/outages/stats`.
   Time-without-power uses `mergeIntervals` from `power-summary.ts` over event intervals.
6. **Pagination and filters are SQL** (`LIMIT/OFFSET` or cursor, `WHERE`, `ORDER BY starts_at DESC, id`). `meta.total` = `count(*)` of the same filtered set.
7. **Unclassified is visible**: category `other` + a `warn` log with the reason text; never silently dropped.

Full draft DDL: `references/target-schema.sql`. Step-by-step plan, rollback and the acceptance test: `references/migration-plan.md`.
Adapt column types to the real `apps/api/src/db/schema.ts` (check whether ids are `uuid`) before writing a migration.

## Workflow

1. Read, in this order: `outage-grouping.ts`, `outage-classification.ts`, `outage.service.ts`, `incidents.service.ts`,
   `parse.service.ts`, `power-summary.service.ts`, `reliability.ts`, then the matching tests in `tests/services/`.
2. **Write the acceptance test first** (see `test-strategy`, "numbers must match"). It must FAIL on the current code
   (raw 30 vs events 6). Commit/back it up.
3. Add the migration (follow `db-migrations`): new tables only, no destructive change to `outages` yet.
4. Backfill with a **TypeScript script** that calls the real `outageEventKey()` and classification functions
   — never re-implement the key in SQL, the two would drift.
5. Switch ingest (`parse.service.ts`) to write events + addresses (dual-write with the old table for one release).
6. Switch readers one endpoint at a time, running the acceptance test after each switch.
7. Remove `mergeDuplicateOutages` calls, `updateOutageStatuses`, the web `outageCategory`, and the `MAX_ROWS_FOR_GROUPING` cap.
8. Only after a full release cycle with no regressions: drop/rename the old `outages` columns in a separate migration.

## Rules of thumb

- If you feel the need to call `mergeDuplicateOutages` in a new place, the data model is wrong — fix the model instead.
- `GET /outages/:id` must return the whole event with all its addresses.
- The timeline row key is `event.id`, never a label string like `dd.mm · reason` (two events on one day with the same reason would merge).
- Keep `incidents` as a view/mapper over events plus `kind:'report'` messages. Do not write incidents derived from outages into a second table.
- Reliability and "light on/off" must say they are based on **operator-published** outages (unannounced cuts are not counted).

## Definition of done

- The acceptance test passes: `/outages` total, `/outages/stats` sum, `/status` counts and `/reliability` event count agree on the same fixture.
- `grep -rn "mergeDuplicateOutages" apps` returns nothing outside tests/legacy shims.
- `grep -rn "outageCategory" apps/web/src` returns nothing.
- API contract unchanged for the web (or `packages/shared` types updated first and web adjusted).


---

# SKILL: db-migrations

When to use: How to change the PostgreSQL schema in EnergyMonitor safely: SQL migrations in apps/api/src/db/migrations, the custom runner db/migrate.ts, Drizzle schema.ts sync, the energy_normalize_address function, seeds vs migrations, backups and rollback. Use for any new/changed table, column, index, extension, SQL function, or data fix. Триггеры: миграция, новая таблица, колонка, индекс, схема БД, schema.ts, drizzle, seed, unaccent, pg_trgm.

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


---

# SKILL: api-endpoint-change

When to use: Checklist and conventions for adding or changing an HTTP endpoint in the EnergyMonitor Fastify API and wiring it through to the React app: shared zod types, route, service, error envelope, auth, pagination, caching, tests, web client and TanStack hook. Use for any new route, changed response shape, new query parameter, admin endpoint, or when fixing endpoint contracts (fake pagination, ignored params, %2F queue ids). Триггеры: эндпоинт, ручка, роут, /api/v1, параметр запроса, пагинация, ответ API, admin route.

# API endpoint change

Order matters: **shared types → route → service → test → web client → web hook → UI**.
Mirror an existing route file (e.g. `routes/contacts.ts` for a simple GET, `routes/admin.ts` for an authenticated one) instead of inventing a new style: read it first.

## Conventions (this repo)

- Prefix `/api/v1`. Success: `{ "data": … }`, lists add `meta: { page, limit, total, totalPages }`.
  Error: `{ "error": { "code", "message", "details"? } }`, thrown as `AppError(statusCode, 'CODE', 'message')`; `ZodError` becomes 400 `VALIDATION_ERROR` in the global handler.
- Input validated with zod schemas that live in `packages/shared/src/index.ts` and are reused by the web app for types.
- Handlers stay thin: parse → call service → wrap in `{ data }`. SQL and business rules live in `src/services/`.
- Admin routes use the `fastify.authenticate` decorator (Bearer `ADMIN_TOKEN`).
- Relative imports use `.js` extensions. Config comes from `config.ts` only (never read `process.env` elsewhere).
- Register new route files in `server.ts`.

## Checklist

1. **Contract in one sentence**: method, path, params, response, who may call it, expected size, cache TTL.
2. **Shared**: add/adjust the zod schema and the TS type in `packages/shared/src/index.ts`.
3. **Route** (`src/routes/<name>.ts`): `export default async function xRoutes(fastify)`; validate with the shared schema; throw `AppError` for 404/409/…
4. **Service** (`src/services/<name>.service.ts`): pure function(s) taking explicit inputs (`now`, filters), no hidden clock.
5. **Pagination**: real `LIMIT/OFFSET` (or cursor) in SQL, `total` from `count(*) over ()` or a matching count. Never "fetch 1000 then slice".
6. **Parameters**: every documented query parameter must be honoured or removed from the schema (`/outages/stats` currently ignores its arguments — do not copy that).
7. **Identifiers**: do not put `/` in path/query identifiers (queue `2/2` forced a `%2F` workaround). Use `2-2` or `2.2` for new code.
8. **Caching**: data changes every ~30 min. Read endpoints may send `Cache-Control: public, max-age=30` (or ETag); `no-store` only for search suggestions and admin.
9. **Security**: reads are public, writes require Bearer. Never log the token or request bodies of admin routes. Keep the rate limit in mind (100/min/IP; behind nginx `trustProxy` must be on).
10. **Tests** (`apps/api/tests/routes/<name>.test.ts`): happy path, validation error 400, 404, auth 401/403 for admin, pagination edges. Use `fastify.inject`.
11. **Web client**: add a method in `apps/web/src/api/client.ts` (the only place that calls `fetch`), then a hook in `api/queries.ts` with a stable `queryKey` and a sensible `staleTime` (30–60 s for outage data).
12. **Docs**: update the endpoint table in `PROJECT_MAP.md` §5 in the same change.
13. **Verify**: `bash skills/energymon-onboarding/scripts/verify.sh`, then `curl` the endpoint and paste the output.

## Skeleton (shape only — copy the real style from a neighbouring route)

```ts
import type { FastifyInstance } from 'fastify';
import { itemQuerySchema } from '@energy-monitor/shared';
import { AppError } from '../utils/errors.js';
import { listItems } from '../services/item.service.js';

export default async function itemRoutes(fastify: FastifyInstance) {
  fastify.get('/items', async (request) => {
    const query = itemQuerySchema.parse(request.query);          // ZodError → 400 handled globally
    const { rows, total } = await listItems(query, new Date());
    return { data: rows, meta: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
  });

  fastify.get('/items/:id', async (request) => {
    const { id } = request.params as { id: string };
    const item = await getItem(id);
    if (!item) throw new AppError(404, 'NOT_FOUND', 'Item not found');
    return { data: item };
  });
}
```

## Common mistakes

- Changing a response shape without updating `packages/shared` and the web hook → runtime `undefined` in the UI.
- Reading `process.env` in a service → untestable and bypasses the zod config.
- Adding `mergeDuplicateOutages` to a new endpoint (see `outage-data-core`).
- Returning raw DB rows (snake_case, internal columns) instead of the shared type.
- Forgetting the web client path for admin pages: tokens must never be stored in `localStorage`.


---

# SKILL: scraper-adapter-hardening

When to use: Rules and checklist for the EnergyMonitor source adapters (operator chernihivoblenergo web API, Telegram channel/bot, mock): contract tests with scrubbed fixtures, strict validation of external responses, loud failure on format change, rate limiting, backoff and circuit breaker, handling of WAF/IP blocks (without evasion), PII removal before storage. Use for any change in apps/api/src/parsers, parse.service.ts, scheduler, snapshots, or when the source returns errors or empty data. Триггеры: парсер, адаптер, оператор заблокировал, 403, 429, WAF, бан IP, telegram, снапшот, парсинг, list_acc.

# Source adapters: hardening

Context: the main source is an operator endpoint (`GET /power_outages` → `POST /api/list_acc`, types 1,2,6) that is not a public API and sits behind a WAF that has already blocked the IP. Telegram parsing reads public channel pages. Both can change without notice.
Goal: **when the source changes or blocks us, we fail loudly, stop hammering, keep serving the last good data, and tell a human.**

## Hard rules

1. **No block evasion.** Do not add proxy/IP rotation, header spoofing, captcha solving or "try from another IP" logic. If the operator blocks us: stop, back off, record it, and escalate to the project owner (ask the operator for an official data feed or permission). Respect `Retry-After` (`parseRetryAfter` exists).
2. **Low and polite load**: one request chain per parse run, `requestDelayMs` between calls, `PARSE_INTERVAL_MINUTES` ≥ 30, identifiable `User-Agent`. Never parse in a loop on error.
3. **Never store PII.** Responses may contain account numbers and session data. Scrub *before* writing to DB, logs, `rawSnapshot` or fixtures (see `secrets-pii-hygiene`).
4. **TLS verification stays on.** The operator serves an incomplete chain; the fix is `NODE_EXTRA_CA_CERTS` with their CA (already mounted). Never set `rejectUnauthorized: false`.

## Validate the external shape

Every adapter must parse the raw response with a zod schema *at the boundary* (`parseListAccRow` and friends):

- unknown/extra fields → ignore;
- missing required fields or an unexpected top-level shape → throw `SourceFormatError` with the source name, the failing path and a **sanitised** 200-char sample;
- row-level failures: skip the row, count it, and fail the run if more than ~20 % of rows are rejected (a sign of format drift).

## Run-level behaviour (`runParse` / `parse_runs`)

- Record every run: status, `records_found`, `records_rejected`, duration, error message (sanitised).
- Failure of the main source must not stop secondary sources (current behaviour — keep it) **and** must not overwrite good data with an empty result. An empty successful response is suspicious: if the previous run found >0 events and this one found 0, mark the run `suspect` and keep existing data unless the source explicitly says "none".
- Circuit breaker: after 3 consecutive failures, pause the source for an increasing time (30 min → 1 h → 3 h → 6 h) and expose it in `/status` (`dataStale`, `lastError`, `nextAttemptAt`).
- Keep `sources.last_success_at` / `last_error` accurate; they feed monitoring.

## Time and addresses

- Operator times are Kyiv wall-clock; convert with `kyivWallClockToUtc` (see `kyiv-time` for the DST gap/overlap hours).
- Normalise addresses with the shared normaliser; do not invent a second one.
- `event_key` must not depend on the address list (see `outage-data-core`).

## Tests (fixtures are mandatory)

- Keep scrubbed sample payloads under `apps/api/tests/fixtures/<source>/<date>-<case>.json`: normal, empty, one malformed row, changed field name, HTML instead of JSON, 403 page, 429 with `Retry-After`.
- Contract test per fixture: expected `ParseResult` or expected `SourceFormatError`.
- Never commit raw captures; run the scrubber and the scan (`secrets-pii-hygiene/scripts/scan_secrets.py`) first.
- For Telegram: table-driven tests for `classifyTelegramText` with real (public) post texts; new rule ⇒ new case.

## When "the data is empty" — diagnose in this order

1. `select id, started_at, status, records_found, error_message from parse_runs order by started_at desc limit 10;`
2. Is the scheduler on (`ENABLE_SCHEDULER`)? In the current compose it is **off**; data only comes from `POST /admin/parse`.
3. Does `sources.last_error` mention 403/429/timeout (block) or a parse error (format drift)?
4. Is `USE_MOCK_ADAPTER` accidentally true?
5. Only then suspect the frontend.

## Definition of done

Fixtures + contract tests added, PII scan clean, failure paths covered (format drift, block, empty), `parse_runs` shows the new fields, and nothing in the change retries aggressively or bypasses a block.


---

# SKILL: frontend-ui-change

When to use: Conventions and checklist for changing the EnergyMonitor React/Vite/Tailwind PWA (apps/web): Tailwind semantic tokens (bg-card, text-muted-foreground) and the globals.css ↔ tailwind.config.ts mapping, api/client.ts as the single HTTP path, TanStack Query hooks, i18n uk/ru, navigation lists, charts (ECharts), map (Leaflet), PWA/service-worker behaviour, localStorage hooks, accessibility and bundle size. Use for any page/component/style change, 'element has no background/text invisible', empty Contacts page, timeline/graph bugs, language strings. Триггеры: компонент, страница, стили, tailwind, тема, прозрачный фон, перевод, i18n, график, таймлайн, PWA, кэш, Контакти.

# Frontend change (apps/web)

## Before you edit

1. Read the page and every component it renders; read `api/queries.ts` for the data it uses.
2. Run the token check: `python3 skills/frontend-ui-change/scripts/check_tailwind_tokens.py .` — it lists semantic Tailwind classes that will silently generate **no CSS**.
   Missing tokens were the real cause of the transparent address dropdown and are the **first suspect** for "text invisible / no border / no background" (including the empty Contacts page).
3. Check git status / back up (`agent-discipline`).

## Rules

**Styling**
- Use semantic classes (`bg-card`, `border-border`, `text-muted-foreground`, `bg-primary`, …). A new token goes into **both** `styles/globals.css` (light `:root` and `.dark`) **and** `tailwind.config.ts`.
- No inline colours or magic z-index as a workaround for a missing token. Fix the token. If you need `z-60`, add it to `theme.extend.zIndex`, or use `z-50`.
- Test both themes (`class="dark"`) and 360 px width: this is a phone-first PWA used when the lights are out, often with a bad connection and low battery.

**Data**
- Browser HTTP only through `src/api/client.ts` → hooks in `src/api/queries.ts`. No bare `fetch('/api/v1/…')` in pages (HomePage and ScheduleImportPage currently violate this; fix when you touch them).
- Query keys stable and filter-aware; `staleTime` 30–60 s for outage data (the backend refreshes every ~30 min).
- Business rules (category emergency/repair/regime, "is active", reliability) are computed by the **API**. Do not add regexes over reason texts in the UI. Use fields the API returns.
- Never keep `ADMIN_TOKEN` in `localStorage`/`sessionStorage`; admin screens should not be in the public navigation.

**Structure**
- Navigation items live in one array used by both `Sidebar` and `BottomNav` (today they are duplicated — change both, or better, extract `NAV_ITEMS`).
- Prefer `components/ui/Tabs` over hand-made tab switchers (keyboard + `role="tab"`).
- Lists/timelines use the entity **id** as React key and as row identity, never a display label.
- Relative imports keep the `.js` extension; alias `@/` → `src/`.
- Format with Prettier (`.prettierrc`: singleQuote, printWidth 100, trailingComma all, semi). Do not leave one-line "minified" source files.

**i18n**
- User-visible strings via `t('namespace.key')`; add the key to **both** `i18n/uk.json` and `i18n/ru.json`. No new hardcoded Ukrainian in JSX. Namespaces: `nav, status, outages, incidents, contacts, myAddress, common, charts, streets`.
- Server-provided texts (reasons, grid messages) are Ukrainian only; do not pretend they are translated.

**PWA**
- `vite-plugin-pwa`; API uses `NetworkFirst` (5 s timeout). After a rebuild users may see an old bundle: hard reload / `docker compose up -d --force-recreate web`. Never "fix" this in code.
- Always show data freshness (`LastUpdated`, `dataStale`) — stale data presented as live is the worst failure for this product.
- Show `demo:true` data with an unmistakable badge, or better, not at all in production.

**Performance**
- Import ECharts modules from `echarts/core` (tree-shake), lazy-load the map and chart tabs with `React.lazy`. Budget: first-screen JS ≲ 250 KB gzip.

**Accessibility**
- Interactive elements are `button`/`a`; combobox follows the ARIA combobox pattern (`role="combobox"`, `aria-expanded`, `aria-activedescendant`); colour is not the only signal for outage state (add text/icon); touch targets ≥ 44 px.

## Verify

```bash
pnpm --filter @energy-monitor/web lint
pnpm --filter @energy-monitor/web test
python3 skills/frontend-ui-change/scripts/check_tailwind_tokens.py .
pnpm --filter @energy-monitor/web build      # check bundle size in the output
```
Then open the page after a hard reload (Ctrl+Shift+R) in light and dark mode at phone width and describe what you actually saw.

## Known traps in this codebase

- Timeline row labels like `дд.мм · причина` can collide; use `event.id`.
- `useMyQueues.addQueue` supports only `'2/2'`.
- `AddressCombobox` contains inline-colour/z-index workarounds from before the tokens existed; remove them after confirming the tokens work.
- `lib/outage-location.ts` has a hardcoded city-coordinates table: map points are approximate, label them so.


---

# SKILL: kyiv-time

When to use: Correct handling of Europe/Kyiv time in EnergyMonitor: UTC in DB/API, Kyiv-day boundaries, 23h/25h days on DST change, the non-existent and repeated hour, operator HH:MM wall-clock conversion, 'today' in schedules and reliability windows, SQL at time zone. Use for any code or bug involving dates, 'today/tomorrow', day/week/month windows, queue schedule intervals, DST, time zones, or off-by-one-hour/off-by-one-day symptoms. Триггеры: время, часовой пояс, сегодня, завтра, переход на летнее время, сутки, интервал, kyivDayStart, Europe/Kyiv, UTC.

# Kyiv time

## Rules

1. **Store and transmit UTC** (`timestamptz`, ISO strings with `Z`). Convert to Kyiv only to (a) decide which *calendar day/week/month* something belongs to, (b) display, (c) parse operator wall-clock times.
2. **Zone id is `Europe/Kyiv`** (not `Europe/Kiev`, not a fixed `+02:00`/`+03:00` offset). Check that the runtime tzdata knows it (`new Intl.DateTimeFormat('en', {timeZone:'Europe/Kyiv'})` must not throw; Alpine images may need `tzdata`).
3. **Never add `24 * 3600 * 1000` to get "tomorrow"**. A Kyiv day is 24 h only most of the year. Compute day boundaries from the calendar date: start of day D = Kyiv `D 00:00` converted to UTC; end = start of day D+1.
4. **Use the existing helpers** and do not write new ones: API `kyivDayStart` (`power-summary.ts`), `kyivMonthStart`, `mondayKeyOf` (`reliability.ts`); web `kyivDateKey`, `kyivDayStart`, `outageOverlapsKyivDay` (`lib/outage-dates.ts`), `KYIV_TZ` (`lib/date.ts`); SQL `at time zone 'Europe/Kyiv'`. If a helper is wrong, fix it and add a test; do not fork it.
5. **Pass `now` as a parameter** into any function that depends on the current time. Tests inject a fixed instant.
6. "Duration of an outage in a day" = overlap of the interval with `[dayStart, nextDayStart)` in UTC, in minutes. On DST days the denominator is 1380 or 1500 minutes, not 1440 — reliability percentages must use the real day length.
7. Weeks start on **Monday** (`mondayKeyOf`); months start at Kyiv `1st 00:00`.

## DST facts (EU rules, Ukraine follows them)

Transitions happen at 01:00 UTC on the last Sunday of March/October.

| Year | Spring (EET +2 → EEST +3) | Autumn (EEST +3 → EET +2) |
|---|---|---|
| 2026 | Sun **2026-03-29**: 03:00 → 04:00 (local 03:00–03:59 does **not exist**), day = 23 h | Sun **2026-10-25**: 04:00 → 03:00 (local 03:00–03:59 happens **twice**), day = 25 h |
| 2027 | Sun **2027-03-28** | Sun **2027-10-31** |

UTC start of those Kyiv days: 2026-03-29 → `2026-03-28T22:00:00Z`; 2026-10-25 → `2026-10-24T21:00:00Z`.
More verified cases in `references/dst-cases.md`.

## Operator wall-clock strings (`kyivWallClockToUtc`, schedule HH:MM)

- A time inside the spring gap (03:00–03:59 on the transition day) does not exist: map it forward to the first valid instant (04:00 local) and log `warn`.
- A time inside the autumn overlap (03:00–03:59) is ambiguous: choose the **first** occurrence (EEST) unless the source gives an offset, and log `warn`. Decide once, document it in the function, test it.
- Schedule slots `time_from`/`time_to` for a Kyiv date: a slot ending at `24:00` means next day's `00:00`. Intervals crossing midnight must be split per Kyiv day when shown per day.
- Never parse operator strings with `new Date('2026-10-25 03:30')` (engine-local zone, differs between your host `TZ` and the container `TZ=Europe/Kyiv`).

## Typical bugs and where to look

| Symptom | Likely cause |
|---|---|
| Event appears on the previous/next day around midnight | Day key computed in UTC instead of Kyiv |
| One-hour shift only in summer or only in winter | Fixed offset instead of tz database |
| "today" differs between API and UI | UI uses browser zone, API uses Kyiv. Use `Europe/Kyiv` on both for outage logic |
| Reliability >100 % or <0 % on 2026-03-29/10-25 | Denominator fixed at 1440 min |
| Test passes locally, fails in Docker | Host `TZ` differs from container `TZ=Europe/Kyiv`; make tests zone-independent (pass explicit zone/UTC instants) |

## Tests to add whenever you touch time code

- `kyivDayStart` for 2026-03-28, 03-29, 03-30 and 2026-10-24, 10-25, 10-26 returns the UTC instants in `references/dst-cases.md`.
- Interval 2026-10-24T20:00Z → 2026-10-25T05:00Z split over Kyiv days: Kyiv 24 Oct ends at 2026-10-24T21:00Z, so 24 Oct gets 1 h and 25 Oct gets 8 h; the parts must sum to the interval length (9 h).
- A 23 h and a 25 h day both give `reliabilityPct` of 100 for an empty outage list and exactly `100 * (1 - down/dayMinutes)` for a known outage.
- Run the whole test suite twice with different `TZ` env values (`TZ=UTC` and `TZ=America/New_York`): results must be identical.

## Definition of done

No arithmetic on milliseconds for calendar logic, no hand-made offsets, tests for both DST days, and the suite passes under two different host `TZ` values.


---

# SKILL: secrets-pii-hygiene

When to use: Keep secrets and personal data out of the EnergyMonitor repo, logs, DB, snapshots, fixtures and chat: ADMIN_TOKEN, DB passwords, operator raw responses, session cookies, personal account numbers (лицевой/особовий рахунок), phones, names. Includes a scanner script, .gitignore baseline, scrubbing rules for fixtures and snapshots, and an incident procedure. Use before any commit/zip/share, when creating fixtures from real operator responses, when touching snapshots/raw_snapshot_ref/telegram_posts, localStorage of user data, or when a secret may have leaked. Триггеры: токен, пароль, секрет, .env, лицевой счёт, персональные данные, снапшот, утечка, коммит, фикстура.

# Secrets and personal data

## Why it matters here

- Operator responses can contain **personal account numbers** and **session data**.
- `ADMIN_TOKEN` is a single static bearer token that currently may be typed into browser forms and may linger in `/tmp` or shell history.
- A migration (`0005_remove_seed_personal_data`) already had to remove personal data that entered through seeds.
- `useMyAddress` once stored `myAccountNumber` in the user's `localStorage`.
- The repo may have **no git history**: a leak can't be rolled back, only rotated.

## Hard rules

1. Never print, echo, log, paste into chat, or commit: `ADMIN_TOKEN`, DB passwords, cookies, `Authorization` headers, raw operator JSON/HTML, account numbers, phone numbers or names of private people.
2. When you must show a config, mask values: `ADMIN_TOKEN=***`, `postgres://user:***@db:5432/energymon`.
3. Do not read `.env` out loud. If you need to know whether a variable is set: `grep -c '^ADMIN_TOKEN=.' .env` (prints a count, not the value).
4. Real operator payloads never go into tests. Fixtures are **scrubbed copies** (below).
5. New code must not store account numbers anywhere (DB, logs, snapshots, `localStorage`). Drop them at the adapter boundary.
6. Admin token handling in the web UI: never persist it (`localStorage`, `sessionStorage`, cookies, query string). Better: no admin UI in the public build.

## Scan (run before every commit, zip or share)

```bash
python3 skills/secrets-pii-hygiene/scripts/scan_secrets.py .          # report, values masked, exit 1 on findings
python3 skills/secrets-pii-hygiene/scripts/scan_secrets.py . --also /tmp   # also scan temp dirs for leftovers
```
It checks: token/password assignments, bearer headers, private keys, JWTs, DB URLs with passwords, account-number-like numbers near `рахунок/счет/account`, tracked `.env`, and a `.gitignore` baseline. Findings are printed as `file:line  rule  masked-snippet` — the secret itself is never printed.

## `.gitignore` baseline (must contain)

```
.env
.env.*
!.env.example
node_modules/
dist/
.turbo/
nohup.out
snapshots/
operator-samples/
sample-responses/
*.dump
.ai-backup/
```
`.env.example` contains placeholders only (`ADMIN_TOKEN=change-me-long-random`).

## Scrubbing a payload into a fixture

1. Copy the raw capture to a **temporary** directory outside the repo.
2. Replace: account numbers → `000000000`, phones → `+380000000000`, person names → `Іван Іваненко`, cookies/session ids → `SESSION`, tokens → `TOKEN`. Keep structure, field names, and *street names and dates* (they are public and needed for tests).
3. Run the scanner on the fixture folder; it must be clean.
4. Delete the raw capture and shell history lines that contained secrets.

## Storage

- `raw_snapshot_ref` / `snapshots/` / `telegram_posts`: confirm what is stored. If a snapshot can contain PII, either scrub before writing or do not persist it. Add a retention limit (e.g. 7 days).
- Logs: pino redaction for `req.headers.authorization`, `*.token`, `*.password`, `*.cookie`.
- Generate secrets with `openssl rand -base64 48` (admin token) and a different one for the DB password.

## If a secret leaked (act in this order)

1. **Rotate**: new `ADMIN_TOKEN` and DB password in `.env`, then `docker compose up -d --force-recreate api db`-style restart as appropriate (changing the DB password also requires `ALTER USER` inside the DB).
2. Remove the secret from files, shell history, `/tmp`, uploaded archives and chat transcripts you control.
3. Check access logs for use of the old value (`docker compose logs api | grep -c admin`).
4. If personal data (account numbers) was exposed beyond the project owner, tell the owner: they may have notification duties.
5. Add a scanner rule or `.gitignore` entry so it cannot recur.

## Definition of done

Scanner exits 0, `.gitignore` baseline present, no real payloads in tests, nothing sensitive printed in your report.


---

# SKILL: ops-deploy-check

When to use: Deployment and operations checklist for EnergyMonitor (Docker Compose: db, migrate, api, web/nginx): why containers exited (137, Exit 1), HTTPS for the PWA, nginx upstream resolution, restart policies, healthchecks, closing the DB port, trustProxy and the rate limit, env override trap (x-api-env vs .env), scheduler/demo flags, backups, monitoring of stale data. Use for any docker-compose/nginx/Dockerfile/.env change, 'site is down', 'containers stopped', going to production, or setting up a server. Триггеры: docker, compose, nginx, деплой, сервер, контейнер упал, Exited, HTTPS, сертификат, бэкап, прод, порт 5432, restart.

# Ops and deploy check

Run the **diagnosis** first when something is down; run the **production checklist** before exposing the service to the internet.
Back up before changing compose/nginx (`agent-discipline`). Do not print `.env` values.

## 1. Diagnose "containers are stopped"

```bash
docker compose ps -a
docker compose logs --tail=200 api web db
docker inspect -f '{{.Name}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}} err={{.State.Error}}' $(docker compose ps -aq)
docker compose config -q && echo "compose file valid"
docker stats --no-stream            # memory pressure?
```

| Symptom | Meaning | Fix |
|---|---|---|
| `api Exited (137)` | SIGKILL: OOM-killer or host/`docker kill`. `oom=true` confirms OOM | find memory hog (parse run, big query, `MAX_ROWS` array), add `mem_limit`, fix the leak; if `oom=false`, someone/something stopped it (host reboot, `docker compose down`) |
| `web Exited (1)` + log `host not found in upstream "api"` | nginx resolves `api` at startup; api was down | nginx resolver trick (§3) and `depends_on: api: condition: service_healthy` |
| `migrate` non-zero | a migration failed; `api` will not start (by design) | read `docker compose logs migrate`, fix SQL, see `db-migrations` |
| `db Exited (0)` | stopped cleanly (compose down/stop/host shutdown) | `restart: unless-stopped` |
| `ADMIN_TOKEN` error at `up` | compose requires it | set it in `.env` (long random) |

Restart: `docker compose up -d` (images exist) or `docker compose up -d --build` (code changed). After a web rebuild do a hard reload in the browser (PWA cache).

## 2. Traps specific to this project

- `x-api-env` in `docker-compose.yml` **overrides `.env`**. Changing `ENABLE_SCHEDULER` in `.env` does nothing until you edit the compose file. Prefer `${ENABLE_SCHEDULER:-true}` style references so `.env` is the single source.
- Current prod flags are wrong for a live product: `ENABLE_SCHEDULER=false` (data never refreshes), `SCHEDULE_DEMO=true` (fake schedule shown to residents). Target prod: scheduler **on**, demo **off**.
- `VITE_API_BASE_URL` is baked at build time. Use the relative `/api/v1` and let nginx proxy; a `http://localhost:3001/...` value breaks every non-local deployment.
- `migrate` uses `image: energy-monitor-api:latest` — make sure it is the image built in this `up --build`, not a stale tag.
- Toolchain mismatch: host node 26 / pnpm 11 vs image node 22 / pnpm 9.15. Test in the container.
- `docker/init.sql` runs only on an empty volume.

## 3. Production checklist

**Network and exposure**
- [ ] DB not published: remove `5432:5432` (or `127.0.0.1:5432:5432`). Default credentials `energymon/energymon/energymon` replaced by long random ones from `.env`.
- [ ] Only the reverse proxy is public (80/443). `api:3001` is internal, or at least firewalled.
- [ ] HTTPS in front (PWA/service worker requires it outside localhost). Simplest: Caddy (automatic certificates):
  ```
  your.domain.example {
    encode gzip
    reverse_proxy web:80
  }
  ```
  add a `caddy` service publishing 80/443 and remove the `3000:80` publish.
- [ ] Admin endpoints and pages reachable only from trusted places (nginx `allow/deny` or basic auth on `/admin`, and no admin entries in the public UI).
- [ ] Security headers on the web server (`X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, a CSP suited to Leaflet/ECharts), `/docs` (Swagger) restricted or off.
- [ ] CORS: with the relative `/api/v1` the API can restrict `origin` to your domain instead of `*`.

**Behind a proxy: rate limit and client IP**
- [ ] In `server.ts` Fastify created with `trustProxy: true` (or the proxy's CIDR) and nginx/Caddy forwards `X-Forwarded-For`. Otherwise every visitor shares the proxy's IP and the 100 req/min limit applies to **all users together**. Verify: `docker compose logs api | head` should show real client IPs.

**nginx upstream resolution** (prevents Exit 1 when api is down)
```
location /api/ {
  resolver 127.0.0.11 valid=10s ipv6=off;   # Docker's embedded DNS
  set $api_upstream http://api:3001;
  proxy_pass $api_upstream;                  # original URI is passed unchanged
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```

**Compose reliability**
```yaml
api:
  restart: unless-stopped
  mem_limit: 512m
  healthcheck:
    test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:3001/api/v1/health || exit 1"]
    interval: 30s
    timeout: 5s
    retries: 3
web:
  restart: unless-stopped
  depends_on:
    api:
      condition: service_healthy
db:
  restart: unless-stopped
```
Also: run the api as a non-root user (`USER node` in `Dockerfile.api`), pin versions (`.nvmrc`/`engines`/`packageManager`).

**Data freshness and monitoring**
- [ ] Scheduler on; `/status` shows `dataStale=false` after 30–40 minutes.
- [ ] External uptime check (e.g. a free ping service) on a readiness endpoint that returns 503 when `dataStale` is true or the DB is down. `/health` should check the DB (`select 1`); keep liveness and readiness separate.
- [ ] `parse_runs` reviewed: `select started_at,status,records_found,error_message from parse_runs order by started_at desc limit 10;`
- [ ] If the operator blocks us: do not rotate IPs; back off and contact the owner (`scraper-adapter-hardening`).

**Backups**
```bash
# nightly (cron on the host), keep 14 days
docker compose exec -T db pg_dump -U energymon -d energymon -Fc > /backups/energymon_$(date +%F).dump
find /backups -name 'energymon_*.dump' -mtime +14 -delete
# restore test (do it once, for real, on a scratch DB)
docker compose exec -T db pg_restore -U energymon -d energymon_restore_test --clean --if-exists < /backups/energymon_YYYY-MM-DD.dump
```
Manual data (`street_queues`, `schedule_slots`, `contacts`) is the part that cannot be re-fetched.

## Verify after changes

```bash
docker compose up -d --build && docker compose ps          # all Up, db healthy
curl -s localhost:3001/api/v1/health
curl -s localhost:3001/api/v1/status | head -c 300          # check dataStale, powerSummary
curl -s localhost:3000/ | grep -o 'assets/index-[^"]*\.js'  # new bundle hash
```
Report which items of the checklist are done, not done, or unverifiable from where you are.


---

# SKILL: test-strategy

When to use: How to write meaningful tests for EnergyMonitor (vitest): the 'numbers must match' integration test across /outages, /outages/stats, /status, /reliability; Postgres-backed service tests; contract tests with scrubbed fixtures; DST/time tests with an injected clock; route tests with fastify.inject; frontend component tests; a minimal CI pipeline. Use when adding features, fixing bugs (write the failing test first), when coverage of services/routes is requested, or when setting up CI. Триггеры: тест, vitest, покрытие, CI, интеграционный тест, фикстура, GitHub Actions, регрессия, проверить цифры.

# Test strategy

## What exists and what is missing

- Exists: 14 API test files, mostly pure-function tests (parsers, classification, grouping, power-summary, reliability, schedule-normalizer, street-queues) and `routes/health.test.ts`; 1 web test (`outage-location.test.ts`).
- Missing (highest value first): DB-backed service tests, route tests (pagination, filters, auth, 400/404), the cross-endpoint **numbers-must-match** test, parser contract tests with fixtures, DST tests, component tests for `OutageTimeline` / `QueueScheduleBar` / `AddressCombobox`, CI.

## Rules

1. **Bug fix ⇒ failing test first**, then the fix. Show the test failing, then passing.
2. Test behaviour through the public surface (HTTP route or exported service function), not private helpers.
3. No hidden clocks: services take `now`; tests pass a fixed instant (e.g. `2026-10-09T09:00:00Z`).
4. Deterministic: independent of host `TZ`, network, test order. Run the suite twice, once with `TZ=UTC` and once with `TZ=America/New_York`.
5. Fixtures are scrubbed (`secrets-pii-hygiene`) and named by case: `tests/fixtures/<area>/<case>.json`.
6. Never weaken an assertion to go green; if an expectation was wrong, change it explicitly and say why.
7. One logical failure per test, descriptive names: `returns 6 events for 30 address rows`.

## The key test: numbers must match

Build one fixture dataset (6 events over 30 address rows; see `outage-data-core/references/migration-plan.md`), load it into a test database, freeze `now`, then assert that **all endpoints agree**:

```ts
describe('data consistency', () => {
  it('reports the same event count everywhere', async () => {
    const list  = await get('/api/v1/outages?limit=100');
    const stats = await get('/api/v1/outages/stats');
    const rel   = await get('/api/v1/reliability');
    expect(list.meta.total).toBe(6);
    expect(sum(stats.data.byDay.map((d) => d.count))).toBe(6);
    expect(countEventsIn(rel.data.months.at(-1))).toBe(6);
  });
});
```
Today this test fails (30 vs 6): that is the proof the model needs `outage-data-core`.

## DB-backed tests

- Use a real PostgreSQL 16 (Testcontainers `@testcontainers/postgresql`, or a `db_test` service in a compose profile). Do not mock SQL: the bugs are in SQL.
- Per test file: create schema by running the real migrations, truncate tables in `beforeEach`.
- Extensions needed: `pg_trgm`, `unaccent`; the function `energy_normalize_address` comes from the migrations.

## Route tests

```ts
const app = await buildApp({ ...testConfig });              // do not listen on a port
const res = await app.inject({ method: 'GET', url: '/api/v1/outages?limit=2&page=2' });
expect(res.statusCode).toBe(200);
expect(res.json().meta).toMatchObject({ page: 2, limit: 2, total: 6, totalPages: 3 });
```
Always cover: success, validation error → 400 `VALIDATION_ERROR`, unknown id → 404 `NOT_FOUND`, admin route without/with wrong token → 401/403, with token → 2xx.

## Parser contract tests

One test per fixture: normal, empty, one malformed row, renamed field, HTML instead of JSON, 403 page, 429 with `Retry-After`. Assert either the exact `ParseResult` or the exact error class (`scraper-adapter-hardening`).

## Time tests

See `kyiv-time`: both DST days, injected clock, two host `TZ` values.

## Frontend tests (Vitest + Testing Library)

- `OutageTimeline`: two events same day same reason → two rows; keys are ids.
- `QueueScheduleBar`: next-outage text rounds to whole minutes; empty schedule shows the empty state, `demo:true` shows the badge.
- `AddressCombobox`: typing "шев" shows "Шевченка"; keyboard navigation; no result state.
- Mock the API layer (`api/client.ts`) or use MSW; never hit the network.
- One Playwright smoke test later: home → outages → chart tab → my address.

## Minimal CI (GitHub Actions)

```yaml
name: ci
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env: { POSTGRES_USER: energymon, POSTGRES_PASSWORD: ci, POSTGRES_DB: energymon }
        ports: ['5432:5432']
        options: >-
          --health-cmd "pg_isready -U energymon" --health-interval 5s --health-timeout 5s --health-retries 10
    env:
      DATABASE_URL: postgres://energymon:ci@localhost:5432/energymon
      ADMIN_TOKEN: ci-token-not-secret
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9.15.0 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @energy-monitor/api lint
      - run: pnpm --filter @energy-monitor/web lint
      - run: pnpm --filter @energy-monitor/api db:migrate
      - run: pnpm --filter @energy-monitor/api test
      - run: pnpm --filter @energy-monitor/web test
      - run: pnpm --filter @energy-monitor/web build
      - run: python3 skills/secrets-pii-hygiene/scripts/scan_secrets.py .
```
Adjust env names to `config.ts`. Pin action versions you have verified exist when you add this.

## Definition of done

New behaviour has tests that fail without the change, the suite passes twice under different `TZ`, and your report lists the commands and their results.


---

# SKILL: code-audit

When to use: A repeatable method for auditing a codebase or project documentation and producing an honest verdict with prioritised findings, evidence levels and a staged rework plan. Use when asked to review a project, decide whether it is 'good or garbage', find weak spots, estimate rework, prepare a refactoring roadmap, or evaluate AI-generated code. Works with or without access to the source (map-only audits must say so). Триггеры: аудит, ревью проекта, слабые места, оценка качества, с чего начать переделку, технический долг, говно или нет.

# Code audit method

## Principles

1. **Say what you actually saw.** Every finding carries an evidence tag:
   `[fact]` — you read it in code/config/output; `[inference]` — follows logically from what you read; `[verify]` — a hypothesis, name the exact file/command that would confirm it.
   If you only read a description (e.g. `PROJECT_MAP.md`) and not the code, state that at the top.
2. **Verdict first**, in plain words: is it usable, what is its state, rewrite vs. refactor. Then the details.
3. **Be fair**: list what is good and must not be broken. Rewrites are rarely the answer; find the smallest set of changes with the biggest effect.
4. **Priorities**: P0 security / product-does-not-work / data loss; P1 structural problems that cause recurring bugs; P2 maintainability debt; P3 nits.
5. **Actionable**: every finding has a concrete fix, an owner-sized step, and a way to verify it.

## Procedure

1. **Scope**: what is the product, who uses it, what must never break. Read README/map first.
2. **Inventory** (with commands, not memory): `git log --oneline | head`, file counts, dependencies, tests list, CI, Dockerfiles, env files (names only).
3. **Run what you can**: install, typecheck, tests, build, start. Record exact results. If you cannot run anything, say so.
4. **Walk the checklist** below; for each area, read the actual files.
5. **Cross-check numbers**: where two parts of the system compute the same thing, compare them (that is where the real bugs hide).
6. **Write the report** (template below), then re-read it and delete anything you did not verify or tag.

## Checklist

- **Product reality**: does data refresh by itself? is any fake/demo data shown as real? does it work offline/poor network if it should?
- **Data model**: one source of truth per concept? duplicated business rules (server vs client)? derived values stored and recomputed? constraints in the DB?
- **API**: contract matches docs? fake pagination, ignored params, inconsistent identifiers, error format, caching?
- **Security**: exposed ports/default credentials, secrets in repo/logs, auth model, admin UI exposure, CORS, rate limit behind a proxy, input validation, PII.
- **Reliability/ops**: restart policy, health/readiness, monitoring of stale data, backups and a tested restore, HTTPS, resource limits, logs.
- **Time/locale/units**: time zones, DST, languages, currency/number formats.
- **Frontend**: duplicated logic, direct network calls, state handling, a11y, bundle size, error boundaries, offline/PWA behaviour.
- **Tests/process**: test pyramid vs risk, CI, git/history, linting, formatting, toolchain pinning, dependency freshness.
- **External dependencies**: scraping/unofficial APIs (fragility, legal/ToS), third-party quotas.
- **Docs**: accurate? contradictions inside the docs themselves?

## Report template

```
# <Project> audit — <date>
Scope & method: what was read/run; what was NOT (be explicit).
## Verdict (5–8 lines)
## Scores table (area → 0–10 → one-line reason)
## What is good (do not break)
## Findings (P0 → P3): <title> [fact|inference|verify]
   Evidence: <file/command/output>   Impact:   Fix:   Verify by:
## Staged plan: stage → goal → steps → rough effort → exit criterion
## Open decisions for the owner
## What I need to go deeper (files/logs)
```

## Anti-patterns

- Praise or condemnation without evidence; confident claims about code you did not open.
- A 100-item flat list: group, prioritise, cut.
- Recommending a rewrite because the code "feels messy".
- Hiding uncertainty. A short, tagged `[verify]` list is more valuable than invented certainty.
