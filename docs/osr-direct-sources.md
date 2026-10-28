# Прямі джерела ОСР: реєстр і стратегія

Станом на **2026-10-21**. Мета — поступово прибрати залежність від агрегаторів
(Energy-UA, дзеркала ДТЕК), які закриваються Cloudflare/Incapsula, і брати графіки та
адресні довідники з офіційних порталів операторів розподільчих систем (ОСР).

Машинний реєстр: [`tools/osr_sources.py`](../tools/osr_sources.py). Він містить 25 ключів
(24 області + Київ), офіційні URL, тип джерела, API-base, шаблони endpoint'ів і статус
розвідки. Адаптери мають читати URL звідти, а не дублювати їх у коді.

## Статуси

| Статус | Значення |
|---|---|
| `verified` | Endpoint перевірено 2026-10-21; віддає JSON, PDF або придатний HTML. |
| `url-only` | Офіційну сторінку надав користувач; форму/API ще не досліджували. |
| `html` | Сторінку/форму перевірено, але працює як HTML без зручного JSON. |
| `waf` | Сторінка віддає JS/WAF-челлендж серверним клієнтам. Потрібен браузер або інший шлях. |
| `unresolved` | Публічного прямого джерела поки не підтверджено. |

## Зведена таблиця

| Область | Оператор | Джерело | Тип | Статус |
|---|---|---|---|---|
| Вінницька | Вінницяобленерго | [disconnection/detailed](https://www.voe.com.ua/disconnection/detailed) | HTML | `waf` |
| Волинська | Волиньобленерго | [voe-poweron](https://voe-poweron.inneti.net/) | SPA API | `html` |
| Дніпропетровська | ДТЕК ДнЕМ / ЦЕК | [dtek-dnem](https://www.dtek-dnem.com.ua/ua/shutdowns), [dtek-cek](https://www.dtek-cek.com.ua/ua/shutdowns) | HTML | `waf` |
| Донецька | ДТЕК ДЕМ | [dtek-dem](https://www.dtek-dem.com.ua/ua/shutdowns) | HTML | `url-only` |
| Житомирська | Житомиробленерго | [unhooking-search.php](https://www.ztoe.com.ua/unhooking-search.php) | HTML | `html` |
| Закарпатська | Закарпаттяобленерго | [outage.zakarpat.energy](https://outage.zakarpat.energy/schedule_queues) | Hydra API | `verified` |
| Запорізька | Запоріжжяобленерго | [zoe.com.ua](https://www.zoe.com.ua/) | HTML | `url-only` |
| Івано-Франківська | Прикарпаттяобленерго | [be-svitlo.oe.if.ua](https://be-svitlo.oe.if.ua/) | SPA REST API (/schedule-by-queue) | `verified` (адаптер активний) |
| Київ | ДТЕК КЕМ | [dtek-kem](https://www.dtek-kem.com.ua/ua/shutdowns) | HTML | `waf` |
| Київська | ДТЕК КЕМ | [dtek-kem](https://www.dtek-kem.com.ua/ua/shutdowns) | HTML | `waf` |
| Кіровоградська | Кіровоградобленерго | [electricity-blackout](https://kiroe.com.ua/electricity-blackout) | HTML + JSON | `waf` |
| Луганська | ЛЕО | — | — | `unresolved` |
| Львівська | Львівобленерго | [power-api.loe.lviv.ua](https://power-api.loe.lviv.ua/) | Hydra API + REST розпоряджень (/api/menus) | `verified` (адаптер активний) |
| Миколаївська | Миколаївобленерго | [off.energy.mk.ua](https://off.energy.mk.ua/) | REST API (/api/v2/schedule/active) | `verified` (адаптер активний) |
| Одеська | ДТЕК ОЕМ | [odessa-svet-voda-gas](https://odessa-svet-voda-gas.odessa.ua/ru/odessa/electricity/?view=address) | REST API | `verified` (знімок stale) |
| Полтавська | Полтаваобленерго | [power-outages](https://www.poe.pl.ua/disconnection/power-outages/) | HTML | `url-only` |
| Рівненська | Рівнеобленерго | [disconnections](https://www.roe.vsei.ua/disconnections) | HTML таблиця (#fetched-data-container) + PDF | `verified` (адаптер активний) |
| Сумська | Сумиобленерго | [shutdowns](https://www.soe.com.ua/consumers/shutdowns) | HTML | `url-only` |
| Тернопільська | Тернопільобленерго | [poweron.toe.com.ua](https://poweron.toe.com.ua/) | Hydra API | `verified` |
| Харківська | Харківобленерго | [gaoinfo](https://oblenergo.kharkov.ua/uk/gaoinfo) | HTML | `url-only` |
| Херсонська | Херсонобленерго | — | — | `unresolved` |
| Хмельницька | Хмельницькобленерго | [shutdown/new](https://hoe.com.ua/shutdown/new) | HTML | `url-only` |
| Черкаська | Черкасиобленерго | [cherkasyoblenergo.com/off](https://cherkasyoblenergo.com/off) | HTML | `url-only` |
| Чернівецька | Чернівціобленерго | [shutdowns](https://oblenergo.cv.ua/shutdowns/) | HTML | `verified` |
| Чернігівська | Чернігівобленерго | [PDF графіка](https://chernihivoblenergo.com.ua/files/other/Grafik_obmezhen.pdf) | PDF | `verified` |

## Публікація паків

Графіки ГПВ і приналежність адрес до черг — публічна інформація операторів, тому окремого
legal-статусу для джерел немає. Усі `verified`-джерела можна включати в пак, якщо вони
технічно доступні. Це не скасовує вимогу поважати ліміти: Львів віддає `429`, тому його
повний експорт запускаємо повільно, а не паралельним штурмом.

```bash
python tools/build-address-packs.py --regions lvivska-oblast
```

## Що вже розвідано

### Львівобленерго — `poweron.loe.lviv.ua`

Бекенд SPA: `https://power-api.loe.lviv.ua/api` (Hydra JSON-LD). Адресний довідник повний:

```text
GET /pw_otgs?pagination=false
GET /pw_cities?pagination=false&otg.id={otg_id}
GET /pw_streets?pagination=false&city.id={city_id}
GET /pw_accounts?pagination=false&city.id={city_id}&street.id={street_id}
```

`pw_accounts` віддає `buildingName` і `chergGpv` (наприклад `1.2`) — цього достатньо, щоб
зібрати статичний пак «населений пункт → вулиця → будинок → черга». Перевірено на
`м. Пилипівці`, `вул. Ім. Москаля`: 7 будинків, усі `1.2`.

Поточні/планові відключення: `/pw_accidents` і `/pw_accident_planeds` (поля `city`, `street`,
`buildingNames`, `dateEvent`, `datePlanIn`, `typeOff`). `/pw_accident_histories` дуже повільний.

Тижневого JSON-графіка ГПВ не знайдено: на порталі графік переважно картинками. Окремий
контентний API живе на іншому хості — `https://api.loe.lviv.ua/api` (не `power-api`):

```text
GET /menus?page=1&type=photo-grafic   -> Menu 9 «Чому немає світла (Зображення-графік)»
GET /pages?page=1&synonym=photo-grafic -> []
```

У меню є пункти `Today`, `Tomorrow` і `Arhiv`. Станом на 2026-10-21 `Today`/`Tomorrow` мають
порожні `imageUrl`, `description` і `rawHtml`; архів містить сотні історичних PNG
(`/media/...GPV.png`). Тобто контракт готовий до картинки, але актуального графіка цей API
зараз не віддає. `/pages?synonym=photo-grafic` порожній — не використовувати як джерело.

API жорстко обмежує частоту: пілот на 22 вулицях дістав кілька `429 Too Many Requests`
навіть із паузою 2 с. Повний експорт Львова треба запускати дуже повільно (годинами) або
шукати інший bulk-ендпоінт; для решти областей це не блокер.

### Тернопільобленерго — `poweron.toe.com.ua`

Бекенд: `https://api-poweron.toe.com.ua/api`, та сама Hydra-схема, що у Львова. Перевірено на
`м. Теребовля`, `вул. Тараса Шевченка`: 509 будинків, `chergGpv = 4.2`.

Графік:

```text
GET /a_gpv_g?before={yesterdayT12:00+00:00}&after={tomorrowT00:00+00:00}
    &group={1.1}&time={11}
X-debug-key: base64("1.1")
```

`time` — це група без крапки (`1.1` → `11`). `after` — нижня межа, `before` — верхня;
їх не можна переставляти. Поза сезоном/без відключень `hydra:member` порожній; це нормально.
Також є `/pw_accidents`, `/pw_accident_planeds`, `/pw-accounts/building-groups`,
`/pw-accounts/building-names`, `/pw_accounts_by_acc`.

`a_gpv_g` віддає колекцію `ActualGpvGraph`; JS сайту бере з неї `dateGraph`,
`dateCreate` і `dataJson`, де `dataJson[queue].times[]` містить `{hour, min, s00, s30}`.
`group`/`time` у запиті JS будує з вибраної адреси, а не з коду черги; точний контракт
фільтра ще не підтверджений. Перевірка 2026-10-21: порожній `hydra:member` і для поточного
вікна, і для липня 2026, і для липня 2025 — тобто це не помилка діапазону дат.

`/menus` і `/pages` у Тернополі віддають `404` — контентного API, як у Львова, тут немає.
Єдиний схожий endpoint — `GET /archive_gpv_graphs?page={n}` з фільтрами
`dateGraph[after]`/`dateGraph[before]`. Він повертає Hydra-колекцію `ArchiveGpvGraph`, але
станом на 2026-10-21 це лише три тестові записи (два без даних і один із `rawHtml`
`file:///etc/passwd`). Реальних графіків там немає; парсити цей endpoint як джерело не можна.

### Прикарпаттяобленерго — `svitlo.oe.if.ua`

Бекенд: `https://be-svitlo.oe.if.ua`.

```text
GET  /gpv-queue-list                 -> 12 черг 1.1..6.2
GET  /schedule-by-queue?queue=1.1
POST /schedule-by-search
     {"accountNumber":"...","userSearchChoice":"pob","address":"місто, вулиця, будинок"}
```

`schedule-by-queue` віддає масив денних записів `{eventDate, queues, scheduleApprovedSince}`,
де `queues["1.1"]` — інтервали `{from, to}` у `HH:mm`. Порожній масив означає, що наразі
графік не опубліковано; це не помилка адаптера.

Повної вигрузки адрес немає: тільки пошук за адресою/особовим рахунком. Для паків адрес це
означає або краулити всі вулиці через пошук (дорого), або залишити тільки динамічний пошук.

### Миколаївобленерго — `off.energy.mk.ua`

```text
GET /api/outage-queue/by-type/1..3
GET /api/v2/schedule/active
GET /api/schedule/time-series
GET /api/addr/filii
GET /api/addr/filii/{id}/ns
GET /api/addr/ns/{id}/street
GET /api/addr/street/{id}/dom
GET /api/addr/dom/{iddom}/outage-queue
```

Адресна ієрархія повна (філія → НП → вулиця → будинок → черга), тому це хороший кандидат
на статичний пак. `schedule/active` порожній поза відключеннями; `time-series` — лише
довідник 30-хвилинних слотів, а не сам графік. Перевірено 2026-10-21: API відповідає без WAF.
Активний графік має вигляд `[{from, series: [{outage_queue_id, time_series_id, type}]}]`;
`type` — статус черги в слоті (`ENABLE`/`SURE_OFF` та інші значення).

### ДТЕК Одеса — `odessa-svet-voda-gas.odessa.ua`

Проксі перед `dtek-oem.com.ua`, доступний серверним клієнтам:

```text
GET /api/dtek-search.php?type=streets&q={query}&lang=ru&limit=12
GET /api/dtek-search.php?type=houses&street={street}&q={query}&lang=ru&limit=24
GET /api/dtek-search.php?type=status&street={street}&house={house}&lang=ru
GET /schedule.json
```

`type=houses` віддає `house` + `groups` (у будинку може бути кілька черг). `schedule.json`
містить групи `1.1..6.2`, `periods`, `outage_times`, `status_type`, `source_url`, але
`updated_at`/`schedule_date` можуть відставати — обов'язково перевіряти свіжість.

Перевірено на `вул. Філатова Академіка`: 128 будинків, наприклад будинок `1` → `2.2` і `3.1`.

`dtek-search.php` не має пагінації й віддає максимум 50 підказок, а пошук працює як підрядок,
не як префікс: перебрати всі вулиці запитами `q=а`, `q=аб` неможливо. Тому повний перелік
береться з OpenStreetMap (named `highway` у межах Одеси), а ДТЕК уточнює назву та будинки.
Скрипт: [`tools/scrape-odesa-addresses.py`](../tools/scrape-odesa-addresses.py). Результат на
2026-10-21: 1 005 вулиць, 38 145 будинків; вулиці, яких немає в довіднику ДТЕК, чесно
пропускаються. Пак: `odeska-oblast` у `apps/web/public/data/address/manifest.json`.

### Чернівціобленерго — `oblenergo.cv.ua`

Серверний HTML без JSON. Сторінка `/shutdowns/` містить блок `#gsv` із 12 групами
(`inf1`..`inf12`); у кожній рівно 48 півгодинних клітинок поточного дня.
Позначки: `В` — вимкнено, `З` — заживлено, `МЗ` — можливо заживлено.

Дата над таблицею (`<p>18.10.2026</p>`) — день публікації **чинного добового** графіка, а не
колонка «сьогодні». 2026-10-21 сторінка відкрита о 15:30, графік актуальний на 15:00: усі
12×48 клітинок `З`, тобто опублікований all-clear. Саме цей знімок імпортовано в D1 з
`source = chernivtsioblenergo`.

`МЗ` не перетворюється на гарантоване вимкнення: адаптер вважає його «світло є». Це свідоме
рішення — краще не показати можливе відключення, ніж вигадати точне.

Адаптер і тести: [`tools/osr_direct_sync.py`](../tools/osr_direct_sync.py),
[`tests/test_osr_direct_sync.py`](../tests/test_osr_direct_sync.py).

### Волиньобленерго — `voe-poweron.inneti.net`

Публічна сторінка — SPA. API знайдено в `main.*.js`:
`https://api-voe-poweron.inneti.net/api`.

```text
GET /archive_gpv_graphs
GET /pw_accidents
GET /pw_accident_planeds
GET /pw_streets
GET /pw_cities
GET /pw_gpv_image_today
GET /pw_gpv_image_tomorrow
GET /pw_gpv_nek_comand
GET /options?option_key=successful_last_synk
```

Графік ГПВ віддається **картинками** (`pw_gpv_image_today`/`tomorrow`), а не JSON-інтервалами.
Без OCR або окремого контракту це не дає надійних слотів; поки що джерело не підключене.

### Кіровоградобленерго — `kiroe.com.ua`

HTML `/electricity-blackout` доступний і містить `baseUrl`, `ajaxToken` та endpoint'и:

```text
GET /city/{officeId}
GET /street/{cityId}
GET /house/{streetId}
GET /actual-gpv-graphs
GET /get-house-info/{houseId}
```

Але всі ці data-endpoint'и віддають Cloudflare `403 Just a moment...` навіть через
`scrapling.Fetcher.post(..., impersonate="chrome")`. WAF не обходимо. HTML без виклику цих
endpoint'ів не містить самого графіка, тому область лишається непокритою.

### Закарпаттяобленерго — `outage.zakarpat.energy`

SPA «Чому немає світла?» має бекенд `https://api-outage-zakarpat-energy.inneti.net/api`
(та сама Hydra-схема, що у Львова/Тернополя):

```text
GET /pw_otgs?pagination=false
GET /pw_cities?pagination=false&otg.id={otg_id}
GET /pw_streets?pagination=false&city.id={city_id}
GET /pw_address_queues?page={page}&city.id={city_id}&street.id={street_id}
GET /pw_accidents?pagination=false
GET /pw_accident_planeds?pagination=false
```

Один `pw_address_queues` запис — це вулиця з `buildingNames` (рядок через кому) і `chergGpv`.
Перевірено на `м. Ужгород`, `вул. Стрільнична`: 606 вулиць у місті, запис містить 50+ будинків
і чергу `5.2`. Запит лише з `city.id` повертає посторінковий список таких записів, тому для
повного експорту достатньо обійти міста й пагінацію, а не кожен будинок.

Графік на `/schedule_queues` — це зображення `pw_gpv_image_today` / `pw_gpv_image_tomorrow`
плюс команда НЕК; JSON-інтервалів немає.

### Рівнеобленерго — PDF

PDF: `GPV_cherga_Rivnenska_oblast-1.pdf` (45 сторінок, таблиця
`громада | населені пункти | вулиці/будинки | черга`). Локальний парсер:
[`tools/import-rivne-pdf.py`](../tools/import-rivne-pdf.py). Він пише
`.cache/address-hierarchy/rivne-final.json` у форматі, який читає
[`tools/build-address-packs.py`](../tools/build-address-packs.py).

Після парсингу 2026-10-21: 83 громади, 224 НП, 3617 вулиць, 4003 будинки (7907 рядків).
Назви вулиць без префікса (`Зірненська`, `Небесної Сотні`) розділяються по комах; сміттєві
організації (`ТОВ`, `магазин`, `автовокзал`) і хвости на кшталт `Шевченка с.Яцковичі`
відфільтровуються.

Парсер розводить колізії НП: якщо один НП трапляється у двох непов'язаних громадах, його
назви отримують суфікс `(<Громада> ТГ)` і стають окремими варіантами. Станом на 2026-10-21
таких НП 14 (Білашів, Городище, Залав'я, Зарічне, Карпилівка, Корнин, Лютинськ, Мощаниця,
Мирне, Селець, Смордва, Степань, Уїздці, Хрінники), разом 29 варіантів назв. Клітинки з
кількома громадами через кому — це спільний графік, а не колізія; хвостові коми
нормалізуються.

Вараш у поточному PDF не має самостійних рядків (`0`), але «Вараська» згадується у 76
рядках об'єднаних клітинок інших громад. Якщо Вараш колись з'явиться як НП, парсер
примусово лишить його без черг до окремого джерела, бо в нього окремий графік.

Окремо парсер ловить суперечливі черги для тієї самої адреси: 202 будинки і 114 вулиць
мають у PDF різні коди. Для них пак віддає `null` і список кандидатів, а не першу-ліпшу
чергу; конфліктність на всю вулицю робить невідомою всю вулицю, а не окремі будинки.
Після розділення громад кількість конфліктів зменшилася з 337 до 316: 21 «конфлікт» був
міжгромадівським і зник разом із двозначністю НП.

## Експортер Hydra API

Для Львова, Тернополя й Закарпаття додано
[`tools/export-hydra-addresses.py`](../tools/export-hydra-addresses.py). Він обходить
`otgs → cities → streets`, бере `pw_accounts`/`pw_address_queues` і пише
`.cache/address-hierarchy/<region>-hydra-final.json` у форматі, сумісному з PDF-парсером.

```bash
# пілот на одному місті
.cache/scrapling-venv/bin/python tools/export-hydra-addresses.py \
  --region ternopilska-oblast --city-limit 1 --workers 1

# повний експорт (свідомо, з паузою)
.cache/scrapling-venv/bin/python tools/export-hydra-addresses.py \
  --region zakarpatska-oblast --workers 2 --delay 1
```

Закарпаття: повний експорт — 586 міст, 546 НП, 8263 вулиці, 303 381 рядок; для кожного
міста один bulk-запит `pw_address_queues?pagination=false&city.id=...`. Частина записів не має
вулиці (урочища, КТП); такі рядки збережено під синтетичною вулицею `Без вулиці`, інакше
зникали б цілі населені пункти.
Тернопіль: повний експорт — 955 НП, 10 871 вулиця, 276 551 рядок. Запит іде по 12 252
вулицях, бо `pw_accounts` для міста не містить `street`; 20 вулиць спочатку впали на TLS-
таймаутах, їх дозібрано точковим повторним запитом. Львів через `429` потребує окремого
повільного прогону.

## Стратегія по решті областей

1. **Спочатку шукати JSON/Hydra.** Якщо сайт — SPA, майже завжди є `/api` або окремий
   `api-*` хост. Перевіряти `fetch`/XHR у JS-бандлі, а не тільки HTML.
2. **Повний адресний довідник — окремо від графіка.** Для паків потрібні `НП → вулиця →
   будинок → черга`. Для графіків — `черга → інтервали → дата`. Не змішувати: у Львова є
   адреси, але немає тижневого JSON-графіка; у Франківська є графік, але немає повного довідника.
3. **PDF/HTML — останній варіант.** PDF стабільний, але потребує ручної перевірки якості;
   HTML ламається при редизайні. Кожен HTML-адаптер має мати фікстуру й тест на реальному фрагменті.
4. **WAF не обходити.** ДТЕК КЕМ/ДнЕМ закриті Incapsula; не робити вид/емуляцію браузера заради
   обходу. Для них або залишаємо поточний агрегатор, або шукаємо офіційний мобільний API.
5. **Джерело без даних — це теж результат.** `unresolved` (Луганськ, Херсон) не можна
   замінювати вигаданими URL; область має чесно показувати «джерело недоступне».

## Наступні кроки

- [x] Зафіксувати реєстр 25 ключів у `tools/osr_sources.py`.
- [x] Розібрати PDF Рівненщини та підключити `rivnenska-oblast` до збірки паків.
- [x] Дослідити Закарпаття: знайдено повний Hydra API з адресними чергами.
- [ ] Дослідити решту `url-only`/`html`: Житомир, Вінниця, Запоріжжя, Полтава, Суми,
      Харків, Хмельницький, Черкаси.
- [x] Чернівці: HTML-таблиця 12×48, адаптер і імпорт all-clear у D1.
- [ ] Волинь: графік картинками, потрібен OCR або інший контракт.
- [ ] Кіровоград: data-endpoint'и за Cloudflare WAF, не обходити.
- [x] Написати експортер Hydra API; пілоти Тернополя/Закарпаття пройшли.
- [x] Прибрати legal-фільтр: ГПВ і черги адрес — публічна інформація операторів.
- [x] Додати перевірку колізій НП Рівненщини та golden-тест паритету нормалізаторів.
- [ ] Повільно експортувати Львів з урахуванням `429`.
- [x] Підключити `*-hydra-final.json` до `build-address-packs.py`.
- [x] Повний експорт Закарпаття і Тернополя; Львів — повільно через `429`.
- [ ] Для Одеси/Миколаєва оцінити повний обхід адресної ієрархії та зібрати пілотний пак.
- [ ] Визначити формат зберігання графіків: `queue -> periods[]` з `source_url` і `updated_at`.
