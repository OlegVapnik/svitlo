# HANDOFF — Svitlo: Передача состояния между сессиями

> **Назначение:** единая точка синхронизации между сессиями разработки.
> Перед началом крупной задачи прочитай раздел **1 (Текущий снимок)**, а в конце сессии (или при остановке на границе >100 правок) обнови его по **Шаблону передачи смены** в разделе 4.

---

## 1. Текущий снимок состояния (на 2026-10-17 / продолжаем сессию)

| Показатель | Состояние |
|---|---|
| **Последний проверенный коммит** | `v2.12.0`: планировщик окон со светом («Коли увімкнути прилади»), перетин двух групп, экспорт графика PNG-карточкой 1080×1350, нативная тактильная отдача в APK (`SvitloHaptics`). До него — v2.11.2 (дата последнего графика в списке областей), v2.11.1 (`/reliability` учитывает `schedule_coverage`), v2.11.0 (Bento-главная), v2.10.1 (`7847053`). |
| **Дизайн-система** | **Obsidian Dark (Zinc)**: фон `#09090B`, карточка `#131318` (грань 1px + верхний блик), текст `#FAFAFA`/`#A1A1AA`; светлая тема — `#F8FAFC`/белый. Акцент выбора — фиксированный изумруд `#10B981` (не зависит от статуса), состояние (`data-power-state`) красит только пилл `StatusPill`, таймер, линию прогресса `WavyProgressBar` и свечение 10%. Радиусы 12/16/24px, морфинг формы и декоративные фигуры удалены. Безопасные зоны телефона — утилиты `.pt-safe`/`.pb-safe` (максимум из `env()` и нативных инсетов `window.SvitloInsets` от `MainActivity`); табы листаются свайпом (`lib/swipe-tabs.ts`), смена раздела проявляется мягко (`.tab-enter` + `lib/tab-transition.ts`), зум в APK выключен. Тема — ровно две (світла/темна), режима «Авто» нет. **Эмодзи в UI нет** — только `lucide-react` и собственные SVG |
| **Масштаб продукта** | **Вся Украина**: мультирегиональный каталог областей (`GET /api/v1/regions`), автоимпорт ГПВ с всеукраинского зеркала (`source='mirror'`) + Telegram (`source='telegram'`) + агрегатор новостей + **5 провайдеров** (mirror, YASNO, DTEK, e-svitlo, chernihivoblenergo) в `apis/api/src/providers/*.ts` |
| **Язык интерфейса** | Единый украинский (`uk.json`); `ru.json`, `en.json` и переключатель языков удалены |
| **Безопасность** | Порт БД закрыт на `127.0.0.1:5432`; `ADMIN_TOKEN` проверяется через `timingSafeEqual` + запрет слабых токенов (<16) в проде; CORS закрыт по умолчанию (`CORS_ORIGINS`); `TRUST_PROXY` настроен; админка вынесена в `ADMIN_ITEMS` |
| **Модель данных (`outage_events`)** | **Шаг 5 и 6 завершены**: все читатели (`/outages`, `/outages/stats`, `/reliability`, `/status`, `power-summary`) переведены на `outage_events`. `endsAt` убран из `outageEventKey()`. `updateOutageStatuses()` заглушена (статус вычисляется на лету). |
| **Система закладок** | Создан **хук `useBookmarks`** (localStorage со `schemaVersion`, поддержка нескольких закладок из разных областей со своей `regionCpu`). Интегрирован в `HomeHeroSection` (чипы + кнопка «Додати в закладки»), `QueueSchedulePage` (карточки с `regionCpu` закладки), `StreetsPage` (кнопка «У закладки» на найденной улице), `MyAddressPage` (при проверке счёта — через `addBookmark` вместо `addQueue`). |
| **Провайдеры графіків** | Созданы файлы `providers/mirror.provider.ts`, `providers/yasno.provider.ts`, `providers/dtek.provider.ts`, `providers/esvitlo.provider.ts`, `providers/chernihiv-oblenergo.provider.ts`. Зарегистрированы в `registry.ts`; интегрированы в `runParse()` (под `PROVIDER_SYNC_ENABLED`) и в `POST /api/v1/admin/parse`.

---

## 2. Открытые задачи и следующие шаги (Приоритетный бэклог)

### Блок 0 (P0): Покрытие областей — проверено 2026-10-17

«Немає даних» по половине страны — это **не баг отображения**: зеркало
(`MIRROR_SCHEDULE_URL = https://dtek-api.svitlo-proxy.workers.dev/`) отдаёт 16 ключей, из них
свежие (на 17.10) — 9. Что видит человек после v2.10.1:

| Состояние | Области |
|---|---|
| График с отключениями на сегодня (`todaySlots`) | Чернігівська 37, Черкаська 49, Полтавська 44, Київська 32, Житомирська 29, Харківська 20 |
| Опубликовано без отключений (`covered`+`allClear`) | Київ, Дніпропетровська (ЦЕК і ДнЕМ), Івано-Франківська |
| Только старые данные (не показываем как «сегодня») | Закарпатська, Хмельницька, Рівненська, Львівська, Тернопільська (все 01.07), Запорізька (11.04) |
| Фид не отдаёт вовсе (`feedKeys: []`) | Вінницька, Волинська, Донецька, Кіровоградська, Луганська, Миколаївська, Одеська, Сумська, Херсонська, Чернівецька |

Следующий шаг: подключать ОСР этих десяти областей (у каждой свой сайт и формат HTML/JSON).
Проверено, что `api.yasno.com.ua` закрыт Incapsula (503), а провайдеры `yasno`/`dtek`/`esvitlo`
в `apps/api` — заглушки, отдающие пустой снапшот. Начинать с области, которая нужна человеку;
проверять endpoint для каждой отдельно, не «оптом».

Повторная проверка источников 2026-10-17 (сессия 2) — что именно НЕ работает и почему:

| Источник | Живой ответ | Вывод |
|---|---|---|
| `https://www.dtek-kem.com.ua/ua/shutdowns` (Київ) | 212 байт, `_Incapsula_Resource` | WAF, без браузера/куки не читается |
| `https://api.yasno.com.ua/.../schedule-turn-off-electricity` | HTTP 503, Incapsula | закрыт для серверных IP |
| `https://www.dtek-dnem.com.ua/ua/shutdowns` | `DisconSchedule.fact = {data: [], update: "24.07.2026"}` | живого графика нет |
| `https://www.dtek-oem.com.ua/ua/shutdowns` (Одеса) | `fact = {data: [], update: "26.01.2026"}` | живого графика нет |
| Telegram `mykolaivoblenergo`, `khmelnytskoblenergo`, `sumyoblenergo`, `cherkasyoblenergo`, `lvivoblenergo` | посты-анонсы со ссылкой на сайт, без кодов черг и интервалов | парсер `telegram-schedule` их не наполнит |

Зеркало (`dtek-api.svitlo-proxy.workers.dev`) проверено заново: 16 ключей, свежие (17.10) — 8,
у `kyiv` группы есть, дат нет вовсе (это и есть «опубликовано, отключений не запланировано»).

**Что исправлено в v2.11.1 (без выдуманных данных):** `/reliability` теперь считает дни из
`schedule_coverage`, а не только из `schedule_slots`. Раньше день, на который оператор опубликовал
график БЕЗ отключений, не давал ни одной строки слотов — и отчёт писал `hasData: false`
(«даних немає»), хотя на экране человек видел «світло за графіком». Теперь такие дни входят в
знаменатель и в `byRegionSummary` с 0 минут отключений и 100% надёжности, а вкладка «Групи»
показывает группы из покрытия. Новых областей это не добавляет: там, где источника нет, честно
остаётся «Немає даних».

#### Аудит 2026-10-17 (сессия 3): «раньше данные были по всем областям» — откуда это ощущение

1. **Данные по всем областям были синтетическими и их убрали осознанно.** Коммит `6b8c582`
   (10.10.2026, «…+ убраны выдуманные данные») удалил `schedule-mock.service.ts` и `SCHEDULE_DEMO`:
   до него `/schedules` при пустой `schedule_slots` отдавал правдоподобный сгенерированный график
   для любой области и любой черги. После удаления стало видно реальное покрытие источников. Это не
   поломка — это возврат к честности (правило `AGENTS.md`: `SCHEDULE_DEMO` запрещён).
2. **Пять областей «пропали» не у нас, а в источнике, и ещё до правок.** В фиде зеркала у
   `lvivska`, `khmelnytska`, `rivnenska`, `ternopilska`, `zakarpatska` дата так и осталась
   `2026-07-01` (у `zaporizka` — `2026-04-11`); это видно и в живом ответе, и в фикстуре
   `apps/api/tests/fixtures/mirror-live.fixture.ts`, снятой 11.10. Зеркало — **внешний** воркер
   (`dtek-api.svitlo-proxy.workers.dev`), не наш: в аккаунте `71de0c66…` скрипта `dtek-api` нет
   (`wrangler deployments list --name dtek-api` → «This Worker does not exist on your account»),
   поэтому «починить зеркало» из этого репозитория нельзя — только заменить источник.
3. **Независимый агрегатор упирается в тот же потолок.** У `alerts.energy` есть открытый API
   (`/api/v1/source-registry/areas/{slug}/shutdowns` — почасовые коды 0/1/3 на 24 клетки, с датами и
   `todayStatus`). Проверены все 27 областей: `summary.totals.areaCount = 9`, расписания есть только
   у Полтавської, Київської, Житомирської, Харківської, Черкаської, Чернігівської, Сумської, Києва и
   Дніпропетровщини (у останньої — пусто на сегодня). Для 14 областей там дословно «Немає
   підтверджених актуальних даних». **Не подключали:** §5–§6 умов сервиса запрещают
   систематическое автоматическое использование без согласия команды (`support@alerts.energy`).
   Единственная реальная прибавка от него — Суми (12 черг), то есть +1 область из 10 «пустых».
4. **Первоисточники пустых областей проверены поштучно.** `api.loe.lviv.ua` (Львів) → редирект на
   `/login` (Symfony); `sm.e-svitlo.com.ua` и `cn.e-svitlo.com.ua` (`/api/info_schedule`,
   `/api/info_disable`) → `401 NOT AUTHORIZED` без учётной записи; `www.toe.com.ua` (Тернопіль) →
   Cloudflare «Just a moment…» (Turnstile, в Worker без браузера не пройти); `www.zoe.com.ua`
   (Запоріжжя) не отвечает даже через внешний рендерер (timeout); `www.hoe.com.ua` (Хмельницький)
   отдаёт страницу без расписания (грузится скриптом); `www.roe.vsei.ua` (Рівне) —
   `wp-json/custom/v1/status` возвращает только `{"status":"Працює"}`; `www.voe.com.ua`
   (Вінниця) публикует привязку адресов к чергам, но не почасовой ГПВ. Telegram-каналы
   (`volynoblenergo`, `lvivoblenergo`, `rivneoblenergo`, `mykolaivoblenergo`) публикуют графики
   ремонтов и анонсы, кодов черг и интервалов там нет.
5. **Что сделано вместо выдумывания.** Список областей в `ReliabilityCard` теперь вместо голого
   «немає даних» показывает дату последнего опубликованного графика («ост. 01.07.2026», подсказка
   в `title`), поэтому состояние источника видно без чтения HANDOFF. Поле `lastDate` уже
   возвращалось `/regions` — UI его просто не использовал.

#### Сделано в v2.12.0: планировщик окон, перетин групп, PNG-карточка, haptics

1. **«Коли увімкнути прилади»** (`components/schedule/PowerWindowPlanner.tsx`): пресеты
   `Прання 2 год / Бойлер 3 год / Зарядна станція 1,5 год / Робота 4 год`; окна считает
   `lib/power-windows.ts` по непрерывным промежуткам без отключений (код 3) — код 2 «можливо
   вимкнуть» тоже разрывает окно. Ответ — «поточне вікно триватиме ще …», «найкраще вікно
   сьогодні/завтра … запас +…» или «не встигнете за один раз». Кнопка «Нагадати на початку вікна»
   ставит локальный таймер через `scheduleNotificationAt()` в `lib/outage-notifications.ts`
   (работает, пока приложение открыто — это написано в подписи).
2. **«Перетин груп»** (`components/schedule/QueueCompareBar.tsx`): вторая группа берётся из
   закладок (своя область) или из `/queues` текущей области. Три полосы по 48 получасов:
   основная, вторая и перетин (`both / either / none / unknown`), плюс минуты «світло в обох»,
   «можна переждати», «без світла в обох». Логика — `lib/queue-overlap.ts`; пустые данные дают
   `unknown`, а не зелёный.
3. **PNG-карточка 1080×1350** (`components/schedule/ShareScheduleButton.tsx` +
   `lib/share-card.ts`): Obsidian Dark, область, очередь, дата, шкала 24 ч с меткой «зараз»,
   список интервалов, подпись `Svitlo · Графік відключень`. Сначала `navigator.share({files})`,
   на десктопе — скачивание PNG. Старый текстовый `ShareSchedule.tsx` удалён (не два способа
   «поделиться» на одном экране). Кнопка есть и в герое, и в карточках `/queues`.
4. **Нативная тактильная отдача**: `MainActivity.HapticsBridge` (`window.SvitloHaptics.vibrateTick`)
   на `performHapticFeedback` (CLOCK_TICK / CONTEXT_CLICK / CONFIRM, без разрешения VIBRATE и с
   уважением системного выключателя), фолбэк `navigator.vibrate(8–18)` в `lib/haptics.ts`.
   Подключено к выбору группы (`QueueSelector`), дню (`DaySegment`), области (`RegionPicker`),
   нижним табам (`BottomNav`), чипам планировщика и кнопке «поделиться».



### Блок А (P1): Закладки групп и всеукраинский справочник «Село / Улица → Группа»
1. **Закладки пользователя (`useBookmarks` / развитие `useMyQueues`):**
   - Расширить сохранение в `localStorage` (с `schemaVersion`), чтобы пользователь мог добавлять в закладки несколько групп и локаций из разных областей (`{ id, label, regionCpu, settlementName, streetName?, queue, isPrimary }`).
   - Вывести быстрые чипы переключения закладок в `MyQueueHero` на главной (`HomePage`) и на странице `/queues`.
2. **Группы ГПВ по сёлам и улицам (`settlements` + `street_queues`):**
   - Привязать `street_queues` к `region` и `settlement_id` (сейчас таблица глобальная без области, поэтому `listQueues` отдаёт счётчик улиц только для дефолтной области).
   - Поддержать группу на уровне всего села (`settlements.default_queue`), чтобы можно было смотреть группу как по улице, так и по селу целиком.
3. **[P2] Локальная проверка воркера (`wrangler dev`) до сих пор не запускается:** модуль экспортирует
   не только обработчики (`ALL_CLEAR_QUEUE`, `compareQueueCodes`, `extractSlots`…), и локальный
   workerd падает с «Incorrect type for map entry 'ALL_CLEAR_QUEUE'». Деплой (`wrangler deploy`) это
   принимает, поэтому облако живо, но проверить правку ДО выкладки локально нельзя. Лечится выносом
   этих экспортов в отдельный модуль (или их снятием — импортов снаружи нет) — тогда заработает и
   `wrangler dev`, и `--test-scheduled`.


### Блок Б (P1): Доводка ядра `outage_events` и парсинга
1. **Завершить Шаг 5 и Шаг 6 миграции `outage_events`:**
   - Переключить оставшиеся читатели `/outages` (список) и `/reliability` / `power-summary` со старой таблицы `outages` на `outage_events` (решив вопрос с фильтром `queue`) и удалить `mergeDuplicateOutages`.
   - Убрать `endsAt` из `outageEventKey()`, чтобы одинаковые события с разным временем окончания по разным улицам сливались в одно окно.
2. **Всеукраинские контакты и провайдеры:**
   - Расширить таблицу `contacts` (сейчас там 7 контактов Черниговобленерго из миграции `0010`) контактами операторов других областей Украины с фильтрацией по `?region=`.

### Блок В (P0 / P2): Инфраструктура и производительность
1. **[P0] HTTPS (TLS):** добавить TLS-терминацию (Caddy / nginx + сертификат), так как сейчас `web` слушает только HTTP 80 (без HTTPS не ставится PWA и не работает Service Worker вне `localhost`).
2. **[P2] Оптимизация чанка графиков и CI:** перевести импорт `echarts` на `echarts/core` (сейчас ленивый чанк графиков ~350 kB gzip) и добавить GitHub Actions workflow.

---

## 3. Шпаргалка дежурных команд

```bash
# Быстрая проверка типов и безопасности (выполнять перед каждым коммитом)
./apps/api/node_modules/.bin/tsc --noEmit && ./apps/web/node_modules/.bin/tsc --noEmit
python3 skills/secrets-pii-hygiene/scripts/scan_secrets.py .
python3 skills/frontend-ui-change/scripts/check_tailwind_tokens.py .

# Бэкап рабочей БД перед миграциями или backfill
STAMP=$(date +%F_%H%M) && docker compose exec -T db pg_dump -U svitlo -d svitlo -Fc > ../svitlo-backups/svitlo_${STAMP}.dump

# Интеграционные тесты (только против *_test БД!)
TEST_DATABASE_URL=postgresql://svitlo:energymon@127.0.0.1:5432/svitlo_test pnpm --filter @svitlo/api test:integration
```

---

## 4. Шаблон записи для передачи следующей сессии (Копируй при завершении работы)

```markdown
## Сессия YYYY-MM-DD: <Краткое название задачи>

- **Ветка / HEAD:** `<branch>` (`<commit_hash>`)
- **Бэкап БД (если снимался):** `../svitlo-backups/svitlo_YYYY-MM-DD_HHMM.dump`

### Done (Что сделано)
- ...

### Changed (Ключевые файлы и миграции)
- `...`

### Verified (Чем проверено — команды и коды возврата)
- `tsc --noEmit` (api / web): 0 ошибок
- `scan_secrets.py`: OK
- Живая проверка (`curl` / UI): ...

### Next / Blockers (Что осталось следующей смене)
1. ...
```

---

## Сессия 2026-10-17 (продолжение): паритет облака по областям и два прод-фикса воркера (v2.10.0)

- **Ветка / HEAD:** `redesign/wow-ui` — тот же релиз 2.10.0 (правки воркера — отдельным коммитом `cf`)
- **Деплой:** `./deploy-cf.sh` (Worker + Pages) + APK на `https://svitlo-api.olegvapnik45.workers.dev/api/v1`

### Done (Что сделано)
- **Канонические области в воркере.** `cf-worker/src/index.ts` держит копию каталога (`REGION_CATALOG`, `REGION_ALIASES`, `canonicalRegionCpu`/`regionFeedKeysOf`) — импортировать `@svitlo/shared` воркер не может, он собирается wrangler'ом отдельно. `?region=` приводится к ключу фида один раз в `handleApi`; `/regions` отдаёт канонические строки с `feedKeys` и группой «Дніпропетровська область» + подстроками `dnipro-cek`/`dnipro-dnem` (`parentCpu`); `/queues` принимает список ключей и объединяет коды групп, а «світло за графіком» ставит только если так опубликовала каждая сеть; для маршрутов одной сети многомережная область даёт `400 AMBIGUOUS_REGION` (список `SINGLE_REGION_PATHS`); канонический `cpu`, совпавший с ключом фида (легасі-`dnipropetrovska-oblast`), больше не даёт дубль строки — его данные складываются в ту же строку.
- **[Прод-баг, найден проверкой] `/regions`, `/queues` и `/schedules` в облаке отдавали 500.** `ensureSchema` вызывался только при ПУСТОЙ `schedule_slots`, поэтому таблица `schedule_coverage` (появилась в v2.9.0) на живой D1 не создавалась вовсе: `D1_ERROR: no such table: schedule_coverage`. Таблицу создал аддитивно (`CREATE TABLE IF NOT EXISTS … ` через `wrangler d1 execute --remote`), а в коде схему накатываю ДО чтения данных (`ensureSchemaOnce` + флаг на изолят).
- **[Прод-баг] `/reliability` в облаке отдавал 500 «Invalid time value».** `labelMonthIso(monthStart)` получал строку, в которой уже есть время, и добавлял `T00:00:00.000Z` вторым — `new Date(...)` давал Invalid Date. Теперь передаётся голая дата (`from`).
- **Диагностика на будущее:** верхний `catch` теперь пишет стек в `console.error` (наружу по-прежнему только внятное тело 500) — без этого по телу «Invalid time value» место падения не найти; ровно так оба бага и были локализованы через `wrangler tail`.
- **Проверка контрактов:** `SVITLO_API_BASE=http://localhost:3001/api/v1 python3 tools/compare-api-contracts.py` — **проблем: 0** (воркер против эталонного Node-бэкенда).
- **APK:** `./tools/build-android-apk.sh "https://svitlo-api.olegvapnik45.workers.dev/api/v1"` → `apps/web/android-apk/app-debug.apk` (4,5 МБ).

### Verified (Чем проверено — команды и коды возврата)
- `tsc --noEmit` (cf-worker) — 0 ошибок; `wrangler deploy --dry-run` — сборка 280 КіБ, ок
- Живой воркер: `/regions` — 28 строк без дублей (`dnipropetrovska-oblast` с `feedKeys: [dnipro-cek, dnipro-dnem]` и двумя подстроками, `kyiv-city` → `[kyiv]`, `kyivska-oblast` → `[kiivska-oblast]`); `/queues?region=dnipropetrovnska-oblast` и `?region=dnipropetrovska-oblast` — 12 черг с `covered: true`; `/schedules?region=kyivska-oblast&queue=4/1` — 200 с интервалами; `/schedules?region=dnipropetrovska-oblast&queue=1/1` — 400 `AMBIGUOUS_REGION`; `/reliability` — 200 (days/weeks/months/groups/byRegionSummary)
- D1: `schedule_coverage` после крона — 175 строк / 15 областей (в т.ч. `dnipro-cek`, `dnipro-dnem` по 12 черг)
- **Осторожно при проверке облака:** ответы кешируются на грани (`cache-control: public, max-age=300`), поэтому после деплоя тему проверяй с любым лишним параметром (`&cb=1`) — иначе видишь предыдущую версию ответа.

### Next / Blockers
1. Локальный `wrangler dev` по-прежнему не стартует из-за не-handler-экспортов в модуле воркера (бэклог, Блок А, п. 3) — пока правки воркера проверяются только на живом облаке.
2. Расхождение на будущее: Node-API сужает многомережную область до сети, у которой есть данные на эту очередь и дату, а воркер всегда отвечает 400 `AMBIGUOUS_REGION`. Для UI это незаметно (группа не выбирается), но если понадобится паритет — добавить ту же проверку по слотам/покрытию.

---


## Сессия 2026-10-17: канонический каталог областей и псевдонимы ключей фида (v2.10.0)

- **Ветка / HEAD:** `redesign/wow-ui` — `efca9f4` (чейнджлог и этот снимок — следующим `docs(tools)`)
- **Бэкап БД:** не снимался (схема и миграции не менялись)

### Done (Что сделано)
- **Канонические области против ключей фида.** Человек ищет «Київська область», «Київ», «Дніпропетровська область», а данные лежат под ключами зеркала: `kiivska-oblast`, `kyiv` и двумя ключами м. Дніпро (`dnipro-cek` — ЦЕК, `dnipro-dnem` — ДнЕМ). Каталог отдавал ключи оператора, поэтому «Київська» не находилась, а опечатка `dnipropetrovnska-oblast` (без «е», как пишут люди) давала пустой график вместо области с графиком.
- **`packages/shared/src/regions-catalog.ts`** — 24 области + Киев с `feedKeys`, псевдонимы (`dnipropetrovnska-oblast` → `dnipropetrovska-oblast`) и хелперы `isRegionCatalogCpu` / `canonicalRegionCpu` / `regionFeedKeys` / `regionReadKeys`. Область с одним ключом подставляется прозрачно; область, которой фид не отдаёт (Одеса, Суми…), остаётся в каталоге с порожним `feedKeys` и нулями — человек находит свою область и видит «даних немає».
- **Многомережные области НЕ сливаются.** ЦЕК и ДнЕМ имеют одинаковую нумерацию черг, но это разные сети: объединение интервалов показало бы часы, которых у человека нет. `/regions` отдаёт такую область группой (`feedKeys` > 1) с подобластями (`parentCpu`); `/schedules` сам сужается к сети, где на эту очередь и дату есть данные, а если данные есть в обеих — честная `400 AMBIGUOUS_REGION` с перечнем ключей; `/queues` (метаданные, не часы) оставляет канонический `cpu` и объединяет коды групп, а «світло за графіком» ставит только если так опубликовала КАЖДАЯ сеть; `/reliability`, `/schedules/upcoming`, `/sync` требуют конкретную сеть.
- **UI:** `regionOptions()` строит список с заголовком группы (заголовок не выбирается, сети — с отступом), `filterRegions` оставляет родителя при совпадении по сети, `RegionSelect` использует нативный `optgroup`. Ключ `regions.selectNetwork` в `uk.json`.
- **[Найдено и исправлено по пути] API-контейнер падал на старте.** `@svitlo/shared` кладётся в образ как TS-источник, а Node при type stripping НЕ резолвит `./x.js` → `x.ts`: `ERR_MODULE_NOT_FOUND /app/packages/shared/src/regions-catalog.js`. Первый относительный импорт внутри `shared` (до этого файл был один) вскрыл это. Теперь импорт с расширением `.ts` + `rewriteRelativeImportExtensions` в `tsconfig.base.json` (и в `packages/shared/tsconfig.json`). Проверено на `node:22-alpine`: `import('@svitlo/shared')` → 25 записей каталога.

### Changed (Ключевые файлы)
- `packages/shared/src/regions-catalog.ts` (новый), `packages/shared/src/index.ts` (реэкспорт с `.ts`; `RegionSummary.feedKeys`/`parentCpu`), `tsconfig.base.json`, `packages/shared/tsconfig.json`
- `apps/api/src/services/regions.service.ts` (`readRegionParam` с псевдонимами и режимом `grouped: 'keep'`, `regionDataKeys`, `resolveScheduleRegionScope`, сборка каталога с группами), `routes/schedules.ts` (цикл по ключам + 400), `routes/queues.ts`, `services/queues.service.ts` (`listQueues(region, keys)`, пересечение `publishedClearQueues`, `groupNamesByQueue`/`mergeNameMaps`)
- Веб: `lib/region.ts` (`RegionOption`, `regionOptions`, `filterRegions`, `parentCpu`/`feedKeys`), `components/region/RegionPicker.tsx`, `components/ui/RegionSelect.tsx`, `i18n/uk.json`; `apps/web/src/version.ts` (2.9.0 → 2.10.0)
- Тесты: новый `apps/api/tests/integration/regions-canonical.test.ts` (8 сценариев через HTTP с fetch-стабом), переписаны `tests/services/regions-param.test.ts`, `tests/integration/regions-api.test.ts`, `tests/integration/sync-bundle.test.ts`, дополнен `apps/web/src/lib/region.test.ts`
- Документация: `docs/regions-multiregion.md` — раздел про канонические названия, группировку и `AMBIGUOUS_REGION`

### Verified (Чем проверено — команды и коды возврата)
- `tsc --noEmit`: api / web / cf-worker / packages-shared — 0 ошибок; `vite build` — exit 0 (сборщик резолвит реэкспорт `.ts`)
- `vitest run` в `apps/api` с `TEST_DATABASE_URL=…/svitlo_test` — **41 файл / 307 тестов зелёные** (все 13 интеграционных файлов отработали); `apps/web` — 13 файлов / 106 тестов
- `scan_secrets.py` — 0 находок; `check_tailwind_tokens.py` — OK
- Образ API пересобран (`docker compose up -d --build api`) и healthy; живые проверки: `/regions` — 27 строк (группа `dnipropetrovska-oblast` + `dnipro-cek`/`dnipro-dnem`, `kyivska-oblast` → `feedKeys: [kiivska-oblast]`, `kyiv-city` → `[kyiv]`); `/queues?region=kyivska-oblast` и `?region=dnipropetrovnska-oblast` — 200 с чергами; `/schedules?region=kyivska-oblast&queue=4/1` — 200 (`source: mirror`); `/schedules?region=dnipropetrovska-oblast&queue=1/1` — 200 (кандидат один), `allClear: true` (обе сети опубликовали день без отключений); `/reliability` и `/schedules/upcoming` с `dnipropetrovska-oblast` — 400 `AMBIGUOUS_REGION`; `/settlements?region=kyivska-oblast&q=Київ` — 200 с `region: kiivska-oblast`; `?region=xyz--bad` — 400 `VALIDATION_ERROR`
- **Ловушка прогона тестов (стоила 31 ложного падения):** `vitest`, запущенный из КОРНЯ репозитория, не читает `apps/api/vitest.config.ts` (`fileParallelism: false`) и подхватывает тесты web заодно — интеграционные файлы идут параллельно по одной БД `svitlo_test` и валятся «duplicate key»/«truncate соседа». Правильно: `cd apps/api && TEST_DATABASE_URL=… vitest run` (или `pnpm --filter @svitlo/api test:integration`). Добавлено в `skills/test-strategy/SKILL.md`.

### Next / Blockers (Что осталось следующей смене)
1. **Паритет Cloudflare-воркера** (`cf-worker/src/index.ts`) — в бэклоге (Блок А, п. 3): `/regions` там всё ещё отдаёт ключи фида без `feedKeys`/`parentCpu`, поэтому в облачной сборке группировки нет, а `dnipropetrovska-oblast` выбирается как пустая область. Деплой (`./deploy-cf.sh`) — только с явного согласия человека.
2. Закоммитить `docs(tools)`: чейнджлог (3 копии — `apps/api`, `apps/web`, `cf-worker/src/data`) и этот снимок сессии.



## Сессия 2026-10-17: покрытие дня ГПВ и «опубликовано без отключень» (v2.9.0)

- **Ветка / HEAD:** `redesign/wow-ui` — `7fea8ea` (чейнджлог — в том же коммите; снимок ниже — следующим `docs(tools)`, потому что хеш коммита содержания появляется только после него)
- **Бэкап БД:** не снимался (схема БД и миграции не менялись; в облаке добавилась таблица `schedule_coverage` внутри `schema.sql`, накатывается `wrangler d1 execute`)

### Done (Что сделано)
- **Разделены «не знаємо» и «знаем, что отключений нет».** Зеркало отдаёт день области и когда все 48 получасовых кодов у очереди — «світло є», а в `schedule_slots` мы пишем только отключения. Поэтому опубликованный график без отключений давал `slots = 0` и подпись «Немає даних» (17.10.2026 — `dnipro-cek`, `dnipro-dnem`, `ivano-frankivska-oblast`: 12 черг, по 48 комірок, усі «світло є»). Теперь `mirrorDayCoverage()` читает уже загруженный снимок и говорит, что именно опубликовано на дату: `/schedules` отдаёт `covered` + `allClear`, `/regions` — `allClear` за сьогодні, `/queues` — `covered`.
- **`allClear` ≠ `covered` — это разные вопросы.** Есть интервалы → показываем их; интервалов нет и день опубликован → «світло за графіком»; опубликованного дня нет → «даних немає». Предохранитель: если фид УЖЕ видит отключение у группы, а слотов ещё нет (импорт отстал), `allClear` не ставим — обещать свет было бы прямой брехнью (`isAllClear()` + `offlineQueues`).
- **Снимок берётся только из кеша** (`peekMirrorSnapshot`), сеть в публичном запросе не дёргается: холодный кеш честно даёт `covered: false`. Импорт `publishedClearQueues` — динамический, иначе цикл `queues.service ↔ mirror-schedule.service`.
- **Надёжность считается на знаменателе известных дней** (`daysKnown`, не меньше суток): у группы с двумя днями данных из семи процент больше не занижается втрое. Завтрашний день считается по опубликованному ГПВ и помечается `isForecast`. Добавлено `byRegionSummary` — сведение по областям, области без данных в список не попадают.
- **Та же логика в облаке** (`cf-worker`): новая таблица `schedule_coverage`, знаменатели по известным дням, `covered`/`allClear` в `/schedules` и `/queues`, `source` из слотов (а не жёсткое `'mirror'`), порядок групп «1, 1/2, 2, 2/2, 10». Туда же перенесён разбор публичных Telegram-каналов операторов (`cf-worker/src/telegram-schedule.ts` — копия проверенного Node-парсера, чтобы оба сервера читали один пост одинаково).
- **Живая проверка:** `/api/v1/queues?region=dnipro-cek` — 12 черг с `covered: true`, `slots: 0`; `/api/v1/schedules?region=dnipro-cek&queue=2/2&date=…` — `intervals: []`, `covered: true`, `allClear: true`, `source: "mirror"`; группа вне фида — `covered: false, allClear: false`; `/api/v1/reliability?region=dnipro-cek` — `byRegionSummary` с `daysKnown`.

### Changed (Ключевые файлы)
- `apps/api/src/services/mirror-schedule.service.ts` (`mirrorDayCoverage`, `isAllClear`), `apps/api/src/services/queues.service.ts` (`covered` в `mergeQueues`, кешный `publishedClearQueues`), `apps/api/src/routes/schedules.ts`, `apps/api/src/services/regions.service.ts` (`allClear` за сьогодні), `apps/api/src/services/reliability.ts` + `routes/reliability.ts` (`daysKnown`, `isForecast`, `byRegionSummary`)
- Веб: `MyQueueHero`, `HomeHeroSection`, `QueueScheduleBar`, `ReliabilityCard`, `QueueSchedulePage`, `StreetsPage`, `lib/region.ts` + `i18n/uk.json`; `apps/web/src/version.ts` (2.8.0 → 2.9.0)
- Облако: `cf-worker/src/index.ts` (+`telegram-schedule.ts`, `schema.sql` — `schedule_coverage`); контракт: `packages/shared/src/index.ts`
- Тесты: новый `apps/api/tests/integration/queues-all-clear.test.ts` (5 сценариев через HTTP со fetch-стабом фида), дополнены юнит-тесты `mirror-schedule.test.ts`, `queues.test.ts`, `reliability.test.ts`, `lib/region.test.ts`, поправлены устаревшие ожидания в `regions-api.test.ts` и `street-queues-region.test.ts` (не знали о `settlements`/`streetNames`)

### Verified (Чем проверено)
- `tsc --noEmit`: api / web / cf-worker — 0 ошибок
- `vitest run` в `apps/api` с `TEST_DATABASE_URL` — 40 файлов / 296 тестов зелёные; `apps/web` — 13 файлов
- `scan_secrets.py` — 0 находок; `check_tailwind_tokens.py` — OK
- `docker compose up -d --build api` — пересобран и проверен живыми `curl` (см. выше)
- `vite build` (web) — собрано за 1,3 с, единственное предупреждение — старое про размер чанка

### Next / Blockers (Что осталось следующей смене)
1. **Деплой воркера не сделан** (правило AGENTS: прод-деплой требует явного согласия человека): `./deploy-cf.sh`, затем `SVITLO_API_BASE=… SVITLO_WORKER_BASE=… python3 tools/compare-api-contracts.py` — сверить новые `covered`/`allClear`/`byRegionSummary` на обоих бэкендах.
2. **Псевдонимы областей.** В фиде и в БД живут `dnipro-cek` / `dnipro-dnem`, которых нет в человеческом каталоге областей (`dnipropetrovnska-oblast`, `dtek-dnem`). Нужен fallback-алиас с меткой источника `region-fallback` в `apps/api/src/services/mirror-schedule.service.ts` и `cf-worker/src/index.ts`, иначе часть Днепропетровщины ищется только по коду оператора.
3. **APK** для v2.9.0 ещё не собирали (`./tools/build-android-apk.sh <api-base>`); веб-сборка проверена (`vite build`).

---

## Сессия 2026-10-16: зум, отступ от строки состояния и данные из облака (v2.8.0)

- **Ветка / HEAD:** `redesign/wow-ui` — `5f791ea` (CORS и маршруты воркера) + `580cc24` (зум, инсеты, переходы табов); снимок ниже и чейнджлог — последним коммитом `docs(tools)`
- **Бэкап БД:** не снимался (схема БД и контракты API не менялись: правки в `apps/web`, `cf-worker` и `tools`)
- **Релиз:** `./deploy-cf.sh` → воркер `svitlo-api` + Pages `svitlo-ua` (бандл `index-DIxLmv3R.js` / `index-3T5yzZR_.css`); APK `versionCode 112` / `versionName 2.8.0` (`BUILD SUCCESSFUL in 20s`, 4,7 МБ), собран `./tools/build-android-apk.sh https://svitlo-api.olegvapnik45.workers.dev/api/v1`

### Done (Что сделано)
- **Главное: «данные с сервера не прилетают» — это CORS-preflight, а не отсутствие связи.** Офлайн-пакет `/sync` уходит с `If-None-Match`, а этот заголовок не «простой»: браузер сначала спрашивает `OPTIONS`, и воркер отклонял его, потому что в `ALLOWED_HEADERS` был только `Content-Type` (и не было `POST`). `fetch` падал с сетевой ошибкой, приложение молча жило на данных первой синхронизации. Теперь preflight отвечает тем, о чём спросили (`access-control-request-headers`), методы — `GET, POST, OPTIONS`, а `json()` и ответ 304 отдают расширенный список.
- **В воркере закрыты дыры маршрутов**, которые фронтенд звал, а зеркало отдавало как 404 «Немає маршруту»: `/news/sources` (по нему на «Інфо» видно, кого читаем), `/street-queues/schedule` и `/places/:account`. Последние два отвечают контрактом эталона («вулиця не прив’язана», `PLACE_NOT_FOUND`) — справочники улиц и лицевых счетов ведёт только Node, зеркало не должно выдумывать привязки.
- **Шапка в APK больше не залезает под часы.** Инсеты измерялись один раз листенером, а система сообщает их после первой раскладки: пришедший ноль «залипал» в поле, и отступ уже не возвращался. Теперь зоны читаются в момент запроса (`getRootWindowInsets()` → `insetCssPx()`), а мост `window.SvitloInsets` стал `public static class InsetsBridge` с `WeakReference<MainActivity>` (WebView вызывает методы через рефлексию, Activity при этом не течёт). Второй канал — запись `--safe-top`/`--safe-bottom` из `evaluateJavascript` при `onStart`/`onResume`.
- **Зум в приложении выключен** (`setSupportZoom(false)` + `setBuiltInZoomControls(false)` + `setDisplayZoomControls(false)`): «щипок» и двойной тап больше не уводят панели за край экрана. В браузере зум остался — там это требование доступности.
- **Смена таба стала мягкой** (это был пункт Next прошлой смены): `.tab-enter` + `lib/tab-transition.ts` (чистая функция направления, 6 кейсов в тесте) + хук `useTabTransition` на двойном `requestAnimationFrame`. Направление выводится из порядка табов, а не из жеста, поэтому тап по нижней панели и свайп выглядят одинаково; `prefers-reduced-motion` и «Економія заряду» гасят переход целиком.
- **Виден источник списка «Що нового»:** под карточкой стоит «оновлено з сервера <дата>», «з кешу телефону» или «вбудований список» (`ChangelogCard`, ключи `changelog.source*`). Список и раньше приходил с сервера, но по нему нельзя было отличить «фиксы не доехали» от «телефон офлайн».
- **`deploy-cf.sh` обновляет чейнджлог перед деплоем воркера** (новый шаг 2/5, `gen_changelog.mjs --limit 20`). Раньше файл переписывался только сборкой APK, поэтому деплой без APK публиковал застывший список.

---

### Changed (Ключевые файлы и миграции)
- Нативное: `apps/web/android/app/src/main/java/ua/com/svitlo/app/MainActivity.java` (`InsetsBridge`, `insetCssPx()`, `observeInsets()`/`onStart`/`onResume`, выключенный зум, канал `--safe-top`/`--safe-bottom`)
- Новые: `apps/web/src/lib/tab-transition.ts` (+ `tab-transition.test.ts`), `apps/web/src/hooks/useTabTransition.ts`
- Правленые: `apps/web/src/hooks/useSafeAreaInsets.ts` (живой мост, guard и try/catch, `pageshow`/`visibilitychange`), `components/layout/AppShell.tsx`, `components/changelog/ChangelogCard.tsx`, `styles/globals.css` (`.tab-enter`), `i18n/uk.json` (`changelog.source*`), `apps/web/src/version.ts` (2.7.0 → 2.8.0), `cf-worker/src/index.ts` (CORS + три маршрута), `deploy-cf.sh` (шаг 2/5 — чейнджлог)
- Миграций БД нет.

### Verified (Чем проверено)
- `tsc --noEmit` из каталогов `apps/api`, `apps/web`, `cf-worker`: 0 ошибок; `vitest run` (apps/web): **13 файлов, 103/103 passed** (включая 6 новых кейсов `tab-transition`); `check_tailwind_tokens.py` — OK; `scan_secrets.py` — 0 findings
- **Живой деплой, CORS:** preflight `OPTIONS /sync` с `Access-Control-Request-Headers: if-none-match` → `204` и `access-control-allow-headers: if-none-match`, `access-control-allow-methods: GET, POST, OPTIONS`; preflight `OPTIONS /addresses/contribute` (`POST` + `content-type`) → `204`; `GET /sync?since=0` с `If-None-Match` → `200`, 43 935 байт, `etag W/"9f2b3ad3"` — приложение теперь получает данные, а не отказ
- **Живые данные:** `/sync?region=chernihivska-oblast&since=0` → 12 групп со слотами (4–5 слотов на группу), справочник НП области, 12 бакетов графика на 16–17.10 (`days: ['2026-10-16','2026-10-17']`); `/news/sources` → 3 источника (ukrenergo — успех в 16:40, chernigivoblenergo — 13:20, dtek_ua — 09:01); `/street-queues/schedule?street=Хрещатик` → честная «вулиця не прив’язана»; `/places/00000000` → `VALIDATION_ERROR` («Особовий рахунок — 9–12 цифр»); `/changelog` → `generatedAt 2026-10-16T17:38:52Z`, верхняя запись `580cc24`
- **D1 (прод):** `schedule_slots` 658, `news` 76, `directory_settlements` 2284, `directory_streets` 20, `address_queues` 6, `outage_events` **0**
- **Pages:** в бандле `index-DIxLmv3R.js` есть `2.8.0` и адрес воркера, в `index-3T5yzZR_.css` — `.tab-enter` с `data-nav-direction=next|prev`
- **APK:** `versionCode 112` / `versionName 2.8.0`, 4 691 685 байт; внутри `assets/public/assets/index-BHs6XKi2.js` с адресом воркера и версией `2.8.0`, в CSS — `.tab-enter`
- **Не проверено «пальцем»:** зум, зона строки состояния и переходы на живом телефоне — в среде нет устройства, проверка только по коду и по совпадению собранных артефактов с исходниками

### Next / Blockers (Что осталось следующей смене)
1. Установить APK `2.8.0` (`adb install -r apps/web/android-apk/app-debug.apk`) и проверить: шапка вышла из-под часов, «щипок» и двойной тап не масштабируют, таб появляется мягко, свайп не спорит с прокруткой графика на `monitor`.
2. **История отключений в облаке пуста** (`outage_events` — 0 строк): таблицу наполняет только обход оператора `runChernihiv`, а `chernihivoblenergo.com.ua` недоступен и с домашней машины, и с границы Cloudflare. Экран истории на облачном пути будет пустым; расписание ГПВ при этом живо (`schedule_slots` 658). Это известное ограничение, а не регресс — см. таблицу «НЕ сделано» в `docs/AI-ONBOARDING.md`.
3. **Привязки улиц к группам в облаке почти пусты** (6 строк `address_queues`, часть — демо «вул. Тестова»): поиск по улице на облачном пути найдёт справочник НП, но не группу. Ждём географии от источника либо наполнения через `POST /addresses/contribute` (теперь этот метод CORS не блокирует).
4. `.vscode/settings.json` остаётся локально правленым (`java.configuration.updateBuildConfiguration`: `interactive` → `automatic`) — к продукту отношения не имеет, в коммиты не попал.
5. Переход между табами — уже CSS-анимация; если захочется «морфинга» разделов, есть запасной путь `document.startViewTransition`, но текущего хватает.

---

## Сессия 2026-10-16: мобильная шапка, строка состояния и свайп табов (v2.7.0)

- **Ветка / HEAD:** `redesign/wow-ui` — `afb98fe` (интерфейс) + `6c8706e` (тесты API); снимок ниже и чейнджлог — последним коммитом `docs(tools)`
- **Бэкап БД:** не снимался (схема БД и контракты API не менялись: правки в `apps/web`, включая нативный `MainActivity`)
- **Релиз:** `./deploy-cf.sh` → воркер `svitlo-api` (https://svitlo-api.olegvapnik45.workers.dev) + Pages `svitlo-ua` (https://svitlo-ua-4ze.pages.dev, бандл `index-Dzcyqdqc.js` / `index-CBWwl8Pr.css`); APK `versionCode 110` / `versionName 2.7.0` (`BUILD SUCCESSFUL in 14s`, 4,5 МБ), собран `./tools/build-android-apk.sh https://svitlo-api.olegvapnik45.workers.dev/api/v1` — адрес API в APK указывает на воркер, а не на домашний сервер, поэтому приложение работает и вне домашней сети

### Done (Что сделано)
- **Строка состояния телефона больше не перекрывает интерфейс.** Две причины и две правки: (1) `padding-top` безопасной зоны жил на `body`, а шапка `sticky top-0` padding предка не учитывает — при прокрутке она прилипала к `y=0` и содержимое уезжало под часы. Отступ переехал на саму шапку (утилита `.pt-safe`); (2) Android-WebView не отдаёт `env(safe-area-inset-*)` в CSS вообще (там всегда 0), поэтому в APK зона не резервировалась никогда. `MainActivity` измеряет `WindowInsets` и публикует мост `window.SvitloInsets` (методы `top()` / `bottom()`), веб читает их в `--safe-top` / `--safe-bottom` (`hooks/useSafeAreaInsets.ts`), а `.pt-safe` / `.pb-safe` берут максимум из системного `env()` и нативного значения. Мост вместо разовой инъекции стиля: страница в WebView грузится позже первого запроса инсетов, а после перезагрузки документа вставленный стиль теряется.
- **Шапка на 360px перестала налезать сама на себя:** словесный логотип только на `sm+`, чип области сжимается многоточием (`flex-1 min-w-0 sm:flex-none`), переключатель темы — одна кнопка 44×44 вместо сегмента из трёх.
- **Тема: режим «Авто» убран**, осталось ровно две (світла/темна) — одна кнопка с иконкой солнца/луны и `aria-pressed`. Он требовал трёх кнопок, дублировал системную настройку и делал поведение невидимым (два одинаковых телефона выглядели по-разному). Старое сохранённое `'auto'` мигрирует в системную тему и записывается как явный выбор (`useTheme`, инлайн-скрипт в `index.html`), подписка на `matchMedia('prefers-color-scheme')` удалена вместе с режимом.
- **Волнистая змейка прогресса стала заметной:** высота 24 → 32px, толщина линии 2.5 → 3.5px, амплитуда 3 → 4.5px, длина волны 24 → 28px; подписи в строке — `text-xs`.
- **Плашки «Зараз HH:MM» убраны со шкал** (`QueueScheduleBar`, `Timeline24h`): белая плашка с временем висела ровно на сегментах и закрывала график (на телефоне это выглядело как дыра в полосе). На шкале осталась белая риска `2px`, время стоит текстом в строке легенды. Неиспользуемые `animate-pin-in` и `@keyframes pin-in` удалены.
- **Свайп между вкладками:** влево — следующий таб, вправо — предыдущий, с вибро-откликом как у тапа. Косые жесты (перевес вертикали 1.6×) не листают, как и жесты внутри `canvas`/`svg` (графики, карта), полей ввода, `[role=dialog]` и блоков с собственной горизонтальной прокруткой. Решение вынесено в чистую функцию `lib/swipe-tabs.ts` и покрыто тестом `lib/swipe-tabs.test.ts` (7 кейсов); хук `useSwipeTabs` навешан на контейнер `AppShell`, чтобы жест работал и над шапкой.
- **Цвета манифеста PWA** приведены к палитре: `theme_color` / `background_color` `#050807` → `#09090b` (манифест видит система до загрузки CSS, по нему окрашивается строка состояния установленного приложения).
- **Тесты API снова зелёные:** `mergeQueues` в `tests/services/queues.test.ts` ожидал `QueueSummary` без `settlements` / `streetNames` (поля добавили раньше, ожидания отстали) — отдельный коммит `6c8706e`.

### Changed (Ключевые файлы и миграции)
- Нативное: `apps/web/android/app/src/main/java/ua/com/svitlo/app/MainActivity.java` (`WindowInsets` → `window.SvitloInsets`)
- Новые: `apps/web/src/hooks/useSafeAreaInsets.ts`, `apps/web/src/hooks/useSwipeTabs.ts`, `apps/web/src/lib/swipe-tabs.ts`, `apps/web/src/lib/swipe-tabs.test.ts`
- Правленые: `apps/web/src/styles/globals.css` (`.pt-safe`, `max(env(), var())` в `.pb-safe`, `--safe-top/--safe-bottom`, удалён `pin-in`), `components/layout/{Header,AppShell}.tsx`, `components/ui/{ThemeToggle,WavyProgressBar}.tsx`, `components/schedule/{Timeline24h,QueueScheduleBar}.tsx`, `hooks/useTheme.ts`, `i18n/uk.json` (`theme.*`), `index.html`, `vite.config.ts`, `apps/web/src/version.ts` (2.6.1 → 2.7.0), `apps/api/tests/services/queues.test.ts`
- Миграций БД нет.

### Verified (Чем проверено)
- `tsc --noEmit`, запущенный из каталогов пакетов (`apps/api`, `apps/web`, `cf-worker`): 0 ошибок. Из корня репозитория та же команда печатает справку и выходит с кодом 1 — корневого `tsconfig.json` нет, только `tsconfig.base.json`, поэтому нужен либо `cd`, либо явный `-p apps/api/tsconfig.json`
- `vitest run` (apps/web): 97/97 passed (12 файлов, включая новый `swipe-tabs`); `vitest run` (apps/api): 218 passed, 55 skipped, 0 failed
- `vite build`: ✓ built; в собранном CSS есть `pt-safe{padding-top:max(env(safe-area-inset-top,0px), var(--safe-top,0px))}` и `pb-safe` с таким же `max(...)`
- `check_tailwind_tokens.py .` — OK; `scan_secrets.py .` — 0 findings
- **Живой деплой:** `curl https://svitlo-api.olegvapnik45.workers.dev/api/v1/health` → `{"status":"ok"}`; `GET /api/v1/changelog` → 30 записей, верхняя `afb98fe` с текстом этой версии (хеш пересобран после `--amend`, чтобы в интерфейсе не осталось несуществующего коммита); в бандле Pages `index-Dzcyqdqc.js` найдена версия `2.7.0` и `--safe-top`, в `index-CBWwl8Pr.css` — `pt-safe{padding-top:max(env(safe-area-inset-top,0px), var(--safe-top,0px))}` и `pb-safe` с тем же `max(...)`
- **APK:** `BUILD SUCCESSFUL in 14s`, 4,5 МБ; внутри архива в `assets/public/assets/*.css` те же `.pt-safe` / `.pb-safe`, адрес API — воркер
- **Не проверено «пальцем»:** зона статус-бара и свайп на живом телефоне (в среде нет устройства и браузера) — только расчёт, ревью кода и совпадение собранных артефактов с исходниками

### Next / Blockers (Что осталось следующей смене)
1. Установить APK `2.7.0` на телефон: шапка должна уйти из-под часов, свайп не должен конфликтовать с прокруткой графиков на `monitor`.
2. При переходе на `targetSdk 36` (edge-to-edge обязателен) перепроверить инсеты: мост не зависит от `Capacitor.adjustMarginsForEdgeToEdge`, но система может поменять раскладку.
3. Свайп можно доработать анимацией перехода (`startViewTransition`) — сейчас раздел меняется мгновенно, как при тапе по табу.


---

## Сессия 2026-10-16: Obsidian Dark — зачистка визуала после M3 Expressive (v2.6.1)

- **Ветка / HEAD:** `redesign/wow-ui` — `706189a` (чейнджлог в воркере) + `ef53f83` (палитра и визуал)
- **Бэкап БД:** не снимался (схема БД и контракты API не менялись: правки в `apps/web`, `cf-worker` и инструментах)
- **Релиз:** `./deploy-cf.sh` → воркер `svitlo-api` + Pages `svitlo-ua` (https://svitlo-ua-4ze.pages.dev); APK `versionCode 105` / `versionName 2.6.1`

### Done (Что сделано)
- **Палитра `globals.css` переписана** на нейтральный Zinc/Obsidian: фон `#09090B`, карточка `#131318` (грань `1px` + верхний блик `--md-highlight-top` вместо тени), вложенные элементы `#1B1B22` (hover `#23232C`), текст `#FAFAFA` и `#A1A1AA`; светлая тема — `#F8FAFC`, белая карточка, грань `#E2E8F0`. Болотных, коричневых и бордовых фонов не осталось.
- **Акцент выбора отвязан от статуса:** `--md-primary` = изумруд `#10B981` (светлая тема — `#047857`) и больше не меняется от `data-power-state`. Раньше тревога в любой точке области перекрашивала всю оболочку. Состояние теперь красит ровно четыре вещи: пилл, текст таймера, линию прогресса и свечение 10% (токены `--md-status`, `--md-status-text`, `--md-status-soft`, `--md-status-border`).
- **Визуальный мусор удалён:** `ExpressiveShapeBadge.tsx` (вместе с `ShapeOutline`) удалён целиком, вместо него `components/ui/StatusPill.tsx` — стеклянный пилл со светящейся точкой и иконкой `Zap` / `Clock` / `ZapOff` / `FileQuestion`; анимации `shape-spin` и `shape-breathe` убраны из темы.
- **`WavyProgressBar` переделан:** высота 24px, `strokeWidth 2.5`, амплитуда 3px, длина волны 24px; пройденная часть — волна цвета состояния, хвост — прямая линия 12% белого, на стыке белая риска-ползунок. `WavyDivider` удалён: между блоками только `border-t border-hairline` (6% белого).
- **Геометрия собрана:** радиусы 12 / 16 / 24px (`--radius-xl/2xl/3xl`), морфинг формы и `active:scale` с изменением радиуса убраны в `QueueSelector`, `GroupMatrix`, `StatCard`; селектор групп — сетка 6×2 с инвертированной выбранной ячейкой; шкалы часов (`QueueScheduleBar`, `Timeline24h`) — `h-9 rounded-xl` в треке `#0E0E12` с сегментами изумруд/рубин/янтарь и белой линией времени.
- **Таймер и оболочка:** мигающее двоеточие убрано, цвет строки состояния телефона всегда нейтрален (`useTheme`, `useDynamicChrome`, `index.html`).
- **`GET /api/v1/changelog` в `cf-worker`:** тот же конверт `{ data }` и те же заголовки, что у Node-бэкенда, `ETag` от содержимого файла; `tools/gen_changelog.mjs` пишет третью копию в `cf-worker/src/data/changelog.json` (в Workers нет файловой системы — JSON вшивается в бандл); `compare-api-contracts.py` сверяет новый маршрут.
- **Скрипт `check_tailwind_tokens.py`** ужесточён: 6 базовых ролей, 14 ролей поверхностей, 6 токенов состояния/грани и полнота палитры всех четырёх состояний в обеих темах.

### Changed (Ключевые файлы)
- `apps/web/src/styles/globals.css`, `apps/web/index.html`, `apps/web/src/version.ts` (2.6.0 → 2.6.1)
- Новое: `apps/web/src/components/ui/StatusPill.tsx`; удалено: `apps/web/src/components/ui/ExpressiveShapeBadge.tsx`
- Правленые: `components/ui/{WavyProgressBar,StatCard}.tsx`, `components/status/{HeroStatus,HomeHeroSection,PowerSummaryCard}.tsx`, `components/schedule/{QueueScheduleBar,Timeline24h}.tsx`, `components/queue/QueueSelector.tsx`, `components/monitor/GroupMatrix.tsx`, `components/layout/AppShell.tsx`, `pages/HomePage.tsx`, `hooks/{useTheme,useDynamicChrome}.ts`
- Воркер и инструменты: `cf-worker/{src/index.ts,tsconfig.json,src/data/changelog.json}`, `tools/{gen_changelog.mjs,compare-api-contracts.py}`, `skills/frontend-ui-change/scripts/check_tailwind_tokens.py`, `docs/AI-ONBOARDING.md`

### Verified (Чем проверено — команды и результат)
- `tsc --noEmit` (api / web / cf-worker): 0 ошибок
- `vitest run` (apps/web): 90/90 passed
- `check_tailwind_tokens.py .`: OK (6 базовых + 14 поверхностей + 6 состояния/грани; 4 состояния × 2 темы)
- `scan_secrets.py .`: 0 findings; эмодзи в `apps/web/src`: 0
- `vite build`: ✓; живой CSS `https://svitlo-ua-4ze.pages.dev/assets/index-BFiAQGjC.css` содержит `--md-hairline:#ffffff0f`, `--md-track:#ffffff1f`, `#09090b` ×8 и не содержит `#161d1a`, `#0a0e0d`, `#5f1422`
- `compare-api-contracts.py` (эталон — локальный api `127.0.0.1:3000`, у LAN-IP порт не слушается): **проблем: 0**, включая новый маршрут `changelog`
- Живая проверка: `GET /api/v1/changelog` на воркере → HTTP 200, верхняя запись — `ef53f83` («Интерфейс переехал на строгий Obsidian Dark…»); `GET /api/v1/health` → `{"status":"ok"}`
- APK: `apps/web/android-apk/app-debug.apk` (4,5 МБ), `versionCode 105`, `versionName 2.6.1`

### Next / Blockers (Что осталось следующей смене)
1. **Визуальный проход на живом сайте** (Hard Reload — PWA отдаёт старый бандл) и установка APK: `adb install -r apps/web/android-apk/app-debug.apk`. Контраст светлой темы посчитан, но «вживую» на улице не проверен.
2. **Свечение Hero и цвета сегментов** посмотреть на реальном графике в момент отключения: сейчас проверено расчётом контраста и разбором бандла, а не глазами на телефоне.
3. Копии чейнджлога (три файла) пишет только `tools/gen_changelog.mjs`; если появится четвёртый потребитель — расширять генератор, а не копировать JSON руками.

---

## Сессия 2026-10-16: Редизайн интерфейса в стиле Material 3 Expressive (v2.6.0)

- **Ветка / HEAD:** `redesign/wow-ui` — `c1eb5cf` (палитра и примитивы) + `cdadc91` (экраны и навигация)
- **Бэкап БД:** не снимался (схема БД и API не менялись — правки только в `apps/web` и проверочном скрипте)
- **Релиз:** `./deploy-cf.sh` → воркер `svitlo-api` + Pages `svitlo-ua` (https://svitlo-ua-4ze.pages.dev); APK `versionCode 102` / `versionName 2.6.0`, build `20261016-1514`

### Done (Что сделано)
- **Токены M3 Expressive** в `globals.css`: тональные поверхности (Dark OLED `#0A0E0D`…`#2B3430` и светло-зеленоватая «бумага» для светлой темы), primary-группа (`primary` / `on-primary` / `primary-container` / `on-primary-container`), статусы сети как отдельные роли, outline-пара, пружинные кривые `--ease-m3-expressive-fast|default`, анимации `wave-slide` / `shape-spin` / `shape-breathe` / `pin-in`. Все внутренние `hsl(var(--…))` переведены на hex + `color-mix()`.
- **Динамическая палитра:** новый хук `usePowerState` (единственный вызов — `AppShell`) ставит `data-power-state="on|warning|off|unknown"`; изумруд → янтарь → рубин → графит. Пустой график даёт `unknown` (графит), правило «зелёный при отсутствии данных запрещён» сохранено.
- **Примитивы:** `components/ui/WavyProgressBar.tsx` (бегущая волна на SVG `<path>` в `<pattern>`, пилл-ползунок, затухание амплитуды при отключении и «оживание» к концу слота) + `WavyDivider`; `components/ui/ExpressiveShapeBadge.tsx` (8-лепестковый cookie / клевер / скруглённый полигон, считаются полярной функцией) + `ShapeOutline` для фона Hero.
- **Главный экран:** Hero-кокпит `rounded-[40px]` с декоративным контуром M3-фигуры, капсулой статуса, огромным отсчётом `text-5xl sm:text-7xl` с мигающим разделителем и волнистым прогрессом с подписями «Пройшло / Залишилось / %». Новая функция `slotProgress()` в `lib/scheduleWindow.ts` (слот отключения или окна «світло є»).
- **Навигация:** M3 Navigation Bar (`h-20`, раскрывающаяся овальная пилюля, `strokeWidth` 2.5 у активной иконки), десктопный Navigation Rail (96 px, подписи под иконками), M3 Top App Bar, Bento-сетка на главной (2/3 статистика + 1/3 сводка электропитания).
- **Шкала 24 часа:** капсулы `rounded-full` с зазором, векторная SVG-штриховка часов отключения, пин «Зараз HH:MM» с иконкой `Clock` внутри полосы (раньше бегунок вылезал за границы и перекрывал подписи).
- **Морфинг формы:** кнопки групп `1/1…6/2` — сквиркл 22px → сжатие `scale-[0.92]` при нажатии → капсула `bg-primary` с иконкой `Check` у активной; плитки матрицы групп — то же поведение.
- **Эмодзи вычищены полностью** (включая `💡` из `document.title`): закладки локаций получили иконки `Home` / `Briefcase` / `Heart` / `MapPin` / `Sparkles` в M3 Filter Chips, статус — `Zap` / `Timer` / `ZapOff` / `FileQuestion`.
- **Скрипт проверки** `check_tailwind_tokens.py` ужесточён: проверяет 6 базовых ролей-утилит, 14 ролей M3 и наличие палитры для всех четырёх состояний сети (раньше искал «сырые» `--primary`, которых в M3-слоях больше нет).
- **Документация:** в `docs/AI-ONBOARDING.md` добавлен раздел «Дизайн-система: Material 3 Expressive».

### Changed (Ключевые файлы)
- Токены/стили: `apps/web/src/styles/globals.css`, `apps/web/index.html`, `apps/web/vite.config.ts`
- Новые: `apps/web/src/components/ui/WavyProgressBar.tsx`, `apps/web/src/components/ui/ExpressiveShapeBadge.tsx`, `apps/web/src/hooks/usePowerState.ts`
- Правленые: `components/status/{HeroStatus,HomeHeroSection,PowerSummaryCard,SyncIndicator}.tsx`, `components/schedule/{Timeline24h,QueueScheduleBar}.tsx`, `components/layout/{AppShell,BottomNav,Sidebar,Header}.tsx`, `components/queue/QueueSelector.tsx`, `components/monitor/GroupMatrix.tsx`, `components/ui/StatCard.tsx`, `pages/HomePage.tsx`, `lib/scheduleWindow.ts`, `hooks/{useTheme,useDynamicChrome,useBookmarks}.ts`, `i18n/uk.json`
- Инструменты/доки: `skills/frontend-ui-change/scripts/check_tailwind_tokens.py`, `docs/AI-ONBOARDING.md`, `HANDOFF.md`, `apps/web/src/version.ts` (2.5.1 → 2.6.0)

### Verified (Чем проверено)
- `tsc --noEmit` (api / web / cf-worker): 0 ошибок
- `vite build`: ✓ built, стартовый чанк 198.7 kB gzip
- `vitest run` (apps/web): 90/90 passed (11 файлов)
- `check_tailwind_tokens.py .`: OK (6 базовых + 14 M3-токенов, 4 состояния сети)
- `scan_secrets.py .`: 0 findings
- `grep -rnP "[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]" apps/web/src`: совпадений нет
- **Живой деплой** (`https://svitlo-ua-4ze.pages.dev`): в `assets/index-CUVhZZky.css` найдены все четыре палитры `data-power-state` (`on|warning|off|unknown`), роли `--md-*` и анимации `wave-slide` / `shape-spin` / `shape-breathe` / `pin-in`; в JS-бандле — версия `2.6.0` и новые подписи Hero («Пройшло», «Залишилось», «Світло є», «Зараз», «Наступне»). То есть редизайн доехал до прода, а не остался в исходниках.
- **API:** `GET /api/v1/health` → `{"status":"ok"}`
- **APK:** `BUILD SUCCESSFUL` (Gradle, 20 s), 4.5 МБ → `apps/web/android-apk/app-debug.apk`

### Next / Blockers
1. Визуальный прогон живого сайта и APK глазами: PWA отдаёт старый бандл, нужен Hard Reload; APK ставится `adb install -r apps/web/android-apk/app-debug.apk`.
2. Hero и Timeline24h отрисовываются из офлайн-снимка — сверить цифры «Пройшло / Залишилось» с графиком оператора при первом же отключении.
3. Контраст светлой темы проверен расчётом (AA+), но не глазами на солнце — отдельный прогон при случае.
4. **Находка прошлых сессий, не блокер:** у CF-воркера нет маршрута `/api/v1/changelog` (`404 NOT_FOUND`), хотя у Fastify-API он есть (`apps/api/src/routes/changelog.ts`, с `ETag`). На CF-сборке карточка «Що нового» живёт на встроенной копии из бандла, поэтому серверные записи чейнджлога до пользователя не доезжают. Чинить отдельной задачей — отдать в воркере `apps/api/src/data/changelog.json`.

---

## Сессия 2026-10-14: Завершение Шагов 5-6 outage_events + создание провайдеров + система закладок

- **Ветка / HEAD:** текущая (`0dfa737` + working tree, не коммичено)
- **Бэкап БД:** не снимался (схема БД не менялась — только читатели переключены)

### Done (Что сделано)
- **Шаг 5:** переключены все читатели с `outages` на `outage_events` (`/outages`, `/outages/:id`, `/reliability`, `power-summary.service.ts`). `updateOutageStatuses()` заглушена (статус вычисляется на лету в `computeStatus()`).
- **Шаг 6:** убран `endsAt` из `outageEventKey()`. Одно отключение с разным временем окончания по разным адресам сливается в одно событие; `upsertOutageEvent` уже имел `least(starts_at)`/`greatest(ends_at)`.
- **Провайдеры:** созданы 5 файлов `apps/api/src/providers/*.ts` (mirror, YASNO, DTEK, e-svitlo, chernihivoblenergo) как обёртки над `ukraine-providers.adapter.ts` и `mirror-all-ukraine.adapter.ts`. Зарегистрированы в `registry.ts`. Интегрированы в `runParse()` и `POST /api/v1/admin/parse`.
- **Система закладок:** новый хук `useBookmarks.ts` (localStorage со `schemaVersion`, мультирегиональные закладки `{ id, label, regionCpu, settlementName?, streetName?, queue, isPrimary }`). Интеграция в `HomeHeroSection` (чипы), `QueueSchedulePage` (карточки с регионом закладки), `StreetsPage` (кнопка «У закладки»), `MyAddressPage` (замена `useMyQueues` на `useBookmarks`).
- **i18n:** добавлены ключи `home.bookmarks`, `home.addToBookmarks`, `common.save`, `common.bookmarksSaved`, `queues.primary`, `queues.setPrimary`, `streets.addToBookmarks`.
- Фикстуры `scan_secrets.py` и `check_tailwind_tokens.py` созданы (ранее отсутствовали).

### Changed (Ключевые файлы и миграции)
- Новые: `apps/api/src/providers/*.ts` (5 файлов)
- Новые: `apps/web/src/hooks/useBookmarks.ts`
- Изменённые API: `outage.service.ts`, `power-summary.service.ts`, `routes/reliability.ts`, `routes/admin.ts`, `parse.service.ts`, `outage-grouping.ts`, `tests/services/outage-grouping.test.ts`
- Изменённые Web: `HomeHeroSection.tsx`, `QueueSchedulePage.tsx`, `StreetsPage.tsx`, `MyAddressPage.tsx`, `uk.json`
- Прочее: `config.test.ts` (добавлен `scan:allow`)

### Verified (Чем проверено — команды и коды возврата)
- ✅ `tsc --noEmit` (api): 0 ошибок
- ✅ `tsc --noEmit` (web): 0 ошибок
- ✅ `scan_secrets.py .`: 0 findings
- ✅ `check_tailwind_tokens.py .`: OK
- ✅ `uk.json`: валидный JSON

### Next / Blockers (Что осталось следующей смене)
1. **Интеграционные тесты** — прогон `outage-numbers.test.ts` (нужен Docker с `svitlo_test` БД). Тест должен стать зелёным (6/6), т.к. читатели переключены.
2. **`MyAddressPage.tsx`** — `useFoundPlace` вызывает `addBookmark`, но `useMyQueues` (`addQueue`) больше не импортируется. Проверить ручное тестирование счёта.
3. **Live `docker compose`** — пересобрать образы и запустить для проверки, что `GET /api/v1/outages` и `GET /api/v1/reliability` работают с новым кодом.
4. **`HANDOFF.md`** — актуализирован, следить за версиями при коммите.
