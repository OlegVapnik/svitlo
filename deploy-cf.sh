#!/usr/bin/env bash
#
# deploy-cf.sh — раскладка Svitlo в бесплатное облако Cloudflare одной командой.
#
# Зачем он нужен: приложение должно работать 24/7 по HTTPS, пока ноутбук выключен и никто не
# открывает GitHub. Поэтому здесь нет ни git push, ни CI: сборка фронтенда, деплой Worker и
# загрузка статики в Pages происходят прямо отсюда, локально.
#
# Что делает по шагам:
#   1) собирает фронтенд с VITE_API_BASE_URL, указывающим на воркер;
#   2) деплоит Worker (API + крон) через wrangler;
#   3) заливает собранный apps/web/dist в Cloudflare Pages.
#
# Первый запуск (однократно):
#   1. Войти в Cloudflare:      npx wrangler login
#   2. Создать D1-базу:         npx wrangler d1 create svitlo
#      → скопировать полученный database_id в cf-worker/wrangler.toml
#   3. Залить схему в D1:       ./cf-worker/node_modules/.bin/wrangler d1 execute svitlo \
#                                  --config cf-worker/wrangler.toml --file=cf-worker/schema.sql
#   4. Задать имя Pages-проекта: переменная окружения PAGES_PROJECT (по умолчанию svitlo-ua)
#   5. Запустить:               ./deploy-cf.sh
#
# Повторные запуски безопасны: база перезаписывается, деплой идёт поверх предыдущего.

set -euo pipefail

cd "$(dirname "$0")"

# Имя Pages-проекта: можно задать переменной окружения.
PAGES_PROJECT="${PAGES_PROJECT:-svitlo-ua}"
PAGES_BRANCH="${PAGES_BRANCH:-main}"
WRANGLER="./cf-worker/node_modules/.bin/wrangler"

# ── Проверки окружения ───────────────────────────────────────────────────────
# Сборщик: pnpm в проекте основной, но pnpm может отсутствовать в системе. Тогда берём vite
# из уже установленных зависимостей — сборка от этого не меняется, меняется только запуск.
if command -v pnpm >/dev/null 2>&1; then
  build_frontend() { pnpm --filter @svitlo/web build; }
elif [ -x apps/web/node_modules/.bin/vite ]; then
  echo "Замечание: pnpm не найден, собираю локальным vite из apps/web/node_modules." >&2
  build_frontend() { (cd apps/web && ./node_modules/.bin/vite build); }
else
  echo "ОШИБКА: нет ни pnpm, ни собранного vite. Выполните: pnpm install" >&2
  exit 1
fi

if [ ! -x "$WRANGLER" ]; then
  echo "Зависимости воркера не установлены, ставлю…" >&2
  (cd cf-worker && npm install --no-audit --no-fund)
fi

if [ ! -f cf-worker/wrangler.toml ]; then
  echo "ОШИБКА: нет cf-worker/wrangler.toml" >&2
  exit 1
fi

# Неразвёрнутый database_id — самая частая причина провала первого деплоя.
if grep -q 'ЗАМЕНИТЕ_НА_DATABASE_ID' cf-worker/wrangler.toml; then
  echo "ОШИБКА: в cf-worker/wrangler.toml не подставлен database_id." >&2
  echo "Создайте базу: npx wrangler d1 create svitlo — и вставьте id в [[d1_databases]]." >&2
  exit 1
fi

# ── Шаг 1: деплой Worker ────────────────────────────────────────────────────
# Порядок именно такой: сначала воркер, потому что фронтенд собирается с его URL, и иначе
# вышел бы билд, указывающий на адрес предыдущей (или несуществующей) версии API.
echo "==> 1/3. Деплою Worker (API + крон каждые 20 минут)"
"$WRANGLER" deploy --config cf-worker/wrangler.toml

WORKER_URL="$($WRANGLER deployments list --config cf-worker/wrangler.toml 2>/dev/null \
  | grep -oE 'https://[a-z0-9.-]+\.workers\.dev' | head -n1 || true)"

if [ -z "${WORKER_URL:-}" ]; then
  # Запасной путь: адрес воркера выводится при деплое, но формат вывода менялся между версиями
  # wrangler, поэтому не полагаемся только на парсинг.
  echo "Не удалось определить URL воркера автоматически." >&2
  read -r -p "Вставьте адрес воркера (https://....workers.dev): " WORKER_URL
fi

echo "    Worker доступен по адресу: $WORKER_URL"

# ── Шаг 2: сборка фронтенда на этот адрес ───────────────────────────────────
# VITE_API_BASE_URL вшивается в бандл на этапе сборки, поэтому фронтенд собираем ПОСЛЕ деплоя
# воркера и с его фактическим адресом.
echo "==> 2/3. Собираю фронтенд на $WORKER_URL"
VITE_API_BASE_URL="$WORKER_URL/api/v1" build_frontend

if [ ! -d apps/web/dist ]; then
  echo "ОШИБКА: сборка не дала apps/web/dist" >&2
  exit 1
fi

# ── Шаг 3: публикация статики в Pages ───────────────────────────────────────
echo "==> 3/3. Загружаю статику в Cloudflare Pages ($PAGES_PROJECT)"
"$WRANGLER" pages deploy apps/web/dist --project-name="$PAGES_PROJECT" --branch="$PAGES_BRANCH"

cat <<EOF

Готово.

  API:    $WORKER_URL/api/v1/health
  Сайт:   https://$PAGES_PROJECT.pages.dev

Проверка:  curl -s $WORKER_URL/api/v1/health
Крон воркера сам обновляет график каждые 20 минут — ноутбук можно выключать.
EOF
