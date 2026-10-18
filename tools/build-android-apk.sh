#!/usr/bin/env bash
# Сборка Android-приложения Svitlo (Capacitor) из веб-бандла.
#
# По умолчанию собирается release-APK, подписанный постоянным ключом. Это важно:
# debug-сборка помечена как отладочная, и Android/Play Protect встречают её предупреждением
# «приложение для разработки». Release-подпись такого предупреждения не даёт, а главное —
# позволяет ставить новую версию поверх предыдущей без «Приложение не установлено».
#
# Использование:
#   ./tools/build-android-apk.sh                              # release, адрес API из .env/дефолта
#   ./tools/build-android-apk.sh https://example.com/api/v1   # адрес явно
#   ./tools/build-android-apk.sh --debug                      # debug-сборка для локальной отладки
#   ./tools/build-android-apk.sh --debug http://192.168.1.10:3000/api/v1
#
# Результат:
#   apps/web/android-apk/svitlo-<версия>.apk  (release)
#   apps/web/android-apk/app-debug.apk        (debug)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILDER_IMAGE="svitlo-android-builder"
PRODUCTION_API="https://svitlo-api.olegvapnik45.workers.dev/api/v1"
BUILD_TYPE="release"
POSITIONAL=()

for arg in "$@"; do
  case "$arg" in
    --debug) BUILD_TYPE="debug" ;;
    --release) BUILD_TYPE="release" ;;
    -h|--help)
      sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      POSITIONAL+=("$arg")
      ;;
  esac
done

if (( ${#POSITIONAL[@]} > 0 )); then
  API_BASE="${POSITIONAL[0]}"
else
  API_BASE="${VITE_API_BASE_URL:-}"
fi
if [[ -z "${API_BASE}" ]]; then
  API_BASE="$(grep -E '^VITE_API_BASE_URL=' "${REPO_ROOT}/.env" | cut -d= -f2- || true)"
fi
if [[ -z "${API_BASE}" || "${API_BASE}" == "/api/v1" ]]; then
  if [[ "${BUILD_TYPE}" == debug ]]; then
    # В нативном WebView относительный /api/v1 указывает на сам WebView. Для отладки
    # подставляем адрес машины в локальной сети.
    LAN_IP="$(ip -4 addr show scope global 2>/dev/null | grep -oP 'inet \K[\d.]+' | head -1)"
    if [[ -z "${LAN_IP}" ]]; then
      echo "Не удалось определить локальный IP. Передайте адрес явно: $0 --debug http://<ip>:<port>/api/v1" >&2
      exit 1
    fi
    API_BASE="http://${LAN_IP}:3000/api/v1"
  else
    # Release-сборка ходит на боевой HTTPS-API. Если адрес другой — передайте аргументом.
    API_BASE="${PRODUCTION_API}"
  fi
fi
echo ">>> Режим: ${BUILD_TYPE}; API: ${API_BASE}"

APP_VERSION="$(grep -oP "APP_VERSION = '\K[0-9]+\.[0-9]+\.[0-9]+" "${REPO_ROOT}/apps/web/src/version.ts")"
BUILD_NUMBER="$(git -C "${REPO_ROOT}" rev-list --count HEAD 2>/dev/null || echo 1)"
APK_OUT_DIR="${REPO_ROOT}/apps/web/android-apk"
mkdir -p "${APK_OUT_DIR}"

# --- постоянный ключ release-подписи -------------------------------------------------
# Ключ и пароль не коммитятся. Если потерять ключ, обновить уже установленное приложение
# поверх старого не получится: Android считает это другим приложением.
KEYSTORE_DIR="${REPO_ROOT}/apps/web/android/app/keystore"
KEYSTORE_FILE="${KEYSTORE_DIR}/svitlo-release.p12"
KEYSTORE_PROPS="${REPO_ROOT}/apps/web/android/keystore.properties"
KEY_ALIAS="svitlo"

ensure_release_keystore() {
  if [[ -f "${KEYSTORE_FILE}" && -f "${KEYSTORE_PROPS}" ]]; then
    echo ">>> Release-ключ: ${KEYSTORE_FILE}"
    return
  fi
  if [[ -f "${KEYSTORE_FILE}" || -f "${KEYSTORE_PROPS}" ]]; then
    echo "Найден только один из файлов release-ключа:" >&2
    echo "  ${KEYSTORE_FILE}" >&2
    echo "  ${KEYSTORE_PROPS}" >&2
    echo "Восстановите второй файл из бэкапа. Пересоздавать ключ при наличии установленного приложения нельзя." >&2
    exit 1
  fi
  command -v keytool >/dev/null 2>&1 || {
    echo "Не найден keytool. Установите JDK или создайте ключ в Android Studio." >&2
    exit 1
  }
  mkdir -p "${KEYSTORE_DIR}"
  local old_umask
  old_umask="$(umask)"
  umask 077
  local password
  if command -v openssl >/dev/null 2>&1; then
    password="$(openssl rand -hex 24)"
  else
    password="$(python3 -c 'import secrets; print(secrets.token_hex(24))')"
  fi
  keytool -genkeypair -v \
    -keystore "${KEYSTORE_FILE}" \
    -storetype PKCS12 \
    -keyalg RSA \
    -keysize 4096 \
    -validity 10000 \
    -alias "${KEY_ALIAS}" \
    -storepass "${password}" \
    -keypass "${password}" \
    -dname "CN=Svitlo, OU=Mobile, O=Svitlo, L=Chernihiv, C=UA" >/dev/null 2>&1
  cat > "${KEYSTORE_PROPS}" <<PROPS
storeFile=keystore/svitlo-release.p12
storePassword=${password}
keyAlias=${KEY_ALIAS}
keyPassword=${password}
PROPS
  chmod 600 "${KEYSTORE_FILE}" "${KEYSTORE_PROPS}"
  umask "${old_umask}"
  echo ">>> Создан release-ключ: ${KEYSTORE_FILE}"
  echo "    Сохраните его и apps/web/android/keystore.properties в надёжном месте."
}

if [[ "${BUILD_TYPE}" == release ]]; then
  ensure_release_keystore
fi

cd "${REPO_ROOT}"

# Чейджлог генерируется из git. В Docker истории нет, поэтому обновляем до сборки.
echo ">>> Обновление чейджлога"
node tools/gen_changelog.mjs --limit 60 || echo "    (пропущено: git недоступен, используем прежний changelog.json)"

# maskable-иконка нужна Vite до сборки. PNG рендерятся позже в Docker.
echo ">>> Обновление SVG-слоёв иконки"
node apps/web/scripts/generate-android-icons.mjs --svg-only

BUILD_ID="$(date -u +%Y%m%d-%H%M)"
echo ">>> Сборка веб-бандла (build ${BUILD_ID})"
# APK от предыдущей сборки лежит в public и Vite копирует его в dist. Тогда следующая сборка
# зашила бы старый APK внутрь нового (6 МБ → 13 МБ → 19 МБ). Убираем до сборки; свежий файл
# кладём обратно после подписи, чтобы Pages отдавал ту же сборку.
rm -f "${REPO_ROOT}/apps/web/public/svitlo-latest.apk"
VITE_API_BASE_URL="${API_BASE}" SVITLO_BUILD_ID="${BUILD_ID}" \
  npx --yes pnpm@11 --filter @svitlo/web build

# Service Worker в нативном приложении вреден: он встаёт перед локальной раздачей ассетов
# Capacitor и после selfDestroying-активации перезагружает страницу. Убираем только инъекцию
# vite-plugin-pwa; в PWA-сборке регистрация остаётся.
echo ">>> Удаление Service Worker из нативного бандла"
node - <<'NODE'
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';

const indexPath = 'apps/web/dist/index.html';
const html = readFileSync(indexPath, 'utf8');
const cleaned = html.replace(/<script[^>]*id="vite-plugin-pwa:register-sw"[^>]*><\/script>\s*/g, '');
if (cleaned !== html) {
  writeFileSync(indexPath, cleaned);
  console.log('    тег регистрации SW удалён из index.html');
} else {
  console.log('    (тег регистрации SW не найден — возможно, сборка без PWA)');
}
for (const file of ['apps/web/dist/sw.js', 'apps/web/dist/registerSW.js']) {
  if (existsSync(file)) {
    rmSync(file);
    console.log(`    удалён ${file}`);
  }
}
NODE

# versionCode/versionName меняем в build.gradle перед gradle. Номер версии — производная
# от git-истории и version.ts, поэтому после сборки возвращаем файл в исходное состояние:
# в git не должно быть случайных «versionCode 137» от каждой локальной сборки.
GRADLE_FILE="apps/web/android/app/build.gradle"
cp "${GRADLE_FILE}" "${GRADLE_FILE}.buildbak"
restore_gradle() {
  if [[ -f "${GRADLE_FILE}.buildbak" ]]; then
    mv "${GRADLE_FILE}.buildbak" "${GRADLE_FILE}"
  fi
}
trap restore_gradle EXIT
python3 - "${BUILD_NUMBER}" "${APP_VERSION}" <<'PY'
import pathlib
import re
import sys

number, version = sys.argv[1], sys.argv[2]
path = pathlib.Path('apps/web/android/app/build.gradle')
text = path.read_text(encoding='utf-8')
text = re.sub(r'versionCode \d+', f'versionCode {number}', text)
text = re.sub(r'versionName "[^"]*"', f'versionName "{version}"', text)
path.write_text(text, encoding='utf-8')
print(f"    versionCode = {number}, versionName = {version}")
PY

echo ">>> Синхронизация в нативный проект Capacitor"
(cd apps/web && npx cap sync android >/dev/null)

echo ">>> Сборка образа со сборщиком (кэшируется Docker)"
# Образ пересобираем каждый раз: Docker использует кэш, но так изменения Dockerfile
# (например, добавление rsvg/nodejs для иконок) не теряются на машинах с готовым образом.
docker build -f docker/Dockerfile.android -t "${BUILDER_IMAGE}" .

echo ">>> Gradle assemble${BUILD_TYPE^}"
GRADLE_CACHE="${REPO_ROOT}/.cache/gradle"
mkdir -p "${GRADLE_CACHE}"

docker run --rm \
  --user "$(id -u):$(id -g)" \
  -v "${GRADLE_CACHE}:/tmp/.gradle" \
  -v "${REPO_ROOT}:/repo" \
  -v "${APK_OUT_DIR}:/out" \
  -e ANDROID_HOME=/opt/android-sdk \
  -e ANDROID_SDK_ROOT=/opt/android-sdk \
  -e GRADLE_USER_HOME=/tmp/.gradle \
  -e HOME=/tmp \
  -e BUILD_TYPE="${BUILD_TYPE}" \
  -e APP_VERSION="${APP_VERSION}" \
  "${BUILDER_IMAGE}" \
  bash -c '
    set -e
    # Иконки и splash рендерим здесь: в образе есть nodejs и rsvg-convert.
    cd /repo
    node apps/web/scripts/generate-android-icons.mjs
    cd /repo/apps/web/android
    mkdir -p /out
    if [ "${BUILD_TYPE}" = "release" ]; then
      ./gradlew --no-daemon --console=plain assembleRelease
      cp -f app/build/outputs/apk/release/app-release.apk "/out/svitlo-${APP_VERSION}.apk"
      cp -f app/build/outputs/apk/release/app-release.apk /out/app-release.apk
      echo ">>> Проверка подписи"
      /opt/android-sdk/build-tools/36.0.0/apksigner verify --print-certs "/out/svitlo-${APP_VERSION}.apk" | head -8
      /opt/android-sdk/build-tools/36.0.0/aapt dump badging "/out/svitlo-${APP_VERSION}.apk" | head -3
    else
      ./gradlew --no-daemon --console=plain assembleDebug
      cp -f app/build/outputs/apk/debug/app-debug.apk /out/app-debug.apk
    fi
    echo "APK скопирован наружу"
  '

if [[ "${BUILD_TYPE}" == release ]]; then
  APK="${APK_OUT_DIR}/svitlo-${APP_VERSION}.apk"
else
  APK="${APK_OUT_DIR}/app-debug.apk"
fi
if [[ ! -f "${APK}" ]]; then
  echo "APK не найден: ${APK}" >&2
  exit 1
fi

# OTA-ссылка для сайта и Android-моста. Файл кладём в public, Vite копирует его в dist,
# и Pages отдаёт тот же APK, что собран и подписан сейчас. Сам бинарник не коммитится:
# это артефакт сборки, а не исходник.
if [[ "${BUILD_TYPE}" == release ]]; then
  PUBLIC_APK="${REPO_ROOT}/apps/web/public/svitlo-latest.apk"
  mkdir -p "$(dirname "${PUBLIC_APK}")"
  install -m 644 "${APK}" "${PUBLIC_APK}"
  echo ">>> APK для OTA: ${PUBLIC_APK} ($(du -h "${PUBLIC_APK}" | cut -f1))"

  # Публикуем метаданные ровно того файла, который только что подписан. SHA-256 и размер
  # считаются здесь, а не руками: иначе клиент скачал бы APK, хеш которого не совпадает,
  # и нативная обёртка справедливо отказалась бы устанавливать файл.
  APK_URL="${SVITLO_APK_URL:-https://svitlo-ua-4ze.pages.dev/svitlo-latest.apk}"
  python3 - "${REPO_ROOT}" "${PUBLIC_APK}" "${APP_VERSION}" "${APK_URL}" <<'PY'
import hashlib
import json
import pathlib
import sys
from datetime import datetime, timezone

repo = pathlib.Path(sys.argv[1])
apk = pathlib.Path(sys.argv[2])
version = sys.argv[3]
apk_url = sys.argv[4]
changelog_path = repo / 'apps/web/src/data/changelog.json'
try:
    changelog = json.loads(changelog_path.read_text(encoding='utf-8'))
    release = (changelog.get('releases') or [{}])[0]
except Exception:
    release = {}
notes = []
for key in ('features', 'fixes', 'optimizations'):
    notes.extend(release.get(key) or [])
payload = {
    'version': version,
    'apkUrl': apk_url,
    'sha256': hashlib.sha256(apk.read_bytes()).hexdigest(),
    'sizeBytes': apk.stat().st_size,
    'releasedAt': datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z'),
    'notes': notes[:8],
}
text = json.dumps(payload, ensure_ascii=False, indent=2) + '\n'
for relative in ('cf-worker/src/data/version.json', 'apps/api/src/data/version.json'):
    target = repo / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding='utf-8')
print(f">>> Версия {version}, SHA-256 {payload['sha256'][:12]}…, {payload['sizeBytes']} байт")
PY
fi

echo ">>> Готово"
ls -lh "${APK}"
echo
echo "Установка по USB:"
echo "  adb install -r \"${APK}\""
if [[ "${BUILD_TYPE}" == release ]]; then
  echo "Если на телефоне осталась старая debug-сборка, один раз удалите её:"
  echo "  adb uninstall ua.com.svitlo.app"
fi
echo "Или скопируйте APK на телефон и откройте через «Файлы»."
