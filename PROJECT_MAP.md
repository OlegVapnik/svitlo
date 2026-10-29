# PROJECT_MAP — Svitlo

> Снимок на **2026-10-26**, дополнен после релиза v2.41.1 (см. §0). Источник истины — код и конфиги,
> а не старая документация. Все пути указаны от корня репозитория.
>
> Версия продукта: **2.41.1**, Android `versionCode=279` (`apps/mobile/app.json:5`, `:46`).
> Публичный API: `https://svitlo-api.olegvapnik45.workers.dev/api/v1`.
> Публичная статика/OTA: `https://svitlo-ua-4ze.pages.dev`.

---

## 0. Обновления 2026-10-25 – 2026-10-26 (v2.40.0 – v2.41.1)

- **Мобільний клієнт (v2.40.0 – v2.41.1)**:
  - Редизайн живого повідомлення у шторці Android під чистий системний стиль (без громіздких рамок і градієнтів, з чіткою шкалою доби й таймером).
  - Новий екран «Налаштування» (`app/settings.tsx`), куди винесені тумблери живого сповіщення, детектора раннього увімкнення та параметри оновлень. Екран «Інфо» очищено суто під новини.
  - Повноцінна картка оновлень у стилі Morphe Manager з покроковим відображенням процесу інсталяції та вибором OTA vs APK.
  - Підтримка власних джерел новин (Telegram `t.me/s/` та RSS/Atom) з локальним кешуванням на 30 хвилин і можливістю повного відключення серверної стрічки для захисту квоти D1.
- **Оптимізація та надійність D1 / Worker**:
  - `/sync` та `/news` переведені на R2-снапшоти для усунення надлишкових `rows_read` у D1 (див. `docs/d1-quota-profile-2026-10-25.md`).
  - Виправлено логіку збереження слотів (`replace: true` для запобігання застарілим накладанням) та якір поточної доби в HeroStatus.
  - Додано обробку Telegram Webhook та розширено ендпоінти статусу здоров'я D1.

- **Сбор графиков перешёл на `tools/osr_engine/`**: нормализованные слоты, статусы
  публикации (`PublicationStatus`), SHA-256 fingerprint-дедуп пушей, state в
  `.cache/osr_state.json`, systemd-таймер (`tools/osr_engine/systemd/`, каждые 15 мин) +
  `run-sync.sh`. Боевой ingest 24.10: 7 областей, 264 слота, 0 rejected.
- **Транспорт ОСР переписан на три уровня антидетекта** (29.10, `tools/osr_engine/transport/`,
  было `transport.py`): Tier 1 `curl_cffi` → `httpx` → `requests` → `urllib`;
  Tier 2 `patchright` → `playwright`; Tier 3 `camoufox`; распознавание заглушек
  (`challenge.py`), эскалация по требованию (`escalation.py`), сессии с `cf_clearance`.
  22 unittest без сети. Установка опциональных пакетов —
  `tools/osr_engine/requirements-transport.txt`, описание — `docs/OSR-ANTIDETECT.md`.
- **Защита от отката графика**: ранг джерела (`mirror` 1 < `telegram` 2 < `energy-ua` 3)
  плюс отказ писать снимок старше 45 минут (`409 STALE_SNAPSHOT`).
- **Крон-зеркало отключено**: `MIRROR_SYNC_ENABLED="false"` (wrangler.toml:47) —
  `syncMirrorSchedule()` в `scheduled()` больше не выполняется; зеркало
  `dtek-api.svitlo-proxy.workers.dev` мертво (данные от 17.10).
- **Виток квоты D1 устранён** (инцидент 24.10, ~833k rows_read за 27 мин ночи):
  причина — `/sync` в `HOT_SNAPSHOT_WARM_PATHS` (полное чтение directory_settlements
  24k + directory_streets 31k на каждый тик). Убран из прогрева; индексы справочников
  (`idx_dir_streets_region`, `idx_dir_settl_region`) применены в живой D1 `--remote`.
- **Первичные источники по регионам**: ДТЕК Київ/Київщина/Одеса/ДнЕМ — inline
  `DisconSchedule.fact` (Одеса/ДнЕМ через Camoufox: Incapsula); Полтава — POST
  `poe.pl.ua/customs/newgpv-info.php` (seldate); Черкаси — t.me/pat_cherkasyoblenergo;
  Харків/Суми/Запоріжжя — energy-ua.info (рішення власника: офіційні сайти — лише
  адресний пошук); Миколаїв — lviv.energy-ua.info/select/Миколаїв (warm-up сесія);
  Рівне, ІФ, Тернопіль, Чернівці — офіційні API/таблиці. Волинь — джерела немає.
- **`exempt`-регионы**: `luhanska-oblast` (`occupied`) и `donetska-oblast`
  (`frontline_emergency`) в каталогах TS/движка + плашки в RegionPicker (web/mobile).
- **Приватный бэкап**: https://github.com/OlegVapnik/svitlo-internal (private) —
  полный срез прод-контура; H-5 из PROJECT_AUDIT.md закрыт.
- **Ingest-токен ротирован** 24.10 (`wrangler secret put` оба алиаса), новое значение —
  `~/.config/svitlo/osr-sync.env` (0600, вне репо).
- Прогон 24.10: движок 49/49 pytest, воркер 81/81 + tsc, web 249 тестов, mobile typecheck.

## 1. Что это

Svitlo показывает графики почасовых отключений (ГПВ) по областям Украины, состояние света,
новости операторов и позволяет найти свою очередь по адресу. Один продукт в трёх оболочках:

| Оболочка | Код | Что использует |
|---|---|---|
| PWA | `apps/web` | React 19 + Vite 8 + React Router 7 + TanStack Query + Tailwind 4 + `vite-plugin-pwa` |
| Android | `apps/mobile` | Expo SDK 58 / React Native 0.88 / expo-router; OTA JS-бандла, виджеты, уведомления |
| Прод-API | `cf-worker` | Cloudflare Worker + D1 + Cache API + R2; cron `*/20 * * * *` |
| Эталон контрактов | `apps/api` | Fastify 5 + PostgreSQL 16 + Drizzle; **заморожен** (ADR-0002): oracle форм ответа и golden-фикстур, не резервный прод |
| Общая логика | `packages/shared`, `packages/core` | zod-контракты, каталог регионов, расчёты, offline-хранилище |

**Главный инвариант:** нет данных — нет графика. Приложение не рисует «зелёное» там, где
оператор ничего не опубликовал; состояния «даних немає», «застарілий графік» и «світло за
графіком» различаются явно.

---

## 2. Топология

```
                    ┌──────────────────── Cloudflare ────────────────────┐
                    │ Worker svitlo-api                                  │
                    │  /api/v1/*  → D1 svitlo (SQLite) + Cache API       │
                    │  cron */20  → mirror / Telegram / news / Chernihiv │
                    │  /download/* → R2 svitlo-apk                       │
                    │ Pages svitlo-ua                                   │
                    │  /, /search, /monitor, /info, /ota, /data/address  │
                    └───────────────▲──────────────────▲─────────────────┘
                                    │ HTTPS            │ HTTPS
                         ┌──────────┴────────┐  ┌──────┴─────────────┐
                         │ Web PWA           │  │ Android APK        │
                         │ apps/web          │  │ apps/mobile        │
                         └───────────────────┘  └────────────────────┘
```

Локальный Fastify/PostgreSQL (`apps/api`) **не обслуживает прод-трафик** и **заморожен**
(ADR-0002): новых маршрутов, парсеров и миграций там не появляется. Он нужен как эталон форм
ответа (golden-фикстуры) и для сверки контрактов. Прод читает и пишет только Worker; набор
маршрутов эталона зафиксирован тестом `apps/api/tests/frozen-surface.test.ts`.

---

## 3. Дерево репозитория

```
apps/
  web/                 PWA: экраны, графики, поиск адреса, карта, offline-пакет
  mobile/              Expo/RN: 4 таба, OTA, SQLite/kv-store, уведомления, виджеты
  api/                 Fastify + PostgreSQL: маршруты, сервисы, 18 SQL-миграций, тесты
packages/
  shared/              zod-контракты, каталог областей, общие типы
  core/                API-клиент, React Query, offline-хранилище, расчёты графика
cf-worker/             прод-Worker: маршруты, D1-схема, ingestion, cron, R2
tools/                 сборка APK/OTA, парсеры, импорт справочников, скрипты релиза
tests/                 pytest: правила публикации графика и фикстуры
docs/                  обзоры источников, скриншоты, архив handoff
ota/                   копия OTA-манифеста и бандлов для raw.githubusercontent.com
```

**Важно про границы git:** локальный `.git/info/exclude` скрывает `cf-worker/`, `tools/`,
`tests/`, `HANDOFF.md`, часть `docs/` и `deploy-cf.sh` (строки 55–87). Поэтому в публичном
`origin/main` этих файлов нет, хотя прод-Worker и релизные скрипты живут именно там. Сокрытие
намеренное; риск не в приватности, а в отсутствии приватного remote/бэкапа — это H-5 в
`PROJECT_AUDIT.md`. При работе с публичным репозиторием нельзя рассчитывать, что `cf-worker`
уже в git.

---

## 4. Прод: Cloudflare Worker

### 4.1. Точка входа и кэш

- `cf-worker/src/index.ts` — 170 строк: только `fetch`-диспетчер (preflight, APK, кэш-каскад,
  фолбэк при недоступной D1) и `scheduled` из `modules/ingest/service.ts`.
- `cf-worker/src/modules/ingest/service.ts` — `scheduled()`: cron-цикл каждые 20 минут.
- `cf-worker/src/modules/api/router.ts` — `handleApi()`: единый диспетчер `/api/v1/*`.
- `cf-worker/src/modules/sync/service.ts` — `/sync`: тяжёлый офлайн-пакет.
- `cf-worker/wrangler.toml` — имя `svitlo-api`, D1 `svitlo`, R2 `svitlo-apk`, cron `*/20`.

Кэш трёх уровней:
1. память изолята: TTL 2 минуты для данных, 5 минут для готовых HTTP-ответов;
2. Cache API: переживает перезапуск изолята;
3. ETag/`If-None-Match` для `/sync` и других ответов.

Это защита от лимита D1 Free Tier: 5 млн `rows_read` и 100 тыс. `rows_written` в сутки,
а также от CPU-лимита Worker (10 мс на запрос).

### 4.2. Маршруты Worker

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/api/v1/health` | статус, флаги D1 quota/unavailable |
| GET | `/api/v1/version` | версия APK, URL, sha256, размер |
| GET | `/api/v1/changelog` | «Що нового» |
| GET | `/api/v1/regions` | каталог 24 областей + Киев, покрытие |
| GET | `/api/v1/queues?region=` | очереди области |
| GET | `/api/v1/schedules?region=&queue=&date=` | интервалы очереди на дату |
| GET | `/api/v1/schedules/upcoming?region=&days=` | график на несколько дней |
| GET | `/api/v1/status?region=` | состояние света/сети области |
| GET | `/api/v1/news` | новости операторов и Укренерго |
| GET | `/api/v1/news/sources` | статус источников новостей |
| GET | `/api/v1/outages?region=` | точечные отключения |
| GET | `/api/v1/outages/stats` | агрегаты отключений |
| GET | `/api/v1/incidents` | инциденты |
| GET | `/api/v1/reliability?region=&queue=` | отчёт по надёжности |
| GET | `/api/v1/addresses/settlements` | подсказки НП |
| GET | `/api/v1/addresses/streets` | подсказки улиц |
| GET | `/api/v1/addresses/houses` | дома и очереди |
| GET | `/api/v1/addresses/resolve` | область → НП → улица → дом → очередь |
| GET | `/api/v1/addresses/suggest` | общий поиск улиц |
| GET | `/api/v1/street-queues` | в Worker — пустой массив (контракт сохранён) |
| GET | `/api/v1/street-queues/schedule` | «улиця не прив'язана» |
| GET | `/api/v1/places/:account` | в Worker — честный 404 (справочник только в Node) |
| GET | `/api/v1/sync?region=&days=` | офлайн-пакет: статус + каталог + графики + НП + новости |
| POST | `/api/v1/internal/schedules-ingest` | приём снимка ГПВ от внешнего сборщика |
| GET/HEAD | `/download/svitlo-*.apk`, `/svitlo-*.apk` | APK из R2 с Range |
| OPTIONS | любой `/api/v1/*` | CORS preflight |

Особенности:
- `/places/:account` и `/street-queues*` в Worker намеренно отвечают пустой/«немає в довіднику»
  формой: персональные данные и ручные привязки живут только в эталонном Node-API
  (`cf-worker/src/modules/api/router.ts`, решения — `apps/api/README.md`).
- `/internal/schedules-ingest` защищён `SVITLO_INGEST_TOKEN`/`SCHEDULES_INGEST_TOKEN` и
  constant-time сравнением (`cf-worker/src/modules/ingest/routes.ts`).
- CORS в Worker — `access-control-allow-origin: *`; это read-only API, кроме ingest.

### 4.3. Cron-конвейер

`cf-worker/src/modules/ingest/service.ts` → `scheduled()`:

1. `ensureSchemaOnce()` — идемпотентные `CREATE TABLE IF NOT EXISTS` (ядро D1).
2. `syncMirrorSchedule()` — один запрос к зеркалу ДТЕК, fingerprint, diff-write, prune.
3. `importTelegramSchedules()` — посты операторов, только как дополнение.
4. `materializeGpvEvents()` — перенос слотов ГПВ в `outage_events`.
5. `fetchNews()` + `saveNews()` — новости; ошибка новостей не отменяет график.
6. `runChernihiv()` — точечные отключения, если `CHERNIHIV_WEB_ENABLED=true`.
7. `clearMemoryCache()` и `cacheApiRefresh()`.

Ключевые защиты:
- `mirror_slots_fp` в `snapshot_meta`: неизменный график не пишет строки;
- история хранится 7 дней, prune раз в сутки (`schedule_pruned_on`);
- `MIRROR_SCHEDULE_IMPORT_REGIONS` — аварийный тормоз при исчерпании квоты;
- `ensureSchedule()` подтягивает зеркало при пустой D1, чтобы первый запуск не ждал 20 минут.

### 4.4. D1

Схема: `cf-worker/schema.sql`. Основные таблицы:

| Таблица | Смысл |
|---|---|
| `schedule_slots` | получасовки отключений: `region, queue, date, time_from, time_to, source` |
| `schedule_coverage` | факт публикации дня и очереди, `has_outages` |
| `snapshot_meta` | метаданные обходов, fingerprint, имена регионов |
| `news` | посты Telegram/RSS |
| `outage_events` | канонические точечные отключения |
| `provider_city_ids` | найденные ID населённых пунктов ОСР |
| `directory_settlements` | справочник НП |
| `directory_streets` | справочник улиц, `houses_json` |
| `directory_houses` | точный каталог домов (в текущем коде справочник в основном читается из `houses_json`) |

**Было (исправлено):** Worker читал `address_queues`, но ни `schema.sql`, ни `ensureSchema()`
таблицу не создавали — чистая D1 после `npm run d1:init` не обслуживала адресный поиск.
Сейчас DDL живёт в `cf-worker/src/schema-address-queues.ts`, его подключает `ensureSchema()`
(`cf-worker/src/modules/schedule/repo.ts`), а `tests/schema-coverage.test.ts` сверяет код и
`schema.sql` в обе стороны.

Голосование за очередь удалено: `readAddressVotes()` (`cf-worker/src/modules/address/repo.ts`)
— заглушка, всегда возвращает нули; `address_queue_votes` в текущем коде не используется.

---

## 5. Источники и логика регионов

### 5.1. Источники

| Источник | Роль | Код |
|---|---|---|
| Зеркало ДТЕК `https://dtek-api.svitlo-proxy.workers.dev/` | основной источник слотов и покрытия на всю страну | `cf-worker/src/mirror-sync.ts`, `mirror-parser.ts` |
| Telegram-каналы операторов | дополнение там, где зеркало молчит | `cf-worker/src/telegram-schedule.ts` |
| Energy-UA | парсер готов; из Worker получает 403 Cloudflare Managed Challenge | `cf-worker/src/energy-ua.ts`, `energy-ua-parse.ts`, `ingest.ts` |
| Прямые ОСР | Черновцы, Одесса, Николаев, Ивано-Франковск, Львов, Ровно и др. | `tools/osr_direct_sync.py`, `tools/osr_sources.py` |
| Черниговоблэнерго | точечные отключения по НП | `cf-worker/src/chernihiv.ts` |
| RSS/Telegram | новости | `cf-worker/src/modules/news/*`, `apps/api/src/services/news/*` |

`POST /internal/schedules-ingest` — контур для внешнего сборщика (`scrapling`), но текущая
эксплуатация **не использует GitHub Actions**. Данные ОСР заливаются вручную/скриптом
`tools/osr_direct_sync.py` с `--ingest` или SQL.

### 5.2. Канонические регионы и ключи фида

- Каталог: `packages/shared/src/regions-catalog.ts:36` (24 области + Киев).
- Копия для Worker: `cf-worker/src/regions.ts:25` (сборка Worker намеренно не тянет
  `@svitlo/shared`, чтобы не тащить zod).
- `feedKeys` — ключи, под которыми данные реально лежат в D1 (`kyiv`, `kiivska-oblast`,
  `dnipro-cek`, `dnipro-dnem`).
- `dnipropetrovska-oblast` — группа из двух сетей; нельзя сливать интервалы ЦЕК и ДнЕМ.
- `chernivetska-oblast` имеет пустой `feedKeys` в каталоге, но прямые данные ОСР могут
  лежать под каноническим `cpu`; поэтому область может быть `covered`, даже если зеркало её
  не отдаёт.

### 5.3. Покрытие на 22.10.2026

- Свежие (13): Днепр, Житомир, Ивано-Франковск, Киев, Киевская, Николаев, Полтава, Ровно,
  Сумы, Харьков, Черкассы, Черновцы, Чернигов.
- Устарели на 17.10 (6): Закарпатская, Запорожская, Львовская, Одесская, Тернопольская,
  Хмельницкая.
- Нет данных (6): Винницкая, Волынская, Донецкая, Кировоградская, Луганская, Херсонская.
- Статический fallback `apps/web/public/data/schedules-all.json` содержит 20 из 25 регионов.

UI разделяет «Застарілі графіки» и «Немає даних»:
`apps/web/src/components/region/RegionPicker.tsx:313`, `:318`;
`apps/mobile/src/components/home/RegionPicker.tsx:40-42`.

---

## 6. Web (PWA)

### 6.1. Маршруты

`apps/web/src/router.tsx`:

| Путь | Экран |
|---|---|
| `/` | `HomePage` |
| `/search` | `SearchPage` |
| `/monitor` | `MonitorPage` |
| `/info` | `InfoPage` |
| `/schedule-import` | служебный импорт графика |
| `/outages`, `/incidents`, `/queues`, `/streets`, `/my-address`, `/news` | редиректы на новые табы |

### 6.2. Данные и состояние

- API-клиент: `packages/core/src/api/client.ts`; `apps/web/src/api/client.ts` реэкспортирует.
- React Query: `packages/core/src/api/query-client.ts`.
- Выбранный регион: `apps/web/src/context/RegionContext.tsx`, `packages/core/src/lib/region.ts`.
- Offline:
  - кэш ответов по URL — `packages/core/src/api/offline-cache.ts`;
  - снимок всех групп области — `offline-region-schedules.ts`;
  - `/sync`-пакет — `offline-sync.ts`;
  - гидратация до первого рендера в `apps/web/src/main.tsx`.
- PWA: `apps/web/vite.config.ts` — `VitePWA` с `selfDestroying: true`, `skipWaiting`,
  `clientsClaim`; API намеренно не кэшируется Service Worker.
- Статика: `apps/web/public/_redirects` проксирует `/api/*` на Worker, всё остальное — на
  `index.html`.

### 6.3. Ключевые экраны

- `HomePage` — текущая очередь, таймер, график, закладки.
- `MonitorPage` — группы, отключения, события.
- `SearchPage` — мастер «область → НП → улица → дом → очередь».
- `InfoPage` — новости, фильтры, источники.
- `ScheduleImportPage` — админский импорт.

---

## 7. Mobile (Android)

### 7.1. Табы

`apps/mobile/app/(tabs)/_layout.tsx`: «Головна», «Пошук», «Графіки», «Інфо».
Корневой layout `apps/mobile/app/_layout.tsx` подключает storage, API, offline-пакет,
провайдеры региона/настроек/синхронизации/обновлений, тему и уведомления.

### 7.2. Нативные модули

`apps/mobile/native-android/java/ua/com/svitlo/app/`:

- `OtaBundle.kt` — выбор OTA-бандла и откат по маркеру `.booted`;
- `AppRestartModule.kt`, `AppRestartPackage.kt` — перезапуск после OTA;
- `widget/*` — `SvitloWidget2x1`, `SvitloWidget4x1`, `SvitloWidget4x2`,
  `HeroWidgetRenderer`, `WidgetPayload`, `WidgetPrefs`.

Плагины prebuild:
- `apps/mobile/plugins/withSvitloNative.js` — разрешения, signing config, versionCode,
  `expo.useLegacyPackaging=true` (`:246`), `reactNativeArchitectures=arm64-v8a` (`:247`);
- `apps/mobile/plugins/withAndroidWidget.js` — receiver'ы виджетов и регистрация пакета.

Вопреки `apps/mobile/README.md:66-68`, виджеты **есть** и в текущем APK.

Виджет не ходит в сеть сам: во всех `res/xml/svitlo_widget_*.xml` стоит
`updatePeriodMillis=0`, а снимок пишет JS только с главного экрана через `useHomeWidget`.
После убийства процесса или перезагрузки показывается последний снимок из `SharedPreferences`
до следующего открытия приложения. Проблемы на HyperOS/One UI и diagnostic-план — в
`PROJECT_AUDIT.md` («Открытый вопрос: виджеты…»).

### 7.3. OTA

- JS-бандл и ресурсы: `apps/mobile/src/lib/ota.ts`.
- Манифест читается сначала с
  `https://raw.githubusercontent.com/OlegVapnik/svitlo/main/ota`, fallback —
  `https://svitlo-ua-4ze.pages.dev/ota` (`ota.ts:38-42`).
- Проверка sha256 **до** распаковки (`ota.ts:309`), gzip, минимальный размер 100 КБ,
  атомарная замена файла, ресурсы скачиваются рядом с бандлом.
- Нативный загрузчик при старте ставит `.booted`; JS снимает маркер после успешного
  монтирования; если маркер остался — откат к вшитому бандлу.
- OTA меняет только JS и ассеты; нативные изменения требуют нового APK.

### 7.4. APK

- Сборка: `tools/build-android-apk.sh`.
- Release: только `arm64-v8a`, подпись из `apps/mobile/credentials/keystore.properties`,
  публикация в R2 `svitlo-apk/svitlo-latest.apk`.
- `versionCode` берётся из `apps/mobile/app.json`, а не из `git rev-list --count`.
- 2.37.9: `20 719 132` байт, sha256
  `72c70b717b7c587a4af2f6f63fcbb532dbd5c42050d3996b401a84ec6f21c951`
  (`apps/api/src/data/version.json`).
- Уменьшение размера достигнуто сжатием `.so` (`useLegacyPackaging=true`), ABI и число
  библиотек не менялись.

---

## 8. Fastify + PostgreSQL (резервный/эталонный API)

### 8.1. Состав

`apps/api/src/app.ts`:

- CORS (`plugins/cors.ts`), Helmet, rate limit 100 req/min, auth, Swagger;
- маршруты: health, outages, incidents, status, addresses, schedules, street-queues, queues,
  regions, places, reliability, settlements, news, sync, changelog, version, admin,
  admin-providers.

Точка входа: `apps/api/src/server.ts`; планировщик (`ENABLE_SCHEDULER`) и новости
(`NEWS_COLLECT_ENABLED`) включаются флагами.

### 8.2. Маршруты (сгруппировано)

- `/api/v1/health`, `/version`, `/changelog`
- `/api/v1/regions`, `/regions/coverage`
- `/api/v1/queues`, `/schedules`, `/schedules/upcoming`, `/schedules/:queue`
- `/api/v1/status`, `/reliability`, `/sync`
- `/api/v1/outages`, `/outages/stats`, `/outages/:id`, `/incidents`
- `/api/v1/news`, `/news/sources`; `POST /admin/news/collect`
- `/api/v1/settlements`, `/settlements/:id/queues`
- `/api/v1/addresses/suggest`, `/settlements`, `/streets`, `/houses`, `/resolve`,
  `POST /addresses/contribute`, `POST /admin/addresses/import`
- `/api/v1/street-queues`, `/street-queues/schedule`; `PUT/DELETE /admin/street-queues`
- `/api/v1/places/:account`; `PUT /admin/places`
- `POST /api/v1/admin/parse`, `/admin/schedules/import`, `/admin/schedules/fetch`,
  `/admin/schedules/import-telegram`, `/admin/schedules/import-mirror`
- `/api/v1/admin/providers`, `POST /admin/providers/sync`

### 8.3. PostgreSQL

Схема: `apps/api/src/db/schema.ts`; миграции: `apps/api/src/db/migrations/0001…0018`.

Таблицы: `sources`, `outages`, `outage_events`, `outage_event_addresses`, `addresses`,
`telegram_posts`, `incidents`, `regions`, `region_queues`, `schedule_slots`, `street_queues`,
`address_queues`, `subscriber_places`, `grid_status`, `parse_runs`, `geocode_cache`,
`settlements`, `settlement_queues`, `news_sources`, `news_items`.

Провайдеры: `apps/api/src/providers/` — `mirror`, `dtek`, `yasno`, `esvitlo`,
`chernihiv-oblenergo`, `registry`.

---

## 9. Общие пакеты

- `packages/shared/src/index.ts` — zod-контракты API, типы, общие константы.
- `packages/shared/src/regions-catalog.ts` — канонический каталог и `feedKeys`.
- `packages/core/src/api/` — клиент, запросы, offline.
- `packages/core/src/lib/` — расчёты интервалов, очередей, региона, статусов, закладок.
- `packages/core/src/storage.ts` — интерфейс key-value; веб — `localStorage`, mobile —
  `expo-sqlite/kv-store`.

---

## 10. Build / release / deploy

### 10.1. Версия

```bash
./tools/bump-version.sh patch   # X.Y.Z + versionCode + все package.json
./tools/bump-version.sh show
```

Источник `versionName`: `apps/mobile/app.json`; `versionCode` — там же.

### 10.2. APK

```bash
./tools/build-android-apk.sh --no-publish --skip-tests   # локальная сборка
./tools/build-android-apk.sh --publish-only             # залить готовый APK в R2
```

Скрипт проверяет:
- ABI только `arm64-v8a`;
- отсутствие `assets/data/address*` и `assets/ota*` в APK;
- `versionCode`/`versionName`;
- подпись тем же сертификатом.

### 10.3. OTA

```bash
./tools/build-ota-bundle.sh
./tools/publish-ota.sh
```

`build-ota-bundle.sh` пишет только `apps/web/public/ota` (бандл + `version.json`).
`publish-ota.sh` собирает web и деплоит Pages. **Но** приложение первым читает GitHub raw
`ota/`, поэтому корневой `ota/` нужно синхронизировать и пушить вручную; иначе новый
манифест на GitHub может указывать на старый бандл. `OTA_DIR` в `publish-ota.sh:25`
фактически не используется.

### 10.4. Worker

`deploy-cf.sh` отсутствует, хотя на него ссылаются `docs/AI-ONBOARDING.md`,
`cf-worker/schema.sql` и `tools/build-ota-bundle.sh`. Фактический деплой:

```bash
./cf-worker/node_modules/.bin/wrangler deploy --config=cf-worker/wrangler.toml
```

Секреты (ingest-токен) задаются через `wrangler secret put`.

### 10.5. Pages

```bash
./cf-worker/node_modules/.bin/wrangler pages deploy apps/web/dist \
  --project-name=svitlo-ua --branch=main
```

`apps/web/public/_redirects` проксирует `/api/*` на Worker.

---

## 11. Конфигурация

### 11.1. Worker (`cf-worker/wrangler.toml`)

- `MIRROR_SCHEDULE_URL` — зеркало ДТЕК;
- `MIRROR_SCHEDULE_IMPORT_REGIONS` — ограничение импорта (закомментировано);
- `NEWS_CHANNELS` — `chernigivoblenergo,ukrenergo,dtek_ua`;
- `CHERNIHIV_WEB_ENABLED`, `CHERNIHIV_CITY_IDS`, `CHERNIHIV_WEB_BASE_URL`;
- секреты: `SVITLO_INGEST_TOKEN` / `SCHEDULES_INGEST_TOKEN`, `NEWS_RSS_URL`.

### 11.2. Fastify (`apps/api/src/config.ts`)

`DATABASE_URL`, `API_PORT`, `API_HOST`, `ADMIN_TOKEN`, `PARSE_INTERVAL_MINUTES`,
`PARSE_INTERVAL_JITTER_MINUTES`, `PARSE_TIMEOUT_MS`, `PARSER_USER_AGENT`,
`CHERNIHIV_*`, `OPERATOR_SCHEDULE_URL`, `MIRROR_SCHEDULE_*`, `PROVIDER_SYNC_*`,
`YASNO_API_BASE_URL`, `DTEK_*`, `ESVITLO_BASE_URL`, `CAPTCHA_SOLVER_*`,
`USE_MOCK_ADAPTER`, `ENABLE_SCHEDULER`, `NEWS_COLLECT_*`, `TRUST_PROXY`,
`TELEGRAM_*`, `NOMINATIM_*`, `CORS_ORIGINS`, `NODE_ENV`, `LOG_LEVEL`, `TZ`.

В production `ADMIN_TOKEN` обязан быть явно задан, ≥16 символов и не равен известным
дефолтам (`config.ts:131-137`).

### 11.3. Клиенты

- Web: `VITE_API_BASE_URL`; по умолчанию относительный `/api/v1`.
- Mobile: `EXPO_PUBLIC_API_BASE_URL`; по умолчанию прод-Worker
  (`apps/mobile/app/_layout.tsx`).
- Mobile address packs: `EXPO_PUBLIC_ADDRESS_PACKS_BASE_URL`.
- OTA: `EXPO_PUBLIC_OTA_BASE_URL`, `OTA_PUBLIC_BASE`.

---

## 12. Проверки

```bash
# web
pnpm --filter @svitlo/web test          # 28 файлов, 241 тест
pnpm --filter @svitlo/web lint          # tsc --noEmit

# worker
cd cf-worker && npm test                # 5 файлов, 35 тестов
cd cf-worker && ./node_modules/.bin/tsc --noEmit

# mobile
pnpm --filter @svitlo/mobile typecheck  # tsc --noEmit

# api
pnpm --filter @svitlo/api test          # unit/интеграционные; интеграционные требуют PostgreSQL
pnpm --filter @svitlo/api lint
```

Фактически проверено 22.10.2026:
- web: 28 файлов / 241 тест — pass;
- cf-worker: 35 тестов — pass;
- web lint, mobile typecheck — pass;
- `pnpm audit --prod`: 7 уязвимостей (3 moderate, 4 high) в транзитивных зависимостях
  (см. `PROJECT_AUDIT.md`).

---

## 13. Оперативные ограничения

1. **D1 Free Tier**: 5 млн чтений / 100 тыс. записей в сутки. Не делать `d1 export`
   целиком; не запускать тяжёлые SQL без нужды; писать только diff.
2. **APK только `arm64-v8a`**: на x86/32-бит не установится.
3. **Одна страна — один зеркальный payload**: зеркало отдаёт не все области; для
   отсутствующих источников честно показывается «немає даних».
4. **OTA не меняет native**: новые виджеты/разрешения/библиотеки — только новый APK.
5. **GitHub raw — первичный OTA-источник**: после публикации OTA синхронизировать
   корневой `ota/`.
6. **`versionCode` нельзя считать из git history** после очистки: только `app.json`.
7. **Ingest из GitHub Actions не использовать**: Energy-UA отдаёт 403 Worker'у; сборщик
   должен иметь браузерный TLS-отпечаток, но текущая эксплуатация обходится без GH Actions.

---

## 14. Расхождения документации

| Документ | Утверждение | Факт |
|---|---|---|
| `README.md:102` | есть `skills/` | каталога нет |
| `README.md:112` | `docker compose up -d db` | `docker-compose.yml` отсутствует |
| `README.md:151` | APK 35,6 МБ | 2.37.9 — ~20 МБ |
| `apps/mobile/README.md:66-68` | виджетов нет | есть 3 виджета и провайдеры |
| `docs/AI-ONBOARDING.md:11,15,62` | Capacitor, 2.22.0, `deploy-cf.sh` | Expo/RN, 2.37.9, скрипта нет |

Эти расхождения не мешают работе кода, но вводят в заблуждение при онбординге; они
перечислены в аудите как отдельные findings.

Отдельно: `HANDOFF.md` говорит, что live — 2.37.8, а метаданные релиза — 2.37.9. Это не
устаревший документ, а неподтверждённое состояние прода: в этом проходе `GET /version` не
вызывался. Проверять перед релизом (см. `PROJECT_AUDIT.md`, L-4).

---

## 15. Быстрый индекс

| Что нужно | Куда смотреть |
|---|---|
| Версия/сборка | `apps/mobile/app.json`, `apps/web/src/version.ts` |
| Прод-API | `cf-worker/src/index.ts` + `cf-worker/src/modules/`, `cf-worker/wrangler.toml` |
| Схема D1 | `cf-worker/schema.sql`, `ensureSchema()` в `modules/schedule/repo.ts` |
| Cron/ingestion | `cf-worker/src/mirror-sync.ts`, `ingest.ts`, `telegram-schedule.ts` |
| Регионы | `packages/shared/src/regions-catalog.ts`, `cf-worker/src/regions.ts` |
| Адреса/очереди | `apps/api/src/services/address-lookup.service.ts` |
| Web-экраны | `apps/web/src/pages`, `apps/web/src/router.tsx` |
| Mobile-экраны | `apps/mobile/app/(tabs)`, `apps/mobile/src` |
| OTA | `apps/mobile/src/lib/ota.ts`, `OtaBundle.kt` |
| APK/OTA-скрипты | `tools/build-android-apk.sh`, `tools/build-ota-bundle.sh`, `tools/publish-ota.sh` |
| Тесты | `apps/web/src/**/*.test.ts`, `apps/api/tests`, `cf-worker/tests`, `tests` |
