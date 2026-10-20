# PROJECT_MAP — Svitlo (всеукраинский монитор отключений)

> Назначение файла: за 5 минут ввести в курс нового разработчика или ИИ-агента.
> Актуальность: проверено по коду и живому проду **2026-10-20**, ветка `redesign/wow-ui`,
> последний коммит `4a080c2`, версия приложения **2.25.0**.
> `tsc` для `apps/api` (src и tests), `apps/web`, `cf-worker`, `apps/mobile` — **0 ошибок**.

---

## 0. TL;DR

**Svitlo** — всеукраинский монитор отключений электроэнергии (24 области + Киев): график ГПВ
по очередям (группам), адресный поиск «область → населённый пункт → улица → дом» с привязкой
дома к группе, лента аварий и новостей операторов, честный статус «світло є / немає».

Одна доменная логика (`packages/core`) и три клиента: **PWA** (`apps/web`), **Android**
(`apps/mobile`, Expo SDK 58 → APK), плюс **Node-бэкенд** (`apps/api`, Fastify 5) как резерв и
локальный стенд. Данные в проде раздаёт **Cloudflare Worker + D1**, статика и справочники
адресов — **Cloudflare Pages**, APK — **R2**.

| Слой | Технология | Где |
|---|---|---|
| Монорепо | pnpm workspaces (`apps/*`, `packages/*`) | `/package.json`, `/pnpm-workspace.yaml` |
| API и крон | Cloudflare Worker (Web Fetch + D1 + Cache API + R2), крон `*/20` | `/cf-worker` |
| База прод | Cloudflare D1 `svitlo` (`e3613ade-704e-480c-924a-c765745ea59c`) | `cf-worker/wrangler.toml` |
| Web | React 19.3 + Vite 8.3 + TS 7 + Router 7 + TanStack Query 5 + Tailwind v4 + ECharts 6 + Leaflet + vite-plugin-pwa | `/apps/web` |
| Android | Expo SDK 58 + RN 0.88 + expo-router 58 + NativeWind 4 + Reanimated 4 + Notifee | `/apps/mobile` |
| Общая логика | `@svitlo/core` — платформенно-нейтральные lib/api/storage/config | `/packages/core` |
| Контракты | zod-схемы и TS-типы, потребляются как исходники | `/packages/shared` |
| Резервный бэкенд | Fastify 5 + Drizzle ORM + postgres.js + pino + node-cron | `/apps/api` |
| Локальная БД | PostgreSQL 16 (`pg_trgm`, `unaccent`, `energy_normalize_address`) | сервис `db` в `/docker-compose.yml` |
| Тесты | vitest (API, web), pytest (парсер Energy-UA) | `apps/*/tests`, `tests/` |
| Деплой | `./deploy-cf.sh` (5 шагов, без GitHub и CI) | корень |

### Живое состояние прода (проверено запросами 2026-10-20)

| Что | Ответ |
|---|---|
| `GET /api/v1/health` | `{"status":"ok","d1QuotaExceeded":false,"d1UnavailableAt":null}` |
| `GET /api/v1/version` | опубликовано `2.25.0`, sha256 `7e0e537a…`, 107 700 865 байт; собран `2.26.0`, sha256 `a55061da…`, 35 624 859 байт, `arm64-v8a` |
| `GET /api/v1/regions` | 27 записей каталога, 12 `covered`, `lastDate: 2026-10-20` |
| Паки адресов | `svitlo-ua-4ze.pages.dev/data/address/manifest.json`, `version: 2`, 3 области |

---

## 1. Поток данных

```text
        ┌─────────────── источники ───────────────┐
Energy-UA (HTML)   зеркало ГПВ (JSON)   Telegram   PDF Чернігівобленерго
        │                  │                 │              │
        │        крон Worker */20 ───────────┘              │
        │                  │                                │
        │            ┌─────▼─────┐                          │
        │            │    D1     │  schedule_slots, schedule_coverage,
        │            │  svitlo   │  news, directory_*, snapshot_meta
        │            └─────┬─────┘                          │
        │                  │                                │
   tools/*.py (вручную)    │  /api/v1/*                     │
        └──► .cache/ ──► паки адресов ──► Pages ──► web / mobile
                                          │
                              APK ──► R2 ─┘  /download/svitlo-latest.apk
```

1. **Крон воркера** каждые 20 минут забирает снимок ГПВ и новости, пишет в D1. Снимок из
   зеркала **дополняется**, а не заменяется: `MirrorSnapshot.d1Slots` (слоты из
   `schedule_slots`) и `d1Coverage` (покрытие из `schedule_coverage`).
2. **Свои источники сильнее зеркала.** Для области, которую разбираем сами и у которой есть
   строки покрытия, `covered` берётся только из нашей таблицы. Зеркало
   `dtek-api.svitlo-proxy.workers.dev` уже отдавало пустые таблицы как «свет есть».
3. **Выбор источника при выдаче графика** — по силе доказательства: слоты запрошенной группы →
   любые слоты дня → покрытие. Иначе один `schedule_coverage` перекрывал зеркало с живыми
   интервалами (Київ показывал «Відключень немає»).
4. **Бюджет записи D1.** Крон не перезаписывает неизменное: фингерпринт `gpv_fingerprint` в
   `snapshot_meta` даёт ноль записей, когда набор ГПВ-событий не изменился.
5. **Публичный поиск адреса** идёт не в D1, а в статические паки с Pages (см. §4): автокомплит
   на каждый символ съедал суточную квоту `rows_read`.

---

## 2. Быстрый старт

### Путь 1. Облако (основной)

```bash
npx wrangler login          # однократно
./deploy-cf.sh              # D1 → чейнджлог → Worker → паки+фронт → Pages
```

`deploy-cf.sh` идемпотентен: сам находит или создаёт D1 `svitlo` и Pages-проект, подставляет
`database_id`, накатывает `cf-worker/schema.sql`, деплоит воркер, собирает паки адресов и
фронтенд с фактическим адресом воркера и проверяет, что этот адрес вшит в бандл.

- `SKIP_ADDRESS_IMPORT=1 ./deploy-cf.sh` — пропустить тяжёлый перенос справочника в D1
  (деплой кода от него не зависит; нужно, когда квота на исходе).
- Паки адресов собираются из **локальных** выгрузок в `.cache/`; без них шаг пропускается и
  поиск остаётся на D1-фолбэке.

### Путь 2. Android

```bash
./tools/build-android-apk.sh     # SDK/JDK в Docker-образе; прямой ./gradlew падает
./tools/build-ota-bundle.sh      # тихий OTA: JS-бандл + манифест в apps/web/public/ota
```

`apps/mobile/android` не коммитится: он генерируется `expo prebuild`, а нативные правки
воспроизводятся config-плагинами `plugins/withAndroidWidget.js` и `plugins/withSvitloNative.js`.

### Путь 3. Локально (Node-бэкенд, резерв)

```bash
cp .env.example .env             # в production ADMIN_TOKEN обязателен, ≥16 символов
docker compose up -d --build     # db → migrate → api (3001) + web (3000)
curl -s localhost:3001/api/v1/health
open http://localhost:3000       # nginx: SPA + прокси /api/
open http://localhost:3001/docs  # Swagger UI
```

| Порт | Что |
|---|---|
| `3000` | `web` (nginx, статика + прокси `/api/` → `api:3001`) |
| `3001` | `api` (Fastify), `/docs` — Swagger |
| `127.0.0.1:5432` | PostgreSQL (роль/база `svitlo`, только loopback) |

### Проверки перед коммитом

```bash
./apps/api/node_modules/.bin/tsc -p apps/api/tsconfig.json --noEmit
./apps/api/node_modules/.bin/tsc -p apps/api/tsconfig.tests.json --noEmit
./apps/web/node_modules/.bin/tsc -p apps/web/tsconfig.json --noEmit
(cd cf-worker && ./node_modules/.bin/tsc --noEmit)
(cd apps/mobile && ./node_modules/.bin/tsc --noEmit)
python3 skills/secrets-pii-hygiene/scripts/scan_secrets.py .
python3 skills/frontend-ui-change/scripts/check_tailwind_tokens.py .   # при правках UI
node tools/gen-git-history.mjs --check                                 # GIT_HISTORY.md актуален
```

---

## 3. Структура репозитория

```text
svitlo/
├─ deploy-cf.sh                 # ОСНОВНОЙ ДЕПЛОЙ: D1 → чейнджлог → Worker → паки+фронт → Pages
├─ cf-worker/                   # Cloudflare Worker: API + крон */20, без Node-зависимостей
│  ├─ wrangler.toml             # имя, crons, [vars], D1 (database_id), R2 для APK
│  ├─ schema.sql                # схема D1: schedule_*, directory_*, news, snapshot_meta
│  └─ src/
│     ├─ index.ts               # все /api/v1 маршруты, крон, Telegram-новости, /download APK
│     ├─ mirror-sync.ts         # снимок зеркала: d1Slots, d1Coverage, фингерпринт
│     ├─ mirror-parser.ts       # разбор ответов зеркала ГПВ
│     ├─ schedule-utils.ts      # интервалы, группы, ключи очередей
│     ├─ address.ts             # нормализация адресов + матчер домов
│     ├─ settlements.ts + settlements-ua.json  # поиск по НП, бинарный поиск по префиксу
│     ├─ chernihiv.ts           # порт парсера Чернігівобленерго
│     ├─ telegram-schedule.ts   # посты канала → ГПВ
│     ├─ d1-write.ts            # бюджет записи D1
│     ├─ regions.ts, kyiv-time.ts
│     └─ data/version.json      # версия, sha256 и ссылка на APK
├─ packages/
│  ├─ core/                     # @svitlo/core: lib/*, api/*, storage.ts, config.ts
│  └─ shared/                   # @svitlo/shared: типы и zod-схемы контрактов
├─ apps/
│  ├─ web/                      # PWA: React 19, Vite 8, Tailwind v4
│  │  ├─ src/pages/             # 11 страниц (Home, Search, Streets, Monitor, Outages, Info…)
│  │  ├─ src/components/        # ui, layout, outages, incidents, status, search, schedule,
│  │  │                         # address, places, monitor, offline, changelog, events, region
│  │  ├─ src/hooks/, src/lib/   # платформенные обёртки; расчёты живут в @svitlo/core
│  │  ├─ src/i18n/              # одна локаль — uk.json (мультиязычность убрана)
│  │  ├─ src/styles/globals.css # Tailwind v4 CSS-first (@theme inline + токены тем)
│  │  └─ public/                # data/address (паки), ota (JS-бандл) — артефакты, в git нет
│  ├─ mobile/                   # Expo SDK 58, expo-router
│  │  ├─ app/(tabs)/            # Головна, Пошук, Монітор, Інфо
│  │  ├─ src/components/        # home, search/address, monitor, schedule, navigation, share, ui
│  │  ├─ src/context/           # RegionContext, SettingsContext, OtaContext
│  │  ├─ src/lib/               # ota.ts, notifications.ts
│  │  ├─ native-android/        # Kotlin (OtaBundle), res (иконка уведомления, shortcuts)
│  │  └─ plugins/               # withAndroidWidget.js, withSvitloNative.js
│  └─ api/                      # Fastify 5: роуты, сервисы, парсеры, Drizzle, миграции
│     ├─ src/{routes,services,parsers,db,plugins,utils,scheduler}/
│     └─ tests/                 # vitest: 43 файла (интеграционным нужен TEST_DATABASE_URL)
├─ tools/                       # сборка, импорт и синхронизация данных (см. §6)
├─ tests/                       # pytest: правило публикации дня ГПВ + фикстуры
├─ docs/                        # предметные обзоры + архив истории сессий
└─ docker/                      # Dockerfile.api, Dockerfile.web, nginx.conf, init.sql
```

---

## 4. Контракты API (Cloudflare Worker, `/api/v1`)

Публичный адрес: `https://svitlo-api.olegvapnik45.workers.dev/api/v1`. Контракты описаны в
`packages/shared` и одинаковы для воркера и Node-бэкенда — фронтенд не знает, с кем говорит.

| Маршрут | Назначение | Заметки |
|---|---|---|
| `GET /health` | статус + `d1QuotaExceeded`, `d1UnavailableAt` | единственный источник правды о квоте |
| `GET /status` | сводка: покрытые области, время снимка, квота | то же для UI-баннера |
| `GET /sync` | один пакет для офлайн-старта: сеть + области + график на сегодня/завтра + новости | контракт совпадает с Node |
| `GET /regions` | 27 записей каталога: `covered`, `lastDate`, `slots` | `slots` — что реально лежит в D1 |
| `GET /queues?region=` | группы (очереди) области по приоритету | для селектора |
| `GET /schedules?region=&date=` | снимок ГПВ: слоты, группы, покрытие | источник выбирается по силе доказательства |
| `GET /schedules/upcoming` | ближайшие интервалы отключений | для главной и виджета |
| `GET /street-queues?region=&settlement=` | очереди населённого пункта | привязки «улица → очередь» |
| `GET /street-queues/schedule?region=&queue=&settlement=` | график по очереди/селу | для поиска по адресу |
| `GET /addresses/settlements?q=&region=` | автокомплит НП | в web/mobile заменён паками (§5) |
| `GET /addresses/streets?settlement=&q=` | улицы НП + `wholeSettlementQueue` | пустой `q` не допускается (<2 символов → `[]`) |
| `GET /addresses/houses?settlement=&street=&q=` | дома улицы | читается только после выбора улицы |
| `GET /addresses/resolve` / `/addresses/suggest` | адрес → очередь, подсказки | мастер адреса |
| `GET /places/:account` | место по лицевому счёту | ПД не логируются |
| `GET /outages` | отключения по стране/области | `region=all` — вся страна |
| `GET /outages/stats` | агрегаты | для страницы статистики |
| `GET /incidents` | аварийные перерывы (тип 2) с местом и причиной | отдельно от плановых |
| `GET /reliability?from=&to=&queue=` | `ReliabilityReport`: `days/weeks/months/groups` | контракт чинили в 2.24.0 |
| `GET /news?limit=&kind=&region=` | лента: `kind`, `region_cpu`, `is_ukraine_wide`, `image_urls` | `excludeKind` для фильтра |
| `GET /news/sources` | источники ленты | для подписи в UI |
| `GET /changelog` | «Що нового» из `changelog.json` | генерируется при сборке |
| `GET /version` | `2.25.0`, sha256, размер, ссылка на APK | для OTA и подписи версии |
| `GET /download/svitlo-latest.apk` | APK из бакета R2 `svitlo-apk` | Range, 206 на частичный запрос |

Коды: `200` — данные; `400` — невалидные параметры; `404` — нет адреса/места; `5xx` — D1
недоступна. **`200` не означает «данные есть»** — пустой список честнее выдуманного графика.

---

## 5. Статические паки адресов (Pages)

`tools/build-address-packs.py` раскладывает `apps/web/public/data/address/` (в git не хранится):

```text
data/address/
├─ manifest.json                # version: 2, generatedAt, области и счётчики
└─ <region>/
   ├─ settlements.json(.gz)     # НП области для автокомплита
   ├─ streets.json(.gz)         # индекс улиц кортежами:
   │                            #   [name, normalized, defaultQueue, queues[], housesShard]
   └─ houses-00.json.gz … houses-15.json.gz   # дома, разложенные по шардам
```

Правила работы с паками:

- **Дома грузятся только после выбора улицы** (`housesShard` указывает шард). Раньше дома лежали
  в индексе улиц и пак раздувался до мегабайтов на область.
- **Подсказки ограничены:** пустой запрос — 20 позиций, непустой — не больше 30, совпадение
  `includes`, а не `startsWith` (люди ищут «Шевченка» в середине названия).
- **Матчинг домов** — `matchHouse()` в `cf-worker/src/address.ts`: диапазоны `1-5`, дроби,
  литеры `12а`, чёт/нечет. Точное совпадение всегда приоритетнее диапазона.
- **Деградация:** манифест недоступен или `version ≠ 2` → клиент идёт в `/addresses/*` (D1).
  Это медленнее и тратит квоту, но поиск не ломается.

---

## 6. Доменная модель и инварианты

**Термины.** Область (`regionCpu`: `kyiv-city`, `dnipropetrovska-oblast`, …) → населённый пункт
(`settlement`) → улица (`street`) → дом (`house`). Группа/очередь (`queue`: 1…6, `1.1`, `3.2`)
— то, что оператор публикует в графике. Слот — интервал `[startsAt, endsAt]` с признаком
«отключение/свет есть».

| Таблица D1 | Смысл |
|---|---|
| `schedule_slots` | слоты ГПВ из своих источников (основная таблица графиков) |
| `schedule_coverage` | по области/дате: опубликован ли день; `d1Coverage` читается воркером |
| `snapshot_meta` | время снимка, `gpv_fingerprint`, служебные ключи |
| `directory_settlements` / `directory_streets` | справочник НП и улиц (`source`: `osm`, `curated`) |
| `address_queues` | привязки «улица/дом → очередь»; `source` ≠ `mirror` для реальных привязок |
| `news` | посты: `kind`, `region_cpu`, `is_ukraine_wide`, `image_urls`, `body` |
| `outage_events` | канонические события отключений (план/авария) для `/outages`, `/incidents`, `/reliability` |

**Инварианты (нарушение = баг уровня «врёт пользователю»):**

1. **Нет данных ≠ «света нет» и ≠ «свет есть».** Неопубликованный график показывается как
   «Немає даних», а не зелёным. Правило живёт в `is_day_published()` в
   `tools/scrapling_schedules_sync.py`, регрессия ловится `tests/test_scrapling_schedules.py`.
2. **Своё покрытие важнее зеркала** (`d1Coverage` + `loadOwnCoverage`): зеркало не может
   «покрасить» день, который наш парсер считает неопубликованным.
3. **Источник выбирается по силе доказательства:** слоты запрошенной группы → любые слоты дня →
   покрытие. Слабое доказательство никогда не перекрывает сильное.
4. **Никаких демо-графиков.** `SCHEDULE_DEMO` и подобные заглушки запрещены: лучше пустой экран.
5. **ПД не ходят в логи и в URL.** Номера лицевых счетов не пишутся в лог и не коммитятся.
6. **Неизменный снимок не пишется в D1** (фингерпринт `gpv_fingerprint`): квота на запись —
   100 тыс. строк в сутки на весь проект.

---

## 7. Инструменты (`tools/`)

| Скрипт | Что делает |
|---|---|
| `./deploy-cf.sh` (корень) | полный деплой в Cloudflare (5 шагов) |
| `build-address-packs.py` | паки адресов v2 из `.cache/` → `apps/web/public/data/address/` |
| `build-android-apk.sh` | сборка подписанного APK в Docker + загрузка в R2 + метаданные `/version` |
| `build-ota-bundle.sh` | тихий OTA: JS-бандл (.gz) + манифест в `apps/web/public/ota/` |
| `bump-version.sh` | версия `major|minor|patch` во всех `version.json` и `app.json` |
| `gen_changelog.mjs` | `changelog.json` из `Release-Note`-трейлеров + `changelog-notes.json` |
| `gen-git-history.mjs` | `GIT_HISTORY.md` из `git log` (`--check` — только проверка актуальности) |
| `scrapling_schedules_sync.py` | разбор графиков Energy-UA → D1 (16 областей) |
| `scrapling_addresses_sync.py`, `import-address-hierarchy.py` | справочник НП/улиц и привязки |
| `sync-directory-to-d1.mjs` | перенос справочника в D1 |
| `release-after-midnight.sh` | деплой сразу после сброса суточной квоты D1 |
| `gen-settlements-ua.py`, `gen_settlement_directory.py` | список НП Украины |
| `import-osm-streets.mjs` | улицы из OSM |
| `discover-chernihiv-cities.mjs`, `energy_ua_catalog.py` | каталог городов и сетей |
| `compare-api-contracts.py` | сверка ответов Worker и Node-бэкенда |
| `gemini-assist.mjs` | вспомогательная нормализация (не в прод-пути) |

---

## 8. Лимиты D1 и операционные правила

Free Tier: **5 млн `rows_read`** и **100 тыс. `rows_written`** в сутки, сброс в **00:00 UTC**.

- `wrangler d1 export` без `--table` читает всю базу и съедает суточный лимит → бэкапить только
  селективно: `schedule_slots`, `schedule_coverage`, `snapshot_meta`, `address_queues`.
- `DELETE FROM` тарифицируется построчно → большие таблицы сносить через DDL, не построчно.
- `INSERT OR REPLACE` = DELETE + INSERT → поэтому в кроне фингерпринт, а не безусловная запись.
- D1 не умеет `ADD COLUMN IF NOT EXISTS` → догоняющие колонки добавляются по `PRAGMA table_info`
  (`ensureNewsColumns` в `cf-worker/src/index.ts`).
- Когда квота исчерпана: `GET /health` → `d1QuotaExceeded: true`, `/status` тоже; записи уходят
  на следующий деплой, читатели получают снимок или пустой ответ, но **не 500**.
- Деплой, которому нужны записи: `./tools/release-after-midnight.sh`.

---

## 9. Тесты и проверки

| Где | Что | Запуск |
|---|---|---|
| `apps/api/tests` — 43 файла | юнит (парсеры, сервисы, конфиг, `timingSafeEqual`) + интеграционные с БД | `pnpm --filter @svitlo/api test` (интеграционным нужен `TEST_DATABASE_URL`, база `svitlo_test`) |
| `apps/web/src/**/*.test.ts` — 26 файлов | api-клиент, офлайн-синк, паки адресов, расчёты графика, health источников | `pnpm --filter @svitlo/web test` |
| `tests/test_scrapling_schedules.py` | правило публикации дня ГПВ (8 тестов) | `python3 -m pytest tests/ -q` |
| `cf-worker`, `apps/mobile` | тестов нет — только `tsc` | `(cd cf-worker && tsc --noEmit)` |

Правило: **`tsc` обязателен всегда**, полный прогон тестов — по запросу человека (интеграционные
требуют поднятой БД).

---

## 10. Безопасность

- Секреты только в `.env` / `wrangler secret`; `.env*`, `*.jks`, `keystore.properties` — в
  `.gitignore`. Ключи: `ADMIN_TOKEN` (≥16 символов в production), токен Telegram, ключ
  release-подписи APK.
- Сравнение токенов — `timingSafeEqual` (`apps/api/tests/timing-safe.test.ts`).
- ПД (номера лицевых счетов, адреса) не попадают в логи и в коммиты. Сканер:
  `python3 skills/secrets-pii-hygiene/scripts/scan_secrets.py .`
- CORS воркера ограничен доменами Pages и локальной разработкой.

---

## 11. Куда смотреть дальше

| Документ | О чём |
|---|---|
| `HANDOFF.md` | что сделано, что не закоммичено, что дальше |
| `PROJECT_AUDIT.md` | ревизия 2026-10-20: риски, оценки, бэклог |
| `GIT_HISTORY.md` | история коммитов (генерируется из `git log`, руками не править) |
| `docs/energy-ua-source-audit.md` | разбор источников Energy-UA по областям |
| `docs/address-queue-sources.md` | откуда берутся привязки «улица → очередь» |
| `docs/regions-multiregion.md` | мультирегиональность: ключи, покрытие, приоритеты |
| `docs/AI-ONBOARDING.md` | вводная для ИИ-агента |
| `docs/archive/HANDOFF-history.md` | как проект пришёл к текущему состоянию |
| `skills/*/SKILL.md` | обязательные процедуры (дисциплина, миграции, API, парсеры, UI, тесты, deploy) |




