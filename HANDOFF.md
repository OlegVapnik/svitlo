# HANDOFF — Svitlo: передача состояния между сессиями

**Читай этот файл целиком, он короткий.** История прошлых сессий — в
`docs/archive/HANDOFF-history.md`: там ложное покрытие 11 областей, квота D1, релизы 2.23.x,
scaffold `apps/mobile`, вынос `packages/core` и статические паки адресов.

---

## Текущее состояние (2026-10-20, версия 2.26.0)

| Слой | Где | Статус |
|---|---|---|
| API + крон `*/20` | Worker `svitlo-api.olegvapnik45.workers.dev/api/v1` | основной раздатчик |
| База | D1 `svitlo` (`e3613ade-704e-480c-924a-c765745ea59c`) | графики, справочник, новости |
| Web-PWA и паки адресов | Pages `svitlo-ua-4ze.pages.dev` + `/data/address` | основной фронт |
| APK | R2 `svitlo-apk` → `/download/svitlo-latest.apk` | 34 МБ, только `arm64-v8a`, отдаётся с Range |
| Android | `apps/mobile` (Expo SDK 58, RN 0.88) | APK 2.26.0 + тихий OTA JS-бандла |
| Резерв и локальный стенд | `apps/api` (Fastify 5) + `docker compose` | не в прод-пути |

### Прод проверен живыми запросами 2026-10-20

- `/health` → `{"status":"ok","d1QuotaExceeded":false,"d1UnavailableAt":null}`.
- `/version` → `2.25.0`, sha256 `7e0e537a…`, 107 700 865 байт, `releasedAt 2026-10-20T03:07:53Z`.
- `/regions` → 27 записей каталога, **12 `covered` с `lastDate: 2026-10-20`**:
  kyiv-city 400 слотов (240 сегодня), остальные 12–32. У `dnipropetrovska-oblast`,
  `dnipro-dnem`, `dnipro-cek`, `ivano-frankivska-oblast` — `covered: true` при **0 слотах**.
- Паки адресов: `manifest.json` → `version: 2`, `generatedAt 2026-10-19T22:18:59Z`,
  области `chernihivska`, `kyiv-city`, `kyivska`.

### Что появилось после прошлой передачи (2.25.0 → 2.26.0)

- **APK похудел втрое:** 107 МБ → 34 МБ. Причина была в четырёх ABI: x86/x86_64 и
  armeabi-v7a давали ~60 МБ мёртвых библиотек. Фильтр `abiFilters` живёт в
  `buildTypes.release` (плагин `withSvitloNative`), поэтому dev-сборка по-прежнему ставится
  в x86_64-эмулятор. Плюс R8-сжатие ресурсов и `useLegacyPackaging = false`.
- **Фантомное покрытие убрано:** `build_sql()` больше не пишет строку `schedule_coverage`
  для дня, который оператор не публиковал; выбор источника в воркере идёт по убыванию
  доказательства (`queueSlots` → `slots` → `coverage`). Четыре сети, которые отдавали
  `covered: true` при нуле слотов, проверены живым снимком `dnipro.energy-ua.info`.
- **Ошибка в `extract_days()`:** рефакторинг потерял `return`, функция возвращала `None`.
  Восстановлено, добавлен тест на проводку (тесты на само правило этого не видели).
- **Сборка APK локальная:** `tools/build-android-apk.sh` по умолчанию использует SDK
  Android Studio; `--docker` — только для CI. Docker поднимал второй Gradle-кэш и на 14 ГБ
  приводил к `systemd-oomd`, который убивал VS Code.

### Что осталось за рабочей сессией 2.26.0

- `apps/web/public/ota/` — артефакт `tools/build-ota-bundle.sh` (в `.gitignore`).
- `apps/mobile/android/` и `apps/mobile/android-apk/` — выход `expo prebuild` и сборки APK,
  тоже в `.gitignore`. Лежащий там `svitlo-2.26.0.apk` — уже подписанный релиз.

- **Поиск адреса больше не читает D1.** Статические паки на Pages: `tools/build-address-packs.py`
  собирает из локальных выгрузок `.cache/`; формат v2 — `manifest.json`, `<region>/settlements.*`,
  индекс улиц кортежами `[name, normalized, defaultQueue, queues, housesShard]` и
  16 шардов `houses-*`. Дома читаются только после выбора улицы, подсказки ограничены
  (startsWith → includes, максимум 30, пустой запрос — 20) — `218f9f9`.
- **Квота D1 стала наблюдаемой:** `/health` и `/status` отдают `d1QuotaExceeded` и
  `d1UnavailableAt`, зеркальный `/status` — тоже (`4227c3c`, `aeb0e72`). Раньше воркер
  на `D1_ERROR` молча уходил в фолбэк и отвечал HTTP 200.
- **Выбор источника по силе доказательства:** слоты запрошенной группы → любые слоты дня →
  покрытие. Раньше одного `schedule_coverage` хватало, чтобы перекрыть зеркало с живыми
  интервалами, и Київ показывал «Відключень немає».
- **Новости с категориями:** у постов есть `kind`, `region_cpu`, `is_ukraine_wide`,
  `image_urls`, `body`; колонки добавляет догоняющая миграция `ensureNewsColumns`
  (PRAGMA → ALTER, потому что D1 не умеет `ADD COLUMN IF NOT EXISTS`).
- **APK переехал в R2:** Pages не принимает файл больше 25 МиБ, поэтому бинарник лежит в
  бакете `svitlo-apk`, а воркер отдаёт его по стабильной ссылке.
- **`packages/core`** — общая логика веба и мобильного (lib/api/storage/config), чтобы два
  клиента не расходились в расчётах графика и региона.

### Коммиты 2.26.0 (ветка `redesign/wow-ui`)

- `fix(api): Не выдавать покрытие неопубликованного дня` — парсер, тесты, живой снимок.
- `feat(api): Отдавать APK из R2 и группировать новости по областям` — worker, shared, R2.
- `feat(android): Тихое OTA-обновление, виджет и уведомления о свете` — `apps/mobile`.
- `chore(tools): Собирать APK локальным Gradle вместо Docker` — скрипты сборки.

Артефакты, которые в репозиторий не попадают (всё в `.gitignore`): `apps/web/public/ota/`
(выход `tools/build-ota-bundle.sh`), `apps/mobile/android/` (`expo prebuild`),
`apps/mobile/android-apk/` (подписанный APK), `.idea/`.

### Что нельзя нарушать

1. **Зелёный при отсутствии данных запрещён.** Оператор без графика пишет `class="no_data"` и
   «Немає даних» — это не «світло є за графіком». Правило живёт в
   `is_day_published(block, slots)` в `tools/scrapling_schedules_sync.py`, проверяется
   `tests/test_scrapling_schedules.py` (13 тестов, фикстуры — живые снимки Днепра и Сум плюс
   честно помеченная синтетика «все зелёные»). Отдельный тест проверяет проводку:
   `extract_days()` обязан вернуть строки, а не `None`.
2. **Своё покрытие важнее зеркала.** Для области, которую разбираем сами и для которой есть
   строки `schedule_coverage`, источник истины — только наша таблица (`d1Coverage` +
   `loadOwnCoverage`). Зеркало `dtek-api.svitlo-proxy.workers.dev` уже приносило ложное
   покрытие у 11 областей.
3. **Квота D1 (Free Tier: 5 млн `rows_read`, 100 тыс. `rows_written` в сутки, сброс 00:00 UTC)**
   — главное операционное ограничение:
   - полный `wrangler d1 export` съедает суточный лимит чтения → бэкапить только селективно
     (`--table schedule_slots --table schedule_coverage --table snapshot_meta --table address_queues`);
   - `DELETE FROM` тарифицируется построчно → большие таблицы сносить через DDL;
   - `INSERT OR REPLACE` = DELETE+INSERT → в кроне работает фингерпринт `gpv_fingerprint`
     в `snapshot_meta`, при неизменном наборе записей записи нулевые;
   - тяжёлый импорт справочника можно пропустить: `SKIP_ADDRESS_IMPORT=1 ./deploy-cf.sh`.

### Что дальше (в этом порядке)

1. **Опубликовать 2.26.0 и проверить OTA на живом устройстве.** APK `2.26.0` (versionCode 197,
   arm64-v8a, 34 МБ) собран и подписан, но лежит только локально в
   `apps/mobile/android-apk/`. Публикация — прод-операция (нужно согласие человека):
   `./tools/build-android-apk.sh` без `--no-publish` зальёт файл в R2 и обновит
   `version.json`; затем `./tools/build-ota-bundle.sh` + `./deploy-cf.sh`.
   После выкладки проверить на телефоне: скачивание, применение при следующем запуске,
   откат по маркеру `.booted`.
2. **Долги из аудита** (см. `PROJECT_AUDIT.md`, раздел «Бэклог»): backfill `outage_events`
   и отказ от легаси `outages`, CI на `tsc` + тесты, тесты для воркера и мобильного.

### Шпаргалка команд

```bash
# типы (обязательный минимум перед «Готово»)
./apps/api/node_modules/.bin/tsc -p apps/api/tsconfig.json --noEmit
./apps/api/node_modules/.bin/tsc -p apps/api/tsconfig.tests.json --noEmit
./apps/web/node_modules/.bin/tsc -p apps/web/tsconfig.json --noEmit
(cd cf-worker && ./node_modules/.bin/tsc --noEmit)
(cd apps/mobile && ./node_modules/.bin/tsc --noEmit)

# выкладка: паки адресов → чейнджлог → worker → сборка фронта → Pages
./deploy-cf.sh
SKIP_ADDRESS_IMPORT=1 ./deploy-cf.sh     # когда квота D1 на исходе

# Android: собирается локальным Gradle из SDK Android Studio (NDK 27.1 + cmake 3.22.1)
./tools/build-android-apk.sh                 # release, arm64-v8a, ключ из keystore.properties
./tools/build-android-apk.sh --docker        # альтернатива для CI, где нет локального SDK
./tools/build-ota-bundle.sh                  # тихий OTA JS-бандла

# история и чейнджлог
node tools/gen-git-history.mjs           # GIT_HISTORY.md из git log
node tools/gen-git-history.mjs --check   # только проверка актуальности
node tools/gen_changelog.mjs             # apps/web/src/data/changelog.json

# проверки
python3 skills/secrets-pii-hygiene/scripts/scan_secrets.py .
python3 skills/frontend-ui-change/scripts/check_tailwind_tokens.py .
python3 -m pytest tests/ -q              # парсер Energy-UA
```

### Документы

- `PROJECT_MAP.md` — карта репозитория, контракты API, поток данных.
- `PROJECT_AUDIT.md` — ревизия 2026-10-20: риски, оценки, бэклог.
- `docs/archive/HANDOFF-history.md` — как пришли к текущему состоянию.
- `docs/energy-ua-source-audit.md`, `docs/address-queue-sources.md`,
  `docs/regions-multiregion.md`, `docs/AI-ONBOARDING.md` — предметные обзоры источников.


