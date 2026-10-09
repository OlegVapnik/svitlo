---
name: test-strategy
description: "How to write meaningful tests for EnergyMonitor (vitest): the 'numbers must match' integration test across /outages, /outages/stats, /status, /reliability; Postgres-backed service tests; contract tests with scrubbed fixtures; DST/time tests with an injected clock; route tests with fastify.inject; frontend component tests; a minimal CI pipeline. Use when adding features, fixing bugs (write the failing test first), when coverage of services/routes is requested, or when setting up CI. Триггеры: тест, vitest, покрытие, CI, интеграционный тест, фикстура, GitHub Actions, регрессия, проверить цифры."
---

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
