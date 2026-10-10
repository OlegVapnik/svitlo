---
name: svitlo-onboarding
description: "Project context and golden rules for the Svitlo repo (PWA for power outages in Chernihiv oblast, Desnianske village): Fastify 5 + Drizzle + PostgreSQL API, React 18 + Vite + Tailwind web, pnpm monorepo, Docker Compose. Read this FIRST for any task inside this repository, even a small one, because it lists forbidden actions, invariants and where each thing lives. Триггеры: Svitlo, відключення, отключения, график, черга, ГПВ, outages, incidents, schedule, /api/v1, apps/api, apps/web, packages/shared."
---

# Svitlo — onboarding for an AI agent

Read `PROJECT_MAP.md` in the repo root for the full map and `PROJECT_AUDIT.md` for the known problems.
This file is the short version: facts, golden rules, where to look.

## What it is

PWA "Svitlo — Чернігів": shows power outages (planned / emergency / repair), hourly queue schedules
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
pnpm --filter @svitlo/api  lint    # = tsc --noEmit (there is no ESLint yet)
pnpm --filter @svitlo/web  lint
pnpm --filter @svitlo/api  test    # vitest
pnpm --filter @svitlo/web  test
pnpm --filter @svitlo/api  db:migrate
docker compose up -d --build && docker compose ps
docker compose logs --tail=200 api web
docker compose exec -T db psql -U energymon -d energymon -c 'select count(*) from outages'
bash skills/svitlo-onboarding/scripts/verify.sh      # runs the standard checks and prints a summary
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
