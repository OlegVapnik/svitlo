# AGENTS.md — Svitlo (All-Ukraine Power Monitor)

Ты работаешь в монорепо **Svitlo** (`pnpm` workspaces: Fastify 5 + PostgreSQL 16 + Drizzle API, React 19 + Vite 8 + Tailwind v4 PWA, Docker Compose). Масштаб: **вся Украина** (24 области + Киев), закладки групп/адресов, поиск групп по сёлам (`settlements`) и улицам (`street_queues`), каноническое ядро `outage_events`, мульти-парсинг (ОСР, зеркала ГПВ, Telegram, RSS).

## Базовые правила и Экономный режим
1. **Сначала скил:** перед задачей прочитай `skills/agent-discipline/SKILL.md` и профильный скил из таблицы Router. Не открывай лишние файлы.
2. **Честность:** не выдумывай пути, API, версии и графики (`SCHEDULE_DEMO` запрещён). Пустой ответ = честный EmptyState.
3. **Язык:** отвечай на языке пользователя (RU/UA), код — на английском, UI-локализация — только украинская (`uk.json`).
4. **Крупные правки:** заменяй функции и создавай файлы целиком. Если задача >100 правок — остановись на логической границе, закоммить и запиши остаток в `HANDOFF.md`.
5. **Краткость:** вывод команд режь (`| tail -15`). Полный набор тестов гоняй только по просьбе человека; всегда проверяй типы (`tsc --noEmit`).

## Router — какая задача → какой скил читать

| Если задача касается… | Читай скил |
|---|---|
| Любой задачи (обязательный цикл работы и формат отчёта) | `skills/agent-discipline/SKILL.md` |
| БД, миграций, `outage_events`, `settlements`, сёл/улиц, `energy_normalize_address` | `skills/db-migrations/SKILL.md` |
| API роутов, контрактов `@svitlo/shared`, регионов, очередей, закладок, пагинации | `skills/api-endpoint-change/SKILL.md` |
| Парсеров ОСР, зеркал ГПВ, Telegram, RSS/новостей, обхода WAF/Turnstile, кронов | `skills/scraper-adapter-hardening/SKILL.md` |
| React 19, Tailwind v4 (`globals.css`), закладок групп/сёл, графиков, PWA | `skills/frontend-ui-change/SKILL.md` |
| Тестов (unit/integration), `svitlo_test`, схождения цифр (`outage-numbers`), CI | `skills/test-strategy/SKILL.md` |
| Docker, nginx, HTTPS/TLS, бэкапов `pg_dump`, healthchecks, деплоя | `skills/ops-deploy-check/SKILL.md` |
| Секретов, `.env`, токенов, `timingSafeEqual`, защиты от утечек ПД и счетов | `skills/secrets-pii-hygiene/SKILL.md` |

## Permissions — границы полномочий агента

### Часть 1. Разрешено делать БЕЗ вопросов (действуй автономно)
- Читать/править код, конфиги, доки и скилы в репозитории; создавать ветки и коммиты.
- Запускать typecheck (`tsc`), точечные тесты, линтеры, сборку и управлять локальным Docker (`up -d --build`, `logs`, `exec`).
- Создавать новые SQL-миграции (`00XX_*.sql`), накатывать их локально и писать парсеры/провайдеров для новых областей, сёл и улиц.
- Искать и применять обходные пути для получения данных (зеркала, Telegram-каналы, RSS, внутренние API, куки/сессии, headless-браузер).

### Часть 2. Требует ЯВНОГО согласия человека (STOP & ASK)
- **Удаление данных и томов:** `DROP TABLE/COLUMN` на проде, `TRUNCATE`, `docker compose down -v`, удаление `pg_data` или бэкапов.
- **История миграций и git:** изменение уже применённых SQL-миграций, `git push --force`, `git reset --hard` несохранённой работы.
- **Прод и секреты:** деплой на внешний прод-сервер, ротация реальных паролей/токенов, показ или коммит ПД (номеров лицевых счетов).
- **Платные внешние вызовы:** подключение/расход баланса платных CAPTCHA-солверов (`CAPTCHA_SOLVER_API_KEY`), платных прокси и внешних API.

## Финальный чек-лист перед словом «Готово»
```bash
./apps/api/node_modules/.bin/tsc --noEmit && ./apps/web/node_modules/.bin/tsc --noEmit
python3 skills/secrets-pii-hygiene/scripts/scan_secrets.py .
python3 skills/frontend-ui-change/scripts/check_tailwind_tokens.py .   # если менялись стили/UI
```
