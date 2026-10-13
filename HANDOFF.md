# HANDOFF — Svitlo: Передача состояния между сессиями

> **Назначение:** единая точка синхронизации между сессиями разработки.
> Перед началом крупной задачи прочитай раздел **1 (Текущий снимок)**, а в конце сессии (или при остановке на границе >100 правок) обнови его по **Шаблону передачи смены** в разделе 4.

---

## 1. Текущий снимок состояния (на 2026-10-14 / продолжаем сессию)

| Показатель | Состояние |
|---|---|
| **Последний проверенный коммит** | `0dfa737` (все изменения — working tree, не коммичено) |
| **Масштаб продукта** | **Вся Украина**: мультирегиональный каталог областей (`GET /api/v1/regions`), автоимпорт ГПВ с всеукраинского зеркала (`source='mirror'`) + Telegram (`source='telegram'`) + агрегатор новостей + **5 провайдеров** (mirror, YASNO, DTEK, e-svitlo, chernihivoblenergo) в `apis/api/src/providers/*.ts` |
| **Язык интерфейса** | Единый украинский (`uk.json`); `ru.json`, `en.json` и переключатель языков удалены |
| **Безопасность** | Порт БД закрыт на `127.0.0.1:5432`; `ADMIN_TOKEN` проверяется через `timingSafeEqual` + запрет слабых токенов (<16) в проде; CORS закрыт по умолчанию (`CORS_ORIGINS`); `TRUST_PROXY` настроен; админка вынесена в `ADMIN_ITEMS` |
| **Модель данных (`outage_events`)** | **Шаг 5 и 6 завершены**: все читатели (`/outages`, `/outages/stats`, `/reliability`, `/status`, `power-summary`) переведены на `outage_events`. `endsAt` убран из `outageEventKey()`. `updateOutageStatuses()` заглушена (статус вычисляется на лету). |
| **Система закладок** | Создан **хук `useBookmarks`** (localStorage со `schemaVersion`, поддержка нескольких закладок из разных областей со своей `regionCpu`). Интегрирован в `HomeHeroSection` (чипы + кнопка «Додати в закладки»), `QueueSchedulePage` (карточки с `regionCpu` закладки), `StreetsPage` (кнопка «У закладки» на найденной улице), `MyAddressPage` (при проверке счёта — через `addBookmark` вместо `addQueue`). |
| **Провайдеры графіків** | Созданы файлы `providers/mirror.provider.ts`, `providers/yasno.provider.ts`, `providers/dtek.provider.ts`, `providers/esvitlo.provider.ts`, `providers/chernihiv-oblenergo.provider.ts`. Зарегистрированы в `registry.ts`; интегрированы в `runParse()` (под `PROVIDER_SYNC_ENABLED`) и в `POST /api/v1/admin/parse`.

---

## 2. Открытые задачи и следующие шаги (Приоритетный бэклог)

### Блок А (P1): Закладки групп и всеукраинский справочник «Село / Улица → Группа»
1. **Закладки пользователя (`useBookmarks` / развитие `useMyQueues`):**
   - Расширить сохранение в `localStorage` (с `schemaVersion`), чтобы пользователь мог добавлять в закладки несколько групп и локаций из разных областей (`{ id, label, regionCpu, settlementName, streetName?, queue, isPrimary }`).
   - Вывести быстрые чипы переключения закладок в `MyQueueHero` на главной (`HomePage`) и на странице `/queues`.
2. **Группы ГПВ по сёлам и улицам (`settlements` + `street_queues`):**
   - Привязать `street_queues` к `region` и `settlement_id` (сейчас таблица глобальная без области, поэтому `listQueues` отдаёт счётчик улиц только для дефолтной области).
   - Поддержать группу на уровне всего села (`settlements.default_queue`), чтобы можно было смотреть группу как по улице, так и по селу целиком.

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
