# Передача → opencode: Шаг 2 (packages/domain), модуль 1 — «киевские сутки и интервалы»

Дата: 2026-10-27 · Предыдущий шаг 1 СМЕРЖЕН в `main` (`58e22e85`): `cf-worker/src/regions.ts`
генерируется из `packages/shared` (см. merge-коммит — образец того, как оформлять работу).
Работаешь по `docs/ARCHITECTURE.md` §5.2–5.4 и ADR-0003 (оба приняты).

## Задача

Создать пакет `packages/domain` — **чистые функции и типы, ноль зависимостей** (никакого zod,
fetch, D1, React; только стандартная библиотека) — и перенести в него ПЕРВЫЙ доменный модуль:
**киевское время / сутки / интервалы слотов**.

1. Инвентарь источников (не переписывать с нуля — переносить проверенную логику):
   - `cf-worker/src/kyiv-time.ts` (157 строк): `kyivOffsetMinutesAt`, `kyivDateKeyFromMs`,
     `kyivToday`, `shiftYmd`, `localSlotToUtc`, `kyivWallClockMs`, `halfHourLabels`;
   - `cf-worker/src/schedule-utils.ts` (48 строк): `queueFromGroupKey`, `cellCode`,
     `offIntervalsFromCodes` — домен «интервалы из кодов зеркала»;
   - `packages/core/src/lib/intervals.ts`, `day-schedule.ts`, `outage-dates.ts` — клиентская
     логика, пересекающаяся по смыслу. ДВИГАТЬ ИХ ПОКА НЕ НАДО: задокументируй в отчёте,
     какие функции дублируют домен и чем отличаются (это материал для следующих модулей).
2. Пакет: `packages/domain` в pnpm-workspace (уже покрыт маской `packages/*`), витхок vitest
   (как в apps/web), скрипты `test`/`typecheck`. Все тесты из `kyiv-time.test.ts` воркера
   переезжают в пакет (и дополняются, если найдёшь дыры в покрытии DST/полуночи).
3. Воркер подключает пакет как `file:../packages/domain` зависимость + `npm ci` в cf-worker
   (там npm, не pnpm). Проверка сборки БЕЗ деплоя: `npx wrangler deploy --dry-run --outdir /tmp/wrangler-dry`
   в cf-worker — если bundling с file:-зависимостью ломается, СТОП и отчёт (не выхолащивай
   домен обратно в копию молча; альтернатива — сгенерированный файл по образцу регионов,
   но сначала попробуй честный импорт).
4. Клиенты (web/mobile/core) на этот модуль не переводить — только воркер + пакет. Это шаг
   следующий.

## Гейты (все зелёные перед финальным коммитом)

- `pnpm -r --if-present test` (включая новый пакет), `pnpm -r --if-present lint`,
  `pnpm -r --if-present typecheck`;
- `cd cf-worker && npx tsc --noEmit && node --test tests/*.test.ts` (105/105 не должно упасть);
- `npx wrangler deploy --dry-run --outdir /tmp/wrangler-dry` без ошибок;
- `pnpm gen:regions && git diff --exit-code` (гейт шага 1 не должен сломаться).

## Порядок работы

- Ветка `arch/step2-domain-kyiv-time` от свежего `main`. Атомарные коммиты, стиль репо.
- Тесты до кода: пакет + переехавшие тесты падают/красные → перенос реализации → зелёные.
- В конце отчёт в stdout: что перенесено, что дублируется в core (таблица), результаты
  прогонов числами, риски.
- Запреты прежние: НЕ пушить, НЕ деплоить (wrangler только --dry-run!), D1/R2 не трогать,
  `.git/hooks` и `.git/info/exclude` не менять, каталог регионов не править руками.
