# Skill: Database, Migrations & All-Ukraine Data Model (`db-migrations`)

## Когда применять
При любых изменениях в `apps/api/src/db/schema.ts`, написании SQL-миграций (`apps/api/src/db/migrations/*.sql`), работе с каноническими событиями (`outage_events`, `outage_event_addresses`), регионами (`regions`, `region_queues`), населёнными пунктами (`settlements`), привязкой сёл и улиц к группам (`street_queues`) и нормализацией адресов (`energy_normalize_address`).

## Архитектурные правила БД
1. **Только новые миграции:** никогда не редактируй уже применённые файлы `0001…0016_*.sql`. Создавай следующую по номеру миграцию (`0017_*.sql`), делай её идемпотентной (`IF NOT EXISTS`) и синхронно обновляй `apps/api/src/db/schema.ts`.
2. **Каноническая модель отключений:**
   - Таблица `outage_events` хранит 1 строку на событие (`event_key` = местность + старт + причина, `category` CHECK: `emergency | repair | regime | planned | other`).
   - Таблица `outage_event_addresses` хранит затронутые адреса. Единственный писатель — `outage-events-writer.ts`.
3. **Всеукраинская иерархия «Область → Село/Город → Улица → Группа ГПВ»:**
   - Регионы идентифицируются по `cpu` (`chernihivska-oblast`, `kyiv-city`, `lvivska-oblast` и т.д.) в таблице `regions`.
   - Справочник населённых пунктов (`settlements`) привязан к области; у небольшого села может быть `default_queue` (группа на всё село целиком), а у крупных сёл и городов группы детализируются в `street_queues` с учётом региона/населённого пункта (`region`, `settlement_id`, `street_normalized` → `queue`).
4. **Ограничение Drizzle + `postgres.js 3.4`:**
   - **Никогда** не передавай объект `Date` напрямую внутрь сырого шаблона ``sql`... ${date}` `` — драйвер упадёт с `Received an instance of Date`. Используй Drizzle Query Builder (`gt`, `lte`, `eq`) либо передавай `date.toISOString()` с явным кастом `::timestamptz`.
5. **Нормализация адресов:** SQL-функция `energy_normalize_address(text)` помечена `IMMUTABLE` и используется в триграммных индексах `pg_trgm`. При изменении её логики обязательно пересчитывай `name_normalized` / `street_normalized` в новой миграции.

## Пошаговая процедура
1. Сделай бэкап рабочей БД (`pg_dump -Fc > ../svitlo-backups/svitlo_$(date +%F_%H%M).dump`).
2. Создай файл `apps/api/src/db/migrations/00XX_<name>.sql` (транзакционный, идемпотентный).
3. Отрази новые таблицы/колонки/индексы в `apps/api/src/db/schema.ts`.
4. Примени миграцию локально и проверь идемпотентность повторным запуском.
5. Проверь типы API (`tsc --noEmit`).

## Команды проверки
```bash
# Применение миграции (дважды для проверки идемпотентности)
pnpm --filter @svitlo/api db:migrate && pnpm --filter @svitlo/api db:migrate

# Проверка журнала миграций и таблиц в контейнере
docker compose exec -T db psql -U svitlo -d svitlo -c "SELECT name, applied_at FROM __energy_migrations ORDER BY name DESC LIMIT 5;"

# Проверка типов
./apps/api/node_modules/.bin/tsc --noEmit
```

## Типичные ошибки
- Передача `new Date()` в сырой `sql`-шаблон Drizzle вместо Query Builder.
- Использование `street_normalized` как глобального ключа без привязки к `region` / `settlement_id` (улицы «Шевченка» в разных сёлах Украины перезапишут друг друга).
- Забытый `COPY` или пересборка образа `api` при тестировании через Docker (сервис `migrate` берёт SQL из `dist/db/migrations`).
