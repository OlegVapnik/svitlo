# Svitlo — історія розробки (git log)

**Комітів:** 65  
**Перший:** 2026-10-09  
**Останній:** 2026-10-14  
**Автор:** OlegVapnik <olegvapnik45@gmail.com>

**Типи комітів:** `feat` × 21, `fix` × 16, `chore` × 11, `docs` × 7, `refactor` × 3, `merge` × 3, `test` × 3, `checkpoint` × 1

---


## 2026-10-14  (15 комітів)

### `df6eff0` feat(web): «Що нового» из истории git + сборка APK без Service Worker

*`df6eff0` · 2026-10-14 05:35:37 · OlegVapnik*

Чейджлог:
- tools/gen_changelog.mjs читает `git log` и пишет apps/web/src/data/changelog.json.
  Отдельный шаг нужен потому, что сборка идёт в Docker, где репозитория нет, а в PWA/Android
  история коммитов не нужна. Показываются только пользовательские типы (feat/fix/security):
  служебные chore/docs человеку ничего не объясняют.
- Заголовок записи — первая строка тела коммита (там живое украинское описание), а не тема
  коммита: темы короткие и часто машинные («fix: CORS»).
- Порядок — как в git log (свежие сверху). Раньше была сортировка по дате, а в разработке все
  коммиты за один день, из-за чего список перемешивался.
- ChangelogCard на главной: раскрывающийся блок, 5 последних записей.

Метка сборки:
- __BUILD_ID__ через define + подпись «build …» в меню. Раньше на телефоне было невозможно
  понять, какая версия приложения стоит — при отладке «ничего не работает» это первое, что
  нужно проверить.

APK без Service Worker:
- В нативном приложении SW встаёт ПЕРЕД локальной раздачей ассетов Capacitor, а на активации
  selfDestroying-SW ещё и стирает все кэши и перезагружает страницу (client.navigate). Итог:
  приложение открывалось с «кучей функций» — область и очереди не подгружались. Офлайн
  обеспечивает сам Capacitor (ассеты внутри APK), поэтому SW и регистрация удаляются из
  нативного бандла. Веб-сборка не затронута: в PWA SW нужен.

### `6146c16` fix(api): вимкнений збір відключень не сприймається за збій джерела

*`6146c16` · 2026-10-14 05:25:23 · OlegVapnik*

Після CHERNIHIV_WEB_ENABLED=false прогін провалювався у старий HTML-адаптер, той не віддавав
записів, і runParse завершувався з «Ingest skipped: incomplete feed or no outage records».
Джерело назавжди лишалося в стані «не відповідає» (consecutiveParseFailures зростав), хоча
оператора просто не питають — і головна показувала баннер «Джерело даних не відповідає».

Тепер при вимкненому зборі прогін не запускається взагалі, а застаріла помилка знімається.
runParse може повернути null, тому admin-маршрут обробляє цей випадок окремо (0 ≠ помилка).

### `8ce762b` fix(api+android): данные в APK — CORS для нативного origin и cleartext в debug

*`8ce762b` · 2026-10-14 05:18:05 · OlegVapnik*

Приложение показывало пустые экраны без единой ошибки в UI. Две независимые причины:

1. CORS. Нативная обёртка отдаёт страницу с origin `https://localhost`
   (capacitor.config.json → androidScheme), поэтому запросы к API кросс-доменные, а CORS в
   проде выключен (фронт и API ходят на один origin через nginx) — ответ блокировался
   браузерным движком. Добавляем `https://localhost` и `capacitor://localhost` в список
   разрешённых: это конкретные адреса, не `*`, безопасность не снижается.

2. cleartext. Основной манифест подключает network_security_config.xml, где http разрешён для
   адресов локальной сети, но Android сопоставляет <domain> с ИМЕНЕМ ХОСТА и для IP-литерала
   192.168.1.100 такое сопоставление не гарантировано. Добавлен app/src/debug/AndroidManifest.xml
   с usesCleartextTraffic=true — только для debug-сборки, ставятся руками; в release остаётся
   строгая политика.

Также отключён сбор аварийных по адресам (CHERNIHIV_WEB_ENABLED=false) по решению владельца;
графики по группам из зеркала ГПВ работают.

### `cc30616` chore(api): дефолты батча НП=12 и паузы=1500мс в compose/.env.example

*`cc30616` · 2026-10-14 05:08:28 · OlegVapnik*

30 НП × 3 типа = 90 запросов подряд; WAF оператора рвал соединение в конце прогона
(«fetch failed»), источник гас и главная показывала «Джерело даних не відповідає».
12 НП ≈ 36 запросов ≈ 1.5 мин — прогон стабильно success. Значения жили только в .env
(файл в gitignore), поэтому перенесены в дефолты, иначе фикс терялся бы при пересоздании .env

### `8d3ba42` feat(android): нативная обёртка APK (Capacitor) со сборкой в Docker

*`8d3ba42` · 2026-10-14 04:56:52 · OlegVapnik*

Тот же веб-бандл в нативном контейнере: иконка в лаунчере, полноэкранный режим, своя
тема, установка как обычного приложения (а не PWA в браузере). minSdk 26, targetSdk 35 —
под Android 13+.

Сборка воспроизводима на машине без JDK и Android SDK: docker/Dockerfile.android
(temurin 21 + Android SDK 36/35 + build-tools 36/34) и tools/build-android-apk.sh.

- адрес API передаётся через VITE_API_BASE_URL и зашивается в бандл: в нативном приложении
  «localhost» — это сам WebView, поэтому относительный /api/v1 уводит запросы в никуда
- network_security_config.xml: http разрешён ТОЛЬКО для localhost и локальной сети,
  глобально он запрещён (при targetSdk 35 cleartext по умолчанию выключен)
- контейнер работает от текущего пользователя иначе build-каталоги остаются под root,
  а на btrfs их не удалить без sudo — пересборка падала бы с EACCES
- кэш gradle вынесен на хост (.cache/gradle): docker volume создаётся под root
- иконки всех плотностей + adaptive-иконка Android 8+ генерируются из одного SVG
  собственным скриптом (без sharp/canvas, build-скрипты которых pnpm не даёт запускать)
- имя приложения «Світло», тёмная тема DayNight (тему рисует веб), allowBackup=false

APK: apps/web/android-apk/app-debug.apk (4.5 МБ), адрес http://192.168.1.100:3000/api/v1.
Инструкция: apps/web/README-ANDROID.md

### `130da7f` feat(api): обхід всієї Чернігівщини за довідником КОАТУУ + обхід блокувань

*`130da7f` · 2026-10-14 04:13:10 · OlegVapnik*

Аварійних відключень по области не було видно, бо в CHERNIHIV_CITY_IDS стояв ОДИН код —
Деснянське. Оператор ідентифікує НП саме кодами КОАТУУ, тож перелік не можна було взяти
«з воздуху»: звідси довідник, згенерований з відкритого державного реєстру (tools/
gen_settlement_directory.py, 1509 НП, 16 міст, 2 райони Чернігова).

- settlement-directory.ts + data/settlement-directory.json: довідник у репозиторії,
  збір не залежить від мережі; Dockerfile копіює JSON у dist (tsc не копіює .json,
  без цього адаптер падав з «CHERNIHIV_CITY_IDS порожній»)
- порція за прогін (міста → села) з курсором у файлі стану: область не обходиться ніколи,
  але й оператора не долбимо (1.8 с на запит); ліміт CHERNIHIV_MAX_CITIES_PER_RUN
- обхід блокувань: ротація UA з узгодженим sec-ch-ua, jitter + адаптивна пауза,
  зниження темпу при 5xx
- 400 з тілом ESOCKETTIMEDOUT більше не фатальний: це падіння власного сокета оператора
  (на Чернігові другий запит дає 200), тепер ретраїться
- головний баг: при complete=false прогін не писав НІЧОГО, тож одна впала порція викидала
  210 зібраних записів по інших 23 НП. Тепер пишемо все, що є, а complete лише захищає
  скасування зниклих вікон

Перевірено вживу: 238 подій по 25 НП (Ніжин, Прилуки, Носівка, Бахмач, Мена, Борзна,
Корюківка, Сновськ, Бобровиця, Ічня…) замість 28 по одному селу.

### `2884176` feat(web): розкривати всі групи, список вулиць у групі, групування ремонтів за вулицями

*`2884176` · 2026-10-14 03:27:00 · OlegVapnik*

- «Ще N груп» більше не просто підпис: кнопка «Показати ще N груп» / «Згорнути список груп»
  розкриває всі 12 груп (раніше 6 были, а решта 6 — недосяжні)
- у кожній картці групи — розкривний список вулиць групи (показується, коли джерело віддало
  прив'язку; порожній список не малюється і не вигадується)
- «Точкові відключення (ремонт)» згруповані за вулицями, а не за одним «Деснянське»:
  API тепер віддає `streets` (вулиці з outage_event_addresses без номерів домов), агрегатні
  рядки на кшталт «вул. А, вул. Б та інші вулиці» відсікаються

### `bc6838b` feat(web+api): ближні відключення по групах области і прив'язка груп до НП/вулиць

*`bc6838b` · 2026-10-14 03:19:01 · OlegVapnik*

Головна брала «Найближчі відключення» только из outage_events, где лежат 28 точечных
ремонтных записей одного села (Деснянское), поэтому в Черниговской области весь блок
занимало одно и то же село, а в остальных областях было пусто. Плановые отключения
по группам живут в schedule_slots — они и показываются теперь.

API:
- новый GET /api/v1/schedules/upcoming?region=&days= (1..7) — срез по всем группам области:
  очередь, дата, интервалы с локальным временем оператора, статус «идёт сейчас», география
- localSlotToUtc вынесен из getQueueSchedule, чтобы перевод киевского времени в UTC не разъезжался
- GET /api/v1/queues отдаёт по каждой группе settlements/streetNames

Web:
- блок «Найближчі відключения»: карточки групп (код, «10:00–11:00», статус, НП/улицы),
  точечные ремонтные записи свёрнуты отдельным подразделом и больше не вытесняют график групп
- чипы «НП/улицы в группе» на главной (выбранная очередь) и на карточках /queues
- fetcher: cache: 'no-store' — HTTP disk cache отдавал устаревший/пустой ответ /schedules

Списки НП/улиц берутся из settlement_queues/street_queues как есть: сейчас они пусты, потому
что зеркало ГПВ отдаёт номера групп без привязки к районам. Плейсхолдер зеркала (запись с
названием самой области, привязанная ко всем группам) в ответ не попадает, а вместо пустых
списков ничего не выдумывается.

### `7238025` fix(web): selfDestroying для PWA — снести залипший Service Worker

*`7238025` · 2026-10-14 03:08:09 · OlegVapnik*

Новый sw.js при установке удаляет все кэши workbox и разрегистрирует себя во всех
вкладках, поэтому старый бандл и старые кэши API больше не могут отдаваться.
Офлайн-режим временно отключён; вернём registerType, когда убедимся, что «залипание»
больше не повторяется.

### `21a94d7` fix(web): чистить старый кэш api-responses при старте приложения

*`21a94d7` · 2026-10-14 03:02:55 · OlegVapnik*

Кэш от прошлых Service Worker'ов переживал их удаление и отдавал устаревший
(в том числе пустой) ответ графика очереди — главная показывала «Даних графіка немає».
Кэширования API в PWA больше нет, поэтому старый кэш только мешает.

### `ed2069c` fix(web): не кэшировать API в Service Worker

*`ed2069c` · 2026-10-14 02:58:25 · OlegVapnik*

runtimeCaching отдавал из кэша api-responses устаревший (в том числе пустой) ответ
/schedules, и главная показывала «Даних графіка немає», хотя бэкенд отдавал интервалы.
График очереди должен приходить только из сети — офлайн для него не нужен.

### `1725bf7` chore(web): убрать неиспользуемый блок админ-меню в сайдбаре

*`1725bf7` · 2026-10-14 02:55:16 · OlegVapnik*

ADMIN_ITEMS больше нигде не импортируется — навигация админ-раздела удалена.

### `6551dbb` fix(web): распаковка конверта { data } в графике очереди

*`6551dbb` · 2026-10-14 02:55:16 · OlegVapnik*

fetcher() возвращает res.json() целиком, а API отдаёт график внутри `data`.
На главной было `const schedule = scheduleResponse`, поэтому intervals/source
становились undefined и герой показывал «Даних графіка немає» при непустом ответе.

- useQueueSchedule/useStreetSchedule типизированы как { data: ... } (как остальные хуки)
- HomeHeroSection: безопасное извлечение (конверт или уже плоский объект)
- hasRegionData учитывает непустые интервалы, а не только source
- QueueSchedulePage/StreetsPage: та же регрессия распаковки
- vite.config: cleanupOutdatedCaches вынесен на верхний уровень VitePWA
  (внутри workbox опция игнорировалась); skipWaiting/clientsClaim — против залипания бандла

### `1ee6840` fix: region filter for /outages, non-sensitive queue search, no Деснянське for other regions

*`1ee6840` · 2026-10-14 02:21:45 · OlegVapnik*

_(без опису)_

### `2275ac0` feat: all-ukraine providers, canonical outage_events readers, multi-region bookmarks

*`2275ac0` · 2026-10-14 01:51:31 · OlegVapnik*

_(без опису)_


## 2026-10-13  (6 комітів)

### `ea4cc37` docs(audit): закрыть пункты 0.2 (auth/token/CORS/незакомиченный пласт); остаётся HTTPS, CI, легаси-шар

*`ea4cc37` · 2026-10-13 21:41:22 · OlegVapnik*

_(без опису)_

### `0dfa737` fix(security): Этап 0 — constant-time auth, строгий ADMIN_TOKEN у prod, CORS по-origin

*`0dfa737` · 2026-10-13 21:40:35 · OlegVapnik*

- auth.ts: замість `!==` тепер SHA-256 + timingSafeEqual (utils/timing-safe.ts) — без timing-атаки
  по символах і довжині; типи замість `any`; єдина відповідь для невалідного токена.
- config.ts: `CORS_ORIGINS` (через кому); у production помилка на старті, якщо ADMIN_TOKEN
  дефолтний/«change-me»/короткий (<16).
- cors.ts: за замовчуванням CORS вимкнено (порожньо); дозволяє список у development.
- docker-compose.yml / .env.example: прокинуто CORS_ORIGINS.
- тести: timing-safe.test.ts (6) і config.test.ts (production-token кейси); importConfig скидає
  стаби env між кейсами (усуває «протікання» PARSE_INTERVAL_MINUTES).

### `b41e0f7` chore(tools): gemini-assist — CLI-обгортка над Antigravity (agy), flash 3.8 low think

*`b41e0f7` · 2026-10-13 21:35:13 · OlegVapnik*

_(без опису)_

### `6cefa1f` docs(meta): актуалізація на 2026-10-13 — env-варіанти, AGENTS/HANDOFF, skills, аудит

*`6cefa1f` · 2026-10-13 21:35:05 · OlegVapnik*

- .env.example: нові змінні (новини, провайдери, капча-солвер) з позначками scan:allow
- PROJECT_AUDIT.md: новий розділ 0 «Свежее состояние на 2026-10-13» (перевірено по коду)
- AGENTS.md: уточнення правил / політики обходу капчі
- HANDOFF.md: доповнення статусу
- skills (frontend-ui-change, scraper-adapter-hardening) і docs/operator-engagement: уточнення

### `b3eff86` refactor(web): перехід на одну мову (uk) замість циклічного uk→en→ru

*`b3eff86` · 2026-10-13 21:34:40 · OlegVapnik*

- видалено ru.json, en.json, LanguageToggle та code-switch у Header
- i18n/config.ts: lng='uk' без localStorage (старий ключ у браузера не вмикає зниклу мову), supportedLngs=['uk']
- uk.json: додано оновлені ключі

### `662539e` feat(data-collect): мульти-регіональні джерела даних — новини, settlements, провайдери графіків

*`662539e` · 2026-10-13 21:34:14 · OlegVapnik*

- news: міграції 0014/0016, services/news (collector, RSS, Telegram, classifier, dedup), routes/news, NewsPage + фікстури й тести парсерів
- settlements: міграція 0015, services/settlements, routes/settlements (пошук сел і черг)
- providers: contract + registry + provider-sync.service + admin-providers routes
- сопутствующая правка config/server/app/cron/schema/shared/web-клиента відповідно до нових джерел та обходу Turnstile (коментарі, без коду капча-клієнта)


## 2026-10-11  (11 комітів)

### `9f2e386` refactor(api): drop hardcoded Desnyanske/lone-village assumptions (generic settlement naming, honest empty-city-ids failure)

*`9f2e386` · 2026-10-11 02:39:27 · OlegVapnik*

_(без опису)_

### `84d491d` merge(feat/region-collectors): data-quality validator + regions coverage endpoint (COLLECT P1/P2)

*`84d491d` · 2026-10-11 02:36:36 · OlegVapnik*

_(без опису)_

### `3a76ad6` feat(api): provider contract for multi-region schedules (types, interval helpers, provider env config)

*`3a76ad6` · 2026-10-11 02:33:34 · OlegVapnik*

_(без опису)_

### `a1676ef` feat(api): P2 data quality validator and import path integration

*`a1676ef` · 2026-10-11 02:22:54 · OlegVapnik*

_(без опису)_

### `50f1fab` feat(api): P1 audit and coverage endpoint GET /api/v1/regions/coverage

*`50f1fab` · 2026-10-11 02:19:29 · OlegVapnik*

_(без опису)_

### `e0d57fa` fix(api): /api/v1/queues без ?region= звужується до дефолтної області (без суміші областей) + регресійний тест

*`e0d57fa` · 2026-10-11 02:16:20 · OlegVapnik*

_(без опису)_

### `3be3d7d` merge(web): new main screen UI — RegionPicker, 24h timeline, region queues, i18n uk/ru/en (feat/ui-refresh)

*`3be3d7d` · 2026-10-11 02:11:37 · OlegVapnik*

_(без опису)_

### `5be4a9e` merge(api): multi-region address directory — migration 0013 + region wiring (feat/api-assist)

*`5be4a9e` · 2026-10-11 02:09:15 · OlegVapnik*

_(без опису)_

### `aec92d6` feat(web): новий інтерфейс головної — RegionPicker, 24h Timeline, вибір черг області, i18n uk/ru/en

*`aec92d6` · 2026-10-11 02:00:34 · OlegVapnik*

_(без опису)_

### `ffbabe0` feat(api): multi-region address directory (migration 0013 + region wiring + tests)

*`ffbabe0` · 2026-10-11 01:55:58 · OlegVapnik*

_(без опису)_

### `6d54ca9` checkpoint(team): multi-region base — migration 0012, region catalog API, mirror feeds, web region wiring

*`6d54ca9` · 2026-10-11 01:33:54 · OlegVapnik*

_(без опису)_


## 2026-10-10  (13 комітів)

### `914157c` feat(api+web): реальный список очередей вместо зашитой '2/2' (шаг 3 плана)

*`914157c` · 2026-10-10 19:19:30 · OlegVapnik*

- API: GET /api/v1/queues — очереди ТОЛЬКО из реальных данных (schedule_slots + street_queues);
  пустая БД → пустой список, никакого выдуманного перечня. Чистые mergeQueues/compareQueueCodes
  с unit-тестами (порядок «1, 1/2, 2, 2/2, 10» — числовой, а не строковый)
- GET /schedules теперь валидирует код очереди (queueCodeSchema): мусор → 400 с подсказкой,
  раньше принимался любой текст
- shared: queueCodeSchema + QUEUE_CODE_PATTERN — единый формат «3»/«2/2» вместо regex по файлам
- web: useMyQueues больше не привязан к '2/2' (принимает любой валидный код и чистит мусор из
  localStorage), новый lib/queue.ts + тест-сторож расхождения шаблона с API
- QueueSchedulePage: подсказки очередей из API (datalist) + ручной ввод, честный статус
  «Черг ще немає: графік не імпортовано», предупреждение о неверном коде, кнопка «Додати» disabled
- QueueScheduleBar: захардкоженные украинские строки переведены на i18n (schedule.*),
  дубль текста «Графік не імпортовано» убран (остался один ключ)
- skills/frontend-ui-change: зафиксирован грабль transform-кэша Vite при правке i18n

Проверено: verify.sh 4/4 PASS (api+web typecheck, api-тесты, web 4 файла/20 тестов); живой API
в контейнере: GET /queues → {"data":[]}, /schedules?queue=2/2 → intervals:[] source:null без demo,
/schedules?queue=abc → 400; скриншот мобильной /queues — новые ключи i18n резолвятся.

### `6b8c582` feat(web)!: порт дизайна grok (Tailwind v4) + убраны выдуманные данные

*`6b8c582` · 2026-10-10 19:11:43 · OlegVapnik*

Дизайн — перенос смысла, не копирование файлов прототипа:
- палитра из globals.css на тёплых grok-токенах (background/card/border, primary #0d6b4f/#3dbe8c),
  плоские тени; статусы берутся из палитры через alias-блок --color-emerald/lime/amber/red/blue-*
  (8 компонентов перекрашены без правки их разметки)
- новый герой главной MyQueueHero: крупный ответ «є світло / немає / немає даних» + отсчёт +
  полоса суток; расчёт окна вынесен в lib/scheduleWindow.ts (общий с QueueScheduleBar)
- QueueScheduleBar: форма grok (rounded-full, разметка 00/06/12/18/24), легенда без повторов,
  проп showSummary (герой показывает сводку сам)
- тема ставится инлайн-скриптом до первой отрисовки, useTheme синхронизирует подписчиков событием
- Tailwind v4 через плагин Vite; postcss.config.js и tailwind.config.ts удалены

Честность данных (никакой синтетики):
- удалён untracked-прототип grok-workspace/ (273 файла, генератор данных buildModel) и
  план-документ переноса — перенесённое описано в HANDOFF
- удалён schedule-mock.service.ts; SCHEDULE_DEMO вырезан из config.ts, .env.example,
  docker-compose.yml: при пустой schedule_slots /schedules отдаёт intervals: [] и source: null,
  а не правдоподобный выдуманный график
- shared: QueueScheduleData без demo; queueCodeSchema — единый формат кода очереди «3»/«2/2»
- манифест: единственный источник — vite-plugin-pwa (manifest.webmanifest); статический
  public/manifest.json удалён как дубль, index.html ссылается на webmanifest
- доки синхронизированы: PROJECT_MAP, skills/svitlo-onboarding (#14), skills/ops-deploy-check

Проверено: verify.sh 4/4 PASS (typecheck api+web; tests api + web 3 файла/16 тестов);
скриншоты light/dark/360px и DOM-проба — skills/frontend-ui-change/scripts/screenshot.mjs.

### `7980aff` docs: HANDOFF §15 (cleanup + rename to Svitlo), fix test inventory in PROJECT_MAP

*`7980aff` · 2026-10-10 03:33:18 · OlegVapnik*

_(без опису)_

### `3379c4c` chore: cleanup dead code, sync docs, rename project energy-monitor -> svitlo

*`3379c4c` · 2026-10-10 03:32:19 · OlegVapnik*

Cleanup: delete dead modules (api geocode.service = fake stub, web demo-schedule, useMediaQuery, incidents/IncidentList stub, ui/Dialog), gitignored build output apps/*/dist and the regenerable ALL_IN_ONE.md draft; sync stale docs (PROJECT_MAP, PROJECT_AUDIT, skills/db-migrations now state there is no db/seed.ts and no geocode.service).

Rename: packages @svitlo/{api,web,shared}, image svitlo-api:latest, skill dir skills/svitlo-onboarding, SNAPSHOT_DIR /var/lib/svitlo/snapshots, brand Svitlo - Chernihiv; fix phantom dependency (packages/shared now declares zod ^3.24.1).

Kept on purpose: Postgres role/database energymon + compose project/volume names (touching them affects the live data volume -> separate approved step).

### `1688196` feat(web): редизайн раунд 2 — все страницы на токенах, ленивые вкладки, i18n

*`1688196` · 2026-10-10 02:42:25 · OlegVapnik*

React.lazy/Suspense для календаря, таймлайна, чартов и карты: стартовый чанк 157 kB gzip вместо 561 kB. Incidents/Contacts/Streets/MyAddress/QueueSchedule/ScheduleImport переписаны на ui/* и семантические токены, AddressCombobox без inline-цветов. i18n uk/ru +90 ключей, наборы идентичны. VS Code: Debugger for Firefox + Tailwind IntelliSense. HANDOFF §12.

### `4cabbaa` feat(web): редизайн UI — токены, навигация из одного списка, состояние источника данных

*`4cabbaa` · 2026-10-10 02:29:55 · OlegVapnik*

- токены: success/warning/info, тени card/pop, анимации, системный стек шрифтов вместо
  внешнего Inter; пересобраны светлая и тёмная темы; inline-цвета из компонентов убраны;
- навигация: NAV_ITEMS — один список для Sidebar и BottomNav (были дубли и пункты без
  перевода), admin-раздел отделён, aria-current, skip-link, тач-зоны >= 44px;
- состояние источника данных: FreshnessChip в шапке (виден с любой страницы) и
  SourceHealthBanner (lastError без персональных данных, nextAttemptAt, pausedUntil,
  число неудач подряд, кнопка обновления); правила вынесены в чистую функцию
  sourceSeverity с unit-тестом;
- главная переписана: hero со статусом сети, метрики-плитки StatCard, быстрые ссылки,
  «мій графік» через useQueueSchedule (убран прямой fetch со страницы), строки через i18n;
- ui: Card/Button/Badge/Skeleton обновлены, Tabs — ARIA-паттерн с управлением стрелками,
  новый StatCard; EmptyState/ErrorState больше не однострочники с any;
- страница «Відключення»: ручной переключатель видов заменён на ui/Tabs, украинские строки
  переведены в i18n; поля StatusResponse (nextAttemptAt/lastError/...) уже в shared.

Проверено: web lint 0, web tests 7/7, token check OK, vite build OK, verify.sh 4/4 PASS.
Осталось (HANDOFF §11): остальные страницы и ленивая загрузка графиков/карты (бюджет gzip).

### `2086a53` feat(api): circuit breaker для источника + пауза переживает перезапуск

*`2086a53` · 2026-10-10 02:16:11 · OlegVapnik*

403/429/таймаут/обрыв TLS больше не повторяются в прогоне (адаптер кидает
SourceBlockedError, а не ретраит), блок на любой порции останавливает весь
прогон. Пауза 30 мин → 1 ч → 3 ч → 6 ч, Retry-After соблюдается, состояние
живёт в sources.consecutive_failures/paused_until (миграция 0009), успех
сбрасывает паузу, планировщик пропускает источник на паузе. /status отдаёт
nextAttemptAt, lastError (без персональных данных), pausedUntil и
consecutiveParseFailures. PARSE_INTERVAL_MINUTES — целое ≥ 30, джиттер меньше
интервала (опечатка падает на старте, а не ускоряет опрос WAF).

Проверено: api lint чисто, фокусные тесты 34/34, tests/integration 24/24,
verify.sh 4/4 PASS, миграция 0009 применена к рабочей БД без рестарта api
(/status HTTP 200). Реальный парсинг и обращения к оператору не выполнялись.

### `20d3116` docs(repo): HANDOFF — live parsing on, numbers agree, remaining data issues

*`20d3116` · 2026-10-10 02:00:00 · OlegVapnik*

Updates the state table (HEAD, working tree, done steps, acceptance test now
GREEN 6/6, dev DB 36/9/38, fresh backup) and adds §9 with this session:

- 9.1 the ingest bug that blocked every live parse (two unique indexes, one
  conflict target) and the fix;
- 9.2 ENABLE_SCHEDULER=true, with the missing circuit breaker spelled out;
- 9.3 step 5 part 1 (stats/status/incidents on events) + area-name normalisation;
- 9.4 what is still crooked: multiple rows per window (event_key contains
  ends_at), /outages and reliability still on legacy rows because of the queue
  filter, powerSummary, circuit breaker;
- 9.5 Android 13+ packaging plan (TWA/Bubblewrap vs Capacitor, minSdk 33 /
  targetSdk 34+, absolute API base URL needed because VITE_API_BASE_URL is baked
  at build time) with the open questions before starting.

### `a45b603` chore(docker): keep operator raw snapshots in a named volume

*`a45b603` · 2026-10-10 02:00:00 · OlegVapnik*

parse.service.ts writes raw operator responses to SNAPSHOT_DIR (in the container
/var/lib/energy-monitor/snapshots); without a volume they die with the container
on the next recreate. The volume also keeps that PII-adjacent data out of the
image/build context.

### `c30db48` feat(api): read canonical outage events in stats, status and incidents

*`c30db48` · 2026-10-10 01:58:46 · OlegVapnik*

migration step 5, part 1 (skills/outage-data-core): /outages/stats, /status and
/incidents no longer aggregate raw address rows, so one real outage is counted
once instead of once per address.

- /outages/stats: distributions count every published window (incl. cancelled —
  it is schedule history and the acceptance test requires 6/6), while
  active/scheduled are computed from cancelled_at/starts_at/ends_at.
- /status: active and scheduled counts come from outage_events.
- /incidents: outage cards are a projection of emergency/repair events with
  addresses from outage_event_addresses; an open-ended event (ends_at NULL) is
  never reported as resolved.
- backfill: area name goes through normalizeOutageLocation, the same normaliser
  as ingest (history said "ДЕСНЯНСЬКЕ", live data says "Деснянське" — the UI
  showed two settlement filters for one village).

Acceptance test tests/integration/outage-numbers.test.ts: 6/6 green
(was 3 red). Integration suite 21/21, api 78 passed, web 2 passed, typecheck OK.

### `e67a3e4` fix(api): make outage ingest idempotent across both unique keys

*`e67a3e4` · 2026-10-10 01:58:42 · OlegVapnik*

Live operator parse never succeeded: `outages` has two unique indexes —
(content_hash, source_id) and the partial (source, external_id) — while
onConflictDoUpdate could target only the first. The web adapter merges
address rows into one event and rewrites addresses_raw, so a repeat run
produced a new content_hash but kept the child external_id and died with
`duplicate key value violates unique constraint "outages_source_external_id_uq"`
(parse_runs: status=error, records_found=0).

Upsert is now explicit: look the row up by EITHER key, then UPDATE (keeps
first_seen_at) or INSERT with onConflictDoNothing as a race guard.

Verified against the live operator feed: two consecutive runs finished
status=success, records_found=7, counts unchanged (36 outages / 9 events /
38 addresses).

### `5e880ce` fix(api): mark a source successful only on a complete operator feed with outage records

*`5e880ce` · 2026-10-10 01:10:45 · OlegVapnik*

Problem: sources.last_success_at was bumped after a partial run (status='partial',
records_found=0), so /status reported fresh data while nothing had actually been
observed.

- runParse: last_success_at is written only when the primary feed is complete
  (complete !== false) AND it carried outage records; otherwise lastError is set
  and parse_runs stays 'partial'.
- ingestOutages: takes an explicit 'complete' flag and is now the single place that
  decides source success, so manual/test runs follow the same rule; a database
  override is accepted so tests can point it at the throwaway *_test database
  instead of the ambient connection.
- chernihiv-web.adapter: a failed operator type no longer aborts the whole fetch;
  it is counted as an unfilled scope (complete=false, completeScopeKeys without
  that portion) and the error is rethrown only when no portion could be loaded.
- tests: last_success_at stays unchanged for a partial feed and for an empty feed;
  a failing configured type (1, 2, 6) cancels nothing while a complete feed still
  cancels the dropped window.
- copy: replace the inaccurate success log with 'Parse run finished' + runStatus.

### `a4cc42d` chore(api): write raw operator snapshots outside src/dist at a configurable path

*`a4cc42d` · 2026-10-10 01:02:45 · OlegVapnik*

Snapshots of raw operator responses (addresses, published text) are written to
SNAPSHOT_DIR (default ../../operator-samples/raw-snapshots relative to the api
cwd; /var/lib/energy-monitor/snapshots in Docker) instead of ../snapshots/
next to the compiled code. The default path avoids the 'snapshots/' directory
name on purpose: .gitignore rule 'snapshots/' matches any nested directory with
that name, which would silently break mkdir. Only raw_snapshot_ref points to
'snapshots/<run-id>.json' as a logical reference.

Also ignore /apps/api/{dist,src}/snapshots and document the variable in
.env.example.


## 2026-10-09  (20 комітів)

### `ca654f7` docs(repo): add HANDOFF.md — branch state, done/left steps, commands, red test

*`ca654f7` · 2026-10-09 18:37:44 · OlegVapnik*

Передача смены по миграции на канонические outage_events (шаги 0-4 сделаны, 5-8 остались).
Собрано из отчётов по шагам, без правок кода:

- ветка `ai/stage1-ops` (локальная, не запушена), HEAD `337951a`, база `main` = `33fa832`;
- что сделано: шаг 0 (бэкапы/baseline), 1 (приёмочный тест + test-db helper),
  2 (0008_outage_events), 3 (backfill + классификация в одной точке), 4 (dual-write на ingest),
  плюс инфраструктурные коммиты Stage 0/1;
- что осталось: шаг 5 — переключить читателей по одному, 6 — чистка легаси,
  7 — rollback (описан), 8 — финальная миграция отдельным релизом;
- команды: verify.sh, scan_secrets, tailwind-токены, интеграционные тесты с TEST_DATABASE_URL,
  миграции/backfill, бэкап и его проверка через контейнер;
- известные проблемы: postgres.js 3.4 + Date в сыром sql, живой парсинг оператора локально
  не прогонялся (флаги адаптеров), snapshots не изолированы от репозитория, флаги в compose;
- красный тест `tests/integration/outage-numbers.test.ts`: таблица 6 кейсов (3 падают),
  причина, доказательство отсутствия регрессии от шага 4 и когда позеленеет (3 -> 1 -> 0);
- бэкапы: свежий дамп после шага 4, проверен реальным восстановлением в scratch-БД (32/6/32).

### `337951a` docs(skills): record the postgres.js Date-param footgun in db-migrations

*`337951a` · 2026-10-09 18:28:06 · OlegVapnik*

Драйвер отвергает Date в сиром drizzle-`sql`-шаблоні: postgres.js 3.4 кидає
«The "string" argument must be of type string or an instance of Buffer or ArrayBuffer. Received an
instance of Date». Перевірено зондом на apps/api 2026-10-09: сирий шаблон + Date падає, сирий шаблон
+ ISO-рядок працює, query builder + Date працює. Тому WHERE/SET збираємо builder-ом, а `sql` лишаємо
для літералів, посилань на колонки та функцій БД.

### `b2c1d0f` feat(api): dual-write canonical outage events on ingest (migration step 4)

*`b2c1d0f` · 2026-10-09 18:23:43 · OlegVapnik*

- outage-events-writer.ts: єдиний писач outage_events / outage_event_addresses;
  ним користуються і backfill, і ingest, тож ключ події та категорія мають одне
  джерело правди (invariant 3 у skills/outage-data-core).
- ingestOutages(): одна транзакція пише і старі адресні рядки `outages`, і канонічну
  подію з її адресами; читачів не перемикає. Пише лог-звірку old path vs outage_events
  (rowsInFeed / eventsOldPath / eventsNewPath / eventsInTable / addressesInTable),
  рахує причини без відомої категорії (без адрес у логах) і скасовує лише ті майбутні
  вікна, яких оператор більше не публікує; порожня стрічка не скасовує нічого.
- markMissingEventsCancelled() і підрахунки зібрані query builder-ом, а не сирим
  sql-шаблоном: drizzle передає там параметри драйверу як є, і postgres.js 3.4 падає
  на Date-параметрі (Bind → Buffer.byteLength «must be a string»).
- tests: outage-events-ingest.test.ts — 6 тестів на спільній фікстурі (30 рядків → 6
  подій, 30 адрес, ідемпотентність, скасування вікна, яке оператор прибрав, і 0
  скасувань для порожньої стрічки).

### `37f7764` chore(repo): stop tracking ALL_IN_ONE.md (already ignored)

*`37f7764` · 2026-10-09 14:36:20 · OlegVapnik*

_(без опису)_

### `64725e1` docs(api): point the backfill header at the db:backfill-events script

*`64725e1` · 2026-10-09 13:02:48 · OlegVapnik*

_(без опису)_

### `90e4fff` test(api): backfill tests (6 events / 30 addresses, idempotent) with a shared fixture and DB helper

*`90e4fff` · 2026-10-09 13:02:03 · OlegVapnik*

_(без опису)_

### `8ae9834` feat(api): outageCategoryFromReason() as the single classification source; idempotent TS backfill for outage_events

*`8ae9834` · 2026-10-09 13:02:03 · OlegVapnik*

_(без опису)_

### `cea4c3b` feat(db): 0008_outage_events — canonical event/address tables and computed-status view

*`cea4c3b` · 2026-10-09 13:02:03 · OlegVapnik*

_(без опису)_

### `fa949b8` test(api): skip the numbers-must-match suite without TEST_DATABASE_URL; add the test:integration script

*`fa949b8` · 2026-10-09 12:56:08 · OlegVapnik*

_(без опису)_

### `55780f3` chore(skills): support scan:allow + .scan-allowlist in scan_secrets.py; note the buildServer prerequisite in test-strategy

*`55780f3` · 2026-10-09 12:55:15 · OlegVapnik*

_(без опису)_

### `c09e6c2` chore(repo): drop the stage1.patch input artifact and ignore ALL_IN_ONE.md

*`c09e6c2` · 2026-10-09 12:55:15 · OlegVapnik*

_(без опису)_

### `01d1d46` chore(test): mark local dev-default credentials with scan:allow (secrets scanner)

*`01d1d46` · 2026-10-09 12:39:34 · OlegVapnik*

_(без опису)_

### `f6fbf85` test(api): red integration test - numbers must match (6 events over 30 address rows)

*`f6fbf85` · 2026-10-09 12:38:42 · OlegVapnik*

_(без опису)_

### `a835f9e` refactor(api): extract buildServer() factory into app.ts (no listen, no scheduler); server.ts stays the thin entry

*`a835f9e` · 2026-10-09 12:38:42 · OlegVapnik*

_(без опису)_

### `bd4e6ab` fix(compose): api healthcheck/init/loopback port, .env-driven scheduler/demo/password, relative VITE_API_BASE_URL

*`bd4e6ab` · 2026-10-09 12:35:10 · OlegVapnik*

_(без опису)_

### `706e8fb` fix(api): graceful shutdown (SIGTERM -> exit 0) and trustProxy from TRUST_PROXY ranges

*`706e8fb` · 2026-10-09 12:35:10 · OlegVapnik*

_(без опису)_

### `fdbf10d` fix(nginx): resolve api at request time (no Exit 1 when api is down), no-cache for sw.js/index.html, security headers

*`fdbf10d` · 2026-10-09 12:35:10 · OlegVapnik*

_(без опису)_

### `fcadd58` fix(stage0): make web typecheck green (skipLibCheck+include), approve esbuild builds, ignore nohup.out

*`fcadd58` · 2026-10-09 12:12:52 · OlegVapnik*

_(без опису)_

### `866becc` fix(stage0): bind db port to loopback, drop generate-frontend.js and junk

*`866becc` · 2026-10-09 12:10:44 · OlegVapnik*

_(без опису)_

### `33fa832` chore: initial commit (baseline before audit fixes)

*`33fa832` · 2026-10-09 12:10:28 · OlegVapnik*

_(без опису)_
