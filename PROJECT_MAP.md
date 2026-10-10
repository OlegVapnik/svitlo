# Svitlo — карта проекта (project map)

> Назначение файла: за 5 минут ввести в курс нового разработчика или ИИ-агента.
> Всё, что описано ниже, проверено по коду на коммит-состоянии от 2026-10-09 (репозиторий **без `.git`** — истории нет, аккуратно с необратимыми правками).

---

## 0. TL;DR

PWA-сервис «Svitlo — Чернігів»: собирает и показывает **отключения электроэнергии** (плановые/аварийные/ремонтные), **график ГПВ по очередям**, **аварийные сообщения**, **статистику надёжности электроснабжения** и **справочник контактов** для жителей Черниговской обл. (в первую очередь — с. Деснянське, Новгород-Северский р-н).

| Слой | Технология | Где |
|---|---|---|
| Монорепо | pnpm workspaces (`apps/*`, `packages/*`) | `/package.json`, `/pnpm-workspace.yaml` |
| API | Fastify 5 + Drizzle ORM + postgres.js + zod + pino + node-cron | `/apps/api` |
| Web | React 18 + Vite 6 + TS + Router 7 + TanStack Query 5 + Tailwind 3 + ECharts + Leaflet + i18next | `/apps/web` |
| Shared | zod-схемы и TS-типы, без сборки (потребляется как исходники) | `/packages/shared/src/index.ts` |
| БД | PostgreSQL 16 (расширения `uuid-ossp`, `pg_trgm`, `unaccent` + SQL-функция `energy_normalize_address`) | docker service `db` |
| Прод-ран | Docker Compose: `db` → `migrate` (one-shot) → `api` + `web` (nginx) | `/docker-compose.yml`, `/docker/*` |

Объём кода: ~6 850 строк в `apps/api/src` + `apps/web/src` + `packages/shared/src` (48 ts в API, 14 ts + 45 tsx в web).

---

## 1. Быстрый старт

```bash
# 1. Переменные окружения (обязательно: ADMIN_TOKEN, иначе compose не стартует)
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

Локальная разработка без Docker:

```bash
pnpm install
pnpm --filter @svitlo/api dev      # tsx watch src/server.ts  (нужна доступная БД по DATABASE_URL)
pnpm --filter @svitlo/api db:migrate
pnpm --filter @svitlo/web dev      # vite, proxy /api → http://localhost:3001
```

| Порт | Сервис |
|---|---|
| 3000 | web (nginx, статика + прокси `/api/` → `api:3001`) |
| 3001 | API (Fastify), `/docs` — Swagger |
| 5432 | PostgreSQL (роль/база `svitlo`, пароль `energymon`, только 127.0.0.1) |

> Локальный тулчейн в этой машине: node v26, pnpm 11, Docker 29. Образы собираются на **node:22-alpine + pnpm 9.15**, т.е. версии в контейнере и на хосте расходятся — не удивляйтесь разному поведению.

---

## 2. Структура репозитория

```
svitlo/
├─ docker-compose.yml          # db + migrate + api + web, единый x-api-env для api/migrate
├─ docker/
│  ├─ Dockerfile.api           # node:22-alpine, multi-stage (deps→builder→runner), CMD node dist/server.js
│  ├─ Dockerfile.web           # vite build (ARG VITE_API_BASE_URL) → nginx:alpine
│  ├─ nginx.conf               # SPA-fallback try_files, proxy /api/ → api:3001, /assets/ cache 1y immutable
│  ├─ init.sql                 # uuid-ossp + pg_trgm (initdb контейнера БД)
│  ├─ operator-oblenergo-ca.pem# промежуточный+корневой CA оператора → монтируется как /app/apps/api/operator-ca.pem
│  └─ .dockerignore
├─ apps/api/
│  ├─ src/server.ts            # bootstrap Fastify: плагины + роуты + опциональный scheduler
│  ├─ src/config.ts            # env-схема на zod (единственный источник настроек)
│  ├─ src/routes/*.ts          # 10 файлов роутов (см. §5)
│  ├─ src/services/*.ts        # бизнес-логика (см. §7)
│  ├─ src/parsers/*.ts         # адаптеры источников (см. §7)
│  ├─ src/db/{schema,migrate,seed}.ts + migrations/*.sql
│  ├─ src/plugins/{auth,cors,swagger}.ts
│  ├─ src/scheduler/cron.ts    # node-cron + jitter (по умолчанию выключен)
│  ├─ tests/**                 # vitest, 14 файлов
│  ├─ operator-ca.pem          # CA оператора (в репе, докладывается в образ)
│  └─ vitest.config.ts         # environment: node, include tests/**/*.test.ts
├─ apps/web/
│  ├─ src/main.tsx → App.tsx → router.tsx
│  ├─ src/pages/*.tsx          # 8 страниц (см. §8)
│  ├─ src/components/{ui,layout,outages,incidents,status,search,schedule,common}
│  ├─ src/api/{client,queries}.ts
│  ├─ src/hooks/*, src/lib/*, src/i18n/{config.ts,uk.json,ru.json}
│  ├─ src/styles/globals.css   # Tailwind v4 CSS-first: @theme-токены + переменные светлой/тёмной темы
│  ├─ vite.config.ts           # alias @→src, proxy /api, vite-plugin-pwa
│  └─ public/{icons/icon.svg}   ← манифест генерирует vite-plugin-pwa (manifest.webmanifest)
├─ packages/shared/src/index.ts# типы + zod-схемы (Outage, Incident, OutageStats, ReliabilityReport, …)
├─ generate-frontend.js        # LEGACY-генератор файлов (Windows-путь, не запускать) — см. §12
├─ .env / .env.example
└─ .vscode/settings.json
```

---

## 3. Домен: три сущности, которые легко перепутать

| Сущность | Где живёт | Что это | Кто показывает |
|---|---|---|---|
| **Outage** (відключення) | таблица `outages` | запись источника: `starts_at…ends_at`, район, адреса, причина, `queue`, `status` | `/outages` (список, календарь, теплокарта, диаграммы, **график**), `/status`, `/reliability` |
| **Incident** (аварія / ремонт) | таблица `incidents` + проекция из `outages` | единая лента: `kind:'outage'` (аварийные/ремонтные отключения оператора) и `kind:'report'` (сообщения Telegram/новости) | `/incidents`, блок на главной, счётчики в `/status` |
| **Schedule** (ГПВ, черги) | `schedule_slots` (реальные), `street_queues` (улица→очередь) | почасовые интервалы очередей на дату; синтетики в коде нет (пусто = пусто) | `/queues` («Мої черги»), `/streets`, герой «є світло / немає» на главной |

Классификация отключений — `apps/api/src/services/outage-classification.ts` (регулярки по тексту):

- `isRegimeNotice(text)` — «заходи обмеження» / ГПВ: **не** авария → выпадает из `/incidents`, но остаётся в `outages` и попадает в график.
- `isOutageIncident(reason)` — аварийные (тип 2) → карточка `kind:'outage'`.
- `isRepairIncident(reason)` — «виконання ремонтних робіт», «технічне обслуговування» → карточка ремонта.
- `shouldShowIncident` / `shouldKeepRegionalIncident` — отсев мусорных сообщений.

Состояние события вычисляется на чтение: `incident-status.ts` → `outageIncidentState(startsAt,endsAt,now)` (`scheduled|active|resolved`), `severityForState(state)`. В БД «готовый» статус не хранится.

Дедупликация: `outage-grouping.ts` → `mergeDuplicateOutages(rows)` схлопывает записи, отличающиеся только адресами (`outageEventKey`), плюс `summarizeAffectedAddresses`, `streetFromAddresses`. Применяется в `/outages`, `/incidents`, `/status`, `/reliability`; в `/outages/stats` — **нет** (см. §13).

---

## 4. Поток данных

```
ИСТОЧНИКИ
 (1) оператор  ChernihivWebAdapter: GET /power_outages → POST /api/list_acc
     (cityIds, types=1,2,6; WAF-friendly: requestDelayMs + sessionWarmup)
 (2) telegram  TelegramChannelAdapter (посты канала)  [+ TelegramBotAdapter, по умолчанию off]
 (3) mock      MockAdapter (USE_MOCK_ADAPTER=true)
 (4) ручной импорт ГПВ   POST /api/v1/admin/schedules/import  (JSON из браузера)
 (5) справочник улиц     PUT/DELETE /api/v1/admin/street-queues

(1)(2)(3) → services/parse.service.ts: runParse(sourceId)
   ├─ insert parse_runs(status=running)
   ├─ adapter.fetch() → {outages[], incidents[], gridLevel, gridMessage, rawSnapshot}
   ├─ normalizer.ts: normalizeAddress / normalizeAreaName / normalizeOutageLocation
   ├─ upsert outages (уникальность: (content_hash, source_id) и (source, external_id))
   ├─ upsert incidents (external_id UNIQUE) + telegram_posts
   ├─ update grid_status (последний level/message)
   └─ updateOutageStatuses()  (пересчёт scheduled/active/finished)

(4) → schedule-import.service.ts → таблица schedule_slots
(5) → street-queues.service.ts  → таблица street_queues

ЧТЕНИЕ
 GET /outages      getOutages() → mergeDuplicateOutages → slice(page=1,limit=50)
 GET /incidents    getIncidents() = проекции outages(kind:outage) + сообщения(kind:report),
                                  сортировка active → scheduled → resolved
 GET /status       grid_status + deduped outages + getIncidents + getPowerSummary
 GET /reliability  buildReliabilityReport(now, deduped rows) — дни/недели/месяцы с начала месяца
 GET /schedules    schedule_slots (queue+date); пусто → intervals: [] и source: null
```

`runParse` не падает целиком, если основной источник недоступен (WAF/IP-ban): warning + продолжение вторичными источниками.

---

## 5. HTTP API (префикс `/api/v1`)

Успех: `{ "data": … }` (+ `meta` у списков). Ошибка: `{ "error": { "code", "message", "details"? } }`; ZodError → 400 `VALIDATION_ERROR`.

| Метод | Путь | Параметры | Ответ / логика | Auth |
|---|---|---|---|---|
| GET | `/health` | — | `{status:'ok'}` | — |
| GET | `/outages` | `query,status,queue,area,dateFrom,dateTo,limit` | `{data:Outage[],meta:{page,limit,total,totalPages}}`; пагинация в роуте зашита `{page:1,limit:50}`, выборка до 1000 строк → dedupe → slice | — |
| GET | `/outages/stats` | аргументы игнорируются | `{data:OutageStats}`: `byHour[24]`, `byDay`, `byArea` (top-10), `heatmap[7×24]`, `totalActive`, `totalScheduled` — **без dedupe** | — |
| GET | `/outages/:id` | — | `{data:Outage}` либо 404 `NOT_FOUND` | — |
| GET | `/incidents` | — | `{data:Incident[]}` — единая лента (§3) | — |
| GET | `/status` | — | `{data:{grid{level,message},activeOutages,scheduledOutages,activeIncidents,scheduledIncidents,totalIncidents,lastUpdatedAt,dataStale,powerSummary}}`; `dataStale` = нет обновления > 2 ч | — |
| GET | `/reliability` | — | `{data:ReliabilityReport{days[],weeks[],months[],from,to,generatedAt}}` с начала киевского месяца | — |
| GET | `/addresses/suggest` | `q` (мин. 2 симв.), `limit` (1..20, default 8) | `{data:AddressSuggestion[]}`; `Cache-Control: no-store` | — |
| GET | `/contacts` | — | `{data:Contact[]}` | — |
| GET | `/schedules` | `queue` (`3`, `2/2`), `date` (YYYY-MM-DD, default — сегодня по Киеву) | `{data:QueueScheduleData{queue,date,intervals[],demo,source,lastImportedAt}}` | — |
| GET | `/schedules/:queue` | `date` | то же; совместимость для очередей без `/` (для `2/2` nginx декодирует `%2F` → 404) | — |
| GET | `/street-queues` | — | `{data:StreetQueuePair[]}` | — |
| GET | `/street-queues/schedule` | `street` (мин. 2), `date` | `{data:StreetScheduleData}` (`queue` может быть `null`) | — |
| PUT | `/admin/street-queues` | body `{street,queue}` | `{data:StreetQueuePair}` | Bearer |
| DELETE | `/admin/street-queues/:street` | — | `{data:{removed:boolean}}` | Bearer |
| POST | `/admin/parse` | — | `{data:[{sourceId,name,recordsFound|error}]}` — немедленный парс активных источников | Bearer |
| POST | `/admin/schedules/import` | body `{queue,date,payload{status,aData[],aState}}` | `{queue,date,imported,mergedIntervals}` | Bearer |
| GET | `/docs` | — | Swagger UI | — |

Auth: `Authorization: Bearer ${ADMIN_TOKEN}` — плагин `plugins/auth.ts` (декоратор `fastify.authenticate`, ошибки 401/403 через `AppError`). Глобально: `@fastify/cors` (`origin:'*'`), `helmet`, rate-limit **100 req/min на IP**.

---

## 6. База данных

Drizzle-схема: `apps/api/src/db/schema.ts`. Миграции — «сырые» SQL в `apps/api/src/db/migrations/*.sql`, применяет самописный раннер `db/migrate.ts` (журнал `__energy_migrations`, каждая миграция в транзакции). `drizzle-kit generate` настроен (`drizzle.config.ts`, out=`./drizzle`), но история миграций ведётся вручную.

| Таблица | Колонки (кратко) | Кто пишет | Кто читает |
|---|---|---|---|
| `sources` | id, name, url, type, is_active, last_success_at, last_error | админ/сид | parse.service, cron, `/admin/parse` |
| `outages` | id, source_id, starts_at, ends_at, area_name, addresses_raw, addresses_normalized, reason, status(`scheduled\|active\|finished\|cancelled`), queue, source, external_id, content_hash, first_seen_at, updated_at | parse.service (upsert) | `/outages`, `/incidents`, `/status`, `/reliability`, `/outages/stats` |
| `addresses` | id, type(`district\|street\|settlement`), name_uk, name_ru, name_normalized, parent_id, city, source | сид + миграции 0002/0004 | addresses.service (`suggest`) |
| `incidents` | id, source_id, external_id (UNIQUE), source_url, title, description, started_at, eta_at, severity, status | parse.service | incidents.service |
| `telegram_posts` | id, post_id (UNIQUE), post_text, published_at, link, kind, raw_snapshot_ref, created_at | parse.service | аудит/дедуп |
| `schedule_slots` | id, queue, date, time_from, time_to, state_code, state_name, state_color, source(`manual`), created_at; индекс `(queue,date)` | `/admin/schedules/import` | `/schedules`, `/street-queues/schedule` |
| `street_queues` | street_normalized (PK), street_name, queue, updated_at | `/admin/street-queues` | street-queues.service, `/streets` |
| `grid_status` | id, source_id, level(`stable\|warning\|emergency`), message, updated_at | parse.service | `/status` |
| `contacts` | id, type, label, value, region | сид | `/contacts` |
| `parse_runs` | id, source_id, started_at, finished_at, status, records_found, error_message, raw_snapshot_ref | parse.service | диагностика |
| `geocode_cache` | id, address_query (UNIQUE), lat, lon, cached_at | **никто** — таблица осталась от удалённого `geocode.service.ts` (мёртвый фейк, удалён 2026-10-10) | — |
| `__energy_migrations` | name (PK), applied_at | migrate.ts | migrate.ts |

Ключевые индексы: `outages(starts_at,ends_at)`, `outages_status_idx`, `outages_area_idx`, GiST-trgm по `addresses_normalized`, UNIQUE `(content_hash,source_id)`, частичный UNIQUE `(source,external_id)`; GIN-trgm по `addresses.name_uk` / `name_normalized`.

Порядок миграций: `0001_initial` → `0002_address_source` (+`telegram_posts`) → `0003_schedule_slots` → `0004_desnyanske_streets` (данные) → `0005_remove_seed_personal_data` (чистка персональных данных) → `0006_street_queues` → `0007_operator_source`.

SQL-функция `energy_normalize_address(text)` (`IMMUTABLE`, создаётся/пересоздаётся в 0001/0002/0004): `unaccent` → lower → `translate` (`ыэёїи → иееіі`) → снятие пунктуации → удаление префиксов «вулиця/вул/улица/ул/проспект/просп/провулок/пров/переулок/пер/село/с.». На неё завязаны `name_normalized` и поиск `/addresses/suggest` — **ломать/менять только новой миграцией**.

Данные-сиды: `0004` — нас. пункт «Деснянське» + ~20 курируемых улиц (тип `curated`); `0007` — запись источника `sources` с URL `https://chernihivoblenergo.com.ua/power_outages` (тип `api`).


⚠️ В Docker миграции обязательны: сервис `migrate` выполняет `node dist/db/migrate.js` (Dockerfile копирует `.sql` в `dist/db/migrations`), и только после `service_completed_successfully` стартует `api`.

---

## 7. Backend: модули и их роли

**Композиция** — `src/server.ts`: `cors → helmet → rate-limit → auth → swagger` + 10 роутеров; собственный `setErrorHandler` (ZodError → 400, `AppError` → его code, прочее → 500/statusCode). Планировщик включается **только** при `ENABLE_SCHEDULER && !USE_MOCK_ADAPTER`.

**Конфиг** — `src/config.ts`: единая zod-схема `env` (defaults для всего: `CHERNIHIV_*`, `TELEGRAM_*`, `USE_MOCK_ADAPTER`, `ENABLE_SCHEDULER`, `NOMINATIM_*`, `TZ`). Новую настройку добавлять: `config.ts` → `.env.example` → `x-api-env` в `docker-compose.yml`.

**Роутеры** (`src/routes/`, все `export default async function …Routes(fastify)`): `health`, `outages`, `incidents`, `status`, `contacts`, `addresses`, `schedules`, `street-queues`, `reliability`, `admin`. Валидация входа — zod-схемы из `@svitlo/shared` (`outageFiltersSchema`, `scheduleImportRequestSchema`, `streetQueueInputSchema`).

**Сервисы** (`src/services/`):

| Файл | Роль |
|---|---|
| `parse.service.ts` | оркестрация парса: выбор адаптеров, устойчивость к падению источника, запись в `outages`/`incidents`/`grid_status`/`telegram_posts` |
| `outage.service.ts` | `getOutages` (фильтры + dedupe + пагинация, `MAX_ROWS_FOR_GROUPING=1000`), `getOutageById`, `getOutageStats` (SQL-агрегаты во времени Киева), `updateOutageStatuses` |
| `outage-grouping.ts` | `outageEventKey`, `mergeDuplicateOutages`, `summarizeAffectedAddresses`, `streetFromAddresses` |
| `outage-classification.ts` | регулярки «авария / ремонт / режимное ограничение (ГПВ)» |
| `incidents.service.ts` | `getIncidents(now)` — единая лента (проекции `outages` + сохранённые сообщения), `storedIncidentState` |
| `incident-details.ts` | `extractIncidentArea/Cause/TimeRange/Details` из текста |
| `incident-status.ts` | `outageIncidentState`, `severityForState`, типы `IncidentState/Severity` |
| `power-summary.ts` | чистая математика: `mergeIntervals`, `totalMinutes`, `kyivDayStart`, `computeWindowSummary` |
| `power-summary.service.ts` | `summarizeWindow` / `getPowerSummary` (сегодня + скользящие 24 ч) → `powerSummary` в `/status` |
| `reliability.ts` | `kyivMonthStart`, `mondayKeyOf`, `buildReliabilityReport` (days/weeks/months) |
| `addresses.service.ts` | `suggestAddresses(query, limit)` — подсказки улиц (trgm) |
| ~~`geocode.service.ts`~~ | **удалён 2026-10-10**: был мёртвый фейк — Nominatim не вызывался, возвращались фиксированные координаты, файл никто не импортировал |
| `schedule-import.service.ts` | `importOperatorSchedule`, `mergeRawScheduleSlots`, `getQueueSchedule`, `getQueueScheduleMeta` |
| `schedule-normalizer.ts` | `normalizeScheduleResponse` — операторский HH:MM (Киев) → UTC-интервалы |
| ~~`schedule-mock.service.ts`~~ | **удалён 2026-10-10**: синтетический демо-график (`SCHEDULE_DEMO`) вырезан из `config.ts`, `.env.example` и compose. Пустая таблица = пустые `intervals` |
| `street-queues.service.ts` | CRUD «улица → очередь» + `getStreetSchedule(street, date)` |

**Парсеры** (`src/parsers/`): `adapter.ts` (интерфейсы `ISourceAdapter`, `ParseResult`, `NormalizedOutage/Incident`), `chernihiv-web.adapter.ts` (основной: типы 1/2/6, `parseListAccRow`, `emergencyIncidentFromOutage`, `kyivWallClockToUtc`, `parseRetryAfter`, warmup сессии), `chernihiv.adapter.ts` (HTML-вариант), `telegram-channel.adapter.ts` (`TELEGRAM_RULES`, `classifyTelegramText`), `telegram-bot.adapter.ts`, `mock.adapter.ts`, `normalizer.ts` (адреса/районы/диапазоны дат), `address-matcher.ts` (`normalizeAddressQuery`, `transliterationVariants`, `rankAddressCandidate`).

**Инструменты** — `utils/errors.ts` (`AppError`, `createErrorResponse`), `utils/hash.ts` (`contentHash` sha256), `utils/logger.ts` (pino + pino-pretty в dev), `scheduler/cron.ts` (`setupCron` с jitter, `setupInitialParse`).

**Тесты** — vitest: 20 файлов в `apps/api/tests` (16 проходят, 4 integration-skip без `TEST_DATABASE_URL`: outage-events-ingest, outage-numbers, outage-events-backfill, status-breaker) + 2 в `apps/web/src/lib` (`outage-location.test.ts`, `source-health.test.ts`).

---

## 8. Frontend

Точка входа: `main.tsx` → `App.tsx` (`ErrorBoundary` → `QueryClientProvider` → `RouterProvider`) → `router.tsx` (`createBrowserRouter`, всё внутри `AppShell`).

### 8.1 Маршруты и страницы

| URL | Компонент | Данные (hooks / api) | Ключевые блоки |
|---|---|---|---|
| `/` | `HomePage` | `useStatus`, `useReliability`, `useOutages({limit:5})`, `useIncidents`, `useMyQueues` + прямой `fetch('/api/v1/schedules?queue=&date=')` | StatusIndicator, PowerSummaryCard, ReliabilityCard, LastUpdated, IncidentBanner, «Мій графік» (QueueScheduleBar, флаг `demo`) |
| `/outages` | `OutagesPage` | `useOutages(filters)`, `useOutageStats()` | собственный переключатель вкладок (не `ui/Tabs`): `list \| calendar \| chart \| map`; во вкладке `chart` — **«Графік відключень та ремонтів»** (`OutageTimeline`) + `OutageHeatmap` + `OutageBarChart`; плюс SearchBar + FilterPanel |
| `/incidents` | `IncidentsPage` | `useIncidents()` | IncidentBanner, локальная фильтрация по `query` |
| `/contacts` | `ContactsPage` | `useContacts()` | Card-список телефонов/ссылок |
| `/my-address` | `MyAddressPage` | `useMyAddress()`, `useOutages({query:address})` | AddressCombobox, отключения по адресу, EmptyState/ErrorState |
| `/queues` | `QueueSchedulePage` («Мої черги») | `useMyQueues()`, `api.fetchQueueSchedule(queue,date)` | AddressCombobox (улица → очередь), QueueScheduleBar на дату |
| `/streets` | `StreetsPage` | `useStreetQueues()`, `useStreetSchedule(street,date)`, `api.upsertStreetQueue/deleteStreetQueue` (+ADMIN_TOKEN) | таблица «улица → очередь», админ-форма, график улицы |
| `/schedule-import` | `ScheduleImportPage` | `fetch('/api/v1/admin/schedules/import')` | textarea с JSON оператора + поле токена |

Навигация: `Sidebar` (desktop, 7 пунктов, включая «Мої черги», «Імпорт графіка») и `BottomNav` (mobile, 6 пунктов) — **списки пунктов дублируются, менять в двух местах**. `Header` — переключатели языка и темы.

### 8.2 Слой данных

- `api/client.ts` — обёртка `fetcher()` над `fetch`, `API_BASE = import.meta.env.VITE_API_BASE_URL || '/api/v1'`; методы `fetchOutages/Outage/OutageStats/Incidents/Reliability/Status/Contacts/Health`, `suggestAddresses`, `fetchQueueSchedule`, `fetchStreetQueues/Schedule`, `upsertStreetQueue`, `deleteStreetQueue`.
- `api/queries.ts` — TanStack Query хуки: `useOutages`, `useOutage`, `useOutageStats`, `useIncidents`, `useReliability`, `useStatus`, `useContacts`, `useStreetQueues`, `useStreetSchedule`. Ключи кэша: `['outages', filters]`, `['outagesStats', params]`, `['incidents']`, …
- Локальное состояние — только `localStorage`-хуки: `useMyAddress` (`myAddress`, при очистке также удаляет `myAccountNumber`), `useMyQueues` (`myQueues`; **сейчас поддерживается только очередь `'2/2'`**), `useTheme` (`theme`).

### 8.3 lib и утилиты

| Файл | Что внутри |
|---|---|
| `lib/cn.ts` | `cn()` = clsx + tailwind-merge |
| `lib/date.ts` | `KYIV_TZ='Europe/Kyiv'`, `formatDateTime`, `formatTimeRange`, `formatRelative`, `isActive`, `isToday`, `isTomorrow` (date-fns + date-fns-tz, локаль `uk`) |
| `lib/outage-dates.ts` | `kyivDateKey`, `kyivDayStart` (корректный DST-расчёт), `outageOverlapsKyivDay` |
| `lib/outage-location.ts` | `resolveOutageMapPoint(areaName, addresses)` — таблица координат городов области + дефолт; `outageCategory(reason)` → `'incident' \| 'planned'` по регулярке «виконання ремонтних робіт / технічне обслуговування» (+ тест `outage-location.test.ts`) |
| ~~`lib/demo-schedule.ts`~~ | **удалён 2026-10-10**: мёртвый демо-дубль фронта (никто не импортировал). Синтетики в кодовой базе больше нет вообще |

### 8.4 Компоненты (`src/components/`)

- `ui/` — `Button`, `Input`, `Card(Header/Title/Content/Footer)`, `Badge`, `Select`, `Skeleton`, `Tabs`, `ThemeToggle`, `LanguageToggle` (часть файлов — однострочные «минифицированные», это норма).
- `layout/` — `AppShell`, `Header`, `Sidebar`, `BottomNav`.
- `outages/` — `OutageList`, `OutageCard`, `OutageCalendar`, **`OutageTimeline`** (график-таймлайн: строки `дд.мм · причина`, интервалы), `OutageHeatmap`, `OutageBarChart`, `OutageMap` (Leaflet).
- `incidents/` — `IncidentBanner`.
- `status/` — `StatusIndicator`, `PowerSummaryCard` (+ `formatMinutes`, `reliabilityLevel`), `ReliabilityCard`, `LastUpdated`.
- `search/` — `SearchBar`, `FilterPanel`, `AddressCombobox` (автодополнение улиц; выпадающий список — мобильный overlay).
- `schedule/` — `QueueScheduleBar` (полоса 24 ч по интервалам очереди; подпись «наступне відключення через N хв»).
- `common/` — `EmptyState`, `ErrorState`, `ErrorBoundary`.

### 8.5 Стили, i18n, PWA

- `styles/globals.css` — единственное место токенов (Tailwind v4 CSS-first): `@theme inline` мапит HSL CSS-переменные в семантические классы (`bg-card`, `border-border`, `text-muted-foreground`, `bg-primary`, …), значения — в `:root` и `.dark`; тёмная тема классовая (`@custom-variant dark (&:where(.dark, .dark *))`). `tailwind.config.ts` и `postcss.config.js` удалены, Tailwind подключён плагином `@tailwindcss/vite`.
- i18n — `i18n/config.ts`: ресурсы `uk`/`ru`, язык из `localStorage['lang']`, fallback `uk`; пространства имён: `nav, status, outages, incidents, contacts, myAddress, common, charts, streets` (~90 ключей в каждом файле). **Хардкод украинских строк в JSX тоже встречается** (напр. названия вкладок графика) — при локализации искать и там.
- PWA — `vite-plugin-pwa` (`manifest.webmanifest` из `vite.config.ts`, `registerSW.js`, `sw.js`, `workbox-*.js` в сборке); `runtimeCaching` для `/api/` = `NetworkFirst` с timeout 5 с; `navigateFallbackDenylist: [/^\/api\//]`. Побочный эффект: агрессивное кэширование статики → после пересборки нужен **hard reload (Ctrl+Shift+R)**.

---

## 9. Инфраструктура и деплой

`docker compose` сервисы:

| Сервис | Образ/сборка | Особенности |
|---|---|---|
| `db` | postgres:16-alpine | volume `pg_data`, `docker/init.sql` (uuid-ossp, pg_trgm), healthcheck `pg_isready`, порт 5432 |
| `migrate` | `svitlo-api:latest` | one-shot `node dist/db/migrate.js`; `depends_on: db(service_healthy)` |
| `api` | `docker/Dockerfile.api` | порт 3001, `depends_on: db(healthy) + migrate(completed)`; монтируется CA оператора |
| `web` | `docker/Dockerfile.web` (nginx) | порт 3000→80, build-arg `VITE_API_BASE_URL` (baked!), `depends_on: api` |

Особенности окружения API (`x-api-env` в compose — **жёстко перекрывает `.env`**):

- `USE_MOCK_ADAPTER=false`, `ENABLE_SCHEDULER=false`, `TELEGRAM_BOT_ENABLED=false`, `CHERNIHIV_WEB_ENABLED=true`, `CHERNIHIV_CITY_IDS=7422288601` (с. Деснянське), `CHERNIHIV_OUTAGE_TYPES=1,2,6`, `PARSE_INTERVAL_MINUTES=30` + jitter 5.
- `NODE_EXTRA_CA_CERTS=/app/apps/api/operator-ca.pem` — оператор отдаёт неполную TLS-цепочку.
- `NODE_OPTIONS=--dns-result-order=ipv4first` — иначе undici зависает на NAT64-адресе.
- `TZ=Europe/Kyiv`, `NODE_ENV=production`.
- `ADMIN_TOKEN` обязателен: `${ADMIN_TOKEN:?Set a long random ADMIN_TOKEN in .env}` — без него compose не поднимется.

nginx (`docker/nginx.conf`): SPA-fallback `try_files $uri $uri/ /index.html`, `location /api/ → http://api:3001/api/`, `location /assets/` кэш 1 год immutable, gzip.

Замечание по архитектуре запросов: `VITE_API_BASE_URL` **вкомпилирован в бандл на этапе сборки**. В `.env.example` там `http://localhost:3001/api/v1` → браузер ходит на API напрямую (CORS `*`). Относительный `/api/v1` тоже работает — через прокси nginx. Меняя адрес, надо **пересобирать образ web**.

---

## 10. Шпаргалка команд

```bash
# --- сборка / проверка типов (ESLint в проекте нет; «линт» = tsc --noEmit) ---
pnpm --filter @svitlo/api  lint        # tsc --noEmit
pnpm --filter @svitlo/web  lint        # tsc --noEmit
pnpm --filter @svitlo/api  build       # tsc → dist/
pnpm --filter @svitlo/web  build       # vite build → dist/
pnpm --filter @svitlo/shared build     # заглушка: исходники потребляются напрямую

# --- тесты ---
pnpm --filter @svitlo/api test         # vitest run (tests/**/*.test.ts)
pnpm --filter @svitlo/web test         # vitest (outage-location.test.ts)

# --- БД ---
pnpm --filter @svitlo/api db:migrate   # tsx src/db/migrate.ts
# db:seed убран 2026-10-10: он вставлял выдуманные contacts/outages/incidents (см. HANDOFF §13.3)
pnpm --filter @svitlo/api db:generate  # drizzle-kit generate (руками почти не нужен)
docker compose exec -T db psql -U svitlo -d svitlo -c 'select count(*) from outages'

# --- данные ---
curl -X POST localhost:3001/api/v1/admin/parse -H "Authorization: Bearer $ADMIN_TOKEN"
curl "localhost:3001/api/v1/outages?dateFrom=2026-10-08&dateTo=2026-10-17"
curl "localhost:3001/api/v1/addresses/suggest?q=шев&limit=8"
curl -X PUT localhost:3001/api/v1/admin/street-queues \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"street":"Шевченка","queue":"2/2"}'

# --- Docker ---
docker compose up -d --build        # полная пересборка + миграции + запуск
docker compose ps                   # статус (api/web должны быть Up, db — healthy)
docker compose logs -f api          # логи Fastify
docker compose up -d --force-recreate web   # если nginx отдаёт старый бандл
```

---

## 11. Конвенции кода

- **Язык**: комментарии и пользовательские строки — украинский/русский; код, имена — английский. i18n-строки — через `t('namespace.key')`, но в новом коде допускается украинский хардкод (существующая практика, не идеал).
- **Импорты**: в web используются спецификаторы с расширением `.js` (`import { X } from '../components/….js'`) при TS-исходниках; alias `@/` → `apps/web/src/` (vite + tsconfig). В API — тоже `.js` в относительных импортах (ESM-стиль, `moduleResolution: Bundler`).
- **API-ответы**: всегда обёртка `{ data }` / `{ error: { code, message, details } }`; ошибки — через `AppError(statusCode, CODE, message)`; валидация — zod-схемы в `packages/shared` (переиспользуются web-ом для типов).
- **Типы**: доменные интерфейсы (`Outage`, `Incident`, `OutageStats`, `ReliabilityReport`, `QueueScheduleData`, `StreetQueuePair`, `PowerWindowSummary`, …) объявлены в `packages/shared/src/index.ts` — **сначала менять там**, потом в API и web.
- **Время**: всё в UTC в БД/API (ISO-строки), вычисления «киевских» суток/окон — хелперами (`kyivDayStart`, `kyivDateKey`, `kyivMonthStart`, SQL `at time zone 'Europe/Kyiv'`). Не изобретать новое смещение.
- **Форментирование**: `.prettierrc` (singleQuote, printWidth 100, trailingComma all, semi). Обязательного CI нет — форматировать локально.
- **Тесты**: vitest, рядом с предметной областью (`tests/parsers`, `tests/services`); для «чистой» логики (группировка, классификация, окна времени) — обязательно добавлять кейс.

---

## 12. Подводные камни (грабли, уже на которые наступали)

1. **Tailwind-токены.** Семантические классы (`bg-card`, `border-border`, `text-muted-foreground`, `bg-primary`, `bg-popover`, `text-foreground`, …) работают только потому, что в `apps/web/src/styles/globals.css` есть `@theme inline`-маппинг на CSS-переменные из `:root`/`.dark`. Пока маппинга не было, классы не генерировались → у выпадающего списка адресов был прозрачный фон. На Tailwind v4 (CSS-first) всё в одном файле: новый токен — `--color-x: hsl(var(--x))` в `@theme inline` + значение `--x` в `:root` **и** `.dark`. Проверка: `python3 skills/frontend-ui-change/scripts/check_tailwind_tokens.py .`
2. **PWA/SW кэш + nginx `immutable`.** После пересборки web пользователю может отдаваться старый бандл из service worker. Признак: в index.html новый хеш (`assets/index-*.js`), в браузере — старый. Лечение: hard reload (Ctrl+Shift+R) либо `docker compose up -d --force-recreate web`. Не «фиксите» это в коде, это ожидаемое поведение PWA.
3. **`/outages/stats` vs `/status`.** Stats считает SQL-агрегатами **без** `mergeDuplicateOutages`, остальные ручки — с ним. Поэтому «За районами» и число событий в статистике не совпадают со списком. Если менять — помнить про 4 места (`outages`, `incidents`, `status`, `reliability`).
4. **Планировщик выключен** (`ENABLE_SCHEDULER=false` в compose). Данные появляются только: (а) вручную `POST /admin/parse`, (б) импортом ГПВ, (в) на чистом томе — справочники из миграций (`0004` улицы, `0007` источник); выдуманных отключений больше не создаёт ни один сид (`db/seed.ts` удалён 2026-10-10). «Пусто на графике» ≠ баг фронта: сначала `parse_runs` и `select count(*) from outages`.
5. **Пустая таблица `schedule_slots` = пустые интервалы.** Синтетической подстановки нет: API вернёт `{intervals: [], source: null}`, UI покажет «Графік не імпортовано». Если график «странный» — смотрите `source`/`lastImportedAt`, а не флаг демо (его больше нет).
6. **`useMyQueues` поддерживает только `'2/2'`** (хардкод в `addQueue`). Остальные очереди из списка 1/1…6/2 в localStorage не добавить без правки хука.
7. **Поиск адресов** (`addresses.service.ts`): pg_trgm `similarity()*70` + `%`-оператор, плюс LIKE-подстрока и fallback по `outages.addresses_raw`; использует SQL-функцию **`energy_normalize_address()`** (unaccent + `ыэёїи→иееіі` + удаление префиксов «вул/ул/вулиця/село/с…»). Из-за substring-логики запрос «шел» **не** находит «Шевченка» (нет подстроки, similarity ниже порога) — это не регрессия, а свойство реализации. Справочник улиц наполняется курируемым сидом (миграция 0004 — с. Деснянське, ~20 улиц).
8. **Секреты.** `.gitignore` исключает `/operator-samples/`, `/sample-responses/`, `snapshots/*.json|html`, `/1/` — ответы оператора могут содержать номера счетов/сессии. Не коммитить и не пересылать их. `ADMIN_TOKEN` — только в `.env`.
9. **История git есть** (работаем на ветках `ai/...`), поэтому откат возможен. Но рабочее дерево может содержать незакоммиченные правки, а ignored-файлы (`.env`, `snapshots/`, `ALL_IN_ONE.md`) git не вернёт: перед крупной чисткой или переименованием проверяйте `git status` и делайте ручной бэкап того, что не в git.
10. **`generate-frontend.js`** — легаси-генератор файлов фронтенда с Windows-путём (`C:\Users\oleg\.gemini\…`). Не запускать: перезапишет `apps/web` шаблонными файлами. Также в репе лежат артефакты `apps/api/nohup.out`, `.turbo/` (при отсутствии `turbo.json`) — мусор, не часть сборки.
11. **Версии тулчейна.** Хост: node 26 / pnpm 11; контейнеры: node 22 / pnpm 9.15 (`corepack prepare pnpm@9.15.0`). Локальная сборка и докер-сборка могут отличаться по поведению — проверять в контейнере.
12. **Rate limit 100 req/min на IP** + `helmet` могут помешать при нагрузочных прогонах; CORS `origin:'*'` — открыто всем, авторизация только на `/admin/*`.

---

## 13. Текущее состояние (на 2026-10-09) и открытые вопросы

**Сделано в последней итерации** (правки уже в файлах; бандл web пересобирался):

- `components/search/AddressCombobox.tsx` — выпадающий список больше не прозрачный (fallback-цвета + `z-60` inline, чтобы не зависеть от отсутствующих токенов), улицы выводятся.
- `pages/OutagesPage.tsx` — во вкладку «Графіки» попадают **все** события, включая аварийные/ремонтные (`outageCategory === 'incident'` больше не отфильтровывается): ранее ремонт от 16.10 физически не мог появиться в таймлайне.
- `components/outages/OutageTimeline.tsx` — подписи строк уникальны (`дд.мм · причина`), иначе несколько интервалов за один день сливались в одну строку.
- `components/schedule/QueueScheduleBar.tsx` — «наступне відключення через N хв» округляется до целого.
- Проверено live: 6 дедуплицированных событий (ремонт 16.10 и оба окна 09.10 «Заходи обмеження»), 6 строк таймлайна 09.10→16.10; `/`, `/api/v1/status`, `/api/v1/outages` → 200; `tsc --noEmit` по `apps/web/src` — 0 ошибок.

**Открытые задачи / решения за заказчиком:**

1. Подтвердить, что под «графіком» имелась в виду именно вкладка **«Графіки» на `/outages`** (а не блок «Мій графік» на главной, не график на «Моя адреса» и не `/streets`).
2. `/outages/stats` («За районами») отдаёт **сырые** цифры (в проверке — 30 вместо 6 дедуплицированных). Нужно решение: дедуплицировать stats или оставить как есть.
3. Поиск адресов: оставить substring-поведение («шел» ≠ «Шевченка») или включить более мягкий fuzzy (понизить порог/добавить префиксы)?
4. «Мій графік» на главной — **пусто**: реальные ГПВ не импортированы (`schedule_slots` пуст, `street_queues` пуст). Нужен реальный импорт из браузера (userscript → `POST /admin/schedules/import`); демо-подстановки в коде нет.
5. Проверить в UI, что страница «Контакти» рендерит текст (данные из `contacts` есть, вопрос — к вёрстке/локализации).
6. Консолидация CA оператора: в репе два файла (`apps/api/operator-ca.pem`, `docker/operator-oblenergo-ca.pem`) — решить, оставить один источник истины.
7. Оператор (chernihivoblenergo.com.ua) может блокировать IP — тогда `/admin/parse` возвращает ошибки в `results[].error`; обходной путь — выждать бан или парсить с другого IP.
8. Инициализировать git-репозиторий (сейчас `.git` отсутствует) — иначе нет истории и ревью.
9. Гигиена секретов: во временных файлах (`/tmp/*`) могли остаться `ADMIN_TOKEN` и номера лицевых счетов — удалить.

**Текущий статус рантайма:** контейнеры остановлены (`api` — `Exited (137)`, `web` — `Exited (1)`, `db` — `Exited (0)`). Поднять: `docker compose up -d` (образы уже собраны) или `docker compose up -d --build` при изменениях.

---

## 14. Чек-лист «как внести изменение и не сломать»

**Добавить/изменить эндпоинт API:** тип+схема в `packages/shared/src/index.ts` → роут в `apps/api/src/routes/*.ts` (или новый файл + `server.register` в `server.ts`) → сервис в `apps/api/src/services/` → тест в `apps/api/tests/` → метод в `apps/web/src/api/client.ts` → хук в `apps/web/src/api/queries.ts`.

**Добавить страницу:** компонент в `apps/web/src/pages/` → маршрут в `router.tsx` → пункт в `Sidebar.tsx` **и** `BottomNav.tsx` → ключи в `i18n/uk.json` + `ru.json`.

**Изменить схему БД:** новый SQL-файл `apps/api/src/db/migrations/000N_*.sql` (идемпотентно, `IF NOT EXISTS`) → обновить `db/schema.ts` → проверить, что `docker compose up -d --build` пересобрал образ api (миграции копируются в `dist/db/migrations`) → сервис `migrate` применит их.

**Перед коммитом/сдачей:**

```bash
pnpm --filter @svitlo/api lint     # 0 ошибок
pnpm --filter @svitlo/web lint     # 0 ошибок (ошибки в node_modules — игнорировать)
pnpm --filter @svitlo/api test     # тесты зелёные
pnpm --filter @svitlo/web test
docker compose up -d --build && docker compose ps
curl -s localhost:3001/api/v1/status | head -c 300
curl -s localhost:3000/ | grep -o 'assets/index-[^"]*\.js'   # убедиться, что хеш бандла новый
# фронт проверять только после hard reload (Ctrl+Shift+R) — иначе PWA отдаст старый бандл
```

**Где искать «правду» при расхождении цифр в UI:** `mergeDuplicateOutages` (дедуп) → `outage-classification` (что считается аварией/ремонтом/режимом) → `status`/`reliability`/`outages/stats` (разные источники агрегатов) → поля `demo`/`source` в ответе `/schedules` (реальные данные или синтетика).

---

## Приложение A. Точки входа для быстрого ориентирования

| Хочу понять… | Смотреть |
|---|---|
| откуда вообще берутся данные | `apps/api/src/services/parse.service.ts` + `apps/api/src/parsers/chernihiv-web.adapter.ts` |
| почему событие не показано как авария | `apps/api/src/services/outage-classification.ts` |
| почему в списке меньше строк, чем в БД | `apps/api/src/services/outage-grouping.ts` (`mergeDuplicateOutages`) |
| как считаются «світло є / немає» и надёжность | `apps/api/src/services/power-summary*.ts`, `apps/api/src/services/reliability.ts` |
| почему пусто на «Мій графік» | таблица `schedule_slots` пустая; наполнение — `POST /admin/schedules/import` |
| как рисуется «Графік відключень та ремонтів» | `apps/web/src/pages/OutagesPage.tsx` (вкладка `chart`) → `apps/web/src/components/outages/OutageTimeline.tsx` |
| почему у элемента нет фона/рамки | `apps/web/src/components/ui/*`, `globals.css` (`@theme inline` — маппинг токенов) |
| что за «очередь 2/2» и откуда она у улицы | таблица `street_queues`, `apps/web/src/pages/StreetsPage.tsx`, `apps/web/src/components/search/AddressCombobox.tsx` |

## Приложение B. Словарик домена

| UA | RU / смысл |
|---|---|
| відключення | отключение электроэнергии (`outages`) |
| аварія / аварійне відключення | авария (тип 2 оператора), карточка `kind:'outage'` |
| планові / ремонтні роботи | плановые/ремонтные работы («виконання ремонтних робіт») |
| заходи обмеження (ГАВ/ГПВ) | режимные ограничения, график почасовых отключений по очередям |
| черга (1, 2, 3, 2/2) | очередь/подочередь ГПВ; `1` — свет есть, `3` — отключение, `2` — переходное состояние |
| світло є / немає | есть/нет электроэнергии (состояния интервалов ГПВ) |
| графік відключень та ремонтів | таймлайн событий во вкладке «Графіки» на `/outages` |
| надійність | доля времени со светом (`reliabilityPct`) |
| райони / населений пункт | район / населённый пункт |

---

*Файл сгенерирован по коду проекта; при расхождении кода и карты — верен код. Обновляйте карту вместе с изменениями архитектуры.*









