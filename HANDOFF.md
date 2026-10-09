# HANDOFF — EnergyMonitor: миграция на канонический `outage_events`

Снимок состояния на **2026-10-09, вечер**. Задача: перевести модель отключений с сырой таблицы `outages`
(строка = адрес) на канонические `outage_events` + `outage_event_addresses` без простоя и без расхождения
цифр между эндпоинтами. План и критерии приёмки: `skills/outage-data-core/references/migration-plan.md`
(шаги 0–8). Правила домена: `skills/outage-data-core/SKILL.md`, `skills/db-migrations/SKILL.md`,
`skills/energymon-onboarding/SKILL.md` (15 золотых правил).

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
| Свежий бэкап | `../energy-monitor-backups/energymon_before_live_parse_20261010_0146.dump` (44 333 B; снят перед живым парсингом) |

## 2. Что сделано (шаги 0–4 + инфраструктура)

### Шаг 0 — предусловия
Бэкапы сняты в `../energy-monitor-backups/` (§7), ветки нарезаны, `verify.sh` прогнан как baseline.

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
bash skills/energymon-onboarding/scripts/verify.sh            # typecheck api+web + unit-тесты
bash skills/energymon-onboarding/scripts/verify.sh --build    # то же + сборка
python3 skills/secrets-pii-hygiene/scripts/scan_secrets.py .  # секреты/PII
python3 skills/frontend-ui-change/scripts/check_tailwind_tokens.py .   # если менялись web-стили
```

```bash
# --- интеграционные тесты (нужна ОТДЕЛЬНАЯ *_test БД; рабочая намеренно отвергается) ---
docker compose exec -T db createdb -U energymon energymon_test        # один раз
cd apps/api
TEST_DATABASE_URL=postgresql://energymon:<password>@localhost:5432/energymon_test \
  pnpm test:integration
# только приёмочный (сейчас красный) файл:
TEST_DATABASE_URL=postgresql://energymon:<password>@localhost:5432/energymon_test \
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
docker compose exec -T db pg_dump -U energymon -d energymon -Fc > ../energy-monitor-backups/energymon_$STAMP.dump
docker compose cp ../energy-monitor-backups/energymon_$STAMP.dump db:/tmp/verify.dump
docker compose exec -T db pg_restore -l /tmp/verify.dump | grep -c 'TABLE DATA'
docker compose exec -T db createdb -U energymon energymon_restore_test
docker compose exec -T db pg_restore -U energymon -d energymon_restore_test --no-owner /tmp/verify.dump
docker compose exec -T db psql -U energymon -d energymon_restore_test -c \
  "select (select count(*) from outages) outages, (select count(*) from outage_events) events, (select count(*) from outage_event_addresses) addresses;"
docker compose exec -T db dropdb -U energymon energymon_restore_test
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

## 7. Бэкапы (`../energy-monitor-backups/`)

| Файл | Размер | Когда | Комментарий |
|---|---|---|---|
| `energymon_after_dual_write_2026-10-09_1832.dump` | 44 545 B | сегодня 18:32 | **свежий**: состояние после шага 4 (32 / 6 / 32) |
| `energymon_before_ingest_2026-10-09_1437.dump` | 39 976 B | сегодня 14:37 | перед первым ingest-прогоном |
| `energymon_before_outage_events_2026-10-09_1256.dump` | 33 945 B | сегодня 12:56 | перед миграцией 0008 / backfill |
| `energy-monitor-20261009-121027.tar.gz` | 929 336 B | сегодня 12:10 | полный архив проекта до правок |

Свежий дамп проверен **реальным восстановлением**, а не только размером: `magic = PGDMP`,
`pg_restore -l` → 14 записей `TABLE DATA` (в т.ч. `outages`, `outage_events`, `outage_event_addresses`,
`sources`, функция `energy_normalize_address`), затем restore в scratch-БД `energymon_restore_test`
внутри контейнера → `32 / 6 / 32`, что совпадает с рабочей БД. Scratch-БД и временный файл внутри
контейнера удалены. Этот дамп — точка возврата перед шагом 5. На хосте `pg_restore` не установлен,
поэтому проверять через контейнер (команды в §4).

## 8. Чек-лист «готово» для следующих шагов

- [ ] `bash skills/energymon-onboarding/scripts/verify.sh` → `rc=0` (typecheck api+web + unit-тесты);
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
(минимум из `scraper-adapter-hardening`), есть джиттер `PARSE_INTERVAL_JITTER_MINUTES=5`.
**Не реализовано:** circuit breaker (3 подряд неудачи → пауза 30 мин → 1 ч → 3 ч → 6 ч) и `dataStale`
по источнику — `scheduler/cron.ts` просто повторяет прогон. Если оператор заблокирует IP, планировщик
будет молча стучаться каждые 30 минут; обходов бана в проекте нет и быть не должно.

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
4. Circuit breaker и `dataStale` по источнику (см. §9.2).

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
