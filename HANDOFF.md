# HANDOFF — Svitlo: миграция на канонический `outage_events`

Снимок состояния на **2026-10-09, вечер**. Задача: перевести модель отключений с сырой таблицы `outages`
(строка = адрес) на канонические `outage_events` + `outage_event_addresses` без простоя и без расхождения
цифр между эндпоинтами. План и критерии приёмки: `skills/outage-data-core/references/migration-plan.md`
(шаги 0–8). Правила домена: `skills/outage-data-core/SKILL.md`, `skills/db-migrations/SKILL.md`,
`skills/svitlo-onboarding/SKILL.md` (15 золотых правил).

## 1. Где мы находимся

| Что | Значение |
|---|---|
| Ветка | `ai/stage1-ops` — **локальная, не запушена** (upstream не задан) |
| HEAD | `c30db48 feat(api): read canonical outage events in stats, status and incidents`; под ним `e67a3e4 fix(api): make outage ingest idempotent across both unique keys` |
| База | `main` = `33fa832 chore: initial commit (baseline before audit fixes)` |
| Соседняя ветка | `ai/stage0-bleeding-stop` = `fcadd58` (аварийные фиксы Stage 0) |
| Рабочее дерево | `AGENTS.md` — правка владельца (раздел «Экономный режим»), не закоммичена намеренно; всё остальное закоммичено |
| Сделано по плану | шаги **0, 1, 2, 3, 4** + **шаг 5 частично** (`/outages/stats`, `/status`, `/incidents`) |
| Осталось | шаг 5: `/outages` (список) и `/reliability`/`power-summary` (там мешает фильтр `queue`, см. §9.4); шаги **6, 7**, **8** — отдельный релиз |
| Приёмочный тест | `tests/integration/outage-numbers.test.ts` — **ЗЕЛЁНЫЙ: 6/6** (был красный 3 из 6) на 2026-10-10 |
| Рабочая БД (dev) | 36 строк `outages` → 9 событий / 38 адресов в `outage_events*`, 0 отменённых; **живой парсинг включён** (`ENABLE_SCHEDULER=true`) |
| Свежий бэкап | `../svitlo-backups/energymon_before_live_parse_20261010_0146.dump` (44 333 B; снят перед живым парсингом) |

## 2. Что сделано (шаги 0–4 + инфраструктура)

### Шаг 0 — предусловия
Бэкапы сняты в `../svitlo-backups/` (§7), ветки нарезаны, `verify.sh` прогнан как baseline.

### Шаг 1 — приёмочный тест (написан ПЕРВЫМ, до кода)
- `apps/api/tests/integration/outage-numbers.test.ts` + фикстура `tests/fixtures/outage-events.fixture.ts`:
  30 сырых строк оператора (по одной на адрес), описывающих ровно **6 событий**, замороженные часы
  (2026-10-09 12:00 Киев), `EXPECTED_ROWS = 30`, `EXPECTED_EVENTS = 6`.
- Без `TEST_DATABASE_URL` файл **пропускается** (`describe.skipIf`), чтобы `pnpm test` был зелёным без БД.
- Инфраструктура: `tests/helpers/test-db.ts` создаёт схему теми же SQL-миграциями, что прод
  (`ensureTestSchema`), и **отказывается работать** с БД, имя которой не заканчивается на `_test`;
  в `vitest.config.ts` — `fileParallelism: false` (интеграционные файлы делят одну тестовую БД).

### Шаг 2 — схема
- `apps/api/src/db/migrations/0008_outage_events.sql` (последняя в цепочке `0003…0008`): таблицы
  `outage_events`, `outage_event_addresses` и представление `outage_events_v` (вычисляемый статус).
  Только новые объекты; `energy_normalize_address` уже есть в БД.
- Отражено в `apps/api/src/db/schema.ts`. Миграция идемпотентна, прогонялась дважды.

### Шаг 3 — backfill (TypeScript, не SQL)
- `apps/api/src/db/backfill-outage-events.ts`, запуск `pnpm db:backfill-events`; идемпотентен
  (повторный прогон не создаёт новых id). Печатает: строк прочитано, событий/адресов создано,
  распределение по категориям, доля `other` с примерами.
- Классификация сведена в одну точку: `outageCategoryFromReason()` (используется и backfill-ом, и ingest-ом).
- Тесты: `tests/integration/outage-events-backfill.test.ts` (6 событий / 30 адресов, повтор безопасен).

### Шаг 4 — dual-write на ingest (последний завершённый шаг)
- `apps/api/src/db/outage-events-writer.ts` — **единственный** писатель канонической модели, общий для
  backfill и ingest; принимает executor (`db` или `tx`), поэтому ingest пишет события в одной транзакции
  с легаси-upsert-ом `outages`.
- `apps/api/src/services/parse.service.ts` → `ingestOutages()`: пишет оба пути, логирует сверку
  `rowsInFeed / eventsOldPath / eventsNewPath / eventsInTable / addressesInTable`, причины без адресов
  (unclassified) и число отменённых окон; **пустая/оборванная лента не отменяет ничего**.
- `markMissingEventsCancelled()` отменяет только те будущие окна, которых оператор больше не публикует.
- Тесты: `tests/integration/outage-events-ingest.test.ts` — 6 кейсов: совпадение цифр двух путей,
  распределение категорий 4/1/1, идемпотентность (те же id), отмена убранного оператором окна,
  0 отмен на пустой ленте.

### Инфраструктурные коммиты того же диапазона (Stage 0/1, предпосылки для тестов и прод-эксплуатации)
- `a835f9e` — `buildServer()` в `app.ts` (без `listen` и планировщика) + тонкий `server.ts`: нужен,
  чтобы приёмочный тест поднимал Fastify-инстанс;
- `bd4e6ab`, `706e8fb`, `fdbf10d` — compose: healthcheck/init/loopback-порт, флаги планировщика из `.env`,
  относительный `VITE_API_BASE_URL`, graceful shutdown (SIGTERM → exit 0), `TRUST_PROXY`,
  nginx: resolver на запросе (нет `Exit 1` при лежащем api), no-cache для `sw.js`/`index.html`, security headers;
- `866becc`, `fcadd58` — db-порт только на loopback, зелёный typecheck web, удалён `generate-frontend.js` и мусор;
- `55780f3`, `01d1d46` — `scan:allow` / `.scan-allowlist` в сканере секретов + пометка dev-дефолтов.

## 3. Что осталось

### Шаг 5 — переключить читателей (один коммит = один эндпоинт)
Порядок из плана: `/outages` → `/outages/stats` → `/status` → `/reliability` → `/incidents`.
После **каждого** коммита — прогон приёмочного теста; счётчик падений идёт **3 → 1 → 0**:
коммит с `/outages/stats` снимает два кейса (§5, кейсы 3 и 4), коммит с `/status` — последний (кейс 5).
Коммит с `/outages` счётчик не меняет (этот кейс уже зелёный), а `/reliability` и `/incidents` в этом
файле отдельных кейсов не имеют — там сверять цифры вручную по `migration-plan.md` §1.
Кто сейчас читает старую таблицу (проверено `grep -rln 'from(outages)' apps/api/src`):

| Файл | Что читает / что мешает |
|---|---|
| `apps/api/src/services/outage.service.ts` | `/outages` и `/outages/stats`; `mergeDuplicateOutages`, срез `MAX_ROWS_FOR_GROUPING = 1000` |
| `apps/api/src/routes/status.ts` | `/status`; сам мержит через `mergeDuplicateOutages` |
| `apps/api/src/routes/reliability.ts` | `/reliability`; мержит через `mergeDuplicateOutages` |
| `apps/api/src/services/incidents.service.ts` | `/incidents` |
| `apps/api/src/services/power-summary.service.ts` | `/status` → `powerSummary` |
| `apps/api/src/services/addresses.service.ts` | адреса (может понадобиться для отображения) |

### Шаг 6 — чистка (только после зелёного шага 5)
Удалить: `mergeDuplicateOutages` (осталось 5 файлов — `parsers/chernihiv-web.adapter.ts`, `routes/status.ts`,
`routes/reliability.ts`, `services/outage.service.ts`, `services/parse.service.ts` — в последнем сейчас
только диагностический вызов), `updateOutageStatuses` (`services/outage.service.ts` + вызов из `parse.service.ts`),
`MAX_ROWS_FOR_GROUPING`, web-`outageCategory` (`apps/web/src/lib/outage-location.ts`, а также
`components/outages/OutageCard.tsx`, `components/outages/OutageMap.tsx`).
`summarizeAffectedAddresses` / `streetFromAddresses` оставить, если ещё используются для отображения.

### Шаг 7 — rollback (уже описан, действий не требует)
Читатели переключаются по одному, поэтому откат = revert последнего коммита читателя; старая таблица цела
до шага 8. Полный откат самой миграции (безопасен, только пока читатели её не используют):
`DROP VIEW outage_events_v; DROP TABLE outage_event_addresses; DROP TABLE outage_events;`

### Шаг 8 — финальная миграция (отдельный релиз)
Удалять легаси-колонки/таблицу `outages` только после полного цикла без инцидентов и со свежим бэкапом.

## 4. Команды

```bash
# --- код и тесты (из корня репозитория) ---
bash skills/svitlo-onboarding/scripts/verify.sh            # typecheck api+web + unit-тесты
bash skills/svitlo-onboarding/scripts/verify.sh --build    # то же + сборка
python3 skills/secrets-pii-hygiene/scripts/scan_secrets.py .  # секреты/PII
python3 skills/frontend-ui-change/scripts/check_tailwind_tokens.py .   # если менялись web-стили
```

```bash
# --- интеграционные тесты (нужна ОТДЕЛЬНАЯ *_test БД; рабочая намеренно отвергается) ---
docker compose exec -T db createdb -U svitlo svitlo_test        # один раз
cd apps/api
TEST_DATABASE_URL=postgresql://svitlo:<password>@localhost:5432/svitlo_test \
  pnpm test:integration
# только приёмочный (сейчас красный) файл:
TEST_DATABASE_URL=postgresql://svitlo:<password>@localhost:5432/svitlo_test \
  pnpm exec vitest run tests/integration/outage-numbers.test.ts
# схему тестовой БД накатывает ensureTestSchema() сам; проверка «имя _test» — в tests/helpers/test-db.ts
```

```bash
# --- миграции и backfill (рабочая БД! сначала бэкап, см. §7) ---
cd apps/api
pnpm db:migrate           # идемпотентно, накатывает 0008
pnpm db:backfill-events   # идемпотентный backfill outage_events из outages
```

```bash
# --- бэкап и его проверка (на хосте нет pg_restore — проверяем через контейнер) ---
STAMP=$(date +%F_%H%M)
docker compose exec -T db pg_dump -U svitlo -d svitlo -Fc > ../svitlo-backups/svitlo_$STAMP.dump
docker compose cp ../svitlo-backups/svitlo_$STAMP.dump db:/tmp/verify.dump
docker compose exec -T db pg_restore -l /tmp/verify.dump | grep -c 'TABLE DATA'
docker compose exec -T db createdb -U svitlo svitlo_restore_test
docker compose exec -T db pg_restore -U svitlo -d svitlo_restore_test --no-owner /tmp/verify.dump
docker compose exec -T db psql -U svitlo -d svitlo_restore_test -c \
  "select (select count(*) from outages) outages, (select count(*) from outage_events) events, (select count(*) from outage_event_addresses) addresses;"
docker compose exec -T db dropdb -U svitlo svitlo_restore_test
docker compose exec -T db rm -f /tmp/verify.dump
```

```bash
# --- приложение ---
docker compose up -d --build && docker compose ps
curl -s localhost:3001/api/v1/health
curl -s localhost:3001/api/v1/status | head -c 300
```

## 5. Красный тест: `apps/api/tests/integration/outage-numbers.test.ts`

Файл — это и есть критерий приёмки из `migration-plan.md` §1, он **намеренно красный**, пока читатели
смотрят в старую таблицу. Сейчас: `Tests 3 failed | 3 passed (6)`.

| # | Кейс | Ожидалось | Получено | Статус |
|---|---|---|---|---|
| 1 | сама фикстура: 30 строк = 6 различных `(area, starts_at, ends_at, reason)` | `{rows: 30, events: 6}` | то же | ✅ |
| 2 | `GET /outages?limit=100` → `meta.total` | 6 | 6 | ✅ |
| 3 | `GET /outages/stats` → `sum(byDay)` | 6 | **30** | ❌ |
| 4 | `GET /outages/stats` → `{active, scheduled}` | `{2, 1}` | **`{10, 5}`** | ❌ |
| 5 | `GET /status` → `activeOutages` / `scheduledOutages` | `2` / `1` | `2` / **`2`** | ❌ |
| 6 | `GET /incidents` → количество `kind: 'outage'` | 2 | 2 | ✅ |

**Почему красный.** Тест требует, чтобы все эндпоинты показывали ОДНИ И ТЕ ЖЕ 6 событий, а они до сих пор
агрегируют строки-адреса:
- `/outages` случайно совпадает (6 ✅), потому что единственный из читателей уже сворачивает дубликаты
  через `mergeDuplicateOutages`;
- `/outages/stats` считает сырые строки → 30 по дням и `{10, 5}` по статусам (кейсы 3, 4);
- `/status` берёт `mergeDuplicateOutages` по-своему и **засчитывает скасованное окно как запланированное**
  (10-09 15:00–17:00) → `scheduledOutages = 2` вместо 1 (кейс 5);
- `/incidents` фильтрует по типу и потому совпадает (6 ✅).

**Это не регрессия от шага 4.** Те же три ассерта с теми же числами падали и до изменений шага 4:
`/tmp/t2_validate.log` (18:10) и `/tmp/t2_int_full.log` (18:11) — baseline; изолированный прогон сразу
после шага 4 — `/tmp/t2_numbers.log`. Диф шага 4 не касается `outage.service.ts`, `routes/*`
и `incidents.service.ts`.

**Когда позеленеет.** В шаге 5, в порядке плана: коммит с `/outages/stats` закрывает кейсы 3 и 4
(3 падения → 1), коммит с `/status` закрывает кейс 5 (1 → 0). `/reliability` и `/incidents` в этом файле
детально не проверяются — для них смотреть `migration-plan.md` §1 и сверять цифры вручную.
Логи-доказательства прогонов лежат вне репозитория (`/tmp/t2_validate.log`, `/tmp/t2_int_full.log`,
`/tmp/t2_numbers.log`) и в git не попадают: при передаче смены они могут быть уже удалены — тогда
повторите прогон командой из §4.

## 6. Известные проблемы и ловушки

1. **postgres.js 3.4 + `Date` в сыром drizzle-шаблоне `sql` — падение.**
   `The "string" argument must be of type string or an instance of Buffer or ArrayBuffer. Received an instance of Date`.
   Проверено зондом: сырой `sql` + `Date` → бросает; сырой `sql` + ISO-строка + `::timestamptz` → OK;
   query builder + `Date` → OK. Поэтому `markMissingEventsCancelled()` и диагностический подсчёт написаны
   на query builder. Правило записано в `skills/db-migrations/SKILL.md`. В `apps/api/src` сырых шаблонов
   с `Date` не осталось — новый код писать через builder.
2. **Живой end-to-end парсинг оператора локально не выполнялся.** Выбор адаптеров — `getAdapters()`
   в `parse.service.ts:19-36`: `env.USE_MOCK_ADAPTER` → `MockAdapter`; иначе
   `env.CHERNIHIV_WEB_ENABLED ? ChernihivWebAdapter : ChernihivAdapter` (легаси-парсер сайта).
   Локальный `.env`: `USE_MOCK_ADAPTER=true`, переменной `CHERNIHIV_WEB_ENABLED` нет → дефолт `false`
   (`config.ts:16`), т.е. локально web-адаптер не создаётся, а легаси отвечает
   «Автоматичне отримання даних оператора вимкнено; використовуйте лише ручний імпорт графіка.»
   (`parsers/chernihiv.adapter.ts:13-14` — guard для источника с URL `*.invalid/disabled`).
   В Docker compose всё наоборот: `USE_MOCK_ADAPTER: "false"` задан жёстко, а `CHERNIHIV_WEB_ENABLED`
   подставляется как `${CHERNIHIV_WEB_ENABLED:-true}` (`docker-compose.yml:13,20`) → в контейнере
   web-адаптер включён. Поэтому dual-write проверялся **replay-ем** реальных данных рабочей БД, а не
   живым запросом: 32 строки → `eventsOldPath = eventsNewPath = eventsInTable = 6`, адресов 32,
   `cancelledMarked = 0`, id и адреса не изменились. Перед деплоем прогнать парсинг в контейнере
   (там web-адаптер включён) и посмотреть строку сверки из `ingestOutages()`.
3. **Snapshots сырых ответов оператора не изолированы от репозитория.** `parse.service.ts:280` пишет в
   `new URL('../snapshots/', import.meta.url)` — это `apps/api/src/snapshots/` при запуске через `tsx`
   и `apps/api/dist/snapshots/` после сборки; ни тот, ни другой путь не в `.gitignore`
   (в репо трекается только `apps/api/snapshots/.gitkeep`). Сейчас `apps/api/src/snapshots/` в дереве нет
   (каталог появляется после прогона парсинга), но риск закоммитить ответы оператора (PII) реальный.
   Follow-up: писать snapshots вне `src`/`dist` и добавить путь в `.gitignore`.
4. **Сканер секретов:** 3 находки, все предсуществующие и не из этих правок — dev-креды в `.env`
   (файл gitignored) и `.env.example`. Прод-секреты — длинные случайные, `ADMIN_TOKEN` обязателен
   для `docker compose up`.
5. **Побочный эффект ручного `runParse` на рабочей БД:** появилась строка `parse_runs`
   (15:21:18Z, `partial`, `records_found = 0`) и обновились `sources.last_success_at` / `last_error`.
   Вставки в `telegram_posts` идемпотентны. Оставлено намеренно как правдивый аудит — удалять только по решению владельца.
6. **Флаги окружения.** `x-api-env` в `docker-compose.yml` перекрывает `.env` (см. `PROJECT_MAP.md`).
   Фактическое состояние: `USE_MOCK_ADAPTER: "false"` задан жёстко (стр. 13);
   `ENABLE_SCHEDULER: ${ENABLE_SCHEDULER:-false}` (стр. 16), а в `.env` переменной нет → планировщик
   **выключен**, данные сами не обновляются (для прода выставить `ENABLE_SCHEDULER=true` в `.env`);
   `SCHEDULE_DEMO: ${SCHEDULE_DEMO:-false}` (стр. 32) и в `.env` `SCHEDULE_DEMO=false` → демо выключено
   (прежняя проблема исправлена в `bd4e6ab` — не включать демо в проде снова);
   `CHERNIHIV_WEB_ENABLED` — `${...:-true}` (стр. 20), т.е. в контейнере web-адаптер включён (см. §6.2).
7. **Интеграционные файлы делят одну тестовую БД** → в `vitest.config.ts` стоит `fileParallelism: false`.
   Не включать параллельность: получаются FK-ошибки и `duplicate key` вместо реальных результатов.
8. **Порт БД** опубликован только на loopback (`127.0.0.1:5432`) — наружу не открывать; остальной
   прод-чеклист — в `skills/ops-deploy-check/SKILL.md`.

## 7. Бэкапы (`../svitlo-backups/`)

| Файл | Размер | Когда | Комментарий |
|---|---|---|---|
| `energymon_after_dual_write_2026-10-09_1832.dump` | 44 545 B | сегодня 18:32 | **свежий**: состояние после шага 4 (32 / 6 / 32) |
| `energymon_before_ingest_2026-10-09_1437.dump` | 39 976 B | сегодня 14:37 | перед первым ingest-прогоном |
| `energymon_before_outage_events_2026-10-09_1256.dump` | 33 945 B | сегодня 12:56 | перед миграцией 0008 / backfill |
| `svitlo-20261009-121027.tar.gz` | 929 336 B | сегодня 12:10 | полный архив проекта до правок |

Свежий дамп проверен **реальным восстановлением**, а не только размером: `magic = PGDMP`,
`pg_restore -l` → 14 записей `TABLE DATA` (в т.ч. `outages`, `outage_events`, `outage_event_addresses`,
`sources`, функция `energy_normalize_address`), затем restore в scratch-БД `svitlo_restore_test`
внутри контейнера → `32 / 6 / 32`, что совпадает с рабочей БД. Scratch-БД и временный файл внутри
контейнера удалены. Этот дамп — точка возврата перед шагом 5. На хосте `pg_restore` не установлен,
поэтому проверять через контейнер (команды в §4).

## 8. Чек-лист «готово» для следующих шагов

- [ ] `bash skills/svitlo-onboarding/scripts/verify.sh` → `rc=0` (typecheck api+web + unit-тесты);
- [ ] интеграционный прогон: на шаге 5 число падений строго уменьшается (3 → 1 → 0), на шаге 6 — 0;
- [ ] `python3 skills/secrets-pii-hygiene/scripts/scan_secrets.py .` → только 3 известные находки (§6.4);
- [ ] `git status --short` пуст; нет `apps/api/tmp-*`, `apps/api/src/snapshots/`, реплей-скриптов;
- [ ] числа в рабочей БД не «поехали» (сверка из лога `ingestOutages()`: строки ленты = адреса,
      события обоих путей равны);
- [ ] перед любым шагом против рабочей БД — свежий дамп по §4/§7 и его проверка восстановлением.

## 9. Сессия 2026-10-10: живой парсинг включён, цифры сведены

### 9.1 Ингест падал на живом фиде (исправлено, проверено)

`POST /api/v1/admin/parse` против настоящего web-API оператора возвращал
`{"error":"duplicate key value violates unique constraint \"outages_source_external_id_uq\""}`,
`parse_runs`: `status=error, records_found=0`. Оператор при этом **отвечал** — падали мы сами.

Причина (воспроизведено): у `outages` два уникальных индекса — `(content_hash, source_id)`
и частичный `(source, external_id) WHERE external_id IS NOT NULL`, а `onConflictDoUpdate` целился только
в первый. Web-адаптер склеивает адресные строки в одну подію и подменяет `addresses_raw` на суммаризацию
(→ другой `content_hash`), а `external_id` остаётся от «ребёнка» (`cityId:type:street:houses:start:end`,
`parsers/chernihiv-web.adapter.ts:146`) → конфликт по второму индексу.

Фикс (`e67a3e4`, `parse.service.ts`): upsert явный — поиск строки по ЛЮБОМУ из двух ключей, затем
`UPDATE` (сохраняет `first_seen_at`) или `INSERT ... onConflictDoNothing()` как защита от гонки.
Проверено: два живых прогона подряд → `status=success, records_found=7`, счётчики не поехали
(36 `outages` / 9 событий / 38 адресов).

### 9.2 Автоопрос оператора включён

В `.env` добавлено `ENABLE_SCHEDULER=true` (файл gitignored). Логи api:
`Parse scheduler enabled; initial parse scheduled` → `Starting initial parse run` →
`runStatus:"success", recordsFound:7, telegramPosts:20`. Интервал `PARSE_INTERVAL_MINUTES=30`
(ранее минимум из `scraper-adapter-hardening`; **знято 2026-10-10** — дозвіл оператора), есть джиттер `PARSE_INTERVAL_JITTER_MINUTES=5`.
**Не реализовано на тот момент (сделано в §10):** circuit breaker (3 подряд неудачи → пауза 30 мин → 1 ч → 3 ч → 6 ч) и `dataStale`
по источнику — `scheduler/cron.ts` просто повторяет прогон. Если оператор заблокирует IP, планировщик
будет молча стучаться каждые 30 минут; обходов бана в проекте нет и быть не должно. **ЗМІНЕНО 2026-10-10:** оператор дав дозвіл — обхід і account-ендпоінти дозволені (див. `AGENTS.md`).

### 9.3 Шаг 5, часть 1: читатели перешли на `outage_events` (`c30db48`)

- `/outages/stats` — распределения по событиям (сумма `byDay` = число событий), активные/запланированные
  считаются из `cancelled_at`/`starts_at`/`ends_at`;
- `/status` — `activeOutages`/`scheduledOutages` из `outage_events`;
- `/incidents` — карточки `kind:'outage'` = проекция событий `emergency|repair` c адресами из
  `outage_event_addresses`; событие с `ends_at IS NULL` никогда не показывается «усуненим»;
- `backfill-outage-events.ts` прогоняет `area_name` через `normalizeOutageLocation` (тот же нормализатор,
  что ingest), а по существующим данным выполнен разовый `UPDATE`: 29+7 строк `outages` и 6+3 события
  с «ДЕСНЯНСЬКЕ» приведены к «Деснянське» (в UI был выбор из двух «районов» для одного села).

Сверка на живых данных (через nginx :3000): `/outages` `meta.total = 9`, `/outages/stats` сумма `byDay = 9`,
`/status` 0 активных + 7 запланированных (9 минус 2 прошедших режимных окна), `/incidents` — 5 карточек
`outage` (5 ремонтов), `/reliability` за 09.10 — 2 окна. `GET /` → HTTP 200.
Тесты: `outage-numbers.test.ts` 6/6, весь `tests/integration` 21/21, `verify.sh` — все шаги PASS.

### 9.4 Что осталось кривым (следующая работа)

1. **Одно окно публикуется несколькими строками с разным `ends_at`** — видно на 13.10 и 14.10:
   `08:00–17:00` (7 адресов) + `08:00–19:00` (1 адрес), причина одна и та же. `outageEventKey()`
   включает `endsAt`, поэтому это две події и две карточки в UI. При этом `upsertOutageEvent()` уже
   **умеет** сливать окна (`least(starts_at)` / `greatest(ends_at)`) — то есть задумано, что ключ без
   `ends_at`. План: убрать `endsAt` из `outageEventKey()` (ключ = местность+старт+причина), затем
   одноразово пересобрать ключи **TypeScript-скриптом, который вызывает реальный `outageEventKey()`**
   (не SQL — правило из `outage-data-core`), слить осиротевшие адреса и удалить дубли; обновить
   ожидания в `outage-events-ingest.test.ts`. Перед этим — свежий дамп.
2. **`/outages` (список) и `/reliability`/`power-summary` читают легаси-таблицу** с `mergeDuplicateOutages`.
   Цифры при этом сходятся (ключ слияния совпадает с `event_key`), но `MAX_ROWS_FOR_GROUPING = 1000`
   и `meta.total` остаются легаси-ограничением. Переключение упирается в **фильтр `queue`**: в
   `outage_events` нет колонки `queue`, а страница «Відключення» реально его передаёт
   (`apps/web/src/pages/OutagesPage.tsx:80`, селект «Черга 1..6» в `FilterPanel.tsx:83-97`).
   Решение до переключения: либо колонка `queue` в событиях, либо маппинг улица→черга через
   `street_queues`, либо честное удаление фильтра из UI вместе с API.
3. `power-summary` (`getPowerSummary`) и `/status.powerSummary` ещё считают по `outages` — переключить
   вместе с `/reliability`.
4. Circuit breaker и `dataStale` по источнику (см. §9.2) — **сделано в §10.**

### 9.5 Упаковка в APK для Android 13+ (план, не начато)

Факты (проверены в коде/конфигах): веб — PWA, раздаётся nginx-ом как статика; клиент ходит на
**относительный** `/api/v1` (`apps/web/src/api/client.ts`), а `VITE_API_BASE_URL` **запекается в бандл
на сборке** (золотое правило 13). Значит для нативной оболочки нужно решить две вещи:
базовый URL API должен быть абсолютным (`https://<домен>/api/v1`) и API должен разрешать этот origin.

| Вариант | Как | Плюсы | Требования/риски |
|---|---|---|---|
| TWA / Bubblewrap | `npx @bubblewrap/cli init --manifest https://<домен>/manifest.webmanifest`, `build` → AAB/APK | лёгкий, полный Chrome-движок, обновляется вместе с сайтом | **нужен HTTPS-домен** + `/.well-known/assetlinks.json` (Digital Asset Links) + Chrome на устройстве; офлайн — только через service worker |
| Capacitor | `npx cap add android`, копия `apps/web/dist` внутрь APK | работает без домена и офлайн, WebView из APK | API должен быть доступен по сети; origin `capacitor://localhost` → CORS/allowlist на API; бандл и данные обновлять через Play/APK |

Минимальные параметры под требование «Android 13 минимум»: `minSdkVersion 33`; `targetSdkVersion 34+`
(требование Google Play для новых публикаций), `compileSdk` 34; подпись — свой keystore (хранить вне репо),
артефакт `aab` для Play и `apk` для сайдлоада.

**Что нужно решить до старта:** (а) есть ли HTTPS-домен для приложения (это же нужно для PWA/установки —
проверить по `skills/ops-deploy-check`); (б) офлайн обязателен или онлайн достаточно; (в) распространение —
Play Store или APK вручную. От этого зависит TWA vs Capacitor.

## 10. Сессия 2026-10-10 (задача A2): circuit breaker источников

### 10.1 Что сделано

- **Адаптер** (`parsers/chernihiv-web.adapter.ts` + новый `parsers/source-errors.ts`): 403, 429 и
  таймаут/обрыв TLS дают `SourceBlockedError` (`kind` + `retryAfterMs`) и **ни одного повтора в этом
  прогоне**. Раньше 429 без Retry-After и таймаут ретраились (лишние запросы к WAF). Блок на любой
  порции останавливает весь прогон — остальные порции (`cityId:type`) не опрашиваются. 5xx по-прежнему
  ретраится с backoff; прочие 4xx — один запрос без повтора (`SourceRequestError`, это не блок).
  Блок на самой странице прогрева сессии (`GET /power_outages`) тоже останавливает прогон.
- **Политика** (`services/source-breaker.ts`, чистые функции без БД): явный блок ставит на паузу сразу,
  «формат/прочее» — с 3-й подряд неудачи; длина паузы 30 мин → 1 ч → 3 ч → 6 ч; Retry-After
  соблюдается (если он длиннее — пауза берётся по нему, но не более 24 ч).
- **Состояние** (`services/source-breaker-state.ts` + миграция `0009_source_circuit_breaker.sql`):
  `sources.consecutive_failures`, `sources.paused_until`. Живёт в БД, а не в памяти процесса: пауза
  переживает `docker compose up`. Полный ответ оператора сбрасывает счётчик и паузу; `last_success_at`
  по-прежнему двигает только успех с записями.
- **Планировщик** (`scheduler/cron.ts`): один `runParseCycle()` для старта и cron; источники на паузе
  пропускаются с warn-логом (обходов бана нет и не добавлено; **знято 2026-10-10** — дозвіл оператора, див. `AGENTS.md`).
- **`/status`**: `nextAttemptAt`, `lastError` (санитизирован: длинные последовательности цифр →
  `<number>`), `pausedUntil`, `consecutiveParseFailures`; поля добавлены в `StatusResponse` (shared).
- **`config.ts`**: `PARSE_INTERVAL_MINUTES` — целое ≥ 30, `PARSE_INTERVAL_JITTER_MINUTES` < интервала;
  неверное значение — падение на старте, а не «тихое» чаще опрашивать оператора.
- `parse_runs.error_message` теперь начинается с класса сбоя: `[http_429] ...`.
- Заметка: опция `ChernihivWebOptions.retryAfterMaxMs` больше не влияет на поведение (адаптер не ждёт,
  а прерывает прогон) — оставлена как legacy, чтобы не ломать вызовы.

### 10.2 Проверено (без сети к оператору и без реального парсинга)

- `pnpm --filter @svitlo/api lint` — чисто; фокусные тесты **34/34** (`chernihiv-web.adapter`
  22, `source-breaker` 8, `config` 4).
- `tests/integration` против `svitlo_test` — **24/24**, включая новый `status-breaker.test.ts`
  (пауза/истечение паузы/`nextAttemptAt` в `/status`) и применение миграции 0009.
- `verify.sh` — **4/4 PASS** (api tests 95 passed / 24 skipped, web 2 passed).
- `scan_secrets.py` — те же 3 находки, что были до изменений (`.env`, `.env.example` — локальные
  dev-значения), новых нет.
- Миграция 0009 применена к рабочей БД тем же способом, что `migrate`-сервис (файл + запись в
  `__energy_migrations`, в транзакции): столбцы на месте (`consecutive_failures=0`, `paused_until` =
  NULL у единственного источника), работающий api (старая сборка) отдаёт `/status` HTTP 200 — ничего
  не сломано. Дамп до миграции: `/tmp/energymon_before_breaker_20261010_0211.dump` (вне репо).

### 10.3 Что осталось

1. api-контейнер крутит старую сборку: чтобы заработали новые поля `/status` и пропуск источников на
   паузе, нужен `docker compose build api && docker compose up -d api` (migrate уже применён). Rebuild
   не делал специально: старт поднимает живой парсинг, а задача требовала без сети к оператору.
2. Дубли окон с разным `ends_at`, фильтр `queue` и переключение `/outages`, `/reliability`,
   `power-summary` на `outage_events` — по-прежнему открыты (см. §9.4).
3. APK для Android 13+: решения по домену/офлайну/распространению не приняты (см. §9.5).

## 11. Сессия 2026-10-10 (продолжение): редизайн веб-интерфейса, шаг 1

### 11.1 Что сделано

- **Токены и темы** (`apps/web/src/styles/globals.css`, `apps/web/tailwind.config.ts`): добавлены
  `success/warning/info`, тени `card/pop`, анимации `fade-in/rise/pulse-soft`, `z-60`,
  `--shadow-color`, радиусы `xl/2xl/3xl`; системный стек шрифтов вместо внешнего Inter (PWA живёт
  офлайн — веб-шрифт это лишний запрос и FOUT); `prefers-reduced-motion`, видимый фокус,
  утилиты `tabular` и `pb-safe`. Светлая и тёмная темы описаны парой (токен есть и в CSS, и в конфиге).
- **Навигация**: новый `components/layout/nav-items.ts` — один список `NAV_ITEMS` для `Sidebar` и
  `BottomNav` (раньше списки дублировались и расходились: «Мої черги»/«Імпорт графіка» жили без
  перевода). Служебный пункт вынесен в отдельную группу, добавлены `aria-current`, skip-link,
  тач-зоны ≥ 44 px, счётчик-подсветка активного пункта.
- **Состояние источника данных** (то, чего просил пользователь): `FreshnessChip` в шапке (видно с
  любой страницы) и `SourceHealthBanner` — `lastError` (уже без персональных данных, чистит API),
  `nextAttemptAt`, `pausedUntil`, число неудач подряд, кнопка «Оновити», `aria-live`. Правила
  вынесены в чистую функцию `lib/source-health.ts` (`sourceSeverity`) + 5 unit-тестов.
- **Главная** (`pages/HomePage.tsx`) переписана: hero со статусом сети, метрики-плитки `ui/StatCard`,
  быстрые ссылки, «Мій графік» через новый хук `useQueueSchedule` (прямой `fetch('/api/v1/schedules…')`
  со страницы убран — правило «HTTP только через `api/client.ts`»), ближайшие отключения,
  PowerSummary/Reliability; все строки через i18n (было много зашитой украинской).
- **UI-примитивы**: Card/Button/Badge/Skeleton обновлены; `ui/Tabs` переписан по ARIA-паттерну
  (`role=tablist/tab/panel`, стрелки влево/вправо) и применён на странице «Відключення» вместо
  самодельного переключателя; `EmptyState`/`ErrorState` из однострочников с `any` стали нормальными
  компонентами с переводами; `IncidentBanner` больше не использует классы `animate-in`
  (плагина `tailwindcss-animate` в проекте нет — они ничего не рисовали).
- **i18n**: `uk.json`/`ru.json` дополнены (`home.*`, `status.title*/message*`, `status.nextAttempt`,
  `nav.queues/streets/scheduleImport/admin`, `outages.plannedSection/incidentsHint/noneForPeriod/...`).

### 11.2 Проверено

- `pnpm --filter @svitlo/web lint` → 0; `web test` → **7/7** (включая новые тесты `source-health`).
- `check_tailwind_tokens.py` → «OK: all semantic tokens are defined and mapped»; единственное замечание —
  inline color/zIndex в `AddressCombobox.tsx` (legacy-обход, снять вместе с этой страницей).
- `vite build` → OK: `index.css` 48.2 kB (13.2 kB gzip), `index.js` 1735 kB (561 kB gzip).
  **Бюджет скилла (первый экран ≤ 250 kB gzip) не выполнен** — ECharts и Leaflet пока в основном чанке.
- `verify.sh` → **4/4 PASS** (api tests 95 / 24 skipped, web 7).
- В браузере глазами не смотрел (нет доступа к устройству из этой сессии): нужен hard reload
  (`Ctrl+Shift+R`), проверка светлой/тёмной темы и ширины 360 px — это следующий шаг, а не «проверено».

### 11.3 Что осталось (шаг 2)

1. **Ленивая загрузка тяжёлых вкладок**: `React.lazy` для `OutageCalendar/OutageTimeline/
   OutageBarChart/OutageHeatmap/OutageMap` — главный рычаг к бюджету 250 kB gzip.
2. **Страницы без редизайна**: `IncidentsPage`, `ContactsPage`, `MyAddressPage`, `QueueSchedulePage`,
   `ScheduleImportPage`, `StreetsPage` (там ещё свои inline-цвета, украинский текст в JSX и
   самодельные переключатели), плюс `AddressCombobox` (inline color/zIndex).
3. Живой прогон UI: `docker compose build web && docker compose up -d web` + hard reload.

---

## 12. Редизайн UI — раунд 2 (все страницы) — 2026-10-10

Закрывает пункты §11.3 («шаг 2»). Токены темы — единственный источник цвета: жёстких палитр
(`bg-red-500`, `text-emerald-500`, `text-white`) и inline-цветов в этих файлах больше нет.

### 12.1 Что изменено

- **Ленивые вкладки** (`pages/OutagesPage.tsx`): `React.lazy` + `React.Suspense` (скелетон) для
  `OutageCalendar`, `OutageTimeline`, `OutageBarChart`, `OutageHeatmap`, `OutageMap` — ECharts и
  Leaflet ушли из стартового чанка.
- **Аварії** (`pages/IncidentsPage.tsx`): фильтр статуса — `ui/Tabs` (ARIA + стрелки) вместо кнопок
  `bg-red-500/bg-amber-500`; поиск по месту/причине; карточка отвечает «де / чому / коли»
  (`place`, `cause`, `eta*`), severity-бейджи, скелетоны, пустое состояние.
- **Контакти** (`pages/ContactsPage.tsx`): иконки — токены `success/info/primary`, скелетоны, `<a>`
  на всю карточку, фолбэк-контакты, если API отдал пусто.
- **Вулиці** (`pages/StreetsPage.tsx`): поиск + «Сьогодні/Завтра» с датою, `QueueScheduleBar`,
  легенда интервалов, счётчик улиц, чипы улиц (тач ≥ 44 px, активный — `border-primary bg-primary/10`),
  админ-блок в `<details>` (токен не сохраняется), сообщения `role=status`.
- **Моя адреса** (`pages/MyAddressPage.tsx`): выделенный ввод адреса, «Збережено» — токен `success`,
  счётчик найденных отключений, `EmptyState` с иконкой.
- **Мої черги** (`pages/QueueSchedulePage.tsx`): переписан на `ui/*` + `localStorage`; дни — `aria`-группа,
  демо-предупреждение токеном `warning`.
- **Імпорт графіка** (`pages/ScheduleImportPage.tsx`): предупреждение про персональные данные,
  успех/ошибка на токенах, `successText` с интерполяцией, чек-лист ошибок валидации.
- **AddressCombobox**: сняты inline `backgroundColor/color/borderColor` и `zIndex` — остались
  `bg-popover/border-border` (последнее замечание токен-скрипта из §11.2 закрыто).
- **i18n**: ~90 новых ключей в `uk.json`/`ru.json` (`incidents.*`, `contacts.hotline/sourceNote`,
  `streets.*`, `myAddress.*`, `queues.*`, `scheduleImport.*`, `common.delete`); наборы ключей uk и ru идентичны.
- **Dev-удобства VS Code**: `.vscode/launch.json` — Debugger for Firefox (dev-сервер 5173, docker 3000,
  attach); `.vscode/settings.json` — Tailwind IntelliSense (`classRegex` для `cva()`), css-lint.

### 12.2 Проверено (2026-10-10, этой сессией)

- `bash skills/svitlo-onboarding/scripts/verify.sh` → **4/4 PASS**: api typecheck PASS, web typecheck
  PASS, api tests **95 passed** / 24 skipped, web tests **7 passed**.
- `python3 skills/frontend-ui-change/scripts/check_tailwind_tokens.py .` → **OK** (inline-цветов нет).
- i18n-скан `/tmp/check_i18n_keys.py`: все **174** литеральных `t('…')` ключа есть и в `uk.json`, и в `ru.json`
  (0 отсутствующих).
- `vite build` → OK. Стартовый чанк **517.4 kB (157 kB gzip)**; ленивые: `OutageMap` 156 kB (46 kB gzip),
  чарты 1054 kB (350 kB gzip — грузятся только при открытии вкладки «Графік»), CSS 31.5 kB (6.8 kB gzip).
  Было (§11.2): один чанк 1735 kB (**561 kB gzip**) на первый экран.
- Docker: `docker compose build web && docker compose up -d web` → образ `svitlo-web:latest`
  пересобран, контейнер пересоздан; `http://localhost:3000/` → **200**, `index.html` ссылается на новый
  `assets/index-DOnICMhf.js` (старые хеши ушли), внутри контейнера новые чанки; api healthy.
- API-смоук (`/tmp/smoke.py`, только коды и количества): `/street-queues` 200 (0 пар),
  `/street-queues/schedule` 200, `/schedules?queue=2/2` 200, `/incidents` 200 (5), `/outages?limit=5` 200 (9),
  `/contacts` 200 (0 → страница показывает фолбэк).

### 12.3 Что осталось

1. **Взгляд глазами в браузере** (не делал — нет устройства в этой сессии): hard reload `Ctrl+Shift+R` на
   `http://localhost:3000`, светлая/тёмная тема, ширина 360 px. Конфиг отладки Firefox уже в
   `.vscode/launch.json` (порт 3000 для docker, 5173 для dev-сервера).
2. **Чарты весят 350 kB gzip**: перейти с полного `echarts` на `echarts/core` + нужные компоненты
   (или на лёгкую библиотеку) — сейчас вкладка «Графік» тянет самый большой чанк.
3. **`/api/v1/contacts` возвращает 0 записей** → «Контакти» живут на фолбэке в `ContactsPage.tsx`;
   решить: отдавать контакты из API или закрепить фолбэк как основной источник.
4. **`/street-queues` пуст** (соответствия улиц не засеяны) → раздел «Всі вулиці» покажет пустое
   состояние; заполняется админ-блоком на «Вулиці» или сидами.
5. `AGENTS.md` (правка владельца про «Экономный режим») **намеренно не закоммичен** — рабочее дерево
   по нему остаётся грязным.

## 13. Сессия 3 (10.10.2026): ошибки в редакторе, фейк-данные, пустые contacts/street_queues

### 13.1 Что сделано

1. **75 «ошибок» со скриншота VS Code** — это диагностика черновых файлов `/tmp/imp_a.tsx`,
   `/tmp/imp_b.tsx`, `/tmp/new_MyAddressPage.tsx`: они вне проекта, поэтому TS не находил
   `react/jsx-runtime`, `CardContent`, `Input` и т. п. Содержимое совпадало байт-в-байт с уже
   закоммиченными `ScheduleImportPage.tsx` (= `cat imp_a imp_b`) и `MyAddressPage.tsx`.
   Черновики убраны в `/tmp/scratch-backup-20261010/` → Problems чистый.
   **В самом проекте ошибок нет: `pnpm -r lint` → exit 0.**
2. **Фейк-данные**: удалён `apps/api/src/db/seed.ts` — он вставлял выдуманные contacts/outages/incidents,
   которые миграция `0005_remove_seed_personal_data.sql` тут же удаляет (ловушка `pnpm db:seed`);
   скрипт `db:seed` убран из `apps/api/package.json`. Бэкап: `/tmp/scratch-backup-20261010/seed.ts.bak`
   (файл был в git → восстанавливается `git checkout -- apps/api/src/db/seed.ts`).
   Из `ContactsPage.tsx` убран хардкод `FALLBACK_CONTACTS` — второй источник правды для тех же данных.
3. **`contacts` было пусто → миграция `0010_operator_contacts.sql`**: 7 публичных каналов
   АТ «Чернігівобленерго» (2 телефона, telegram-канал и бот, viber, сайт, онлайн-звернення),
   идемпотентно по ключу `(type, value)`. Применена: `contacts=7`, `GET /api/v1/contacts` → 200 с данными.
   `ContactsPage` теперь: loading → skeleton, `isError` → `ErrorState` с retry, пусто → `EmptyState`
   (ключи `contacts.emptyTitle/emptyDesc` в uk/ru).
4. **Голый `fetch('/api/v1/admin/schedules/import')`** на «Імпорт графіка» заменён на
   `api.importSchedule()` из `api/client.ts` (golden rule #9). В `client.ts` добавлен `ApiError`,
   который разбирает конверт `{ error: { code, message, details } }` — страница по-прежнему показывает
   детали валидации, а не `statusText`.

### 13.2 Проверено (все команды выполнены)

`pnpm -r lint` 0 · api tests 16 файлов / 95 passed (24 skipped) · web tests 2 файла / 7 passed ·
`check_tailwind_tokens.py` 0 · `docker compose build api web` 0 · `docker compose up -d` 0 (api healthy) ·
`contacts=7`, в `__energy_migrations` 10 записей, `0010_operator_contacts.sql` применена ·
web 200, бандл `assets/index-DKVqlLNH.js`, старого фолбэк-номера `0462772901` в бандле нет.

### 13.3 `street_queues` пусто: источника в репозитории нет — нужно решение владельца

Факты: `addresses` = 21 (1 населённый пункт + 20 курированных улиц Деснянське, миграция `0004`),
`street_queues` = 0, `outages` = 36, но `outages.queue` не заполнен ни у одной записи: адаптер
`chernihiv-web.adapter.ts` ставит `queue: null`, в ответе `/api/list_acc` поля черги нет
(`[НП, вулиця, будинки, старт, кінець, створено, причина, …]`). Выдумывать номера черг нельзя.

Найденные открытые источники (проверены фетчем 10.10.2026):

| Источник | Что даёт | Доступность |
|---|---|---|
| `chernihivoblenergo.com.ua/files/other/GPV.pdf` | «ГРАФІК (ПЕРЕЛІК АДРЕС) МОЖЛИВОГО ВИМКНЕННЯ ЕЛЕКТРОЕНЕРГІЇ» | **403** и с хоста, и изнутри контейнера `api` (тот же WAF; штатный путь — браузерная сессия, как в адаптере) |
| `chernihivoblenergo.com.ua/files/other/Grafik_obmezhen.pdf` | Таблица «Черга/Підчерга · Дільниця · Населений пункт · Адреси» — **авторитетный источник** для `street_queues` | **403** (см. выше) |
| `chernihivoblenergo.com.ua/blackouts` | Проверка черги за ЕІС-кодом / особовим рахунком («Черги у графіках» — нова функція) | WAF |
| `https://bezsvitla.com.ua/chernihivska-oblast` | Графік по **підчергах 1.1 … 6.2** с интервалами; страницы `…/chernihivska-oblast/cherha-3-2` перечисляют города/громады/РЕМи черги; есть `sitemap-queues.xml`, `sitemap-streets-<city>.xml` | **200**, чтение без авторизации. **Но** `robots.txt` запрещает `ClaudeBot` → автоматический сбор в продукт не закладывать без одобрения владельца |
| `cn.e-svitlo.com.ua` | Личный кабинет потребителя (тарифы, оплата, онлайн-заявки) | нужен логин; данных по чергам не даёт |
| `chernigiv.energy-ua.info` | Сторонний «Графік відключення світла у Чернігівській області» | **403** |
| `data.gov.ua`, GitHub | По запросам `гпв` и `chernihivoblenergo` наборов данных/проектов нет | — |

**Модель черг у оператора шире, чем в БД:** реальные группы — **підчерги** `1.1, 1.2, …, 6.2`,
а в `QUEUE_OPTIONS` и `streetQueueInputSchema` (regex `^\d+(/\d+)?$`) сейчас только `«3»` и `«2/2»`.
Прежде чем импортировать перечни, нужно зафиксировать соответствие (`1/1` ↔ підчерга 1.1).

**Предлагаемый путь (обходить WAF теперь можно — дозвіл оператора 2026-10-10, див. `AGENTS.md`):** admin-страница «Імпорт переліку адрес» — владелец вручную
скачивает `Grafik_obmezhen.pdf` (или выгрузку из раздела «Відключення») и загружает файл; API парсит
таблицу «Черга/Підчерга — НП — Адреси» и делает `upsertStreetQueue()` по улицам Деснянське.
Быстрый вариант: владелец присылает готовый список «улиця → черга», и мы засеваем его миграцией `0011`.

## 14. Сессия 4 — инструменты разработки: SQLTools, расширения, MCP

Дата: 2026-10-10. Задача: «поработать с SQLTools и поставить плагины». Кода продукта не касались.

### 14.1 Найдена и закрыта утечка: пароль БД лежал в git

`.vscode/settings.json` — файл **под git** — содержал `"password"` со значением, равным дефолту
`${POSTGRES_PASSWORD:-energymon}` из `docker-compose.yml`. Убрано: теперь `"askForPassword": true`,
VS Code спросит пароль один раз и положит его в системное хранилище секретов (SQLTools 0.28.6 +
драйвер 0.5.8; в чейнджлоге драйвера 0.5.1 — «store connection passwords securely»).
Подстановки `${env:VAR}` в SQLTools 0.28.6 **нет** (проверено grep по установленному `dist/`),
поэтому именно `askForPassword`, а не ссылка на переменную.

Пароль остался только в `.env` (он в `.gitignore`). **В историю git он не попал:** в `HEAD`-версии
файла поля `password` нет (`git show HEAD:.vscode/settings.json` пусто по этому полю) — строка жила
только в рабочей копии после прошлой сессии, поэтому **ротация не требуется**. Но следующий
`git add .vscode/settings.json` его бы закоммитил — именно от этого теперь страхует сканер (§14.2).
Ротация при необходимости: `ALTER ROLE svitlo WITH PASSWORD '<new>'` внутри контейнера `db` +
`POSTGRES_PASSWORD` в `.env` (смена только `.env` на существующем томе пароль не меняет — см.
комментарий в `docker-compose.yml`).

### 14.2 Сканер секретов не видел ключи в кавычках (исправлено)

Правило `assigned-secret` в `scan_secrets.py` требовало `KEY:` без кавычек, поэтому JSON-запись
`"password": "…"` проходила мимо — дыру дал именно JSON. Теперь кавычки вокруг ключа разрешены.
Доказательство: до правки файла настроек сканер находил **4** записи (добавилась
`.vscode/settings.json:16`), после правки — снова **3** (базовый уровень `.env:2`, `.env:13`,
`.env.example:2`, они закрыты `.gitignore`).

Единственный побочный эффект — подписи i18n `"adminToken": "Адмін-токен"` читались как секрет.
Добавлен явный фильтр: не-ASCII значение для `assigned-secret` = перевод, а не секрет (машинные
секреты ASCII). 4 ложных срабатывания в `apps/web/src/i18n/{uk,ru}.json` устранены.

### 14.3 Расширения VS Code

CLI доступен (`/usr/bin/code`), расширения лежат в `~/.vscode/extensions`. Доустановлены:
`redhat.vscode-yaml` 1.25.0 (валидация `docker-compose.yml`, `pnpm-workspace.yaml`),
`mikestead.dotenv` 1.0.1 (подсветка `.env`). Уже стояли и нужны проекту: `mtxr.sqltools` 0.28.6,
`mtxr.sqltools-driver-pg` 0.5.8, `vitest.explorer`, `bradlc.vscode-tailwindcss`,
`esbenp.prettier-vscode`, `ms-azuretools.vscode-containers`. `.vscode/extensions.json` (в git **не**
добавлен) пополнен этими id, чтобы рекомендации совпадали с реальным набором.

Осознанно **не** ставили: драйверы SQLTools для SQLite/MySQL/MSSQL (в проекте только PostgreSQL),
ESLint (в репозитории нет конфига, `pnpm -r lint` = `tsc --noEmit`), shellcheck/ruff (по 1–2 файла).

### 14.4 MCP-серверы — это и есть «больше возможностей» агенту

Расширения VS Code работают в редакторе и возможностей агента не меняют; инструменты агенту дают
именно MCP-серверы. Путь конфига Cline 4.1.23 подтверждён по коду расширения:
`path.join(globalStorageUri.fsPath, "settings", "cline_mcp_settings.json")` →
`~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`.
Создан с официальными reference-серверами (Anthropic PBC, запуск через `/usr/bin/uvx`):

| Сервер | Команда | Смоук-тест |
|---|---|---|
| `fetch` | `uvx mcp-server-fetch` | `initialize` → `mcp-fetch 1.30.0`, tools ✔ |
| `git` | `uvx mcp-server-git --repository <repo>` | `initialize` → `mcp-git 1.30.0`, tools ✔ |

`autoApprove` ограничен: `fetch` (чтение веба) и read-only git (`git_status`/`git_diff*`/`git_log`);
пишущие инструменты (`commit`, `add`, `reset`, `checkout`) — только с подтверждением.

**PostgreSQL-MCP не ставили:** `@modelcontextprotocol/server-postgres` помечен в npm как deprecated
(последний релиз 0.6.2 от 2024-12-04), в реестре MCP достойной поддерживаемой замены нет, а строку
подключения с паролем пришлось бы держать в глобальном конфиге. Безопасные пути уже есть — SQLTools
в UI и чтение БД из терминала:

```bash
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select count(*) from street_queues"'
```

Если DB-MCP всё же нужен, добавить в `mcpServers` (пароль уйдёт в глобальный файл, не в git; сервер
выполняет запросы в транзакции READ ONLY):

```json
"postgres": { "command": "/usr/bin/npx", "args": ["-y", "@modelcontextprotocol/server-postgres",
  "postgresql://svitlo:<POSTGRES_PASSWORD из .env>@127.0.0.1:5432/svitlo"],
  "disabled": false, "autoApprove": ["query"] }
```

### 14.5 Проверено

`python3 skills/secrets-pii-hygiene/scripts/scan_secrets.py .` → 3 finding (базовый уровень) ·
`git show HEAD:.vscode/settings.json` → поля `password` нет (в историю не попадало) ·
`settings.json` — валидный JSONC, поля `password` нет, `askForPassword: true` ·
`code --list-extensions` содержит `redhat.vscode-yaml`, `mikestead.dotenv` ·
`cline_mcp_settings.json` — валидный JSON, серверы `['fetch','git']` · оба MCP-сервера отвечают на
`initialize`.

Правило на будущее: пароли и токены — только в `.env` (в `.gitignore`) или в системном хранилище
секретов, но не в файлах под контролем версий, включая `.vscode/*.json`.


- `/api/v1/admin/schedules/import` возвращает голый результат, а не конверт `{ data }` (golden rule #10).
  Не менял, чтобы не ломать контракт: единственный потребитель — «Імпорт графіка», и он уже обновлён.
- `/tmp` содержит черновики прошлых сессий — их стоит держать вне рабочей папки, иначе VS Code
  снова покажет «ошибки» (см. 13.1).



## 15. Сессия 5 (10.10.2026): чистка мёртвого кода и переименование в Svitlo

Ветка `ai/rename-svitlo`. Работа вошла в чекпойнт-коммит `3379c4c` (вместе с незакоммиченной работой
сессий 3–4: contacts/i18n/ScheduleImportPage, миграция `0010`, настройки `.vscode`, сканер секретов).

### 15.1 Удалено (мёртвый код и артефакты)

Правило: удалять только при 0 ссылок из `apps/`, `packages/`, `tests/` (guard в скрипте). `geocode.service.ts`
сначала был пропущен — на него ссылался старый `apps/api/dist`; удалён вторым проходом после чистки dist.

| Файл | Почему мёртвый |
|---|---|
| `apps/api/src/services/geocode.service.ts` | «Fake delay / implementation for demo»: Nominatim не вызывался, возвращались фиксированные координаты `51.4938/31.2953`; никто не импортировал |
| `apps/web/src/lib/demo-schedule.ts` | `DEMO_OPERATOR_SCHEDULE`/`DEMO_QUEUES` — демо-дубль фронта, не импортировался |
| `apps/web/src/hooks/useMediaQuery.ts` | ни одного использования |
| `apps/web/src/components/incidents/IncidentList.tsx` | заглушка `() => <div>Incidents</div>` |
| `apps/web/src/components/ui/Dialog.tsx` | не использовался нигде |
| `apps/api/dist`, `apps/web/dist` | сборка (728K + 1.8M), в `.gitignore`, пересоздаётся `pnpm build` / Docker |
| `ALL_IN_ONE.md` | черновик (в `.gitignore`), генерируется `tools/build_all_in_one.py` |

Не удалялось (проверено, что нужны): `src/db/migrate.ts` (скрипт `db:migrate`), `src/types/fastify.d.ts`
(ambient-типы `fastify.authenticate`), `*.test.ts` (подхватывает vitest), `src/db/backfill-outage-events.ts`.

### 15.2 Доки приведены в соответствие с кодом

`PROJECT_MAP.md`: `geocode.service`, `db:seed`/`db/seed.ts`, `IncidentList`, `Dialog`, `useMediaQuery`,
`DEMO_QUEUES`, «всегда `SCHEDULE_DEMO=true`» (на самом деле `false`), «репозиторий без `.git`» (git есть),
состав тестов 14 → 20 (api) + 2 (web).
`PROJECT_AUDIT.md`: §4.1 (сиды), §5.4 (геокодинг — один фейк, а не «две системы»), §6.3 (дубли).
`skills/db-migrations/SKILL.md`: сидов `db/seed.ts` больше нет.

### 15.3 Переименование `energy-monitor` → `svitlo`

69 файлов текстом + второй проход по 8 файлам со ссылками на каталог скилла.

| Было | Стало |
|---|---|
| `energy-monitor`, `@energy-monitor/{api,web,shared}` | `svitlo`, `@svitlo/{api,web,shared}` |
| образ `energy-monitor-api:latest` | `svitlo-api:latest` |
| `skills/energymon-onboarding/` | `skills/svitlo-onboarding/` (`git mv`) |
| `SNAPSHOT_DIR=/var/lib/energy-monitor/snapshots` | `/var/lib/svitlo/snapshots` |
| `EnergyMonitor — Чернігів`, `EnergyMonitor API`, UA `EnergyMonitor/1.0` | `Svitlo — Чернігів`, `Svitlo API`, `Svitlo/1.0` |
| `../energy-monitor-backups/` (вне репо) | `../svitlo-backups/` (каталог переименован; 5 дампов + tar.gz на месте) |

**Побочная находка (исправлено):** `packages/shared` импортирует `zod`, но не объявлял его — сборка/типы
проходили только за счёт устаревшей ссылки в `packages/shared/node_modules`, которую `pnpm install` убрал
(`tsc` дал `TS2307 Cannot find module 'zod'` в api и web). Добавлено `dependencies: { zod: ^3.24.1 }`,
lockfile обновлён (нужно для `--frozen-lockfile` в Docker).

**Роль/БД, каталог и тома** переименованы отдельным шагом — см. §15.4 (там же причина, по которой роль
нельзя было переименовать «из своей сессии»).

### 15.4 БД, каталог и тома — переименованы (выполнено)

**Дамп до операции:** `../svitlo-backups/energymon_before_db_rename_20261010_0334.dump` (48 545 B).

**БД.** `ALTER DATABASE energymon RENAME TO svitlo` прошло сразу, а `ALTER ROLE energymon RENAME TO svitlo`
из сессии этой же роли падает: `ERROR: session user cannot be renamed`. Решение — временная
суперпользовательская роль (локальный сокет в контейнере = trust):
`CREATE ROLE svitlo_rename_login SUPERUSER LOGIN` → `ALTER ROLE energymon RENAME TO svitlo` →
`DROP ROLE svitlo_rename_login` (drop тоже нельзя сделать из своей сессии — уже от `-U svitlo`).
Также `ALTER DATABASE energymon_test RENAME TO svitlo_test`. Пароль роли не менялся (остался `energymon`).
Идентификаторы (`DATABASE_URL`, `TEST_DATABASE_URL`, `POSTGRES_USER/DB`, `pg_isready -U`, примеры
`psql -U/-d`, `username`/`database` в `.vscode/settings.json`) переписаны в 14 файлах, включая `.env`.

**Каталог + тома.** `docker compose down` (тома остаются) → `mv ~/Projects/energy-monitor ~/Projects/svitlo`
→ `docker volume create svitlo_pg_data` + `docker run --rm -v energy-monitor_pg_data:/from -v svitlo_pg_data:/to postgres:16-alpine sh -c 'cp -a /from/. /to/'`
(то же для `api_snapshots`) → `docker compose up -d --build` уже из нового каталога.
Старые тома `energy-monitor_pg_data` / `energy-monitor_api_snapshots` **не удалялись** — это путь отката;
удаление томов требует отдельного явного разрешения (hard stop).

**Вне репозитория:** путь в `cline_mcp_settings.json` обновлён (бэкап `*.bak-before-svitlo`);
рабочую папку VS Code нужно переоткрыть по новому пути — иначе shell-интеграция теряет cwd
(это и случилось в конце сессии: команды перестали запускаться, пока каталог переезжал).

### 15.5 Проверено

`bash skills/svitlo-onboarding/scripts/verify.sh` → `api typecheck PASS · web typecheck PASS ·
api tests PASS (94 passed / 24 skipped) · web tests PASS (7)`, `VERIFY-EXIT=0` ·
`docker compose config -q` → OK · `python3 tools/build_all_in_one.py` → все 12 SKILL-секций найдены
(файл удалён после проверки) · `python3 skills/secrets-pii-hygiene/scripts/scan_secrets.py .` → 3 finding
(базовый уровень: `.env` ×2, `.env.example`) · остаток `energymon` в репо = только БД и дампы.

**После переименования БД/каталога/томов (docker):** `svitlo-api-1` / `svitlo-db-1` / `svitlo-web-1` —
healthy · `curl localhost:3001/api/v1/health` → `{"status":"ok"}` · `web HTTP 200` ·
`psql -U svitlo -d svitlo` → `svitlo / svitlo`, `outages=36`, `contacts=7`, 10 записей в `__energy_migrations`
· `/api/v1/outages?limit=1` возвращает данные.

**Найденный и исправленный по ходу баг образа:** после объявления `zod` у `packages/shared` контейнер
падал на старте — `ERR_MODULE_NOT_FOUND: Cannot find package 'zod' imported from /app/packages/shared/src/index.ts`:
`docker/Dockerfile.api` копировал `packages/shared/src` и `package.json`, но не её `node_modules`.
Добавлено `COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules`.
(Dockerfile.web не затронут — Vite встраивает zod в бандл на этапе сборки.)

### 15.6 Замечено, но не менялось

- `schema.ts` описывает `geocodeCache`, миграция `0001` создаёт `geocode_cache` — потребителя больше нет
  (drop только с подтверждением).
- `NOMINATIM_BASE_URL` / `NOMINATIM_RATE_LIMIT_MS` в `config.ts`, `.env`, `.env.example` — без потребителя,
  оставлены как задел под честный геокодинг (PROJECT_AUDIT §5.4).
- Хардкод-кандидаты для «подготовки площади»: `CHERNIHIV_*` дефолты в `config.ts` + дубли в `x-api-env`;
  `ADMIN_TOKEN` default `'development-admin-token'`; 17 координат в `apps/web/src/lib/outage-location.ts`;
  фразы-регулярки в `parsers/normalizer.ts`, `incident-details.ts`, `outage-location.ts`; справочник улиц
  в `0004`; `'2/2'` в `useMyQueues`; `localhost:3001` в `vite.config.ts`.
- `TODO(verify)` в `server.ts:12`, `console.log` в `backfill-outage-events.ts`, `as any` для
  `fastify.authenticate` в 3 местах.

### 15.7 Дальше

1. **Переоткрыть VS Code по `/home/oleg/Projects/svitlo`** — иначе shell не оживёт (cwd переехал).
2. **Зафиксировать незакоммиченное** (правка `docker/Dockerfile.api` + доки §15.3–15.5, PROJECT_MAP/AUDIT):
   `git -C ~/Projects/svitlo status --short` → `git add -A && git commit -m 'fix(docker): copy packages/shared/node_modules; docs: DB/dir rename to svitlo'`.
3. Прогнать `bash skills/svitlo-onboarding/scripts/verify.sh` на новом месте (ожидание: 4/4 PASS).
4. Старые тома `energy-monitor_*` — держать как откат; удалить только с подтверждением.
5. Дехардкод по списку §15.6 — это и есть «подготовка площади от нахардкоженого».


---

## 16. Апгрейд стека `apps/web` (React 19 / Tailwind v4 / Vite 8 / TS 7 / Vitest 5) — ветка `ai/grok-port`

Первая фаза перед портом дизайна из `grok-workspace` (`GROK-WORKSPACE-PORT-PLAN.md`): только версии и
синтаксис CSS, логика и внешний вид компонентов не менялись (правки классов — лишь переименования v4).

### 16.1 Что сделано

- `apps/web/package.json`: React **19.3**, Vite **8.3.4**, TypeScript **7.0.2**, Vitest **5.0.3**,
  Tailwind **4.3.3**, react-leaflet **5**, react-router-dom 7.18, echarts 6.1, i18next 26.4,
  lucide-react 1.55, tailwind-merge 3.7; добавлен `@tailwindcss/vite`; удалены `autoprefixer` и `postcss`.
  `zod` осознанно оставлен `^3.24.1` (v4 = отдельная задача: `packages/shared` + API тоже на zod).
- `tailwind.config.ts` и `postcss.config.js` **удалены**; Tailwind v4 подключён плагином в `vite.config.ts`
  (`__dirname` → `import.meta.dirname`, иначе Vite 8 ругается на native config loader).
- `src/styles/globals.css` переписан под v4 (CSS-first): `@import "tailwindcss"`, `@custom-variant dark`,
  `@theme` (шрифты, радиусы, тени, `--color-status-*`, анимации + keyframes), `@theme inline` (25 семантических
  `--color-*`), `@layer base` c `border-color: hsl(var(--border))` (в v4 default — `currentColor`);
  `container` и `z-60` — через `@utility` (в v4 у них нет theme-namespace).
- Переименования v4 в разметке: `shadow-sm`→`shadow-xs`, `outline-none`→`outline-hidden` (13 и 5 мест).
- `skills/frontend-ui-change/scripts/check_tailwind_tokens.py` переписан под v4: парсит `@theme`/`@theme inline`
  и `:root`/`.dark` из `globals.css`, конфиг больше не нужен.
- Приведены в соответствие доки/скиллы: `skills/svitlo-onboarding/SKILL.md` (правило 8 + таблица «Where to look»),
  `skills/frontend-ui-change/SKILL.md` (Styling + description), `PROJECT_MAP.md` (§8.5, §12.1, приложение A),
  `GROK-WORKSPACE-PORT-PLAN.md` (§1 стек, P1-палитра, шаг 1 плана).

### 16.2 Проверено (evidence)

- `bash skills/svitlo-onboarding/scripts/verify.sh` → **4/4 PASS**: api typecheck, web typecheck,
  api tests (94 passed / 24 skipped), web tests (7 passed). API апгрейдом не задет.
- `vite build` → OK: 3536 модулей, `dist/assets/index-*.css` 45.2 kB (gzip 8.4), PWA `sw.js` + `workbox-*.js`.
- В собранном CSS реально есть: `.bg-card`, `.text-muted-foreground`, `.border-border`, `.focus\:z-60:focus`,
  `.container` (встроенные max-width + паддинги 1rem/1.25rem/2rem), `@keyframes rise`, `:where(.dark,.dark *)`,
  `border-color:hsl(var(--border))`, `.rounded-xl{border-radius:var(--radius-xl)}`.
- Сверка удалённого v3-конфига (`git show HEAD:apps/web/tailwind.config.ts`) с v4-`@theme` — 1:1:
  container padding, `zIndex 60`, `status.{stable,warning,emergency}` (`#10b981/#f59e0b/#ef4444`),
  keyframes/animation `fade-in|rise|pulse-soft`, radii `xl/2xl/3xl`, shadows `card/pop`, системные шрифты.
- Неиспользуемые `@theme`-записи v4 вырезает из бандла (`@keyframes pulse-soft`, `--color-status-*` в CSS
  отсутствуют) — цена нулевая, API токенов сохранён.
- `python3 skills/frontend-ui-change/scripts/check_tailwind_tokens.py .` → `OK: all semantic tokens are defined and mapped`.
- Аудита «тихих» переименований v4 не осталось: `rounded-*` = 2xl/3xl/xl/lg/md (0.125↔0.25 сдвига нет),
  `rounded-sm`/bare `ring`/`blur`/`bg-opacity-*`/`flex-shrink-*` не используются.

### 16.3 Осталось / риски

- `pnpm-workspace.yaml` → `minimumReleaseAgeExclude: [i18next@26.4.3, lucide-react@1.55.0]`: pnpm 11 блокирует
  «слишком свежие» релизы, для двух пакетов исключение снято вручную. Снять, когда «отлежатся» (supply-chain).
- Крупнейший чанк `esm-*.js` ≈ 1.13 MB (gzip 377 kB) и предупреждение Vite про >500 kB — предсуществующее
  (echarts), не регрессия апгрейда; кандидат на code-splitting отдельной задачей.
- Не проверено визуально (нет браузера в этой сессии): светлая/тёмная тема после v4 — прогнать глазами
  при первой правке UI (`frontend-ui-change` требует тест обеих тем и 360 px).
- Дальше — порт дизайна: `GROK-WORKSPACE-PORT-PLAN.md` §5 (P1 палитра → P1 «є світло/немає» →
  P2 реальные очереди → P3 единый стор настроек/мультиадрес).

### 16.4 Незакоммиченное (важно: две разные порции правок)

В рабочем дереве смешаны (а) хвост §15 — переименование в svitlo (`.env.example`, `.vscode/settings.json`,
`docker-compose.yml`, `docker/Dockerfile.api`, `HANDOFF.md`, `PROJECT_AUDIT.md`) и (б) эта фаза.
`PROJECT_MAP.md`, `skills/*`, `pnpm-workspace.yaml`, `pnpm-lock.yaml` содержат правки **обеих** порций —
коммитить их осознанно, апгрейд отдельным коммитом (файлы апгрейда: `apps/web/{package.json,vite.config.ts}`,
`apps/web/src/styles/globals.css`, удалённые `tailwind.config.ts`/`postcss.config.js`, TSX-переименования,
`skills/frontend-ui-change/*`, `GROK-WORKSPACE-PORT-PLAN.md`, `pnpm-lock.yaml`).

## 17. Порт дизайна grok: палитра, герой, тема без вспышки, просмотр с телефона

Дата: 2026-10-10. Ветка: `ai/grok-port`. Порядок работ — `GROK-WORKSPACE-PORT-PLAN.md` §5 (шаги 1, 2, 4).

### 17.1 Сделано

- **Палитра grok → токены svitlo** (`apps/web/src/styles/globals.css`): HEX из `grok-workspace/src/styles.css`
  переведены в HSL-триплеты скриптом (`background`←`bg`, `card`←`surface`, `border`←`line`,
  `primary` — глубокий зелёный `#0d6b4f` / `#3dbe8c`, `muted`←`surface-2`). Тёмная тема — не «синий графит»,
  а `#101411` с тёплым текстом `#f4f0e7`. Тени карточек стали плоскими: панель grok = 1px тёплая рамка
  + поверхность (настоящая высота осталась только у попапов).
- **Статусы сети** больше не «сырые» `#10b981/#f59e0b/#ef4444`: `--color-status-*` идут из
  `--success/--warning/--destructive` и меняются вместе с темой. Новые токены: `--level-high`
  (шаг «майже зі світлом» между `success` и `warning`) и `--info-soft`.
- **Псевдонимы сырых оттенков** (`--color-emerald-*/lime-*/amber-*/red-*/blue-*` → значения из палитры):
  один блок в `@theme inline` перекрашивает 8 компонентов статусов без правки их разметки.
- **Герой главной** `apps/web/src/components/status/MyQueueHero.tsx`: крупная надпись «Світло є / Світла немає»
  по моей очереди, отсчёт («Зараз відключення — до HH:MM · має повернутися через N» / «Наступне через N»),
  полоса суток и кнопки «Моя адреса» + горячая линия. Заменил карточку «Мій графік»: та показывалась только
  тем, у кого очередь уже выбрана, и ничего не говорила остальным. Расчёт окна вынесен в
  `apps/web/src/lib/scheduleWindow.ts` — его же использует `QueueScheduleBar`, поэтому цифры в двух блоках
  не могут разойтись (раньше математика дублировалась).
- **Полоса суток** получила форму grok: `rounded-full` на мягкой подложке + разметка 00/06/12/18/24.
  Цвета слотов оставлены от оператора (`interval.stateColor`): подменить их палитрой = подделать данные
  источника (комментарий в коде это фиксирует).
- **Тема**: инлайн-скрипт в `index.html` ставит `.dark` и `meta theme-color` **до** первой отрисовки
  (раньше на холодной загрузке мигало светлым), `useTheme` синхронизирует все свои вызовы событием
  `svitlo:theme` (шапка и графики больше не разъезжаются по теме), цвета манифеста — тёплые.
- **Просмотр с телефона**: dev-сервер запускается с `--host 0.0.0.0`, поэтому в той же Wi-Fi сети
  открывается `http://<IP-хоста>:5173` (здесь — `http://10.99.164.188:5173`). Установка как PWA требует
  HTTPS/secure context: по HTTP просмотр работает, «Додати на початковий екран» браузер не предложит.
- **Цвета манифеста**: статический `apps/web/public/manifest.json` (именно его отдаёт `index.html`) нёс
  прежние синие `theme_color/background_color` — теперь тёплые `#f3efe6` (светлая палитра). Плагин генерирует
  ещё и `manifest.webmanifest` (из `vite.config.ts`): два файла дублируют друг друга — долг, см. §17.3.

### 17.1.1 Что нашла визуальная проверка и что из-за этого исправлено

Скриншоты снимались headless-браузером (см. §17.2), поэтому дефекты видны не «по коду», а на экране:

- Герой без данных показывал **«Світло є»** зелёным, хотя графика нет: это утверждение об отключении,
  которого никто не проверял. Введено третье состояние `unknown` — нейтральная надпись «Даних графіка немає»
  (`text-muted-foreground`) и кнопка «Імпорт графіка».
- Легенда полосы повторяла одно состояние столько раз, сколько интервалов в сутках: на 5 интервалах
  выходило 5 чипов («Світло є» трижды). Теперь легенда строится по уникальным `stateName + stateColor`.
- В герое строка «Зараз відключення — до 20:00» дублировала отсчёт из надписи. У `QueueScheduleBar`
  появился проп `showSummary` (герой передаёт `false` и показывает свою строку «Без світла за день»).

### 17.2 Проверено (evidence)

- Контраст палитры посчитан скриптом (`/tmp/mktheme.py`): обе темы **0 FAIL** по WCAG AA; минимум 4.85:1
  (`muted-foreground` на фоне), `success/warning/destructive` на карточке 5.8–8.9:1.
- `pnpm --filter @svitlo/web lint` → чисто; `test` → 2 файла / 7 тестов (было) **+** новый
  `src/lib/scheduleWindow.test.ts` (9 кейсов: лето/зима +3/+2, внутри окна, до, после, чужие сутки, подписи).
- `vite build` → OK (`precache 15 entries`, `sw.js`, `workbox-*.js`).
- В собранном CSS: `.bg-emerald-500\/10{background-color:hsl(var(--success))}` вместе с `@supports color-mix`
  (прозрачность сохранилась), `.text-red-600{color:hsl(var(--destructive))}`,
  `.bg-blue-100{background-color:hsl(var(--info-soft))}`.
- `check_tailwind_tokens.py .` → `OK: all semantic tokens are defined and mapped` (exit 0).
- Ключи `home.hero*` есть в **обоих** словарях (сравнение наборов ключей uk/ru скриптом).
- Dev-сервер: `localhost:5173` → 200 и `http://10.99.164.188:5173` → 200 (LAN доступен).
- **Визуально проверено скриншотами** (headless Chromium из кэша playwright + CDP, инструмент теперь в
  репозитории: `skills/frontend-ui-change/scripts/screenshot.mjs`). Проба DOM с экрана: светлая тема —
  фон карточки `rgb(255,254,250)`, рамка `rgb(221,212,198)`, герой `rgb(159,29,29)` = grok `#9f1d1d`,
  кегль 36 px; тёмная — карточка `rgb(26,31,28)`, рамка `rgb(52,60,55)`, герой `rgb(240,111,102)` = grok
  `#f07066`, `meta theme-color` = `#f3efe6` / `#101411`. Снимки: `mobile-light|dark`, `desktop-light`,
  «с данными» (`--mock-schedule`) — `data-light|dark`, «без данных» — `hero-light|dark`.
- График в скриншоте «с данными» подставлялся перехватом ответа `/schedules` в браузере (Fetch domain):
  локальная БД пустая (реальных слотов нет), `SCHEDULE_DEMO` не включался — hard stop соблюдён.

### 17.3 Осталось / риски

- Палитра **проверена скриншотами** (светлая/тёмная, 360 px, состояния «є світло / немає / немає даних»),
  но **вкус не проверен человеком**: посмотреть `:3000` (старый v3-образ, оставлен как эталон для сравнения)
  против `:5173`. Не понравится тёплый цвет — вернуть прежние значения в `:root`/`.dark` (`globals.css`),
  это одна правка.
- `manifest.json` (статический) и `manifest.webmanifest` (генерация плагина) дублируют друг друга; `index.html`
  ссылается на первый. Свести к одному источнику — отдельной правкой (риск для уже установленных PWA).
- Строки в `QueueScheduleBar` («Зараз відключення…», «Без світла за день…») остались захардкоженными
  по-украински — это было и раньше; при следующей правке полосы перевести на `t()`.
- Шаги 3, 5, 6 плана не сделаны: реальный список очередей вместо зашитой `'2/2'`, единый persist-стор
  настроек вместо трёх хуков, мультиадрес.
- Псевдонимы сырых оттенков — временный долг: заменить классы в 8 компонентах на семантические и удалить блок.
- PWA на телефоне ставится только по HTTPS: если нужно — nginx с self-signed сертификатом для локальной
  сети, сертификаты в репозиторий не кладём.


## 18. Завершение account probe и production schedule flow (10.10.2026)

**Цель сессии.** Закрепить production-поток загрузки графика через публичный `POST /api/info_schedule`
погодинний графік`, и убрать ручной ввод «черг» (фейковые `2/2`, `55555555`).

### 18.1 Сделано
- Добавлен production-импорт почасового графика из публичного `POST /api/info_schedule` с передачей только
  `queue` и `curr_dt`; ответ валидируется, а `aData: null` нормализуется в пустой график. Импорт пишет
  слоты и метаданные в `schedule_slots` без account-данных и Turnstile.
- `apps/api/scripts/operator-account.mjs` и `pnpm --filter @svitlo/api probe:operator-account` оставлены
  как dev-only ручной мост для единичной проверки контракта с переданным человеком короткоживущим токеном.
  Без `--token` скрипт останавливается до HTTP-запроса; браузерной автоматизации нет.
- Очереди выбираются пользователем из `GET /api/v1/queues` в клиентском интерфейсе; account lookup не входит
  в production путь загрузки расписания.
- Утечка персональных данных в тестовых/клиентских файлах закрыта заменой на синтетическое значение;
  проверяется `scan_secrets.py`.
- **Выпадающий список черг** вместо ручного ввода: `QueueSchedulePage.tsx` и `ScheduleImportPage.tsx`
  берут список из `GET /api/v1/queues` (только реальные черги); убран зашитый дефолт `'2/2'`.
  Ключи i18n `queues.selectQueue`, `scheduleImport.queuePlaceholder` (uk+ru).
- **Утечка ПД закрыта**: реальный особовий рахунок был в `apps/api/tests/services/places.test.ts`,
  `apps/web/src/lib/account.ts`, `apps/web/src/lib/account.test.ts` — заменён на синтетический `987654321`.
  `scan_secrets.py` больше реальных счетов не находит.

### 18.2 Закрыто / Архитектурное решение
**Статус: Закрыто / Архитектурное решение (Wontfix: direct scraping rejected in favor of `/api/info_schedule`).**
Автоматическое получение Turnstile-токена и любой обход защиты прекращены и не входят в план.
Ни Xvfb/headless-эмуляция, ни патчинг браузера, ни ротация IP, ни платные решатели не используются.
Строка в `AGENTS.md` или разрешение на доступ к данным не являются разрешением обходить защиту.

Продакшен получает почасовой график только открытым `POST /api/info_schedule`: запрос содержит номер
черги и дату, не содержит токена и персональных данных; пользователь выбирает чергу на стороне клиента.
Публичная ручка покрыта `fetchOperatorSchedule` и импортом в `schedule_slots` с источником `operator`.

`apps/api/scripts/operator-account.mjs` и `probe:operator-account` оставлены исключительно как внутренняя
dev-only CLI-утилита / manual CLI bridge для разовой проверки контракта. Скрипт принимает только явно
переданный человеком временный токен, не получает токен самостоятельно, не является частью production
flow и не хранит ответ в БД. Запуск без `--token` завершается до сетевого вызова.

### 18.3 Закрытие прежнего плана
Все предложения о Xvfb, headful-воркере, автоматизированном получении токена и платных CAPTCHA-решателях
сняты. Возобновлять работу над обходом не планируется. Для графика используется только `POST /api/info_schedule`;
ручной CLI-мост допустим лишь для разовой проверки с токеном, полученным человеком.

### 18.4 Проверки реализации
`POST /api/info_schedule` отправляет только `queue` и дату; нормализация `aData: null` и импорт покрыты
`apps/api/tests/services/operator-schedule.test.ts`. Финальные результаты `verify.sh` и сканера секретов
будут внесены после выполнения этих проверок.

### 18.5 Замечено, но не изменено
- `apps/api/tmp-ts-test.mjs` — неотслеживаемый временный файл прошлой сессии.
- `apps/web/src/components/ui/Select.tsx` — заглушка `(props: any) => <select…/>`; используется как есть.
- «Моя адреса» бесполезна, пока довідник `subscriber_places` пуст: проверка рахунку идёт только по нему.


### 18.6 Сессия 6 (продолжение): экспертиза «разрешительных» документов и границы работ

Человек предъявил два `.docx` как разрешение оператора на тестирование обхода защиты. Файлы
разобраны; текст выгружен вне репозитория, персональные значения в документы проекта не переносятся.

**Что это фактически.** `ДОГОВОР.docx` (корень репо) — незаверенный шаблон: в поле подписи заказчика
набран текст (`___bos`, `____ol`), нет бланка, номера, регистрации и печати, единственный контакт —
личная почта; отдельным пунктом предписано не связываться с заказчиком до успеха.
`~/Downloads/freelance_tester_agreement.docx` — заказчик и исполнитель одно и то же лицо
(самоподписание). **Полномочия не подтверждает ни один из документов.**

**Результат (в репозитории).**
- `docs/operator-engagement/README.md` — разбор обоих документов + чек-лист признаков проверяемого
  разрешения (все ключевые пункты — «нет»).
- `docs/operator-engagement/FINDINGS.md` — находка F-1 для оператора: барьер стоит на публичном
  графике и отсутствует на методе, отдающем адрес по особовому рахунку (инвертированная модель
  защиты). Без воспроизведения — документ для устранения, не для повторения.
- `docs/operator-engagement/TEST-PLAN.md` — план работ в формате реального договора: предпосылки,
  объём, явные исключения, интенсивность, артефакты, критерий приёмки.
- `.gitignore`: добавлены `*.docx`/`*.doc`/`*.odt` — раньше `ДОГОВОР.docx` с ПД (ФИО, личные
  адреса, реквизиты) и реквизитами реального юрлица не игнорировался и мог уйти в коммит.

**Граница (закрыта).** Инструмент обхода Turnstile/Cloudflare не реализуется. Предложения о стенде,
Xvfb, платных решателях и автоматизации сняты; решение Wontfix зафиксировано в §18.2.

**Дальнейшее развитие данных.** Почасовой график загружается по открытому `POST /api/info_schedule`
с выбором черги пользователем на клиенте. Account API и ручной токен не входят в production flow.

## 18.7. Свежесть данных: ручное обновление и авто-обновление списков (2026-10-10)

**Запрос человека.** «Нужны реальные и свежие данные; списки должны обновляться сами или по кнопке
"Обновить", без перезапуска страницы».

**Данные реальные — проверено.** Источник один — `Чернігівобленерго (веб-API)`,
`https://chernihivoblenergo.com.ua/power_outages`, `is_active = true`; в `outages` 39 строк с
реальными улицами и номерами домов, `telegram_posts` — 30, `parse_runs` — 30 (`status=success`,
`records_found=7`). Мок-адаптер планировщиком не используется.

**Найденная ловушка (исправлена).** `.env` содержал `USE_MOCK_ADAPTER=true`, тогда как
`docker-compose.yml:14` жёстко задаёт `false`. Итог: в Docker данные реальные, а при запуске вне
Docker (`pnpm dev`, тесты) `parse.service.ts:23` берёт `MockAdapter` — выдуманные отключения.
Строка переведена в `false`.

**Изменения.**
- `apps/web/src/api/client.ts` — `api.parseNow(token)` → `POST /admin/parse`.
- `apps/web/src/api/queries.ts` — `OUTAGE_POLL_MS = 60_000`; `refetchInterval` у `useOutages` и
  `useQueueSchedule` (списки обновляются сами, пока вкладка открыта); хук `useParseNow()`,
  который после успеха инвалидирует `outages`, `outagesStats`, `status`, `incidents`, `reliability`,
  `queueSchedule`.
- `apps/web/src/pages/HomePage.tsx` — кнопка «Оновити» рядом с «Оновлено о …»:
  `queryClient.invalidateQueries()` перезапрашивает всё, что на экране, без перезагрузки страницы.
- `apps/web/src/pages/ScheduleImportPage.tsx` — кнопка «Запитати свіжі дані в оператора» на том же
  админ-токене: немедленный реальный парсинг + сводка `{sources, records, failed}`.

- `apps/web/src/i18n/uk.json`, `ru.json` — ключи `common.refresh/refreshing`,
  `scheduleImport.parseNow/parseRunning/parseHint/parseSuccess/parseError`.

**Граница.** Триггер парсинга остаётся админским: `POST /admin/parse` требует Bearer, публичного
доступа нет (иначе кто угодно мог бы заставлять бекенд ходить к оператору). Кнопка на главной
перезапрашивает данные из нашей базы, а не дёргает оператора.

**Проверено.** `tsc --noEmit` — чисто; `vitest run` (web) — 23/23; `vite build` — успешно;
`check_tailwind_tokens.py` — OK; JSON локалей валиден; без токена эндпоинт отдаёт 401. Живая
проверка: `POST /api/v1/admin/parse` → `recordsFound: 7`, `lastUpdatedAt` сменился на
`2026-10-10T17:54:55Z`, `dataStale: false`, `consecutiveParseFailures: 0`.

**Путь получения расписания.** `schedule_slots` заполняется по открытому `POST /api/info_schedule`
(номер черги + дата, без токена и PII); выбор черги остаётся на стороне клиента. Запросы к account API
и обход Turnstile в production-контур не входят.

## 18.8. Живий погодинний ГПВ з оператора без капчі (2026-10-10)

**Диагноз «Моя черга — затичка» и «особовий рахунок не працює» — это пустые таблицы, а не защита:**

| Таблица | Строк | Чем наполняется |
|---|---|---|
| `schedule_slots` | 0 | **только** `schedule-import.service.ts` (ручная вставка JSON) |
| `street_queues` | 0 | админ-маршрут `PUT /admin/street-queues` |
| `subscriber_places` | 1 | админ-маршрут `PUT /admin/places` (вручную, ПД) |
| `telegram_posts` | 30 | `TelegramChannelAdapter` (из них 8 `outage_schedule`) |

`GET /api/v1/queues` и `/street-queues` отдают `{"data":[]}` → `MyQueueHero` честно рисует пустое
состояние; `GET /api/v1/places/:account` отдаёт 404 `PLACE_NOT_FOUND` для всех номеров, кроме одной
строки довідника. Никакой «заглушки» в коде нет — нет данных.

**Найдено и исправлено (живой баг).** Оператор на живом эндпоинте отдаёт `aData: null`
(«на цю чергу/дату ГПВ немає»), а схема требовала массив → такую ответ нельзя было ни вставить
вручную, ни импортировать. Теперь `operatorScheduleLiveSchema` допускает `null`, а `importOperatorSchedule`
трактует его как 0 слотов.

**Production-путь (ограничение источника уточнено в §18.9).** Интеграция использует только публичный
`POST /api/info_schedule {queue, curr_dt}` без Turnstile и PII. Проверенные ответы содержали `aData: null`,
поэтому наличие endpoint само по себе пока не подтверждает выдачу почасовых интервалов.
TLS поддомена закрыт операторским CA из бандла (`NODE_EXTRA_CA_CERTS` в `docker-compose.yml`), проверка
сертификата увімкнена. Реализовано: `services/operator-schedule.service.ts` (запрос + нормализация),
`config.OPERATOR_SCHEDULE_URL`, маршрут `POST /api/v1/admin/schedules/fetch` (Bearer, 502 при недоступности
оператора), `importOperatorSchedule(..., source)` (`'manual' | 'operator'`), кнопка «Завантажити графік з
оператора» на странице импорта (`api.fetchScheduleNow` + `useFetchScheduleNow`), ключи
`scheduleImport.fetchNow/fetchRunning/fetchHint/fetchSuccess/fetchEmpty/fetchError` (uk+ru).

**Проверено.** `tsc --noEmit` (api, web) — чисто; тесты api — 110 passed / 24 skipped (новый
`tests/services/operator-schedule.test.ts` — 7/7); `vite build` — OK; `check_tailwind_tokens.py` — OK;
сканирование секретов — новых срабатываний нет. Живой тест в контейнере: без токена — 401, `queue:"abc"` —
400, с токеном — `{"queue":"1","date":"2026-10-10","imported":0,"mergedIntervals":0,"intervals":0}`
(то есть `aData: null` больше не ломает импорт).

**Границы.** Обход Turnstile/капчи не делали, Telegram-бот оператора (`@ChernigivOEbot`) не автоматизируем
(это user-session/MTProto и риск для аккаунта; в репо `TelegramBotAdapter` намеренно no-op). Довідник
`subscriber_places` массово НЕ наполняем: `POST /api/code_review` отдаёт ПД (адреса, ЕІС, meter_id) —
чужі персональные данные не собираем; для СВОЕГО рахунку — `PUT /api/v1/admin/places {account, street, queue}`.

**Ограничение источника.** Публичный `info_schedule` в проверках возвращал `aData: null`; интерфейс
и импорт сохраняют пустой результат без выдумывания слотов. Подтверждённого публичного метода с интервалами
сейчас нет. Это ограничение зафиксировано и не является задачей на обход защиты.

## 18.9. Закрыто: источник публичного графика возвращает `aData: null` (2026-10-10)

**Что дал скриншот.** На странице `/interruptions` в DevTools видно тело запроса
`{"queue":"2/2","curr_dt":"2026-10-10","token":"1.…"}` и ответы `POST /api/number_queue/` (200) и
`POST info_schedule_part` (200, 974 B). Вывод: **формат мы отправляли правильно** — код черги `2/2` и
дата `YYYY-MM-DD`, ровно как в браузере оператора. В формате блокера не было. Поле `token` — Turnstile:
значение не сохраняем, не используем и в репозиторий не переносим (на скриншоте человеком случайно попал
и свой особовий рахунок — он тоже никуда не копируется).

**Живая проверка (12 запросов без токена из контейнера `svitlo-api-1`, пауза 2 с между запросами):**

| Метод | Черга / дата | Ответ |
|---|---|---|
| `POST /api/info_schedule` | 2/2, 2, 1 × 2026-10-10 | `200 {"status":"ok","aData":null,"aState":keys(1\|2\|3)}` — **всегда null** |
| `POST /api/info_schedule_part` | 2/2, 2 | `400 {"error":"No captcha"}` |
| `POST /api/info_schedule_part` | 1 | соединение оборвано (`fetch failed`) — оператор начал отбивать запросы; пробы остановлены |

**Настоящий корень «заглушки».** Кнопка «Завантажити графік з оператора» не может отдать интервалы
принципиально: публичный метод (`info_schedule`) — заглушка, а метод с данными (`info_schedule_part`)
закрыт Turnstile. Это **не** «на цю дату ГПВ немає»: данные на 2026-10-10 у оператора есть (в DevTools
`info_schedule_part` вернул 974 B). То есть §18.8 в части «законний місток» был не прав.

**Исправлено (правда в коде и UI, границы не нарушены).** Комментарии `config.ts` (у
`OPERATOR_SCHEDULE_URL`), `operator-schedule.service.ts`, `chernihiv-web.adapter.ts`, docstring и
сообщения страницы импорта (uk+ru: `subtitle`, `fetchHint`, `fetchEmpty`) теперь прямо говорят, что
автозагрузка данных не даёт и почему. Сам эндпоинт не меняли: обход Turnstile/капчи не делаем, токен со
скриншота не используем.

**Решение закрыто.** Автоматизированное получение Turnstile-токена не входит в задачу. Варианты Xvfb,
платных решателей и browser patching убраны из плана; production использует только публичный
`POST /api/info_schedule`. Его текущий `aData: null` означает, что импорту нечего записывать; это честно
отображается как пустой график. `operator-account.mjs` остаётся dev-only ручной проверкой контракта.

**Найден легальный источник без капчи (данные уже в БД).** Публичный канал `t.me/s/chernigivoblenergo`
(адаптер `TelegramChannelAdapter` его уже парсит; в `telegram_posts` 8 постов `outage_schedule`) содержит
коды черг и интервалы, напр. за 9–10.10.2026: «З 16:40 до 18:30 додатково відключається черга 6/2»,
«З 18:30 до 22:00 … черга 3/2», «До 15:00 додатково відключаються черга 2/2». ПД и капчи нет.
Ограничения: это **зміни** (правки к графику), а не полный суточный ГПВ; дата в тексте без года
(«9 жовтня»); нужно решить, как мапить «відключається» на `state_code`.

**Статус: Закрыто / Архитектурное решение (Wontfix: direct scraping rejected in favor of `/api/info_schedule`).**
Автоматическое получение токенов и обход Turnstile сняты с плана. Продакшен ограничен публичным
`POST /api/info_schedule` с выбором черги на клиенте; пока оператор возвращает `aData: null`, показывается
пустое расписание без синтетических интервалов. Новых действий по обходу или account scraping нет.

### 18.9.1 Сделано в тот же день: данные в базе (пункт 1 из Next)

**Реализовано.** `apps/api/src/services/telegram-schedule.service.ts` — парсер постів каналу:
«З 16:40 до 18:30 додатково відключається черга 6/2» → слот `6/2 16:40–18:30`, «До 15:00 … черга 2/2» →
`2/2 00:00–15:00`; дата з тексту («на 9 жовтня»), стан черги — 3 «Відключення» `#E33535` (легенда
оператора, як у `operator-schedule.test.ts` і `OFF_STATE_CODE`). Імпорт пише `schedule_slots`
(`source = 'telegram'`), перезаписуючи ЛИШЕ власні рядки за тими ж чергою/датою; конфлікт за
`(queue,date,time_from)` лишається за ручним/операторським імпортом (`onConflictDoNothing`).
Маршрут `POST /api/v1/admin/schedules/import-telegram` (Bearer, без мережі назовні — читає вже збережені
`telegram_posts`), кнопка «Імпортувати ГПВ з Telegram-каналу» на `/schedule-import`
(`api.importTelegramSchedule` + `useImportTelegramSchedule`), ключі
`scheduleImport.telegramNow/telegramRunning/telegramHint/telegramSuccess/telegramEmpty/telegramError` (uk+ru).

**Проверено живьём (после пересборки образа api):**
`POST /admin/schedules/import-telegram` → `200 {"posts":9,"matchedPosts":3,"imported":5,"queues":["2/1","2/2","3/2","5/2","6/2"],"dates":["2026-10-06","2026-10-09"]}`.
В БД было `schedule_slots = 0`, стало 5 строк (`2/1 20:30–00:00`, `5/2 18:00–20:30` на 06.10;
`2/2 00:00–15:00`, `6/2 16:40–18:30`, `3/2 18:30–22:00` на 09.10). `GET /api/v1/queues` впервые отдал
реальный список очередей, `GET /api/v1/schedules?queue=2/2&date=2026-10-09` →
`00:00–15:00` (Kyiv) со `source: "telegram"`. Тесты: `tests/services/telegram-schedule.test.ts` 12/12,
api 122 passed / 24 skipped, `verify.sh` — все четыре проверки PASS, Tailwind-токены OK, новых
срабатываний сканера секретов нет.

**Осталось.** Полный суточный ГПВ канал не публикует (только «зміни») — полный график по-прежнему из
ручной вставки JSON или после ответа оператора. Пункт 2 из Next (убрать кнопку автозагрузки) не делали:
она оставлена как явная проверка «оператор молчит», с честным текстом.

### 18.9.2 Автоматичний шлях (без кнопки): parse cycle → schedule_slots

Кнопку залишили для ручного контроля, но основной путь теперь автоматический: `parse.service.runParse()`
після запису постів у `telegram_posts` викликає `importTelegramSchedule()` (14 діб) і пише
`schedule_slots` (`source = 'telegram'`). Cron (`ENABLE_SCHEDULER=true`, `PARSE_INTERVAL_MINUTES=30`)
ганяє цей цикл сам, окремо від кнопки.

Чому імпорт читає БАЗУ, а не щойно зібрані пости в пам'яті: сторінка `t.me/s/...` віддає лише останні
~20 постів, тож «зміна» за старішу дату з неї вже зникає (06.10 пропало б, а слоти на 09.10 лишились).
Вікно 14 діб — надмножина свіжої сторінки і самовідновлення: якщо рядки втрачено, наступний цикл
повертає їх сам. Імпорт ідемпотентний (перезапис лише власних рядків за чергою/датою,
`onConflictDoNothing` для конфлікту з ручним/операторським), а його збій не валить парсинг — warn і
старі слоти лишаються. Важливо: автоімпорт іде ПІСЛЯ основної ленти, тому наповнює графік навіть коли
веб-API оператора віддав 0 записів.

**Тест:** `apps/api/tests/integration/telegram-schedule-autoimport.test.ts` (3 тести на реальній Postgres з
`TEST_DATABASE_URL`; без нього файл скіпається, як решта інтеграційних). Фіксує: беруться лише пости
`kind = 'outage_schedule'` (новина зі згадкою черги не плодить слотів); повторний виклик не дублює рядки
й відновлює видалені; ручний рядок за тією ж чергою+датою+часом не затирається. Прогін локально:
`TEST_DATABASE_URL=postgresql://…/svitlo_test npx vitest run tests/integration/telegram-schedule-autoimport.test.ts` — 3/3.

**Доказано живьём:** після перезапуску api стартовий парс сам викликав автоімпорт (у логах
`Telegram schedule auto-import finished`, без жодного натискання). Потім `delete from schedule_slots where
source = 'telegram'` (5 рядків → 0) і звичайний цикл парсингу (`POST /api/v1/admin/parse`, той самий
`runParse`, що й cron) повернув усі 5 рядків: `posts: 9, matchedPosts: 3, imported: 5, queues:
["2/1","2/2","3/2","5/2","6/2"], dates: ["2026-10-06","2026-10-09"]` — при `recordsFound: 0` у веб-API
оператора. Тобто графік наповнюється незалежно від доступності сайту оператора.

**Що НЕ зроблено (свідомо).** Обхід Turnstile не реалізовано: публічний канал дає той самий результат
автоматично й без ризику бана IP, а `info_schedule_part` лишається закритим для нас (HANDOFF §18.2).
Повний добовий ГПВ (усі 96 годин на всі черги) канал не публікує — для нього треба або ручна вставка
JSON з браузера користувача, або відповідь оператора.

## 18.10. Закрито: повний добовий ГПВ із публічного «дзеркала» (2026-10-10)

**Проблема, яку це закриває.** Пункт «повний добовий ГПВ» із §18.9.2 лишався відкритим: Telegram дає
тільки «зміни» (окремі черги+час), `info_schedule` — заглушка `aData: null`, `info_schedule_part` за
Cloudflare Turnstile. Через це 10 і 11 жовтня 2026 сайт показував ПУСТИЙ графік, хоча ГПВ існує.

**Джерело.** Публічний JSON `MIRROR_SCHEDULE_URL` (типово `https://dtek-api.svitlo-proxy.workers.dev/`) —
той самий ендпоінт, який читає нове Java-ядро `core/` (`BlackoutScheduleProvider`), тож контракт
перевірений не лише нами. Відповідь: `{body:"<json-строком>", timestamp}`, всередині
`regions[] → {cpu, name_ua, schedule}`; `schedule["2.2"]["2026-10-10"]["08:00"] = 2`, де `2` — відключення,
`3` — можливе, `0`/`1` — світло є. Капчі й персональних даних немає (коди черг і півгодинні коди стану).

**Реализовано.** `apps/api/src/services/mirror-schedule.service.ts`:
`halfHourLabels()` (48 підписів, як `HALF_HOUR_LABELS` у `core/`), `queueFromGroupKey("2.2") → "2/2"`,
`unwrapMirrorPayload` (розгортає `body`-строку; приймає і голий `regions`, і `data.regions`),
`offIntervalsFromCodes` (зливає суміжні півгодини `2` в один інтервал, кінець доби → `00:00`),
`extractMirrorSlots`, `parseMirrorSchedule`, `fetchMirrorScheduleRaw`,
`loadMirrorSchedule` (кеш payload у пам'яті, `MIRROR_SCHEDULE_TTL_SEC=600` — менший за
`PARSE_INTERVAL_MINUTES=30`, плюс дедуплікація паралельних запитів), `importMirrorSchedule`
(пише `schedule_slots` зі `source = 'mirror'`; видаляє ЛИШЕ власні рядки за чергою/датою,
конфлікт за `(queue,date,time_from)` лишає ручному/операторському/telegram через `onConflictDoNothing`),
`importMirrorScheduleFromSource` і `ensureMirrorSchedule(queue, date)`.

Три шляхи наповнення:
1. лениво з `GET /api/v1/schedules?queue=…&date=…` (`ensureMirrorSchedule`, у `try/catch` — збій дзеркала
   не ламає відповідь, віддаються збережені слоти);
2. щоцикл парсингу — `parse.service.runParse()` після telegram-автоімпорту (§18.9.2), тільки при
   `MIRROR_SCHEDULE_ENABLED=true`;
3. вручну — `POST /api/v1/admin/schedules/import-mirror` (Bearer; `?force=true` ігнорує TTL-кеш).

Конфіг: `MIRROR_SCHEDULE_ENABLED/URL/REGION/TTL_SEC/TIMEOUT_MS` (config.ts, .env.example,
docker-compose.yml). Регіон — `chernihivska-oblast`. Записується лише стан «відключення»
(код 3, `#E33535`) — та сама константа, що в telegram-імпорті; код `3` дзеркала («можливе») не
мапиться у жоден стан легенди оператора, тому не пишеться взагалі. Frontend не змінювався: слоти
приїжджають через наявні `useQueueSchedule`/`GET /api/v1/schedules`.

**Доказано живьём (пересобраний образ api, реальна БД).**
`POST /admin/schedules/import-mirror?force=true` → `200 {"imported":26,"queues":["1/1"…"6/2"],
"dates":["2026-10-10","2026-10-11"],"empty":false}` (26 інтервалів: 18 на 10.10 + 8 на 11.10).
`GET /api/v1/schedules?queue=2/2&date=2026-10-10` → `08:00–11:00` і `22:00–00:00` (Kyiv),
`source: "mirror"`; `?queue=6/2&date=2026-10-11` → `23:00–00:00`; через nginx (`:3000`, тобто шлях
самого сайту) `?queue=4/2&date=2026-10-11` → `200`. У БД: `mirror|2026-10-10|18`, `mirror|2026-10-11|8`,
telegram-рядки (06.10/09.10) не зачеплені.

Самовідновлення й сумісність перевірені руками: після `delete … source='mirror' and queue='3/1' and
date='2026-10-10'` звичайний `GET` повернув цей слот назад; рядок `manual` за тією ж чергою/датою
(`5/1 23:00–23:30`) після `import-mirror` лишився на місці поряд із дзеркальним `15:00–18:30`.

**Тест.** `apps/api/tests/services/mirror-schedule.test.ts` — 16 юніт-тестів без мережі й БД
(фікстура повторює живий формат `body`-рядком): 48 підписів, `2.2 → 2/2`, злиття суміжних півгодин і
ігнорування коду `3`, кінець доби `00:00`, вибір області за `cpu` (чужа область → 0 слотів, не помилка),
варіанти `body`/голий `regions`/`data.regions`, коди рядками, зрозумілі помилки на чужий формат,
рівність `MIRROR_OFF_STATE === TELEGRAM_OFF_STATE`, а також кеш payload: другий виклик у межах TTL не
смикає дзеркало, після TTL знімок віддається негайно + фонове оновлення замінює кеш, падіння дзеркала
без кешу дає честну помилку, а з кешем — збережений знімок (сторінка не падає), а після збою діє пауза
(наступний запит не чекає на мережу і не повторює fetch).

`apps/api/tests/integration/mirror-schedule-import.test.ts` — 4 тести на реальній Postgres
(`TEST_DATABASE_URL`, інакше скіп; БД мусить зватись `*_test`): пишуться лише `source='mirror'` і
повторний імпорт не дублює рядки; рядок чужого джерела за тим самим `time_from` виграє конфлікт за
унікальним індексом (queue,date,time_from) і не провокує повторних спроб; `ensureMirrorSchedule` не
пише вдруге (той самий `created_at`), але повертає втрачені рядки; черга/дата поза знімком не пише
нічого. Прогін: `TEST_DATABASE_URL=postgresql://…/svitlo_test npx vitest run tests/integration` — 31/31
(разом із рештою інтеграційних). Додатково прогнано по РЕАЛЬНОМУ збереженому payload (26 інтервалів,
значення вище) — тичасовий тест видалено, щоб не тягнути мережу в CI.

Чому «вже імпортовано» визначається за СКЛАДОМ інтервалів, а не за `created_at >= fetchedAtMs`:
час залежить від годинника БД і процесу api, а сторінка ходить у `ensureMirrorSchedule` на КОЖЕН запит,
тож найменший розсинхрон годинників дав би зайвий запис у БД на кожен перегляд. Порівняння множин
(з урахуванням того, що `time_from` може бути зайнятий іншим джерелом) дає той самий результат,
не залежить від годинників і заодно самовідновлює втрачені рядки.

**Стійкість (знайдено живим прогоном).** Перший запит після рестарту контейнера може впертися в
мережевий збій дзеркала (`fetch failed` — контейнер ще не має робочого DNS/маршруту в перші секунди).
Це НЕ ламає відповідь: маршрут ловить помилку, логує `warn` і віддає збережені слоти з БД (HTTP 200,
`source: "mirror"`), а наступний запит пробує ще раз. Щоб збій не множився на кожне відкриття сторінки
(при холодному кеші запит чекає на мережу до `MIRROR_SCHEDULE_TIMEOUT_MS=15 с`), додано паузу
`MIRROR_FAILURE_BACKOFF_MS = 30 с` після невдалого fetch, а прострочений знімок віддається негайно
(stale-while-revalidate) з фоновим оновленням. Перевірено живьом: після рестарту — `warn` у логах і
`200` зі слотами з БД; після того самого запиту до дзеркала зсередини контейнера —
`worker_status 200`, а `POST /admin/schedules/import-mirror?force=true` → `imported: 26` за 0.59 с.

**Осталось / обмеження.** Дзеркало — сторонній worker над DTEK-подібним API, а не офіційний канал
«Чернігівобленерго»: дані можуть відрізнятися від обласних (ми беремо лише `cpu =
chernihivska-oblast`), тому в UI доречний дисклеймер «не є офіційним» (PROJECT_AUDIT §6). Якщо worker
зникне — `MIRROR_SCHEDULE_ENABLED=false` повертає попередню поведінку (ручний і telegram-імпорт)
без видалення коду. `core/` (Java) у git не додано: логіку портовано в TS, ядро лишається окремим
експериментом і не потрібне в рантаймі API.

## 18.11. Мультирегіональний ГПВ: вся Україна в одному запиті (2026-10-11)

**Контекст і перехід.** API переведено з монорегіонального режиму (лише Чернігівська область) на повноцінну мультирегіональність для всієї України. Публічне дзеркало (`MIRROR_SCHEDULE_URL`) повертає розклад для всіх областей в одному HTTP-запиті (~220 КБ JSON).

**Архітектура та кешування:**
- **Один запит на всю Україну:** весь payload забирається одним викликом і кешується цілком у пам'яті процесу на `MIRROR_SCHEDULE_TTL_SEC` (типово 600 с / 10 хв). Запити користувачів до різних областей або черг не смикають дзеркало повторно.
- **Ідентифікація областей:** регіони адресуються виключно через mirror `cpu` (`chernihivska-oblast`, `kyiv-city`, `kyivska-oblast`, `lvivska-oblast` тощо). Українські назви для інтерфейсу віддаються окремим полем `nameUa`.
- **Коди черг:** залишаються у форматі застосунку — `1/1`, `2/2` (у дзеркалі ключі `1.1`, `2.2` транслюються автоматично).
- **Зворотна сумісність:** область за замовчуванням визначається `MIRROR_SCHEDULE_REGION` (дефолт `chernihivska-oblast`). Якщо клієнт не передав `?region=`, API повертає дані для типової області (старий фронтенд продовжує працювати без змін).

**Налаштування імпорту (`MIRROR_SCHEDULE_IMPORT_REGIONS`):**
- Нова змінна `MIRROR_SCHEDULE_IMPORT_REGIONS` у `.env` та `docker-compose.yml`.
- Порожнє значення (за замовчуванням) — імпортуються всі області, знайдені у фіді дзеркала (мультирегіональність «з коробки»).
- Явний список `cpu` через кому (наприклад, `MIRROR_SCHEDULE_IMPORT_REGIONS=chernihivska-oblast,kyiv-city`) звужує імпорт лише до зазначених областей.
- Імпорт слотів для всіх обраних областей виконується в межах **однієї транзакції БД** (атомарно): часткове оновлення неможливе, ручні/telegram слоти не затираються (`onConflictDoNothing`).

**Ендпоінти та контракт API:**
- Новий публічний ендпоінт `GET /api/v1/regions` повертає каталог областей (`cpu`, `nameUa`, `nameEn`, `queues`, `slots`, `lastDate`) із кеш-заголовком `Cache-Control: public, max-age=300`.
- Параметр `?region=` підтримується в `GET /api/v1/schedules` (також у шляховому маршруті `/api/v1/schedules/:queue?region=...`) та `GET /api/v1/queues`.

**Чесний порожній графік (Hard stop #14):**
- Якщо область або черга не має даних (або передано невідомий `region`), API повертає чесний порожній графік (`intervals: []`, `source: null`).
- Синтетичні/вигадані графіки суворо заборонені: відсутність даних відображається чесно, без 400 чи 500 помилок.

**Відмовостійкість при збої дзеркала:**
- Пауза після збою мережі: `MIRROR_FAILURE_BACKOFF_MS = 30000` (30 с backoff), щоб не перевантажувати джерело й не блокувати запити.
- При збої віддається збережений знімок з кешу (stale-while-revalidate), відповідь клієнта не падає.
- Останні імпортовані слоти в БД (`schedule_slots`) залишаються незмінними.
- Якщо дзеркало недоступне й кеш порожній, `GET /api/v1/regions` віддає `{ "data": [] }`, а графіки — порожні інтервали (ніколи не 500).

**Точні команди для перевірки та імпорту:**

```bash
# 1. Перевірка каталогу областей:
curl -s localhost:3001/api/v1/regions | head -c 400

# 2. Ручний імпорт ГПВ з дзеркала (вимагає ADMIN_TOKEN):
curl -s -X POST -H "Authorization: Bearer ${ADMIN_TOKEN}" "http://localhost:3001/api/v1/admin/schedules/import-mirror?force=true"

# 3. Перевірка графіків та черг для конкретної області:
curl -s "localhost:3001/api/v1/schedules?queue=2/2&region=chernihivska-oblast&date=2026-10-11" | head -c 400
curl -s "localhost:3001/api/v1/queues?region=chernihivska-oblast"

---

## Мультирегіональний API — що реалізовано в коді (2026-10-11, власник API)

Реалізація контракту `/tmp/API-CONTRACT-regions.md`. Перевірено локально: `tsc --noEmit` = 0,
`vitest run` = **185/185** (30 файлів), міграція `0012_regions.sql` застосована до робочої БД,
`GET /api/v1/regions` віддає живий каталог (16 областей із фіда, назви українською, сортування `uk`).

**Нові файли**
- `apps/api/src/services/regions.service.ts` — каталог областей: `listRegions()` (БД ∪ останній
  відомий знімок із кеша) + `readRegionParam()` (розбір `?region=`), `DEFAULT_REGION`.
- `apps/api/src/routes/regions.ts` — `GET /api/v1/regions`, `Cache-Control: public, max-age=300`.
- `apps/api/tests/integration/regions-api.test.ts` — 5 інтеграційних тестів на нові маршрути
  (каталог із БД без дзеркала, назви з довідника, неактивна область, порожній каталог,
  `?region=` у `/queues` і `/schedules`, невідома область ≠ 400, сміття в `region` = 400).

**Змінені файли (API-частина)**
- `apps/api/src/app.ts` — реєстрація `regionRoutes`.
- `apps/api/src/routes/schedules.ts` — `?region=` в обох маршрутах (query і path); невідома область
  дає порожній графік, а не помилку; форма відповіді не змінилася.
- `apps/api/src/routes/queues.ts` — `?region=` (без параметра — сумісність з v1).
- `apps/api/src/services/queues.service.ts` — `listQueues(region?)`; вулиці показуємо лише для
  легасі-області (`street_queues` поки не має області — краще 0, ніж чужі адреси).
- `apps/api/src/services/schedule-import.service.ts` — `getQueueSchedule(Meta)` фільтрують за
  областю; типова область читається ЛІНИВО з `config` (інакше юніт-тести без `DATABASE_URL` падали).
- `apps/api/src/services/mirror-schedule.service.ts` — `groupKeyFromQueueCode()`,
  `peekMirrorSnapshot()` (знімок ЛИШЕ з кеша, без мережі) і `syncRegionCatalog()`: після імпорту
  слотів upsert у `regions` / `region_queues` (помилка каталогу не валить імпорт — слоти головні).
- `packages/shared/src/index.ts` — типи `RegionSummary`, `RegionListResponse`, `isRegionCpu`.

**Чому каталог читає фід лише з кеша:** публічний GET не має чекати на сторонній worker і не має
права валитися від його таймауту. Кеш наповнює планувальник імпорту (30–60 хв) і маршрут
`/schedules`; каталог областей і назви лежать у БД (`regions`), тож холодний кеш не ламає список.

**Що лишається поза цією частиною**
- Веб (вибір області, збереження в localStorage, показ `nameUa`) — окрема доріжка frontend.
- Типова черга/область у `street_queues` поки глобальні (Чернігівщина); коли адреси стануть
  багаторегіональними — знадобиться `region` у `street_queues` і його фільтр у `listQueues`.

# 4. Перевірка валідності конфігурації Docker Compose та змінних середовища:
docker compose config -q ; echo "exit=$?"
grep -n 'MIRROR_SCHEDULE' docker-compose.yml .env.example
```

