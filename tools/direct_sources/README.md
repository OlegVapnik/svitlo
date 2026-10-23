# direct_sources — прямі джерела ГПВ

Мета — поступово прибрати залежність від `dtek-api.svitlo-proxy.workers.dev` та
Energy-UA. Кожен оператор описується окремим адаптером, а вся спільна логіка
(київські дати, HTTP, злиття інтервалів, JSON/SQL/інжест) живе в `base.py`.

## Структура

```
tools/direct_sources/
├── base.py                  # DayResult, HostResult, HttpClient, build_sql, build_ingest_payload
├── chernihiv_energyua.py    # перший адаптер: Чернігівська область
├── test_chernihiv_energyua.py
└── __main__.py              # реєстр адаптерів і CLI
```

## Швидкий старт

```bash
# JSON-знімок і SQL для D1
.cache/scrapling-venv/bin/python -m tools.direct_sources \
  --adapter chernihiv \
  --json .cache/direct/chernihiv.json \
  --sql .cache/direct/chernihiv.sql

# застосувати SQL до прод-бази
./cf-worker/node_modules/.bin/wrangler d1 execute svitlo --remote \
  --config cf-worker/wrangler.toml --file=.cache/direct/chernihiv.sql

# або POST у воркер (потрібен SVITLO_INGEST_TOKEN)
.cache/scrapling-venv/bin/python -m tools.direct_sources \
  --adapter chernihiv --ingest https://svitlo-api.olegvapnik45.workers.dev/api/v1/internal/schedules-ingest
```

## Контракт адаптера

Адаптер — клас із полями `key`, `region`, `host`, `queues` і методом
`fetch(today, tomorrow) -> HostResult`. Він не пише в D1 і не знає про воркер:
повертає лише нормалізовані `DayResult`.

```python
@dataclass
class DayResult:
    queue: str          # "1.1"
    date: str           # "2026-10-23"
    covered: bool       # false = оператор ще не опублікував
    intervals: list[tuple[str, str]]  # локальний час Києва: [("11:30", "15:00")]
```

`covered=True` з порожнім `intervals` — це «графік опубліковано, відключень
немає». Це важливо не плутати з `covered=False` («ще не опубліковано»).

## Як додати область

1. Створити `tools/direct_sources/<region>.py`.
2. Описати парсер сторінки/API у чисту функцію без мережі (щоб тестувати офлайн).
3. Додати адаптер із `fetch(today, tomorrow)`, який викликає `HttpClient`.
4. Додати його в `ADAPTERS` у `__main__.py`.
5. Додати unit-тест на реальний фрагмент HTML/JSON.
6. Перевірити live: `python -m tools.direct_sources --adapter <key> --json ...`.

## Чернігів: чому Energy-UA

Офіційний `chernihivoblenergo.com.ua` відкриває графік через
`interruptions.energy.cn.ua`, але API `info_schedule_part` вимагає Cloudflare
Turnstile. Без браузера токен не отримати. Тому перший адаптер тимчасово читає
відкритий HTML `chernigiv.energy-ua.info/cherga/1-1` (потрібен `curl_cffi` з
браузерним TLS-відпечатком). Коли офіційний API стане доступним, його можна
додати як другий адаптер із тим самим `HostResult`.

## Важливо

- `tools/` не входить у публічний git-репозиторій.
- SQL видаляє лише рядки свого `source` і своєї області — чужі джерела не зачіпає.
- Після SQL-інжесту воркер підхопить дані з D1 під час наступного крону або
  після завершення TTL кешу.

## Основний хостинг: Cloudflare Browser Run

Чернігів обслуговує сам воркер `cf-worker`, без GitHub і без домашнього
комп'ютера. Окремий крон `15,45 * * * *` відкриває 12 сторінок
`chernigiv.energy-ua.info/cherga/1-1`…`6-2` у справжньому Chromium через
Cloudflare Browser Run і пише результат у D1 як `energy-ua`.

Чому браузер: звичайний `fetch` із Worker отримує 403 від Cloudflare Managed
Challenge, а Browser Run на безкоштовному тарифі дає 10 хвилин Chromium на добу.
Один запуск — близько 9.5 секунди, 48 запусків на добу — приблизно 7.6 хвилини.
Запас є; якщо ліміт почне тиснути, достатньо змінити крон на `15 * * * *`
(раз на годину).

## GitHub Actions — ручний резерв

`.github/workflows/direct-sources.yml` залишається як ручний запуск
`workflow_dispatch`, коли треба перевірити Python-адаптер або отримати SQL/JSON
артефакт. Автоматичний cron вимкнено: GitHub Actions не стартує, поки в
акаунті не вирішено питання з billing, а Cloudflare уже працює безкоштовно.

Потрібен repository secret:

- `SVITLO_INGEST_TOKEN` — токен внутрішнього маршруту
  `/api/v1/internal/schedules-ingest`. Без нього крок синхронізації завершиться
  з помилкою, щоб не мовчки втрачати дані.

Ручний запуск ставить `curl_cffi`, проганяє unittest-и адаптерів, потім виконує:

```bash
python -m tools.direct_sources --adapter all \
  --json .cache/direct/latest.json \
  --sql .cache/direct/latest.sql \
  --ingest https://svitlo-api.olegvapnik45.workers.dev/api/v1/internal/schedules-ingest
```

JSON і SQL зберігаються як artifact на 7 днів.
