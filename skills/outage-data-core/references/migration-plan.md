# Migration plan: raw `outages` → canonical `outage_events`

Read `SKILL.md` first. This file is the detailed plan, rollback and acceptance test.

## 0. Preconditions

- Backup: `docker compose exec -T db pg_dump -U svitlo -d svitlo -Fc > backup_before_events.dump`
  and verify it is non-empty (`ls -l`). Without git this is your only undo.
- Branch (`git checkout -b ai/outage-events`) or a file backup of everything you will touch.
- Run `bash skills/svitlo-onboarding/scripts/verify.sh` — record the baseline.

## 1. Acceptance test (write FIRST)

Fixture: raw operator rows that describe exactly **6 events** spread over **30 address rows**,
including: two windows on the same day with the same reason ("Заходи обмеження"), one repair on a later day,
one cancelled, one open-ended.

Assertions against the same database:

| Check | Expected |
|---|---|
| `GET /outages?limit=100` `meta.total` | 6 |
| `GET /outages/stats` sum over `byDay` | 6 |
| `GET /status` `activeOutages + scheduledOutages + finished-in-window` consistent with fixture clock | matches |
| `GET /incidents` kind `outage` items (emergency + repair only) | exactly the emergency/repair events |
| `GET /reliability` event count for the month | 6 (regime events counted as downtime windows if they are, per product decision) |
| `GET /outages/:id` for the 5-address event | returns all 5 addresses |
| Page 2 with `limit=2` | rows 3–4, same `total` |

Use a frozen clock (inject `now`) so status is deterministic.

## 2. Schema migration

Add `0008_outage_events.sql` from `references/target-schema.sql`. New tables only. Run it twice locally to prove idempotency.

## 3. Backfill (TypeScript script, not SQL)

```
for each row in outages (stream, ordered by starts_at):
  key      = outageEventKey(row)                 // existing function
  category = classify(row.reason, row.text)      // existing classification, single place
  upsert outage_events on (source_id, event_key)  // merge: min(starts_at), max(ends_at)
  upsert outage_event_addresses (event_id, address_raw, energy_normalize_address(address_raw))
```

Print counts: rows read, events created, addresses created, events per category, `other` count with samples.
A large `other` share means the classification regexes need work — fix them before switching readers.

## 4. Dual write

`parse.service.ts` writes both old and new tables for one release. Add a log line comparing the number of events
derived from the old path (`mergeDuplicateOutages`) and the new table; they must match.

## 5. Switch readers (one per commit)

Order: `/outages` → `/outages/stats` → `/status` → `/reliability` → `/incidents`. Run the acceptance test after each.

## 6. Cleanup

Delete: `mergeDuplicateOutages` usages, `updateOutageStatuses`, `MAX_ROWS_FOR_GROUPING`, web `outageCategory`.
Keep `summarizeAffectedAddresses`/`streetFromAddresses` if still used for display.

## 7. Rollback

Readers are switched one at a time, so rollback = revert the last reader commit. The old table is untouched until step 8.
If the migration itself must be reverted: `DROP VIEW outage_events_v; DROP TABLE outage_event_addresses; DROP TABLE outage_events;`
(safe only before readers depend on them).

## 8. Final migration (separate release)

Drop the obsolete columns/table from `outages` only after one full cycle without incidents and with a fresh backup.
