# Передача → opencode: Шаг 1 миграции (генерация regions.ts)

Дата: 2026-10-27 · Контекст: шаг 0 выполнен (см. `git log`, `docs/ARCHITECTURE.md` §11,
`SPEC.md`). Исполнитель работает по `docs/ARCHITECTURE.md` и этому файлу.

## Контекст (главному агенту сделано, не переделывать)

- ADR 0001–0010 — «Принято»; ствол = `main` → `internal/main` (полный контур в git).
- CI-гейты: `.github/workflows/ci.yml`; pre-push guard блокирует `git push` в `origin`
  (обход `--no-verify`); чекпоинты Entire уходят в `svitlo-internal`.
- Запорожье подключено: `zoe.com.ua/outage` — primary в `tools/osr_engine/adapters/__init__.py`
  (group_b_t2 импортирован), Energy-UA — Tier-4 fallback; тесты
  `tests/test_osr_engine_group_b_t2.py` зелёные (66/66 по OSR-набору), живой сбор working.
- Чернигов в проде: слоты 27.10 в D1 (`schedule_slots` 19 шт, `has_outages=1`).

## Задача: Шаг 1 из §11

Цель: **`cf-worker/src/regions.ts` перестаёт быть ручной копией каталога регионов —
генерируется из единого источника; появляется контрактная проверка Worker ↔ пакеты.**

1. Изучи: `packages/shared/src/regions-catalog.ts` (источник), `cf-worker/src/regions.ts`
   (ручная копия), `packages/shared/scripts/gen-regions.mjs` (существующий генератор,
   корневой скрипт `pnpm gen:regions`), тест `cf-worker/tests/regions-parity.test.ts`.
2. Доведи генератор: `pnpm gen:regions` детерминированно пишет `cf-worker/src/regions.ts`
   с заголовком «сгенерировано — не править руками». Повторный запуск без диффа
   (идемпотентность) — обязательный критерий.
3. Сравни текущую копию с каталогом: при расхождениях — СТОП и задокументируй их в отчёте
   (не «подгоняй» каталог под копию и наоборот молча).
4. Контрактные тесты: расширь parity-тест (каталог ↔ сгенерированный файл ↔ экспорты
   воркера). Если в `packages/shared` есть zod-схемы ответа regions — добавь тест структуры
   ответа воркера против схемы; если схем нет — зафиксируй в отчёте, не выдумывай.
5. Зелёные прогоны (обязательны): `pnpm gen:regions && git diff --exit-code`,
   `cd cf-worker && npx tsc --noEmit`, `cd cf-worker && node --test tests/*.test.ts`,
   `pnpm -r --if-present lint && pnpm -r --if-present typecheck`.

## Порядок работы

- Ветка: `git checkout -b arch/step1-regions` от `main`. Коммиты — атомарные, сообщения
  в стиле репо (`feat:`, `test:`, `chore:`), по-русски/украински.
- Тесты до кода: сначала падающий parity-тест на желаемое поведение, потом генератор.
- В конце — отчёт в stdout: сделано; найденные расхождения каталог↔копия; числа прогонов;
  что осталось. НЕ пушить (push делает главный агент), НЕ деплоить, Cloudflare/D1/R2 не
  трогать, `.git/info/exclude` и `.git/hooks` не менять.
