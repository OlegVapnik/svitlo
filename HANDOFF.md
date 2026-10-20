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
| APK | R2 `svitlo-apk` → `/download/svitlo-latest.apk` | 2.26.0, 35 624 859 байт, только `arm64-v8a`, отдаётся с Range |
| Android | `apps/mobile` (Expo SDK 58, RN 0.88) | APK 2.26.0 + тихий OTA JS-бандла |
| Резерв и локальный стенд | `apps/api` (Fastify 5) + `docker compose` | не в прод-пути; контейнеры остановлены, тома `svitlo_pg_data` и `svitlo_api_snapshots` сохранены |

### Прод проверен живыми запросами 2026-10-20 (после выкладки 2.26.0)

- `/health` → `{"status":"ok","d1QuotaExceeded":false,"d1UnavailableAt":null}`.
- `/version` → `2.26.0`, sha256 `a55061da…`, 35 624 859 байт, `releasedAt 2026-10-20T14:42:14Z`;
  тот же файл отдаётся по `/download/svitlo-latest.apk` (`content-length` совпадает).
- OTA: `svitlo-ua-4ze.pages.dev/ota/version.json` → `2.26.0`,
  `bundle-1662d7cd…gz` (2 302 133 байт) + 28 ресурсов в `/ota/assets`.
- `/status?region=chernihivska-oblast` → `dataStale: false`, `lastUpdatedAt` свежий;
  D1 писала снапшот в 14:44, то есть квота на запись в тот момент была жива.
- Паки адресов: `manifest.json` → `version: 2`, области `chernihivska`, `kyiv-city`, `kyivska`.

### OTA проверен на живом устройстве (APK 2.26.0, arm64)

Прогон на физическом телефоне закрыл риск «тихое обновление кладёт приложение». Что
подтверждено и чем это держится:

- **Обновление без APK доезжает.** Временная строка-маркер в `QueueGrid.tsx` приехала
  бандлом: баннер «JS-оновлення завантажено» → перезапуск → новый текст, установка APK не
  потребовалась.
- **Битый `.gz` не кирпичит.** Подсунутый обрезанный архив не распаковался, приложение
  осталось на вшитом бандле; тот же SHA помечается `failed` в `applied.json`, поэтому
  повторной загрузки и цикла падений нет.
- **Ресурсы бандла едут вместе с бандлом.** Найденный дефект: после применения OTA
  пропадали иконки в шапке и таб-баре. Причина не в коде: из APK RN ищет ассет по имени
  Android-ресурса (`res/raw`, `res/drawable-*`), а из файла на диске — по пути
  `files/ota/<raw|drawable-*>/<имя>`. Шрифт `Ionicons.ttf` лежал только внутри APK.
  Теперь `tools/build-ota-bundle.sh` публикует дерево `--assets-dest` в `/ota/assets` и
  перечисляет его в `version.json` (`jsBundle.assets`), а `ota.ts` докачивает файлы в
  `files/ota` **до** записи `meta.json` — то есть к моменту применения бандла они на месте.
  Неудача загрузки ресурса обновление не отменяет, а при следующем запуске недостающие
  файлы досинхронизируются (проверка только по размерам, без сети).
- **Диагностика.** Строки `[ota] …` в `adb logcat -s ReactNativeJS:V` показывают версию,
  короткий SHA, причину отказа (хэш, gzip, размер) и число докачанных ресурсов.

Публикация одной командой: `./tools/publish-ota.sh` (сборка Hermes-байткода + `vite build`
+ `wrangler pages deploy`). Проверять на устройстве так: запуск → баннер, перезапуск →
иконки на месте и баннера нет.

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

- **Подпись синхронизации больше не врёт.** Любая неудача `/sync` считалась офлайном, и шапка
  писала «Без зв’язку, близько 14 годин тому», хотя связь была, а данные не обновил сервер.
  Теперь `errorKind` в `SyncState` разделяет сеть и сервер, правило подписи — чистая функция
  `syncLabelKey` с тестом. Зеркальный `/status` считает `dataStale` по времени снапшота
  (порог 2 часа), а не всегда `false`. `d1QuotaExceeded` зажигается только по тексту про
  дневной лимит D1 — раньше хватало любой ошибки базы.
- **`deploy-cf.sh` падал на чистом кэше:** проверка `apps/web/dist/index.html` стояла до
  `vite build`. Убрана, осталась проверка после сборки.
- **`--publish-only` у `tools/build-android-apk.sh`** — залить уже подписанный APK и обновить
  `version.json`, не пересобирая (`versionCode` зависит от числа коммитов).
- Локальная уборка: снесены 5 ГБ `.cache/gradle-rn`, образы `svitlo-rn-android` и
  `svitlo-android-builder` (9,5 ГБ, нужны только `--docker`), тома `energy-monitor_*` и
  `svitlo-gradle*`, билд-кэш Docker. Release-ключ (`apps/web/android/app/keystore`) на месте.

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

1. **Вынести release-ключ из дерева веба.** `apps/web/android/` — остаток Capacitor-эпохи:
   там же лежит `keystore` и `keystore.properties`. Перенести в `apps/mobile/credentials/`
   (в `.gitignore`) или `~/.config/svitlo-keystore/`, поправить `tools/build-android-apk.sh`
   и `withSvitloNative.js`, затем удалить `apps/web/android` и `@capacitor/*` из
   `apps/web/package.json`. Ключ не терять: без него обновление APK «поверх» не установится.
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
./tools/build-ota-bundle.sh                  # тихий OTA JS-бандла (+ ресурсы в public/ota/assets)
./tools/publish-ota.sh                       # собрать и выложить бандл на Pages одной командой

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


