# Skill: Multi-Source Scrapers, Mirrors, Telegram & Anti-Bot (`scraper-adapter-hardening`)

## Когда применять
При работе с адаптерами операторов (`apps/api/src/parsers/*`), всеукраинским зеркалом ГПВ (`mirror-schedule.service.ts`), автоимпортом из Telegram (`telegram-schedule.service.ts`), сборщиком новостей (`services/news/*`), circuit breaker (`source-breaker*.ts`) и планировщиком (`scheduler/cron.ts`).

## Правила обновлённого парсинга Svitlo
1. **Многоуровневая стратегия добычи данных (Fallback Chain):**
   - **Уровень 1 (Всеукраинское зеркало ГПВ):** `mirror-schedule.service.ts` забирает одним запросом расписание всех областей Украины (`MIRROR_SCHEDULE_URL`), кэширует в памяти на `MIRROR_SCHEDULE_TTL_SEC` (stale-while-revalidate + 30 с backoff при сбое) и атомарно в одной транзакции обновляет `schedule_slots` (`source='mirror'`) и каталог `regions`/`region_queues`.
   - **Уровень 2 (Telegram-каналы ОСР):** `importTelegramSchedule()` разбирает посты за 14 суток (включая оперативные изменения ГПВ и картинки графиков `extractTelegramPhotoUrls`) и пишет `source='telegram'` поверх зеркала, не затирая ручной импорт (`onConflictDoNothing`).
   - **Уровень 3 (Прямые API/сайты обленерго):** `ChernihivWebAdapter` и региональные адаптеры собирают детальные плановые/аварийные отключения по сёлам и улицам, а также привязку улиц и сёл к очередям.
2. **Работа с защитами (Cloudflare / Turnstile / WAF):**
   - Искать обходные пути (зеркала, мобильные/внутренние API, браузерные User-Agent для `*.t.me`, прогрев сессии `warmupSession` с ретраем транзиентных `ETIMEDOUT`) **разрешено и поощряется**.
   - **Внимание по Permissions:** подключение *платных* сервисов решения капчи (`CAPTCHA_SOLVER_API_KEY`) или платных прокси требует предварительного согласия человека (`AGENTS.md`).
3. **Circuit Breaker и изоляция сбоев:**
   - При явном блоке (HTTP 403 / 429) адаптер выбрасывает `SourceBlockedError` без ретраев в текущем прогоне и ставит источник на паузу в БД (`sources.paused_until`: 30 мин → 1 ч → 3 ч → 6 ч).
   - Падение одного источника (в парсере отключений или в сборщике новостей `news`) никогда не валит весь цикл.
   - Пустая или оборванная лента оператора **не отменяет** ранее сохранённые будущие события в `outage_events`.
4. **Безопасность снапшотов:** сырые ответы операторов (`SNAPSHOT_DIR`) должны лежать вне `src/` и `dist/` (`/var/lib/svitlo/snapshots`) и никогда не попадать в git.

## Пошаговая процедура добавления/правки парсера
1. Проверь формат источника на сохранённой фикстуре (без персональных данных!) и напиши чистую функцию парсинга с валидацией выхода.
2. Встрой вызов в соответствующий сервис (`parse.service.ts`, `mirror-schedule.service.ts` или `services/news/`) с `try/catch`, таймаутом и уважением к приоритету источников (`manual > operator > telegram > mirror`).
3. Убедись, что при транзиентном сетевом сбое отдаётся кэш / старые слоты из БД без HTTP 500.
4. Покрой парсер unit-тестом на реальной обезличенной фикстуре.

## Команды проверки
```bash
./apps/api/node_modules/.bin/tsc --noEmit
pnpm --filter @svitlo/api exec vitest run tests/services/mirror-schedule.test.ts tests/services/telegram-schedule.test.ts tests/services/news-parsers.test.ts
```

## Типичные ошибки
- Двойной бэкслеш `\\s` в regex-литералах (например, в RSS-парсере), из-за чего парсер молча находит 0 записей.
- Отправка дефолтного `undici`/ботового `User-Agent` на `t.me/s/...` (Telegram рвёт соединение без браузерного UA).
- Перезапись слотов `manual` или `telegram` данными из `mirror` при повторном импорте.
