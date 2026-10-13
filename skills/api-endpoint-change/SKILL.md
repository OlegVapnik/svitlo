# Skill: API Endpoints, Shared Contracts & Multi-Region Routing (`api-endpoint-change`)

## Когда применять
При добавлении или изменении HTTP-маршрутов в `apps/api/src/routes/*.ts`, сервисов в `apps/api/src/services/*.ts`, схем в `packages/shared/src/index.ts` и клиентских методов в `apps/web/src/api/{client,queries}.ts`.

## Правила дизайна API Svitlo
1. **Единый конверт ответов:**
   - Успех: `{ "data": ... }` (для списков допустим `"meta": { page, limit, total, totalPages }`).
   - Ошибка: через `AppError(statusCode, CODE, message)` → `{ "error": { "code", "message", "details"? } }`; `ZodError` автоматически отдаёт HTTP 400 `VALIDATION_ERROR`.
2. **Контракты сначала в `@svitlo/shared`:**
   - Все DTO, query-параметры и типы (`RegionSummary`, `QueueScheduleData`, `Outage`, `Incident`, `NewsItem`, структуры закладок и сёл) объявляются в `packages/shared/src/index.ts`.
   - Если в `packages/shared` добавляется зависимость, проверь `package.json` и `docker/Dockerfile.api` (копирование `packages/shared/node_modules`).
3. **Всеукраинская мультирегиональность и коды групп:**
   - Все эндпоинты графиков, очередей и поиска улиц/сёл принимают опциональный `?region=<cpu>` (дефолт — `DEFAULT_REGION` из конфига для обратной совместимости).
   - Неизвестный `region` или отсутствие слотов возвращает **честный пустой результат** (`intervals: []`, `source: null`, HTTP 200), а не 400/500 и не фейковые данные (`SCHEDULE_DEMO` запрещён).
   - Слэш в коде очереди (`2/2`) в path-параметрах ломается в nginx (`%2F` → 404): всегда поддерживай передачу очереди через query (`GET /api/v1/schedules?region=...&queue=2/2&date=...`) и трансляцию `2.2` ↔ `2/2`.
4. **Никаких голых `fetch` на фронте:** все запросы идут строго через `apps/web/src/api/client.ts` (с разбором `ApiError`) и хуки TanStack Query в `apps/web/src/api/queries.ts`.

## Пошаговая процедура
1. Опиши/обнови `zod`-схему и TS-тип в `packages/shared/src/index.ts`.
2. Реализуй бизнес-логику в `apps/api/src/services/*.ts` (читай из канонических таблиц `outage_events`, `regions`, `settlements`, `street_queues`, `schedule_slots`).
3. Подключи маршрут в `apps/api/src/routes/*.ts` и зарегистрируй его в `apps/api/src/app.ts` (для `/admin/*` используй `preHandler: [fastify.authenticate]`).
4. Добавь типизированный метод в `apps/web/src/api/client.ts` и хук в `apps/web/src/api/queries.ts`.
5. Проверь типы обоих пакетов и живой ответ через `curl`.

## Команды проверки
```bash
./apps/api/node_modules/.bin/tsc --noEmit && ./apps/web/node_modules/.bin/tsc --noEmit
curl -s "http://localhost:3001/api/v1/regions" | head -c 300
curl -s "http://localhost:3001/api/v1/schedules?region=chernihivska-oblast&queue=2/2" | head -c 300
```

## Типичные ошибки
- Чтение дефолтного региона на уровне импорта модуля, а не лениво внутри функции (ломает unit-тесты без `DATABASE_URL`).
- Чтение старой таблицы `outages` с `mergeDuplicateOutages` вместо канонической `outage_events`.
- Прямой вызов `fetch('/api/v1/...')` внутри React-компонента в обход `api/client.ts`.
