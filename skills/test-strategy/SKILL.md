# Skill: Test Strategy & Data Consistency (`test-strategy`)

## Когда применять
Когда человек просит написать или прогнать тесты, при изменениях в ядре расчётов (`outage-events-writer`, `scheduleWindow`, `mirror-schedule`, `telegram-schedule`, `source-breaker`), а также при настройке CI.
*(Внимание: по правилам Экономного режима из `AGENTS.md` не запускай полный прогон тестов без прямой просьбы человека — по умолчанию достаточно `tsc --noEmit` и точечного теста изменённого модуля.)*

## Правила тестирования в Svitlo
1. **Изоляция тестовой БД (`*_test`):**
   - Интеграционные тесты (`apps/api/tests/integration/*.test.ts`) работают только с отдельной базой, имя которой заканчивается на `_test` (например, `svitlo_test`). Хелпер `tests/helpers/test-db.ts` намеренно выбросит ошибку при попытке подключиться к рабочей базе `svitlo`.
   - Без переменной `TEST_DATABASE_URL` интеграционные файлы автоматически пропускаются (`describe.skipIf`), чтобы unit-прогон всегда проходил без БД.
   - В `vitest.config.ts` установлено `fileParallelism: false` — **не включай параллельность**, так как интеграционные тесты делят одну БД `svitlo_test`.
2. **Главный инвариант цифр (`outage-numbers.test.ts`):**
   - Все эндпоинты (`/outages`, `/outages/stats`, `/status`, `/incidents`, `/reliability`) обязаны показывать одинаковое количество событий из `outage_events` (на эталонной фикстуре: 30 сырых строк = ровно 6 канонических событий).
3. **Запрет на внешнюю сеть и ПД в тестах:**
   - Ни один тест не должен ходить в реальный интернет (к сайтам обленерго, зеркалу или Telegram).
   - В тестовых фикстурах запрещены реальные номера лицевых счетов (используй синтетический `987654321`) и реальные токены.

## Пошаговая процедура
1. Для чистой логики (парсеры, нормализаторы, расчёт интервалов, `scheduleWindow`) пиши быстрый unit-тест без БД.
2. Для проверки SQL, миграций и идемпотентности (`outage-events-ingest`, `mirror-schedule-import`, `regions-api`) пиши интеграционный тест с `ensureTestSchema()`.
3. Запускай сначала только целевой тестовый файл, и лишь по запросу человека — весь набор (`verify.sh`).

## Команды проверки
```bash
# Точечный запуск одного unit-теста (быстро, без БД)
pnpm --filter @svitlo/api exec vitest run tests/services/mirror-schedule.test.ts
pnpm --filter @svitlo/web exec vitest run src/lib/scheduleWindow.test.ts

# Запуск интеграционных тестов против изолированной БД svitlo_test
docker compose exec -T db psql -U svitlo -d postgres -tc "SELECT 1 FROM pg_database WHERE datname='svitlo_test'" | grep -q 1 || docker compose exec -T db createdb -U svitlo svitlo_test
TEST_DATABASE_URL=postgresql://svitlo:energymon@127.0.0.1:5432/svitlo_test pnpm --filter @svitlo/api test:integration
```

## Типичные ошибки
- Запуск `test:integration` с `TEST_DATABASE_URL`, указывающим на рабочую БД `svitlo`.
- Включение параллельного запуска файлов в Vitest (`duplicate key` / `foreign key violation` в `svitlo_test`).
