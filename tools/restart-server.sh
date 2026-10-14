#!/usr/bin/env bash
# Перезапуск сервера Svitlo (web + api + db), к которому подключается телефон.
#
# Зачем скрипт: docker compose up -d без флагов НЕ пересобирает образы, поэтому после правки
# кода в apps/web/src или apps/api/src телефон продолжит видеть старый бандл. Частая ошибка:
# «перезапустил, а на телефоне ничего не изменилось» — именно из-за отсутствия --build.
#
# Использование:
#   ./tools/restart-server.sh              # пересобрать web и api, если код поменялся
#   ./tools/restart-server.sh --fast       # без пересборки (просто перезапуск контейнеров)
#   ./tools/restart-server.sh --all        # включая пересоздание БД (данные сохранятся)
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

MODE="${1:-build}"

case "$MODE" in
  --fast|fast)
    echo ">>> Быстрый перезапуск без пересборки (изменения в коде НЕ подхватятся)"
    docker compose restart web api
    ;;
  --all|all)
    echo ">>> Полная пересборка всех сервисов (volumes сохраняются — БД не потеряется)"
    docker compose up -d --build --force-recreate db api web
    ;;
  *)
    echo ">>> Пересборка web и api (обычный случай после правки кода)"
    docker compose up -d --build web api
    ;;
esac

echo ">>> Ждём готовности"
# web не имеет healthcheck, поэтому ждём именно HTTP-ответ: это и есть «телефон увидит сайт».
for i in $(seq 1 40); do
  if curl -fsS -o /dev/null "http://localhost:3000/api/v1/health" 2>/dev/null; then
    echo "    готов: http://localhost:3000"
    break
  fi
  sleep 1
done

LAN_IP="$(ip -4 addr show scope global 2>/dev/null | grep -oP 'inet \K[\d.]+' | head -1)"
if [[ -n "${LAN_IP}" ]]; then
  if curl -fsS -o /dev/null "http://${LAN_IP}:3000/api/v1/health" 2>/dev/null; then
    echo "    доступен с телефона: http://${LAN_IP}:3000"
  else
    echo "    ВНИМАНИЕ: http://${LAN_IP}:3000 не отвечает — телефон не увидит приложение"
    echo "    Проверьте, что порт 3000 не занят и в брандмауэре открыт."
  fi
fi

echo
echo "Если телефон всё ещё показывает старое — закройте приложение полностью"
echo "(смахнуть из списка задач) и откройте заново, либо переустановите APK:"
echo "  adb install -r apps/web/android-apk/app-debug.apk"
