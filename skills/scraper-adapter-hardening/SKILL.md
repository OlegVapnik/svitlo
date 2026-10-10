---
name: scraper-adapter-hardening
description: "Rules and checklist for the Svitlo source adapters (operator chernihivoblenergo web API, Telegram channel/bot, mock): contract tests with scrubbed fixtures, strict validation of external responses, loud failure on format change, rate limiting, backoff and circuit breaker, handling of WAF/IP blocks (without evasion), PII removal before storage. Use for any change in apps/api/src/parsers, parse.service.ts, scheduler, snapshots, or when the source returns errors or empty data. Триггеры: парсер, адаптер, оператор заблокировал, 403, 429, WAF, бан IP, telegram, снапшот, парсинг, list_acc."
---

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
