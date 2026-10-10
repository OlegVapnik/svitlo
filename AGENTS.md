# AGENTS.md — Svitlo (read this first)

You are working in the **Svitlo** repository (PWA for power outages, Chernihiv oblast; Fastify + PostgreSQL API, React + Vite web, pnpm monorepo, Docker Compose).
This file is deliberately short. Detailed procedures live in `skills/<name>/SKILL.md`: **read the matching skill file before you start the task** (open it with your file-reading tool; do not guess its content).

## Экономный режим (по умолчанию)
- Читай только AGENTS.md, agent-discipline и скилы, названные в задаче. Остальные не открывай.
- Во время работы запускай только один нужный тест-файл с --reporter=dot. Полный набор и tsc — один раз перед коммитом.
- Вывод команд обрезай (| tail -15, | head -20). В отчёт — одна строка с итогом проверки.
- Правь крупными блоками: новый файл создавай целиком, функцию заменяй целиком. Не делай серии мелких правок.
- Задача >100 правок: остановись на логической границе, закоммить и напиши в HANDOFF.md что осталось.
- Отчёт: Done / Changed (файлы) / Verified (итог) / Next. Без полных логов.

## Always

1. Read `skills/agent-discipline/SKILL.md` and follow its loop: restate → orient (read before edit) → backup/branch → small plan → small steps → verify with evidence → fixed report.
2. Read `skills/svitlo-onboarding/SKILL.md` (project facts, 15 golden rules, where things live).
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
- Setting `SCHEDULE_DEMO=true` or `rejectUnauthorized:false` anywhere that ships.
- Editing an already applied migration.

## Standard check before saying "done"

```bash
bash skills/svitlo-onboarding/scripts/verify.sh          # typecheck + tests (add --build, --docker as needed)
python3 skills/secrets-pii-hygiene/scripts/scan_secrets.py .
python3 skills/frontend-ui-change/scripts/check_tailwind_tokens.py .   # when web styles changed
```
