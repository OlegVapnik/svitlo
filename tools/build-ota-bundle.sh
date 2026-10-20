#!/usr/bin/env bash
# Собирает JS-бандл RN, компилирует его в байткод Hermes, сжимает и публикует манифест
# тихого OTA в apps/web/public/ota.
#
# Использование:
#   ./tools/build-ota-bundle.sh
#   OTA_PUBLIC_BASE=https://svitlo-ua-4ze.pages.dev/ota-test ./tools/build-ota-bundle.sh
#   EXPO_PUBLIC_OTA_BASE_URL=... ./tools/build-ota-bundle.sh   # куда будет ходить сам бандл
#
# После этого `./tools/publish-ota.sh` (или полный `./deploy-cf.sh`) выкладывает bundle-*.gz
# и version.json в Pages. Приложение подхватит бандл при следующем запуске без установки APK.
#
# Почему здесь expo export:embed + hermesc, а не gradle-задача
# `:app:createBundleReleaseJsAndAssets` (как было раньше):
#   1) релизное приложение живёт на байткоде Hermes (`hermesEnabled=true`), и обычный JS
#      Hermes-рантайм не исполняет — градл компилировал бандл неявно, а через gradle сборка
#      тянула Android SDK, JDK и daemon ради одного файла;
#   2) `expo export:embed` даёт тот же JS, а `hermesc` из пакета `hermes-compiler` — ту же
#      версию байткода, что и в APK (он и есть зависимость react-native), поэтому OTA-бандл
#      совместим с рантаймом установленного приложения.
# Ресурсы (шрифты, картинки) остаются в APK: OTA доставляет только JS, поэтому новая картинка
# или шрифт без новой сборки APK не приедут — это ограничение контракта, а не баг.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"

MOBILE_DIR="${REPO_ROOT}/apps/mobile"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "${WORK_DIR}"' EXIT

JS_BUNDLE="${WORK_DIR}/index.android.bundle"
HBC_BUNDLE="${WORK_DIR}/index.android.hbc"

echo ">>> Сборка JS-бандла (release)"
(
  cd "${MOBILE_DIR}"
  NODE_PATH="${REPO_ROOT}/node_modules/.pnpm/node_modules" EXPO_NO_TELEMETRY=1 CI=1 \
    ./node_modules/.bin/expo export:embed \
      --platform android \
      --dev false \
      --minify true \
      --entry-file node_modules/expo-router/entry.js \
      --bundle-output "${JS_BUNDLE}" \
      --assets-dest "${WORK_DIR}/assets"
)

if [[ ! -s "${JS_BUNDLE}" ]]; then
  echo "Не найден бандл: ${JS_BUNDLE}" >&2
  exit 1
fi

echo ">>> Компиляция в байткод Hermes"
# `hermes-compiler` — зависимость react-native, а не самостоятельный пакет воркспейса,
# поэтому резолвим его через `react-native`: из корня приложения имя не находится (pnpm
# держит транзитивные зависимости рядом с react-native).
HERMESC="$(
  cd "${MOBILE_DIR}" && node -e "
    const path = require('node:path');
    const { createRequire } = require('node:module');
    const fromReactNative = createRequire(require.resolve('react-native/package.json'));
    const pkg = fromReactNative.resolve('hermes-compiler/package.json');
    const platform = process.platform === 'darwin' ? 'osx-bin' : 'linux64-bin';
    console.log(path.join(path.dirname(pkg), 'hermesc', platform, 'hermesc'));
  "
)"
if [[ ! -x "${HERMESC}" ]]; then
  echo "Не найден hermesc: ${HERMESC}" >&2
  echo "Поставьте зависимости: pnpm install --filter @svitlo/mobile..." >&2
  exit 1
fi
"${HERMESC}" -w -emit-binary -O -out "${HBC_BUNDLE}" "${JS_BUNDLE}"

# Маркер версии байткода: 0xc61fbc03 в первых байтах. Если файл не начинается с него,
# приложение упадёт на старте — лучше поймать это здесь, а не на телефоне.
if [[ "$(xxd -p -l 4 "${HBC_BUNDLE}")" != "c61fbc03" ]]; then
  echo "ОШИБКА: hermesc не дал байткод Hermes (ожидался заголовок c61fbc03)." >&2
  exit 1
fi

PUBLIC_DIR="${REPO_ROOT}/apps/web/public/ota"
mkdir -p "${PUBLIC_DIR}"

# ── Ресурсы бандла ──────────────────────────────────────────────────────────
# Из APK RN находит иконки по имени Android-ресурса, а из файла на диске — по пути
# `<каталог бандла>/raw|drawable-*/<имя>`. Поэтому ассеты едут вместе с бандлом, иначе
# после тихого обновления таб-бар и шапка остаются без иконок (код при этом работает).
echo ">>> Публикация ресурсов"
rm -rf "${PUBLIC_DIR}/assets"
if [[ -d "${WORK_DIR}/assets" ]]; then
  cp -R "${WORK_DIR}/assets" "${PUBLIC_DIR}/assets"
fi

echo ">>> Сжатие"
GZ_HASH="$(gzip -9 -c "${HBC_BUNDLE}" | tee /tmp/svitlo-ota.gz | sha256sum | cut -d' ' -f1)"
GZ_SIZE="$(stat -c%s /tmp/svitlo-ota.gz)"
FILE_NAME="bundle-${GZ_HASH:0:16}.gz"
mv /tmp/svitlo-ota.gz "${PUBLIC_DIR}/${FILE_NAME}"

APP_VERSION="$(node -p "require('${REPO_ROOT}/apps/mobile/app.json').expo.version")"
PUBLIC_BASE="${OTA_PUBLIC_BASE:-https://svitlo-ua-4ze.pages.dev/ota}"

node - <<NODE
const fs = require('node:fs');
const path = require('node:path');
// Список ресурсов повторяет структуру каталога из --assets-dest: приложение скачивает
// их на устройство ровно по тем же относительным путям.
const assets = [];
const walk = (dir, prefix) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? prefix + '/' + entry.name : entry.name;
    if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
    else assets.push({
      path: rel,
      url: '${PUBLIC_BASE}/assets/' + rel,
      sizeBytes: fs.statSync(path.join(dir, entry.name)).size,
    });
  }
};
const assetsDir = '${PUBLIC_DIR}/assets';
if (fs.existsSync(assetsDir)) walk(assetsDir, '');
fs.writeFileSync('${PUBLIC_DIR}/version.json', JSON.stringify({
  generatedAt: new Date().toISOString(),
  version: '${APP_VERSION}',
  jsBundle: {
    url: '${PUBLIC_BASE}/${FILE_NAME}',
    sha256: '${GZ_HASH}',
    sizeBytes: ${GZ_SIZE},
    version: '${APP_VERSION}',
    assets,
  },
}, null, 2) + '\n');
console.log('>>> ресурсов в манифесте: ' + assets.length);
NODE

# Оставляем три последних бандла: старые нужны только для отката вручную.
ls -1t "${PUBLIC_DIR}"/bundle-*.gz 2>/dev/null | tail -n +4 | xargs -r rm -f

echo ">>> OTA готов: ${FILE_NAME} (${GZ_SIZE} байт, sha256 ${GZ_HASH:0:16}…)"
echo "    Манифест: ${PUBLIC_DIR}/version.json"
