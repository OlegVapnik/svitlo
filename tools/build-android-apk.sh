#!/usr/bin/env bash
# Сборка Android-приложения Svitlo (React Native / Expo, `apps/mobile`).
#
# Использование:
#   ./tools/build-android-apk.sh                 # release, arm64-v8a, локальный SDK Android Studio
#   ./tools/build-android-apk.sh --debug         # debug-сборка для эмулятора и отладки
#   ./tools/build-android-apk.sh --skip-tests    # не гонять JVM-тесты OTA
#   ./tools/build-android-apk.sh --no-publish    # собрать, но не заливать APK в R2
#   ./tools/build-android-apk.sh --publish-only  # залить уже собранный APK и обновить version.json
#   ./tools/build-android-apk.sh --docker        # собрать в контейнере (CI, чужая машина)
#
# Результат:
#   apps/mobile/android-apk/svitlo-<версия>.apk  (release)
#   apps/mobile/android-apk/app-debug.apk        (debug)
#
# Почему только arm64-v8a: APK 2.25.0 весил 107.7 МБ, из них около 60 МБ — `.so` для x86 и
# x86_64 (эмулятор) и armeabi-v7a (32-бит). Телефонам нужна одна ABI: фильтр задан в
# `apps/mobile/plugins/withSvitloNative.js` (`buildTypes.release.ndk.abiFilters`), а
# `-PreactNativeArchitectures` ниже избавляет ещё и от сборки лишних ABI.
#
# `expo prebuild` перегенерирует `apps/mobile/android` из `app.json` и плагинов, поэтому
# нативные правки живут только в `apps/mobile/native-android/` и `apps/mobile/plugins/`.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILDER_IMAGE="svitlo-rn-android"
BASE_IMAGE="svitlo-android-builder"
BUILD_TYPE="release"
RUN_TESTS=1
PUBLISH=1
USE_DOCKER=0
PUBLISH_ONLY=0

for arg in "$@"; do
  case "$arg" in
    --debug) BUILD_TYPE="debug" ;;
    --release) BUILD_TYPE="release" ;;
    --skip-tests) RUN_TESTS=0 ;;
    --no-publish) PUBLISH=0 ;;
    --publish-only) PUBLISH_ONLY=1 ;;
    --docker) USE_DOCKER=1 ;;
    -h|--help)
      sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Неизвестный аргумент: $arg" >&2
      exit 2
      ;;
  esac
done

APP_VERSION="$(node -p "require('${REPO_ROOT}/apps/mobile/app.json').expo.version")"
BUILD_NUMBER="$(git -C "${REPO_ROOT}" rev-list --count HEAD 2>/dev/null || echo 1)"
APK_OUT_DIR="${REPO_ROOT}/apps/mobile/android-apk"
mkdir -p "${APK_OUT_DIR}"
echo ">>> Режим: ${BUILD_TYPE}; версия ${APP_VERSION} (versionCode ${BUILD_NUMBER})"

# --- постоянный ключ release-подписи -------------------------------------------------
# Ключ один на приложение (`ua.com.svitlo.app`), поэтому берём тот же, которым подписаны
# предыдущие APK. Пересоздавать его нельзя: Android увидит другое приложение и откажется
# обновлять установленное.
KEYSTORE_PROPS="${REPO_ROOT}/apps/web/android/keystore.properties"
CONTAINER_KEYSTORE=""
HOST_KEYSTORE=""
STORE_PASSWORD=""
KEY_ALIAS="svitlo"
KEY_PASSWORD=""
if [[ "${BUILD_TYPE}" == release ]]; then
  if [[ -f "${KEYSTORE_PROPS}" ]]; then
    STORE_FILE="$(grep -E '^storeFile=' "${KEYSTORE_PROPS}" | cut -d= -f2-)"
    STORE_PASSWORD="$(grep -E '^storePassword=' "${KEYSTORE_PROPS}" | cut -d= -f2-)"
    KEY_ALIAS="$(grep -E '^keyAlias=' "${KEYSTORE_PROPS}" | cut -d= -f2-)"
    KEY_PASSWORD="$(grep -E '^keyPassword=' "${KEYSTORE_PROPS}" | cut -d= -f2-)"
    HOST_KEYSTORE="${REPO_ROOT}/apps/web/android/app/${STORE_FILE}"
    if [[ -f "${HOST_KEYSTORE}" ]]; then
      CONTAINER_KEYSTORE="/repo/apps/web/android/app/${STORE_FILE}"
      echo ">>> Release-ключ: apps/web/android/app/${STORE_FILE}"
    fi
  fi
  if [[ -z "${CONTAINER_KEYSTORE}" ]]; then
    echo "ВНИМАНИЕ: release-ключ не найден (${KEYSTORE_PROPS})." >&2
    echo "  APK будет подписан debug-ключом: обновить им уже установленное приложение нельзя." >&2
  fi
fi

# --- публикация уже собранного APK -------------------------------------------------------
# Зачем режим: versionCode считается по числу коммитов, поэтому пересборка после любой правки
# даёт другой номер и другой sha256. Когда APK уже подписан и проверен на телефоне, заливать
# нужно ровно этот файл — пересборка тихо подменила бы бинарник.
if (( PUBLISH_ONLY )); then
  if [[ "${BUILD_TYPE}" != release ]]; then
    echo "--publish-only работает только с release-сборкой" >&2
    exit 2
  fi
  APK="${APK_OUT_DIR}/svitlo-${APP_VERSION}.apk"
  if [[ ! -f "${APK}" ]]; then
    echo "Нет готового APK: ${APK}" >&2
    echo "Соберите его без --publish-only." >&2
    exit 1
  fi
  echo ">>> Публикую готовый APK: ${APK} (сборка и prebuild пропущены)"
else

# --- prebuild ---------------------------------------------------------------------------
# `--clean` обязателен: без него старые сгенерированные ABI/подписи остаются в android/ и
# результат зависит от того, что лежало на диске.
echo ">>> expo prebuild (android)"
(
  cd "${REPO_ROOT}/apps/mobile"
  CI=1 ./node_modules/.bin/expo prebuild --platform android --clean --no-install
)

GRADLE_FILE="${REPO_ROOT}/apps/mobile/android/app/build.gradle"
python3 - "${GRADLE_FILE}" "${BUILD_NUMBER}" "${APP_VERSION}" <<'PY'
import pathlib
import re
import sys

path, number, version = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3]
text = path.read_text(encoding='utf-8')
text = re.sub(r'versionCode \d+', f'versionCode {number}', text)
text = re.sub(r'versionName "[^"]*"', f'versionName "{version}"', text)
path.write_text(text, encoding='utf-8')
print(f"    versionCode = {number}, versionName = {version}")
PY

# --- gradle: локально или в контейнере --------------------------------------------------
# По умолчанию собираем локальным Gradle: на машине разработчика уже стоит Android Studio,
# а её SDK (NDK 27.1 + cmake 3.22.1) — ровно тот, что нужен React Native 0.88. Docker-путь
# остаётся для CI и чужих машин (`--docker`); он поднимает второй Gradle-кэш на несколько
# гигабайт и на 14 ГБ RAM конкурирует с IDE за память.
echo ">>> Gradle assemble${BUILD_TYPE^} (arm64-v8a)"
GRADLE_CACHE="${REPO_ROOT}/.cache/gradle-rn"
mkdir -p "${GRADLE_CACHE}"

TASKS=(:app:assembleRelease)
if [[ "${BUILD_TYPE}" == debug ]]; then
  TASKS=(:app:assembleDebug)
elif (( RUN_TESTS )); then
  # Тесты гоняем на debug-варианте: AGP в этом проекте создаёт юнит-тестовую компоненту только
  # для него (`gradlew :app:tasks` знает `testDebugUnitTest`, но не `testReleaseUnitTest`).
  # Классы те же, тест `OtaBundleTest` — чистый JVM без Android API, поэтому вариант сборки на
  # результат не влияет; сам APK всё равно собирается в release.
  TASKS=(:app:testDebugUnitTest :app:assembleRelease)
fi

# Потолки памяти: Gradle с Kotlin-демонами и CMake легко перебирает 5 ГБ, а рядом живёт IDE.
# На 14 ГБ с открытым VS Code/Android Studio превышение приводит к `systemd-oomd`, который
# выбирает жертвой крупнейший user-scope — то есть саму IDE (в журнале:
# `app-com.microsoft.VSCode-*.scope: Failed with result 'oom-kill'`). Поэтому дефолт скромный,
# а на выделенном CI его поднимают через переменные окружения.
GRADLE_HEAP="${GRADLE_HEAP:-2048m}"
KOTLIN_HEAP="${KOTLIN_HEAP:-768m}"
GRADLE_WORKERS="${GRADLE_WORKERS:-2}"
GRADLE_JVM_ARGS="-Xmx${GRADLE_HEAP} -XX:MaxMetaspaceSize=512m"
GRADLE_ARGS=(
  --console=plain
  "--max-workers=${GRADLE_WORKERS}"
  "-Dorg.gradle.jvmargs=${GRADLE_JVM_ARGS}"
  "-Dkotlin.daemon.jvm.options=-Xmx${KOTLIN_HEAP}"
)

ANDROID_SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-${HOME}/Android/Sdk}}"
NDK_VERSION="${NDK_VERSION:-27.1.12297006}"
JDK17="${JAVA_HOME:-}"
if [[ -z "${JDK17}" || ! -x "${JDK17}/bin/java" ]]; then
  JDK17=""
  for candidate in /usr/lib/jvm/java-17-openjdk* /opt/android-studio/jbr; do
    if [[ -x "${candidate}/bin/java" ]]; then JDK17="${candidate}"; break; fi
  done
fi

LOCAL_READY=1
[[ -d "${ANDROID_SDK}/ndk/${NDK_VERSION}" ]] || LOCAL_READY=0
[[ -n "${JDK17}" ]] || LOCAL_READY=0
if (( USE_DOCKER == 0 )) && (( LOCAL_READY == 0 )); then
  echo ">>> Локального SDK/NDK ${NDK_VERSION} или JDK 17 нет — собираю в контейнере" >&2
  USE_DOCKER=1
fi

if (( USE_DOCKER )); then
  if ! docker image inspect "${BUILDER_IMAGE}" >/dev/null 2>&1; then
    echo ">>> Сборка образа ${BUILDER_IMAGE} (первый раз, ~10 минут)"
    docker build -f "${REPO_ROOT}/docker/Dockerfile.android" -t "${BASE_IMAGE}" "${REPO_ROOT}"
    docker build -f "${REPO_ROOT}/docker/Dockerfile.rn-android" -t "${BUILDER_IMAGE}" "${REPO_ROOT}"
  fi

  docker run --rm \
    --user "$(id -u):$(id -g)" \
    -v "${GRADLE_CACHE}:/tmp/.gradle" \
    -v "${REPO_ROOT}:/repo" \
    -e ANDROID_HOME=/opt/android-sdk \
    -e ANDROID_SDK_ROOT=/opt/android-sdk \
    -e GRADLE_USER_HOME=/tmp/.gradle \
    -e HOME=/tmp \
    -e SVITLO_KEYSTORE="${CONTAINER_KEYSTORE}" \
    -e SVITLO_STORE_PASSWORD="${STORE_PASSWORD}" \
    -e SVITLO_KEY_ALIAS="${KEY_ALIAS}" \
    -e SVITLO_KEY_PASSWORD="${KEY_PASSWORD}" \
    "${BUILDER_IMAGE}" \
    bash -c "
      set -e
      cd /repo/apps/mobile/android
      ./gradlew --no-daemon --console=plain --max-workers=${GRADLE_WORKERS} \
        -Dorg.gradle.jvmargs='${GRADLE_JVM_ARGS}' \
        -Dkotlin.daemon.jvm.options=-Xmx${KOTLIN_HEAP} \
        ${TASKS[*]} -PreactNativeArchitectures=arm64-v8a
    " 2>&1
else
  echo ">>> Локальный Gradle: SDK ${ANDROID_SDK}, JDK ${JDK17}"
  # `--no-daemon`: демон переживает сборку и держит ~1 ГБ, пока идёт работа в IDE.
  (
    cd "${REPO_ROOT}/apps/mobile/android"
    ANDROID_HOME="${ANDROID_SDK}" \
    ANDROID_SDK_ROOT="${ANDROID_SDK}" \
    JAVA_HOME="${JDK17}" \
    PATH="${JDK17}/bin:${PATH}" \
    SVITLO_KEYSTORE="${HOST_KEYSTORE}" \
    SVITLO_STORE_PASSWORD="${STORE_PASSWORD}" \
    SVITLO_KEY_ALIAS="${KEY_ALIAS}" \
    SVITLO_KEY_PASSWORD="${KEY_PASSWORD}" \
      ./gradlew --no-daemon "${GRADLE_ARGS[@]}" "${TASKS[@]}" -PreactNativeArchitectures=arm64-v8a
  )
fi


# --- артефакт и проверки ----------------------------------------------------------------
if [[ "${BUILD_TYPE}" == release ]]; then
  APK_SRC="${REPO_ROOT}/apps/mobile/android/app/build/outputs/apk/release/app-release.apk"
  APK="${APK_OUT_DIR}/svitlo-${APP_VERSION}.apk"
else
  APK_SRC="${REPO_ROOT}/apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk"
  APK="${APK_OUT_DIR}/app-debug.apk"
fi
if [[ ! -f "${APK_SRC}" ]]; then
  echo "APK не найден: ${APK_SRC}" >&2
  exit 1
fi
cp -f "${APK_SRC}" "${APK}"

fi  # конец ветки сборки (в режиме --publish-only её нет)

# Проверки состава APK, а не только размера: «стало меньше» легко получить, случайно
# выкинув нужную библиотеку. Проверяем именно то, за что боролись.
echo ">>> Состав APK"
python3 - "${APK}" <<'PY'
import sys
import zipfile

path = sys.argv[1]
with zipfile.ZipFile(path) as apk:
    names = apk.namelist()
    sizes = {info.filename: info.file_size for info in apk.infolist()}

abis = sorted({name.split('/')[1] for name in names if name.startswith('lib/')})
forbidden = [name for name in names if name.startswith('assets/data/address') or name.startswith('assets/ota')]
print(f"    ABI: {', '.join(abis) or '—'}")
print(f"    записей: {len(names)}; суммарно распаковано {sum(sizes.values()) / 1024 / 1024:.1f} МБ")
for name, size in sorted(sizes.items(), key=lambda item: -item[1])[:6]:
    print(f"      {size / 1024 / 1024:6.1f} МБ  {name}")
if forbidden:
    print(f"ОШИБКА: в APK попали веб-ассеты ({len(forbidden)} файлов, {forbidden[0]} …)", file=sys.stderr)
    sys.exit(1)
if any(abi in {'x86', 'x86_64', 'armeabi-v7a'} for abi in abis):
    print("ОШИБКА: в APK остались библиотеки нецелевых ABI", file=sys.stderr)
    sys.exit(1)
PY

APK_BYTES="$(stat -c%s "${APK}")"
echo ">>> Готово: ${APK} ($(du -h "${APK}" | cut -f1), ${APK_BYTES} байт)"

if [[ "${BUILD_TYPE}" == debug ]]; then
  echo
  echo "Установка в эмулятор/на телефон:"
  echo "  adb install -r \"${APK}\""
  exit 0
fi

# --- R2 + метаданные ---------------------------------------------------------------------
# Pages не принимает файлы больше 25 MiB, поэтому APK живёт в R2, а Worker отдаёт его по
# стабильной ссылке /download/svitlo-latest.apk. Сам бинарник не коммитится.
if (( ! PUBLISH )); then
  echo ">>> --no-publish: APK остался локально"
  exit 0
fi

R2_BUCKET="${SVITLO_APK_R2_BUCKET:-svitlo-apk}"
WRANGLER="${REPO_ROOT}/cf-worker/node_modules/.bin/wrangler"
APK_URL="${SVITLO_APK_URL:-https://svitlo-api.olegvapnik45.workers.dev/download/svitlo-latest.apk}"
if [[ -x "${WRANGLER}" ]]; then
  echo ">>> Загрузка APK в R2: ${R2_BUCKET}/svitlo-latest.apk"
  "${WRANGLER}" r2 object put "${R2_BUCKET}/svitlo-latest.apk" --file="${APK}" \
    --content-type=application/vnd.android.package-archive
else
  echo "ВНИМАНИЕ: wrangler не найден — APK не загружен в R2." >&2
fi

# Метаданные считаем ровно для того файла, который только что подписан: иначе клиент скачал бы
# APK с несовпадающим хешем, и нативная обёртка справедливо отказалась бы его устанавливать.
python3 - "${REPO_ROOT}" "${APK}" "${APP_VERSION}" "${APK_URL}" <<'PY'
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

echo
echo "Установка по USB:"
echo "  adb install -r \"${APK}\""
