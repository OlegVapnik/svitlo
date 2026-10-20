#!/usr/bin/env bash
# Публикует тихое OTA-обновление (JS-бандл + манифест) в Cloudflare Pages: без пересборки
# APK, без деплоя Worker и без записи в D1.
#
# Зачем отдельный скрипт: полный `./deploy-cf.sh` прогоняет весь конвейер (справочник адресов,
# воркер, паки адресов), а для правки текста или вёрстки на экране нужны только статика и
# бандл. Pages раздаёт каталог целиком одним деплоем, поэтому `vite build` остаётся
# обязательным шагом: иначе новый `/ota/version.json` просто не попадёт в выгрузку.
#
# Использование:
#   ./tools/publish-ota.sh                          # прод: /ota
#   OTA_DIR=ota-test ./tools/publish-ota.sh         # песочница: /ota-test
#   VITE_API_BASE_URL=https://.../api/v1 ./tools/publish-ota.sh
#
# `OTA_PUBLIC_BASE` — откуда приложение берёт манифест, `EXPO_PUBLIC_OTA_BASE_URL` — куда
# смотрит сам бандл. Скрипт держит их одним значением: разъехавшиеся адреса дают бандл,
# который ищет манифест в другом месте, и обновление «не приезжает» без единой ошибки.
# `OTA_APP_BASE` переопределяет только адрес внутри бандла — нужен для проверки отката:
# манифест публикуется в прод, а сам бандл дальше смотрит в песочницу `/ota-test`.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"

OTA_DIR="${OTA_DIR:-ota}"
OTA_PUBLIC_BASE="${OTA_PUBLIC_BASE:-https://svitlo-ua-4ze.pages.dev/${OTA_DIR}}"
OTA_APP_BASE="${OTA_APP_BASE:-${OTA_PUBLIC_BASE}}"
PAGES_PROJECT="${PAGES_PROJECT:-svitlo-ua}"
PAGES_BRANCH="${PAGES_BRANCH:-main}"
# Прод-воркер: адрес публичный и тот же, что вшивает `deploy-cf.sh` после деплоя воркера.
# `.env.local` для этого не годится — там localhost, и прод-сайт уехал бы на пустой API.
VITE_API_BASE_URL="${VITE_API_BASE_URL:-https://svitlo-api.olegvapnik45.workers.dev/api/v1}"
WRANGLER="./cf-worker/node_modules/.bin/wrangler"

if [ ! -x "${WRANGLER}" ]; then
  echo "ОШИБКА: нет ${WRANGLER}. Выполните: (cd cf-worker && npm install)" >&2
  exit 1
fi

echo ">>> OTA: манифест ${OTA_PUBLIC_BASE}/version.json, бандл ищет ${OTA_APP_BASE}/version.json"
OTA_PUBLIC_BASE="${OTA_PUBLIC_BASE}" EXPO_PUBLIC_OTA_BASE_URL="${OTA_APP_BASE}" \
  ./tools/build-ota-bundle.sh

echo ">>> Сборка фронтенда на ${VITE_API_BASE_URL}"
(
  cd apps/web
  VITE_API_BASE_URL="${VITE_API_BASE_URL}" SVITLO_BUILD_ID="$(date -u +%Y%m%d-%H%M)" \
    ./node_modules/.bin/vite build
)
if ! grep -rqF "${VITE_API_BASE_URL}" apps/web/dist/assets/*.js 2>/dev/null; then
  echo "ОШИБКА: в собранном бандле нет адреса ${VITE_API_BASE_URL} — публиковать нельзя." >&2
  exit 1
fi

echo ">>> Деплой Pages (${PAGES_PROJECT})"
"${WRANGLER}" pages deploy apps/web/dist --project-name="${PAGES_PROJECT}" \
  --branch="${PAGES_BRANCH}" --commit-dirty=true 2>&1 | tail -n 5

echo ">>> Проверка манифеста после деплоя"
curl -fsS "${OTA_PUBLIC_BASE}/version.json" | head -c 400
echo
