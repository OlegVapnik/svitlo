#!/usr/bin/env bash
# Повышение видимой версии приложения: X.Y.Z (см. apps/web/src/version.ts).
#
# Зачем: версия показывается прямо в интерфейсе (нижний угол главной), и по ней видно,
# какое поколение приложения стоит на телефоне. Раз в сборку метку времени меняет сборщик,
# но смысловая версия должна меняться только вместе с изменением продукта.
#
# Использование:
#   ./tools/bump-version.sh major   # крупное: новая архитектура, новый экран, смена источника данных
#   ./tools/bump-version.sh minor   # среднее: новая функция в существующем экране, новый эндпоинт
#   ./tools/bump-version.sh patch   # мелкое: исправление ошибки, вёрстка, текст
#   ./tools/bump-version.sh show
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION_FILE="apps/web/src/version.ts"

current() {
  grep -oP "APP_VERSION = '\K[0-9]+\.[0-9]+\.[0-9]+" "$VERSION_FILE"
}

case "${1:-show}" in
  show)
    echo "Текущая версия: $(current)"
    ;;
  major|minor|patch)
    IFS=. read -r x y z <<< "$(current)"
    old="$(current)"
    case "$1" in
      major) x=$((x + 1)); y=0; z=0 ;;
      minor) y=$((y + 1)); z=0 ;;
      patch) z=$((z + 1)) ;;
    esac
    new="$x.$y.$z"
    # sed вместо «-i» разных диаалектов: правим адресно, одной заменой.
    sed -i "s/APP_VERSION = '[0-9]\+\.[0-9]\+\.[0-9]\+'/APP_VERSION = '$new'/" "$VERSION_FILE"
    # `app.json` — источник versionName для Android-сборки (`expo prebuild` пишет его в
    # build.gradle). Пока версия правилась только в version.ts, веб говорил «2.26.0», а APK
    # собирался с versionName 2.25.0 — человек видел разные номера на сайте и на телефоне.
    node - "$new" <<'NODE'
const fs = require('node:fs');
const [version] = process.argv.slice(2);
for (const file of ['apps/mobile/app.json', 'apps/mobile/package.json']) {
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (file.endsWith('app.json')) json.expo.version = version;
  else json.version = version;
  fs.writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
  console.log(`   ${file}: ${version}`);
}
NODE
    # Старое значение читаем ДО sed и держим в переменной. Раньше здесь стояло "$(current)"
    # прямо в echo, и подстановка выполнялась уже после правки файла — поэтому скрипт
    # печатал «2.2.0 → 2.2.0», то есть обе версии выглядели одинаково, и повышение
    # незаметно для человека не выглядело повышенем.
    echo "$old → $new"
    echo
    echo "Не забудьте отразить это в описании коммита и в разделе «Що нового» (changelog.json)."
    ;;
  *)
    echo "Использование: $0 [major|minor|patch|show]" >&2
    exit 1
    ;;
esac