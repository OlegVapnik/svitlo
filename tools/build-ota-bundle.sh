#!/usr/bin/env bash
# Собирает JS-бандл RN, сжимает и публикует манифест тихого OTA в apps/web/public/ota.
#
# Использование:
#   ./tools/build-ota-bundle.sh
#
# После этого `./deploy-cf.sh` (или отдельный деплой Pages) выкладывает bundle-*.gz и
# version.json. Приложение подхватит его при следующем запуске без установки APK.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"

BUNDLE_OUT="${REPO_ROOT}/apps/mobile/android/app/build/generated/assets/react/release/index.android.bundle"
echo ">>> Сборка JS-бандла (release)"
(
  cd apps/mobile/android
  NODE_PATH="${REPO_ROOT}/node_modules/.pnpm/node_modules" \
    ./gradlew :app:createBundleReleaseJsAndAssets --rerun-tasks
)
if [[ ! -f "${BUNDLE_OUT}" ]]; then
  echo "Не найден бандл: ${BUNDLE_OUT}" >&2
  exit 1
fi

PUBLIC_DIR="${REPO_ROOT}/apps/web/public/ota"
mkdir -p "${PUBLIC_DIR}"

echo ">>> Сжатие"
GZ_HASH="$(gzip -9 -c "${BUNDLE_OUT}" | tee /tmp/svitlo-ota.gz | sha256sum | cut -d' ' -f1)"
GZ_SIZE="$(stat -c%s /tmp/svitlo-ota.gz)"
FILE_NAME="bundle-${GZ_HASH:0:16}.gz"
mv /tmp/svitlo-ota.gz "${PUBLIC_DIR}/${FILE_NAME}"

APP_VERSION="$(node -p "require('${REPO_ROOT}/apps/mobile/app.json').expo.version")"
PUBLIC_BASE="${OTA_PUBLIC_BASE:-https://svitlo-ua-4ze.pages.dev/ota}"

node - <<NODE
const fs = require('node:fs');
const path = '${PUBLIC_DIR}/version.json';
fs.writeFileSync(path, JSON.stringify({
  generatedAt: new Date().toISOString(),
  version: '${APP_VERSION}',
  jsBundle: {
    url: '${PUBLIC_BASE}/${FILE_NAME}',
    sha256: '${GZ_HASH}',
    sizeBytes: ${GZ_SIZE},
    version: '${APP_VERSION}',
  },
}, null, 2) + '\n');
NODE

# Оставляем три последних бандла: старые нужны только для отката вручную.
ls -1t "${PUBLIC_DIR}"/bundle-*.gz 2>/dev/null | tail -n +4 | xargs -r rm -f

echo ">>> OTA готов: ${FILE_NAME} (${GZ_SIZE} байт, sha256 ${GZ_HASH:0:16}…)"
echo "    Манифест: ${PUBLIC_DIR}/version.json"
