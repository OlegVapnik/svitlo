# SPEC — вынос расчётной логики из UI + защита /internal/d1-status

Версия: 1.0 · Дата: 2026-10-28
Связанные документы: ADR-0007 (UI-форки), ADR-0008 (границы зависимостей), ADR-0009 (публикация среза).

## Цели

1. Компоненты web и mobile остаются представлением: ни один UI-файл не содержит доменных
   расчётов (даты/время, статусы, очереди, регионы, надёжность).
2. Вся расчётная логика живёт в `packages/domain` (чистые правила) или `packages/core/src/lib`
   (клиентские адаптеры) и покрыта тестами.
3. `GET /internal/d1-status` закрыт тем же токеном, что и остальные `/internal/*`.
4. Свежий web-билд выложен на Cloudflare Pages; публичный срез собран `tools/sync-public.sh`.

## Границы

- HTTP-контракты и поведение экранов не меняются (кроме исправления расхождения mobile
  `QueueScheduleBar`: конец отключения считается по `offEndsAt`, а не `now + backInMinutes`).
- JSX, классы, i18n-строки, анимации и layout не переписываются — только замена inline-расчётов
  вызовами ядра.
- `apps/api` не трогаем (заморожен, ADR-0002).
- Репозиторные гейты обязательны: core/vitest, web 240+, worker 107+, `tsc`, boundaries.

## Шаги

1. [x] Аудит inline-расчётов в 8 дублирующихся компонентах и крупных экранах.
2. [x] `packages/core`: тест-раннер vitest + тесты на новые функции.
3. [x] Новые функции: `waveToneOf`/`isSoonMinutes`, `splitClockMinutes`/`formatDayMonth`,
   `NIGHT_HOURS`/`isNightHour`/`minuteFromTrackX`, `regionFreshnessSection`,
   `compareQueueCodes`/`availableQueueCodes`/`collapsedQueueOptions`/`queueCellState`,
   `uniqueIntervalStates`, `scheduleWithFallback`, `activeAccidents`.
4. [x] Перевести web: HeroStatus, Timeline24h, RegionPicker, QueueScheduleBar, QueueCompareBar.
5. [x] Перевести mobile: HeroStatus, Timeline24h, RegionPicker, QueueGrid, QueueScheduleBar,
   AccidentBanner, power-state, info, index (fallback расписания).
6. [x] Токен для `/internal/d1-status` + тест `platform/internal-auth`.
7. [x] Гейты: core tests, web tests, worker tests, tsc обоих клиентов, boundaries, gen:regions.
8. [x] Деплой: worker, Pages, `sync-public.sh`.

## Критерии готовности

- [x] `pnpm --filter @svitlo/core test` зелёный (24 теста); новые функции покрыты тестами.
- [ ] `grep` по UI не находит локальных `splitClock`, `latestIso`, `kyivHm`, `regionHasAnyData`,
      `48` вместо `SLOTS_PER_DAY`, литералов `stateCode === 3/2` в mobile.
- [x] Web-тесты 240+ (240) зелёные, worker 107+ зелёный, `tsc` чистый у web/mobile/worker.
- [x] `/internal/d1-status` без токена → 401, без секрета → 503.
- [x] Pages отдаёт новый бандл, `sync-public.sh` проходит без запрещённых путей.

## Осталось (волна 2)

- `core/lib/reliability.ts`: `buildReliabilityReport`, `selectPastDays`, `summarizeReliability`,
  `selectPeriodBuckets`, `reliabilityGroupRows`, `reliabilityRegionRows`, `regionPillsFor`,
  `selectableRegionOptions`, `isStaleRegionDate`, `poweredPctOf` — затем web `ReliabilityCard`
  и mobile `UpcomingOutages` (931 строка) становятся представлением.
- `core/lib/address.ts`: `isSingleHousePattern`, `housePatternStart`, `filterHousesByQuery`,
  `nearbyHouseOptions`, `matchExactStreetName`, `mergeSettlementOptions`, `findSettlementByName`,
  `dedupeStrings` — затем `AddressWizard` (1039) и `AddressLookup` (643).
- `core/lib/outages.ts`: `mergeUpcomingGroups`, `groupOutagesByReason`, `groupOutagesByPlace`,
  `buildOutageEvents` для `HomePage` и mobile `monitor`.
- `buildWidgetSnapshot` для `HomeHeroSection` (725 строк).

## Чего не трогаем

- Структуру `features/*` (переезд файлов — отдельная задача ADR-0007).
- Дизайн, тексты, навигацию, тему.
- `apps/api` и схему D1.

## Прогресс волны 2

- [x] Reliability-кластер: `core/lib/reliability.ts` (+20 тестов), web `ReliabilityCard`, mobile `UpcomingOutages`.
- [x] Address-кластер: `core/lib/address.ts` (`filterHousesByQuery`, `nearbyHouseOptions`,
  `matchExactStreetName`, `mergeSettlementOptions`, `findSettlementByName`, `settlementSuggestions`,
  `dedupeStrings`, `housePatternStart`, `houseNumberValue`, `isSingleHousePattern`), web `AddressWizard`,
  mobile `AddressLookup`.
- [x] Лента событий: `mergeUpcomingGroups`, `groupOutagesByReason`, `groupOutagesByPlace`,
  `splitFuturePast`, `buildOutageEvents`, `formatDayHeading`; web `HomePage`, mobile `monitor`.
- [x] `HomeHeroSection`: `buildWidgetSnapshot` в `core/lib/outages.ts` (+7 тестов); компонент только подставляет тексты.
