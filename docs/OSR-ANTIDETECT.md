# Три рівні антидетекту в транспорті ОСР

> Статус: діє з 29.10.2026. Код — `tools/osr_engine/transport/`, тести —
> `tools/osr_engine/tests/test_transport.py`. Це відповідь на питання №3 у
> `docs/ARCHITECTURE.md` §13 (Python vs Worker ingest): транспорт лишається Python,
> контракт один, воркер лише пише.

## Навіщо рівні

Сайти обленерго закриваються різними способами, і кожен спосіб ламає свій інструмент:

| Захист | Що бачить `urllib` | Що потрібно |
|---|---|---|
| TLS-фінгерпринт (JA3), HTTP/2 | «не браузер», `403` | Tier 1: `curl_cffi` з `impersonate="chrome"` |
| Cloudflare Managed Challenge / Turnstile | `Just a moment…` | Tier 2: справжній Chromium без CDP-ознак |
| Incapsula / DDoS-Guard + JS-відбиток | сторінка-заглушка | Tier 3: Camoufox (Firefox з підміною відбитка) |
| Нічого | нормальний HTML | Tier 1 на stdlib (`urllib`) |

## Як влаштовано

```
transport/
  http.py       Tier 1: curl_cffi → httpx → requests → urllib (перший доступний)
  browser.py    Tier 2/3: patchright → playwright → camoufox (перший доступний)
  challenge.py  розпізнавання заглушок (маркери + статуси)
  escalation.py Tier 1 → перевірка → Tier 2/3 → повернення першої «чистої» сторінки
  sessions.py   cookies/cf_clearance по хостах (.cache/osr_sessions.json)
  telegram.py   t.me/s/<channel> через Tier 1
  errors.py     TransportError, BrowserUnavailable
```

Правила, які легко зламати випадково:

1. **`allow_browser=False` за замовчуванням для масових обходів.** Браузер — останній
   аргумент: 12 областей × 2 дати на Chromium не встигають у 12-хвилинний бюджет
   systemd-таймера.
2. **POST не ескалюється в браузер.** Форми операторів (наприклад, Полтава
   `poe.pl.ua/customs/newgpv-info.php`) приймають `application/x-www-form-urlencoded`
   з полем дати; браузер тут лише додає хвилини й нічого не вирішує.
3. **Маркер у тілі читається тільки для коротких сторінок** (< 512 символів), інакше
   звичайний текст новини зі словом «turnstile» вважався б блокуванням.
4. **`cf-mitigated: challenge`** — найнадійніша ознака: заголовок ставить сам Cloudflare,
   текст при цьому може бути будь-яким.
5. **Сесія зберігається**: `cf_clearance` живе годинами, і повторний прогін з тим самим
   cookie не платить за проходження челенджу.

## Встановлення

```bash
python3 -m venv ~/.local/share/osr-venv
~/.local/share/osr-venv/bin/pip install -r tools/osr_engine/requirements-transport.txt
~/.local/share/osr-venv/bin/patchright install chromium   # Tier 2
~/.local/share/osr-venv/bin/camoufox fetch                # Tier 3, ~200 МБ
```

Без цих пакетів движок не падає: `available_backends()` / `available_engines()`
повертають те, що реально є, а `fetch_with_escalation` тихо працює на нижчому рівні.
Саме тому на системному `python3` (лише `requests`) тести й прогін проходять, але
захищені сайти віддадуть порожньо — для бою потрібен venv із `requirements-transport.txt`.

Перевірка, що рівні піднялися:

```bash
~/.local/share/osr-venv/bin/python -c \
  "from tools.osr_engine.transport import backend_names, available_engines; \
   print(backend_names(), available_engines())"
```

## Захист від відкату даних назад

Окремо від транспорту — правило запису: свіжий графік не має бути затёртий старішим.

- **Ранг джерела** (`cf-worker/src/d1-write.ts`, `SOURCE_RANK`): `mirror` 1 <
  `telegram` 2 < `energy-ua`/`chernihivoblenergo` 3. Джерело з меншим рангом не може
  видалити або перезаписати рядок джерела з більшим; при `replace: false` (ОСР,
  Telegram) кожне джерело знімає лише власні рядки.
- **Вік снимка** (`cf-worker/src/ingest-parse.ts`, `MAX_SNAPSHOT_AGE_MINUTES = 45`):
  снимок із `generatedAt` старшим за 45 хвилин не пишеться взагалі — воркер відповідає
  `409 STALE_SNAPSHOT`. Це саме той випадок, коли адаптер залип на закешованій
  сторінці: краще не оновити дані, ніж відкотити їх.
- **Порожній снимок** не пишеться: `parseIngestPayload` не створює ні слотів, ні
  покриття з `covered: false` без інтервалів, а `ingestSchedules` відкидає снимок без
  жодного опублікованого дня (`422 EMPTY_SNAPSHOT`). Один піддомен, що віддав `403`,
  не може стерти чужий графік.

## Бюджет паралельності

`ingest_client.WRITERS = 4` — скільки POST-ів у воркер іде одночасно (`cli.py ingest
--writers 4`). Збір іде з `--workers 6`, а запис — по одному POST на регіон, до чотирьох
паралельно: дванадцять областей проходять за три «хвилі». Підвищувати немає сенсу, кожен
POST — це `SELECT`-диф по `(region, date)` перед `INSERT`, і дванадцять одночасних пушів
стають у чергу на запис D1. Збій області (у тому числі `409 STALE_SNAPSHOT`) не зриває
решту прогону: регіон просто лишається невідміченим і потрапляє в наступний прогін.
