---
name: secrets-pii-hygiene
description: "Keep secrets and personal data out of the Svitlo repo, logs, DB, snapshots, fixtures and chat: ADMIN_TOKEN, DB passwords, operator raw responses, session cookies, personal account numbers (лицевой/особовий рахунок), phones, names. Includes a scanner script, .gitignore baseline, scrubbing rules for fixtures and snapshots, and an incident procedure. Use before any commit/zip/share, when creating fixtures from real operator responses, when touching snapshots/raw_snapshot_ref/telegram_posts, localStorage of user data, or when a secret may have leaked. Триггеры: токен, пароль, секрет, .env, лицевой счёт, персональные данные, снапшот, утечка, коммит, фикстура."
---

# Secrets and personal data

## Why it matters here

- Operator responses can contain **personal account numbers** and **session data**.
- `ADMIN_TOKEN` is a single static bearer token that currently may be typed into browser forms and may linger in `/tmp` or shell history.
- A migration (`0005_remove_seed_personal_data`) already had to remove personal data that entered through seeds.
- `useMyAddress` once stored `myAccountNumber` in the user's `localStorage`.
- The repo may have **no git history**: a leak can't be rolled back, only rotated.

## Hard rules

1. Never print, echo, log, paste into chat, or commit: `ADMIN_TOKEN`, DB passwords, cookies, `Authorization` headers, raw operator JSON/HTML, account numbers, phone numbers or names of private people.
2. When you must show a config, mask values: `ADMIN_TOKEN=***`, `postgres://user:***@db:5432/svitlo`.
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
Reviewed false positive? Add `scan:allow` in a comment on that line, or list `path` / `path:line` in `.scan-allowlist` (one per line). Code-like values (`z.string().default(`, `authHeader.split(`), phrases like `must-be-dropped` and placeholder numbers (`000000000`) are ignored automatically. Quoted keys (`"password": "…"` in `.vscode/settings.json`, i18n JSON, YAML) are matched the same way as `.env` lines; values that are not ASCII (`"adminToken": "Адмін-токен"`) are treated as translations, not secrets. Never allowlist a value you have not looked at.

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
