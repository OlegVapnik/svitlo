#!/usr/bin/env bash
# Сборка debug-APK для Android из веб-бандла.
#
# Зачем Docker: на машине нет JDK и Android SDK, а APK нужен локально и воспроизводимо.
# Скрипт собирает фронтенд с нужным VITE_API_BASE_URL, синхронизирует его в нативный проект
# Capacitor и запускает gradle внутри контейнера svitlo-android-builder.
#
# Использование:
#   ./tools/build-android-apk.sh                              # адрес из .env (VITE_API_BASE_URL)
#   ./tools/build-android-apk.sh http://192.168.1.100:3000/api/v1   # адрес явно
#
# Результат: apps/web/android/app/build/outputs/apk/debug/app-debug.apk
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILDER_IMAGE="svitlo-android-builder"

# Адрес API: аргумент > переменная окружения > значение из .env > локальный адрес машины.
API_BASE="${1:-${VITE_API_BASE_URL:-}}"
if [[ -z "${API_BASE}" ]]; then
  API_BASE="$(grep -E '^VITE_API_BASE_URL=' "${REPO_ROOT}/.env" | cut -d= -f2- || true)"
fi
if [[ -z "${API_BASE}" || "${API_BASE}" == "/api/v1" ]]; then
  # Относительный /api/v1 внутри нативного приложения указывает на сам WebView, а не на сервер:
  # запросы ушли бы в никуда. Поэтому подставляем адрес машины в локальной сети.
  LAN_IP="$(ip -4 addr show scope global 2>/dev/null | grep -oP 'inet \K[\d.]+' | head -1)"
  if [[ -z "${LAN_IP}" ]]; then
    echo "Не удалось определить локальный IP. Передайте адрес явно: $0 http://<ip>:<port>/api/v1" >&2
    exit 1
  fi
  API_BASE="http://${LAN_IP}:3000/api/v1"
fi
echo ">>> API для приложения: ${API_BASE}"

# Каталог для готового APK на хосте. Сборка идёт в контейнере, поэтому артефакт выносим
# в отдельную папку: внутри android/ лежат build-каталоги от контейнера, они в git не нужны.
APK_OUT_DIR="${REPO_ROOT}/apps/web/android-apk"
mkdir -p "${APK_OUT_DIR}"

cd "${REPO_ROOT}"

# Чейджлог обновляем перед сборкой: он генерируется из истории git, а в Docker и в PWA истории
# нет. Если git недоступен (сборка без репозитория) — оставляем предыдущий файл как есть.
echo ">>> Обновление чейджлога"
node tools/gen_changelog.mjs --limit 20 || echo "    (пропущено: git недоступен, используем прежний changelog.json)"

# Метка сборки попадает в интерфейс (низ меню): по ней видно, что на телефоне стоит именно
# свежая версия, а не предыдущая установка.
BUILD_ID="$(date -u +%Y%m%d-%H%M)"
echo ">>> Сборка веб-бандла (build ${BUILD_ID})"
VITE_API_BASE_URL="${API_BASE}" SVITLO_BUILD_ID="${BUILD_ID}" \
  npx --yes pnpm@11 --filter @svitlo/web build

# Service Worker в нативном приложении вреден: он встаёт ПЕРЕД локальной раздачей ассетов
# Capacitor, а на активации наш selfDestroying-SW ещё и стирает все кэши и перезагружает
# страницу (client.navigate). В нативном приложении это ломает загрузку частей интерфейса:
# приложение открывалось с «кучей функций» — области и очереди не подгружались.
# Офлайн-режим тут обеспечивает сам Capacitor: ассеты лежат внутри APK. Поэтому SW убираем.
echo ">>> Удаление Service Worker из нативного бандла"
node - <<'NODE'
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';

const indexPath = 'apps/web/dist/index.html';
const html = readFileSync(indexPath, 'utf8');
// Вырезаем именно инъекцию vite-plugin-pwa, а не любое упоминание: в PWA-сборке она остаётся.
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

echo ">>> Генерация иконок"
node apps/web/scripts/generate-android-icons.mjs >/dev/null

# Версию поднимаем на единицу при каждой сборке.
#
# Файл build.gradle меняется на время сборки и возвращается в исходное состояние после неё:
# иначе каждая сборка оставляла бы в дереве изменённый versionCode, который не несёт смысла
# и только мешает видеть реальные правки в git status.
GRADLE_FILE="apps/web/android/app/build.gradle"
GRADLE_WAS_CLEAN=false
if git diff --quiet -- "${GRADLE_FILE}" 2>/dev/null; then
  GRADLE_WAS_CLEAN=true
  cp "${GRADLE_FILE}" "${GRADLE_FILE}.buildbak"
fi
restore_gradle() {
  if [[ "${GRADLE_WAS_CLEAN}" == true && -f "${GRADLE_FILE}.buildbak" ]]; then
    mv "${GRADLE_FILE}.buildbak" "${GRADLE_FILE}"
  fi
}
trap restore_gradle EXIT
#
# Зачем: пока versionCode оставался равным 1, установщик на телефоне получал APK с тем же
# кодом версии и не мог отличить новую сборку от старой — а нам нужно было проверить, какая
# именно версия установлена. Плюс по versionCode видно, обновилось ли приложение вообще.
BUILD_NUMBER=$(git rev-list --count HEAD 2>/dev/null || echo 1)
# Видимую версию (X.Y.Z) дублируем в versionName Android, чтобы в диспетчере устройств
# и в информации о приложении была та же цифра, что на главном экране.
APP_VERSION="$(grep -oP "APP_VERSION = '\K[0-9]+\.[0-9]+\.[0-9]+" apps/web/src/version.ts)"
python3 - "$BUILD_NUMBER" "$APP_VERSION" <<'PY'
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

echo ">>> Сборка образа со сборщиком (один раз; кэшируется Docker)"
if ! docker image inspect "${BUILDER_IMAGE}" >/dev/null 2>&1; then
  docker build -f docker/Dockerfile.android -t "${BUILDER_IMAGE}" .
fi

echo ">>> Gradle assembleDebug"
# Контейнер запускается от текущего пользователя (--user ниже), а репозиторий смонтирован
# на запись. Обе части нужны вместе: gradle по умолчанию работает как root и оставляет
# build-каталоги под root — на btrfs их не удалить без sudo, и следующая пересборка падала бы
# с "EACCES: permission denied" уже в cap sync. Репозиторий монтируется целиком (а не только
# android/), потому что capacitor подключает node_modules относительным путём.
# Кэш gradle — обычный каталог на хосте, а не docker volume: volume создаётся с правами root,
# а контейнер работает от текущего пользователя, и gradle не может в нём создать lock-файл.
# На хосте права совпадают автоматически, плюс кэш переживает пересборку образа.
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
  "${BUILDER_IMAGE}" \
  bash -c '
    set -e
    # Репозиторий смонтирован на запись, поэтому контейнер запускается от текущего пользователя
    # (--user выше): иначе build-каталоги остались бы под root, и на btrfs их не удалить без sudo —
    # следующая же пересборка падала бы с "EACCES: permission denied" в cap sync.
    cd /repo/apps/web/android
    ./gradlew --no-daemon --console=plain assembleDebug
    mkdir -p /out
    cp -f app/build/outputs/apk/debug/app-debug.apk /out/
    echo "APK скопирован наружу"
  '

APK="${APK_OUT_DIR}/app-debug.apk"
if [[ ! -f "${APK}" ]]; then
  echo "APK не найден: ${APK}" >&2
  exit 1
fi

echo ">>> Готово"
ls -lh "${APK}"
echo
echo "Установка на телефон (включите «Установка из неизвестных источников»):"
echo "  adb install -r ${APK}"
echo "или скопируйте APK на телефон и откройте его файловым менеджером."