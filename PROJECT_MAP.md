> Назначение файла: за 5 минут ввести в курс нового разработчика или ИИ-агента.
> Актуальность: проверено по реальному коду на **2026-10-14 (коммит `6cbe3ff`, ветка
> `redesign/wow-ui`)**. `tsc --noEmit` для `api`, `web` и `cf-worker` — **0 ошибок**.

---

## ⚠️ ЧТО ИЗМЕНИЛОСЬ 14.10.2026 (обязательно к прочтению)

За день проект переехал из «ноутбук + Node-бэкенд» в **бесплатное облако Cloudflare**.
Если вы пришли по инструкциям ниже про `docker compose` и Node-бэкенд — они всё ещё
работают, но это теперь **резервный путь**, а не основной.

| Что | Где | Статус |
|---|---|---|
| Worker (API + крон) | `cf-worker/` | **основной раздатчик данных** |
| D1-база | облако, id в `cf-worker/wrangler.toml` | графики, контакты, привязки адресов |
| Статика | Cloudflare Pages, проект `svitlo-ua` | домен `svitlo-ua-4ze.pages.dev` |
| Деплой одной командой | `./deploy-cf.sh` | без GitHub, без CI |
| Живой API | `https://svitlo-api.olegvapnik45.workers.dev/api/v1` | крон каждые 20 минут |

Новые части проекта, которых не было в предыдущей версии файла:
* `cf-worker/` — автономный Worker без Node-зависимостей (Web Fetch + D1 + Cache API).
* `cf-worker/src/settlements-ua.json` — справочник 1853 населённых пунктов, поиск по префиксу в памяти.
* `apps/api/src/services/address-lookup.service.ts` — поиск очереди по адресу (3 уровня).
* `apps/api/src/services/house-number.ts` — сопоставление номеров домов с шаблонами.
* `tools/compare-api-contracts.py` — сверка контрактов ответа воркера с эталоном.
* `tools/gen-settlements-ua.py` — генератор справочника из дампа GeoNames.

Ветка `redesign/wow-ui` содержит незавершённый визуальный редизайн (этапы 1–6 из 8).

---

## 0. TL;DR

PWA-сервис «Svitlo — Чернігів» собирает и показывает **отключения электроэнергии** (плановые/аварийные/ремонтные), **график ГПВ по очередям**, **аварийные сообщения и новости**, **статистику надёжности электроснабжения** и **справочник контактов** для жителей Черниговской обл. (в первую очередь — с. Деснянське Новгород-Северского р-на, с поддержкой многорегиональности и справочника населённых пунктов `settlements`)[cite: 1, 2].

| Слой | Технология | Где |
|---|---|---|
| Монорепо | pnpm workspaces (`apps/*`, `packages/*`) | `/package.json`, `/pnpm-workspace.yaml`[cite: 2] |
| API | Fastify 5 + Drizzle ORM + postgres.js + zod + pino + node-cron + helmet + rate-limit | `/apps/api`[cite: 1, 2] |
| Web | React 18 + Vite 6 + TS + Router 7 + TanStack Query 5 + Tailwind v4 + ECharts + Leaflet + i18next | `/apps/web`[cite: 2] |
| Shared | zod-схемы и TS-типы, без сборки (потребляется как исходники) | `/packages/shared/src/index.ts`[cite: 2] |
| БД | PostgreSQL 16 (расширения `uuid-ossp`, `pg_trgm`, `unaccent` + SQL-функция `energy_normalize_address`) | docker service `db`[cite: 2] |
| Прод-ран | Docker Compose: `db` → `migrate` (one-shot) → `api` + `web` (nginx) | `/docker-compose.yml`, `/docker/*`[cite: 2] |

---

## 1. Быстрый старт

### Путь 1. Облако (основной)

```bash
# Нужен аккаунт Cloudflare и один раз — вход:
npx wrangler login

# Деплой всего: D1 создаётся и подставляется автоматически, схема накатывается,
# воркер публикуется, фронтенд собирается на его адрес и уезжает в Pages.
./deploy-cf.sh
```

Скрипт идемпотентен и сам ищет существующую базу `svitlo` либо создаёт её, если в
`cf-worker/wrangler.toml` ещё стоит заглушка `ЗАМЕНИТЕ_НА_DATABASE_ID`.

### Путь 2. Локально (Node-бэкенд, резервный)

```bash
# 1. Переменные окружения (обязателен ADMIN_TOKEN от 16 символов в production)
cp .env.example .env

# 2. Прод-подобный запуск (сборка образов + миграции + api + nginx)
docker compose up -d --build
docker compose ps

# 3. Проверка
curl -s localhost:3001/api/v1/health      # {"status":"ok"}
curl -s localhost:3001/api/v1/status      # сводка
open http://localhost:3000                # UI (nginx → /usr/share/nginx/html)
open http://localhost:3001/docs           # Swagger UI
```

Локальная разработка и проверка типов[cite: 1, 2]:

```bash
# С установленным pnpm:
pnpm install
pnpm --filter @svitlo/api db:migrate
pnpm --filter @svitlo/api dev      # tsx watch src/server.ts
pnpm --filter @svitlo/web dev      # vite, proxy /api → http://localhost:3001

# Без глобального pnpm (прямой запуск локальных бинарников tsc):
./apps/api/node_modules/.bin/tsc --noEmit
./apps/web/node_modules/.bin/tsc --noEmit
```

| Порт | Сервис |
|---|---|
| `3000` | `web` (nginx, статика + прокси `/api/` → `api:3001`, внутри слушает HTTP 80 без TLS)[cite: 1, 2] |
| `3001` | `api` (Fastify), `/docs` — Swagger[cite: 2] |
| `127.0.0.1:5432` | PostgreSQL (роль/база `svitlo`, закрыт на loopback-интерфейс)[cite: 1, 2] |

> Тулчейн на хосте: node v26, pnpm 11, Docker 29; образы собираются на **node:22-alpine + pnpm 9.15** (`corepack prepare pnpm@9.15.0`)[cite: 2].

---

## 2. Структура репозитория

```text
svitlo/
├─ deploy-cf.sh                # ОСНОВНОЙ ДЕПЛОЙ: D1 → воркер → сборка фронта → Pages, одной командой
├─ cf-worker/                  # Cloudflare Worker: API + крон 20 мин, БЕЗ Node-зависимостей
│  ├─ wrangler.toml            # имя, cron */20, [vars], привязка D1 (database_id)
│  ├─ schema.sql               # схема D1 + справочные данные (контакты, 20 улиц Деснянского)
│  ├─ .wranglerignore          # что НЕ упаковывать в бандл воркера
│  ├─ src/index.ts             # все /api/v1 маршруты, cron-обход зеркала, Telegram-новости
│  ├─ src/address.ts           # нормализация адресов + матчер домов (порт из apps/api)
│  ├─ src/settlements.ts       # поиск по справочнику, бинарный поиск по префиксу
│  ├─ src/settlements-ua.json  # 1853 населённых пункта (GeoNames), 72 КБ
│  ├─ src/chernihiv.ts         # порт парсера chernihiv-web в Worker
│  └─ src/news / telegram      # разбор t.me/s/<канал>
├─ tools/
│  ├─ compare-api-contracts.py # сверка ответов воркера с эталоном (ловит расхождения контрактов)
│  ├─ gen-settlements-ua.py    # пересборка справочника НП из дампа GeoNames
│  ├─ build-android-apk.sh     # APK: сборка фронта + cap sync + gradle в Docker
│  └─ bump-version.sh          # версия X.Y.Z
├─ docker-compose.yml          # db + migrate + api + web, единый x-api-env для api/migrate
├─ docker/
│  ├─ Dockerfile.api           # node:22-alpine, multi-stage (deps→builder→runner), CMD node dist/server.js
│  ├─ Dockerfile.web           # vite build (ARG VITE_API_BASE_URL) → nginx:alpine
│  ├─ nginx.conf               # SPA-fallback try_files, proxy /api/ → api:3001, /assets/ cache 1y immutable + headers
│  ├─ init.sql                 # uuid-ossp + pg_trgm (initdb контейнера БД)
│  ├─ operator-oblenergo-ca.pem# промежуточный+корневой CA оператора → монтируется как /app/apps/api/operator-ca.pem
│  └─ .dockerignore
├─ apps/api/
│  ├─ src/server.ts / app.ts   # bootstrap Fastify: helmet, rate-limit (TRUST_PROXY), CORS_ORIGINS, роуты, кроны
│  ├─ src/config.ts            # env-схема на zod (валидация ADMIN_TOKEN и CHERNIHIV_CITY_IDS)
│  ├─ src/routes/*.ts          # 10 файлов роутов
│  ├─ src/services/*.ts        # бизнес-логика, классификация, группировка, автоимпорт ГПВ, новости, провайдеры
│  ├─ src/parsers/*.ts         # адаптеры источников (chernihiv-web, telegram-channel, telegram-bot, mock)
│  ├─ src/db/{schema,migrate}.ts + migrations/*.sql  # (seed.ts удалён 2026-10-10)
│  ├─ src/plugins/{auth,cors,swagger}.ts
│  ├─ src/utils/{timing-safe,errors,hash,logger}.ts
│  ├─ src/scheduler/cron.ts    # node-cron + jitter (ENABLE_SCHEDULER + setupNewsCollectCron)
│  ├─ tests/**                 # vitest, 20 файлов (16 проходят, 4 интеграционных требуют TEST_DATABASE_URL)
│  └─ vitest.config.ts
├─ apps/web/
│  ├─ src/main.tsx → App.tsx → router.tsx
│  ├─ src/pages/*.tsx          # 8 страниц
│  ├─ src/components/{ui,layout,outages,incidents,status,search,schedule,common}
│  │  └─ layout/nav-items.ts   # публичная навигация отделена от ADMIN_ITEMS (admin:true)
│  ├─ src/api/{client,queries}.ts
│  ├─ src/hooks/*, src/lib/*   # (demo-schedule.ts удалён 2026-10-10; 2 теста: outage-location и source-health)
│  ├─ src/i18n/{config.ts,uk.json,ru.json}
│  ├─ src/styles/globals.css   # Tailwind v4 CSS-first (@theme inline + переменные светлой/тёмной темы)
│  └─ vite.config.ts           # alias @→src, proxy /api, @tailwindcss/vite, vite-plugin-pwa
├─ packages/shared/src/index.ts# общие типы и zod-схемы
└─ .env / .env.example / .gitignore
```

---

## 3. Доменная модель: ключевые сущности

| Сущность | Где живёт | Что это | Кто показывает |
|---|---|---|---|
| **Outage Event (каноническая)** | `outage_events` + `outage_event_addresses` | 1 строка на событие (`event_key` без адресов, `category` CHECK), адреса в отдельной таблице[cite: 1] | Целевой единый слой для всех роутов (в очереди на backfill и переключение чтения)[cite: 1, 2] |
| **Outage (легаси-слой)** | таблица `outages` | широкая запись источника с блобами адресов; дедуп на чтении через `mergeDuplicateOutages`[cite: 1, 2] | `/outages`, `/status`, `/reliability` (с дедупом); `/outages/stats` (пока без дедупа)[cite: 1, 2] |
| **Incident (авария / ремонт)** | `incidents` + проекция из `outages` | единая лента: `kind:'outage'` (аварии и ремонты оператора) и `kind:'report'` (сообщения Telegram/новости)[cite: 1, 2] | `/incidents`, блок на главной, счётчики в `/status`[cite: 2] |
| **Schedule (ГПВ, черги)** | `schedule_slots`, `street_queues` | почасовые интервалы очередей на дату и привязка улиц; демо-синтетики в коде нет (`SCHEDULE_DEMO` удалён)[cite: 1, 2] | `/queues` («Мої черги»), `/streets`, блок на главной[cite: 2] |

---

## 4. Поток данных и автоимпорт

1. **Опрос источников (`runParse` в `parse.service.ts`):** запись в `parse_runs(status='running')`, вызов активных адаптеров (`ChernihivWebAdapter`, `TelegramChannelAdapter`, `MockAdapter`), нормализация адресов и районов (`normalizer.ts`), идемпотентный upsert в БД[cite: 2].
2. **Автоимпорт ГПВ из Telegram:** после основного парса автоматически вызывается `telegram-schedule.service.importTelegramSchedule()`, который читает `telegram_posts` за 14 суток и наполняет `schedule_slots` (`source='telegram'`) без капчи и ПД; ошибка импорта не роняет основной прогон[cite: 2].
3. **Сбор новостей:** работает по отдельному крону `setupNewsCollectCron`[cite: 1].

---

## 5. Безопасность и конфигурация

* **Аутентификация `/admin/*`:** заголовок `Authorization: Bearer ${ADMIN_TOKEN}` проверяется через `utils/timing-safe.ts` (SHA-256 + `timingSafeEqual`)[cite: 1, 2]. В `production` приложение не запустится с дефолтным или коротким (<16 символов) токеном[cite: 1].
* **Сетевая защита:** глобальный CORS выключен по умолчанию (разрешается через `CORS_ORIGINS`), rate-limit 100 req/min настроен с `TRUST_PROXY`-диапазонами, заголовки защиты заданы в `@fastify/helmet` и `nginx.conf`[cite: 1].
* **Гигиена данных:** `.env`, `operator-samples/`, `snapshots/`, `*.docx` и `CAPTCHA_SOLVER_API_KEY` исключены через `.gitignore`[cite: 1, 2].

---

## 6. Чек-лист перед коммитом

```bash
./apps/api/node_modules/.bin/tsc --noEmit                        # 0 ошибок
./apps/web/node_modules/.bin/tsc --noEmit                        # 0 ошибок
python3 skills/frontend-ui-change/scripts/check_tailwind_tokens.py . # проверка токенов Tailwind v4
pnpm --filter @svitlo/api test                                   # тесты API (20 файлов)
pnpm --filter @svitlo/web test                                   # тесты Web (2 файла)
docker compose up -d --build && docker compose ps                # проверка контейнеров
```