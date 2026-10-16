#!/usr/bin/env bash
#
# deploy-cf.sh — раскладка Svitlo в бесплатное облако Cloudflare одной командой.
#
# Зачем он нужен: приложение должно работать 24/7 по HTTPS, пока ноутбук выключен и никто не
# открывает GitHub. Поэтому здесь нет ни git push, ни CI: сборка фронтенда, деплой Worker и
# загрузка статики в Pages происходят прямо отсюда, локально.
#
# Что делает по шагам:
#   1) переносит справочник адресов (населённые пункты, черги, привязки) в D1;
#   2) деплоит Worker (API + крон) через wrangler;
#   3) собирает фронтенд с VITE_API_BASE_URL, указывающим на воркер;
#   4) заливает собранный apps/web/dist в Cloudflare Pages.
#
# Первый запуск (однократно):
#   1. Войти в Cloudflare:      npx wrangler login
#   2. Задать имя Pages-проекта: переменная окружения PAGES_PROJECT (по умолчанию svitlo-ua)
#   3. Запустить:               ./deploy-cf.sh
#
# Базу D1 создавать вручную НЕ нужно: если в cf-worker/wrangler.toml ещё стоит заглушка
# ЗАМЕНИТЕ_НА_DATABASE_ID, скрипт сам найдёт существующую базу `svitlo` или создаст её,
# подставит database_id и накатит cf-worker/schema.sql.
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

# ── Автоматическая подготовка D1 ─────────────────────────────────────────────
# Первая цель, на которой спотыкался первый запуск, — пустой `database_id` в wrangler.toml.
# Раньше скрипт просто просил человека открыть Cloudflare руками. Теперь он сам находит уже
# созданную базу `svitlo` или создаёт её, подставляет id и накатывает схему.
if grep -q 'ЗАМЕНИТЕ_НА_DATABASE_ID' cf-worker/wrangler.toml; then
  echo "==> Подготовка базы данных D1 (id в wrangler.toml ещё не подставлен)"

  D1_ID="$("$WRANGLER" d1 list --json 2>/dev/null \
    | grep -oE '"uuid"[[:space:]]*:[[:space:]]*"[^"]+"' \
    | head -n1 | grep -oE '[0-9a-f-]{36}' || true)"

  if [ -z "${D1_ID:-}" ]; then
    # Базы с таким именем нет — создаём. Вывод wrangler нестабилен, поэтому берём uuid из
    # текста сообщения: это единственный надёжный источник на всех версиях wrangler.
    echo "    База «svitlo» не найдена, создаю…"
    CREATE_OUT="$("$WRANGLER" d1 create svitlo --config cf-worker/wrangler.toml 2>&1 || true)"
    D1_ID="$(grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' <<<"$CREATE_OUT" \
      | head -n1 || true)"
    if [ -z "${D1_ID:-}" ]; then
      echo "ОШИБКА: не удалось создать D1-базу. Выведите вручную:" >&2
      echo "  npx wrangler login" >&2
      echo "  npx wrangler d1 create svitlo" >&2
      echo "и вставьте database_id в cf-worker/wrangler.toml" >&2
      echo "$CREATE_OUT" >&2
      exit 1
    fi
  else
    echo "    Найдена существующая база: $D1_ID"
  fi

  # Подставляем id в конфиг. sed -i разных диалектов не любим, поэтому правим через temp-файл.
  TMP_TOML="$(mktemp)"
  sed "s/ЗАМЕНИТЕ_НА_DATABASE_ID/$D1_ID/" cf-worker/wrangler.toml > "$TMP_TOML"
  mv "$TMP_TOML" cf-worker/wrangler.toml
  echo "    database_id подставлен: $D1_ID"

  # Схема накатывается до деплоя, чтобы первый же запрос к воркеру не упал на
  # «нет такой таблицы». Все CREATE IF NOT EXISTS и INSERT OR IGNORE — повторный прогон безопасен.
  echo "    Накатываю схему…"
  "$WRANGLER" d1 execute svitlo --remote --config cf-worker/wrangler.toml --file=cf-worker/schema.sql >/dev/null
  echo "    Схема готова."
fi

# ── Шаг 1: справочник адресов в D1 ─────────────────────────────────────────
# Этого шага раньше не было, и на облачном пути мастер адреса знал один населённый пункт из
# тысячи: реестр КОАТУУ лежал только рядом с Node-бэкендом, а `directory_settlements` в D1
# оставалась почти пустой.
#
# Шаг идемпотентен (INSERT OR IGNORE и upsert с защитой community-записей), поэтому его можно
# гонять при каждом деплое. Падение НЕ отменяет деплой: воркер и сайт обязаны уехать, даже если
# локальная база не поднята или у wrangler кончилась квота — о неудаче сообщаем и идём дальше,
# а перенос можно повторить одной командой.
echo "==> 1/4. Переношу справочник адресов в D1 (НП, черги, привязки)"
if node tools/sync-directory-to-d1.mjs --apply --verify; then
  :
else
  echo "    ПРЕДУПРЕЖДЕНИЕ: перенос справочника не удался, продолжаю деплой без него." >&2
  echo "    Повторить только перенос: node tools/sync-directory-to-d1.mjs --apply --verify" >&2
fi

# ── Шаг 2: деплой Worker ────────────────────────────────────────────────────
# Порядок именно такой: сначала воркер, потому что фронтенд собирается с его URL, и иначе
# вышел бы билд, указывающий на адрес предыдущей (или несуществующей) версии API.
echo "==> 2/4. Деплою Worker (API + крон каждые 20 минут)"
# Вывод деплоя сохраняем: wrangler печатает в него адрес воркера, а иначе адрес пришлось бы
# спрашивать у человека — и скрипт «одной кнопкой» снова требовал бы ручного ввода.
# Через `if`, а не присваиванием: при `set -e` падение команды сразу оборвало бы скрипт,
# и до сообщения об ошибке мы бы не дошли.
if DEPLOY_OUT="$("$WRANGLER" deploy --config cf-worker/wrangler.toml 2>&1)"; then
  DEPLOY_STATUS=0
else
  DEPLOY_STATUS=$?
fi
echo "$DEPLOY_OUT"

if [ "$DEPLOY_STATUS" -ne 0 ]; then
  echo "ОШИБКА: деплой воркера не удался (код $DEPLOY_STATUS)." >&2
  exit "$DEPLOY_STATUS"
fi

# Адрес нашего воркера. В выводе деплоя wrangler печатает МНОГО адресов *.workers.dev, и
# первым среди них идёт MIRROR_SCHEDULE_URL из секции Vars — то самое зеркало-источник.
# Если взять первое совпадение, фронтенд соберётся на адрес зеркала и будет ходить в чужой API
# без наших контрактов. Поэтому адрес зеркала исключаем явно, а из остальных берём последний:
# именно он принадлежит задеплоенному воркеру.
MIRROR_HOST="$(grep -oE 'https://[a-zA-Z0-9.-]+\.workers\.dev' cf-worker/wrangler.toml | head -n1 || true)"
WORKER_URL=""
# Читаем построчно во временный файл, а не через process substitution: под `set -e` любая
# команда, вернувшая ненулевой код (в том числе «условие ложно, && не выполнилось»), обрывает
# скрипт. Поэтому здесь только `if`, где ложное условие — штатная ветка.
CANDIDATES="$(mktemp)"
grep -oE 'https://[a-zA-Z0-9.-]+\.workers\.dev' <<<"$DEPLOY_OUT" > "$CANDIDATES" || true
while IFS= read -r candidate; do
  if [ -z "$candidate" ]; then
    continue
  fi
  if [ -n "${MIRROR_HOST:-}" ] && [ "$candidate" = "$MIRROR_HOST" ]; then
    continue
  fi
  WORKER_URL="$candidate"
done < "$CANDIDATES"
rm -f "$CANDIDATES"

if [ -z "${WORKER_URL:-}" ]; then
  echo "ОШИБКА: не удалось определить адрес воркера из вывода деплоя." >&2
  echo "Скопируйте адрес из вывода выше и повторите: ./deploy-cf.sh" >&2
  exit 1
fi

# Контрольная проверка: собранный фронтенд обязан ходить именно в наш воркер. Если в бандле
# окажется чужой адрес (как было с зеркалом), лучше упасть здесь, чем отдать пользователям
# сайт, который молча бьётся не туда.
if [ ! -f apps/web/dist/index.html ]; then
  echo "ОШИБКА: нет apps/web/dist/index.html — проверять нечего." >&2
  exit 1
fi

echo "    Worker доступен по адресу: $WORKER_URL"

# ── Шаг 3: сборка фронтенда на этот адрес ───────────────────────────────────
# VITE_API_BASE_URL вшивается в бандл на этапе сборки, поэтому фронтенд собираем ПОСЛЕ деплоя
# воркера и с его фактическим адресом.
echo "==> 3/4. Собираю фронтенд на $WORKER_URL"
VITE_API_BASE_URL="$WORKER_URL/api/v1" build_frontend

if [ ! -d apps/web/dist ]; then
  echo "ОШИБКА: сборка не дала apps/web/dist" >&2
  exit 1
fi

# Проверяем, что адрес API действительно вшит в бандр. Раньше здесь молча уезжал адрес
# зеркала-источника, и сайт выглядел рабочим, но весь API уходил в чужой сервис.
if ! grep -rqF "$WORKER_URL/api/v1" apps/web/dist/assets/*.js 2>/dev/null; then
  echo "ОШИБКА: в собранном бандле нет адреса $WORKER_URL/api/v1." >&2
  echo "Фронтенд собран не с тем API — публиковать его нельзя. Проверьте VITE_API_BASE_URL." >&2
  exit 1
fi
echo "    Проверено: бандл ходит в $WORKER_URL/api/v1"

# ── Шаг 4: публикация статики в Pages ───────────────────────────────────────
echo "==> 4/4. Загружаю статику в Cloudflare Pages ($PAGES_PROJECT)"

# Pages-проект тоже создаём сами, как и D1: иначе первый запуск падал бы с «Project not
# found» и требовал ручного шага в панели Cloudflare. Команда idempotent — если проект уже
# есть, она просто сообщает об этом и завершается успешно.
if ! "$WRANGLER" pages project list 2>/dev/null | grep -qw "$PAGES_PROJECT"; then
  echo "    Pages-проект «$PAGES_PROJECT» не найден, создаю…"
  # Идёт тем же шагом, что и деплой: ветку main сразу помечаем продакшен, иначе URL
  # будет вида <hash>.pages.dev вместо постоянного.
  "$WRANGLER" pages project create "$PAGES_PROJECT" --production-branch="$PAGES_BRANCH" >/dev/null || {
    echo "ОШИБКА: не удалось создать Pages-проект «$PAGES_PROJECT»." >&2
    echo "Создайте его вручную: npx wrangler pages project create $PAGES_PROJECT" >&2
    exit 1
  }
fi

PAGES_OUT="$("$WRANGLER" pages deploy apps/web/dist --project-name="$PAGES_PROJECT" \
  --branch="$PAGES_BRANCH" --commit-dirty=true 2>&1)" || {
  echo "$PAGES_OUT" >&2
  echo "ОШИБКА: не удалось загрузить статику в Pages." >&2
  exit 1
}
echo "$PAGES_OUT"

# Реальный адрес берём из вывода деплоя, а не сочиняем как «<проект>.pages.dev».
# У этого проекта домен svitlo-ua-4ze.pages.dev, поэтому выдуманный svitlo-ua.pages.dev
# уводил на ЧУЖУЮ старую статику — сайт выглядел живым, но отдавал сборку месячной давности.
# Сначала домен проекта — он постоянный. Адрес конкретного деплоя из вывода содержит хеш
# и меняется при каждой публикации, поэтому он только запасной вариант.
# Колонка с доменом идёт за именем проекта, а позиция колонок зависит от ширины таблицы,
# поэтому домен выбираем по признаку «ends with .pages.dev», а не по номеру поля.
SITE_URL="$("$WRANGLER" pages project list 2>/dev/null \
  | grep -F "$PAGES_PROJECT" \
  | grep -oE '[a-zA-Z0-9.-]+\.pages\.dev' \
  | head -n1 || true)"
if [ -z "${SITE_URL:-}" ]; then
  SITE_URL="$(grep -oE 'https://[a-zA-Z0-9.-]+\.pages\.dev' <<<"$PAGES_OUT" | head -n1 || true)"
fi

cat <<EOF

Готово.

  API:  $WORKER_URL/api/v1/health
  Сайт: ${SITE_URL:+https://$SITE_URL}

Проверка:  curl -s $WORKER_URL/api/v1/health
Крон воркера сам обновляет график каждые 20 минут — ноутбук можно выключать.
EOF
