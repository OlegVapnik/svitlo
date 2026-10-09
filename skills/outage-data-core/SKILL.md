---
name: outage-data-core
description: "Rework of the EnergyMonitor data core: one canonical outage EVENT model, deduplication and categorisation at ingest (not at read time), one source for /outages, /incidents, /status, /reliability and /outages/stats, computed status, real pagination. Use whenever numbers in the UI or API disagree (30 vs 6), when touching mergeDuplicateOutages, outage-classification, outageCategory, outages/incidents tables, stats or reliability, or when asked to 'fix the data model / dedupe / categories'. Триггеры: дедупликация, не совпадают цифры, статистика, категория аварии, события, outage_events, склеивание, пагинация."
---

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
