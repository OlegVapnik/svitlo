# D1 `rows_read`: аудит і що змінено

Безкоштовний тариф D1 дає 5 млн прочитаних рядків на добу. При двох живих
користувачах воркер випалював 3.9–4.3 млн — майже все це фонові обходи та
пересбірка R2-снапшотів. Нижче — заміри на продовій базі
(`wrangler d1 execute svitlo --remote`, метрика `meta.rows_read`), знайдені
причини й те, що зроблено.

## Заміри «до»

| Запит | rows_read |
|---|---|
| `/status`: активні аварії (`starts_at <= now AND ends_at >= now`) | **7886** |
| `/status`: аварії за сьогодні (`substr(starts_at,1,10) = today`) | **7886** |
| `/status`: аварії за 24 год по області | 592 |
| `/outages`: лента області (`region IN … AND ends_at >= …`) | 1147 |
| `/regions`: `GROUP BY region, source, queue` за два дні | 1252 |
| `/regions`: покриття за дату | 286 |
| `/sync`: зведення по області за дату | 626 |
| `/schedules`: слоти однієї області за дату | 316 |

Ключове: `outage_events` містила 7886 рядків, з них активних — **нуль**. Тобто
`/status` щоразу читав усю історію аварій, щоб отримати 0, і робив це і на
кожному `/sync`. Індекс `(starts_at)` для предиката «закінчується в
майбутньому» не працює взагалі, а індекс `(region, starts_at)` ще й
перетягував на себе ленту `/outages`, яка фільтрує по `ends_at`.

## Що зроблено

### Індекси

| Індекс | Навіщо |
|---|---|
| `idx_outage_events_ends (ends_at DESC)` | счётчики `/status` без області |
| `idx_outage_events_region_ends (region, ends_at DESC)` | `/status` і `/outages` по області |
| `idx_slots_date_region_source_queue (date, region, source, queue)` | покривальний для `/regions` |
| `idx_slots_date_region_queue_times (date, region, queue, time_from, time_to, source)` | покривальний для `/schedules` |
| `idx_coverage_date_region_source (date, region, source, queue)` | покриття за дату |
| `idx_news_source_published (source_key, published_at DESC)` | `/news/sources` |
| ~~`idx_outage_events_region_starts`~~ | **прибрано**: планировщик брав його для запитів по `ends_at` і читав усю історію області |

Індекси створюються і в `schema.sql`, і в ідемпотентному `ensureSchema`
(`modules/schedule/repo.ts`), тому чиста база й жива база отримують однакову
схему.

### SQL

- `outagesToday`: `substr(starts_at, 1, 10) = ?` → діапазон `starts_at >= ? AND starts_at < ?`
  (той самий результат, бо ISO-час починається з дати, але працює індекс).
- `scheduledOutages`: додано `AND ends_at > ?` — «заплановане» й так означає
  «закінчиться в майбутньому», а предикат переводе запит на індекс по `ends_at`.
- `statusCounters` збирає всі дев'ять счётчиків одним запитом; порядок
  плейсхолдерів зафіксовано коментарем-мапою.

### Холості читання

- `refreshHotSnapshot(env, { skipHeavy })`: якщо крон за тик не записав жодного
  зміненого рядка (`slots`, `coverage`, `news`, `outage_events`), важкі шляхи
  (`/regions`, `/queues`, `/status`, `/schedules/upcoming`) не перебудовуються.
  `/news` прогрівається завжди — це десятки рядків. Логіка винесена в
  `platform/snapshot-plan.ts`, щоб її можна було тестувати без D1.
- `deleteSourceSlots` і `importTelegramSchedules` тепер повертають кількість
  фактично записаних рядків — саме за нею вирішується, чи є сенс у прогріві.
- `/regions` і `/queues`: `cache-control` 300 → 1800 секунд. Каталог областей
  змінюється разом з імпортом графіка, а не щохвилини.

### Телеметрія

`platform/d1-telemetry.ts` — Proxy над `D1Database`, який збирає
`rows_read`/`rows_written`/`calls` у розрізі `операція + таблиця`
(`SELECT schedule_slots`, `DELETE news`, …). Живе тільки в пам'яті ізоляту,
тому квоти не витрачає. Віддається в `/internal/d1-status` (поле `telemetry`)
і, якщо задано `LOG_D1_ROWS`, пише один рядок у лог крону:

```
d1: cron 42 запросов, 3120 rows_read (без изменений, тяжёлый прогрев пропущен) — …
```

`first()` не має `meta`, тому для нього рахується одна рядок — верхня оцінка.

## Заміри «після»

| Запит | було | стало |
|---|---|---|
| активні аварії (без області) | 7886 | **1** |
| активні аварії (область) | 7886 | **1** |
| аварії за сьогодні | 7886 | **1** |
| аварії за 24 год (область) | 592 | **1** |
| лента `/outages` | 1147 | **2** |
| `/regions` GROUP BY | 1252 | **622** |
| `/status` сумарно | ~9500 | **1254** |

## Тести

- `cf-worker/tests/query-plans.test.ts` — 21 план на `node:sqlite` з реальною
  `schema.sql`: тест падає, якщо запит пішов повним сканом або втратив
  покривальний індекс.
- `cf-worker/tests/d1-telemetry.test.ts` — класифікація SQL, підрахунок,
  ідемпотентність обгортки, розкладка `meta` по `batch`.
- `cf-worker/tests/snapshot-plan.test.ts` — пропуск важкого прогріву й
  обов'язковий прогрів `/news`.

## Як перевірити на проді

```bash
B=https://svitlo-api.olegvapnik45.workers.dev
curl -s -H "x-ingest-token: $SVITLO_INGEST_TOKEN" "$B/internal/d1-status" | jq .telemetry
cd cf-worker && npx wrangler tail svitlo-api --format pretty | grep 'd1:'
```

Телеметрія починається з нуля на кожному холодному ізоляту — це нормально:
мета не в тому, щоб накопичувати статистику, а в тому, щоб побачити, який SQL
у цьому ізоляті з'їв квоту.
