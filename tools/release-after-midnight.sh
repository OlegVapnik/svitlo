#!/usr/bin/env bash
# Выкладка релиза после сброса суточных лимитов D1 (00:00 UTC).
#
# ПОРЯДОК ОБЯЗАТЕЛЕН. Лимит записи на Free Tier — 100 000 rows_written в сутки, а
# `DELETE FROM` тарифицируется ПОСТРОЧНО. Поэтому таблицу на 308 459 строк нельзя чистить
# обычным DELETE: команда выбьет лимит на сотой тысяче и следующие сутки ничего не зальётся.
# Снос через DROP TABLE + CREATE TABLE не тарифицируется построчно — это DDL.
#
# Запуск:  ./tools/release-after-midnight.sh
set -euo pipefail

cd "$(dirname "$0")/.."
W=./cf-worker/node_modules/.bin/wrangler
CFG=cf-worker/wrangler.toml
D1="$W d1 execute svitlo --config $CFG --remote"

step() { printf '\n>>> %s\n' "$1"; }

step "1/9. Проверка гипотезы о размере базы (1 row_read, а не COUNT по всей таблице)"
# В таблице составной первичный ключ, колонки `id` нет: SELECT id упал бы с no such column.
$D1 --command "SELECT 1 FROM directory_houses LIMIT 1" 2>&1 | tail -3

step "2/9. Селективный бэкап лёгких таблиц (НЕ полный экспорт — он выжигает лимит)"
mkdir -p .cache/backups
STAMP=$(date -u +%F_%H%M)
$W d1 export svitlo --config $CFG --remote --output ".cache/backups/d1-light-${STAMP}.sql" \
  --table schedule_slots --table schedule_coverage --table snapshot_meta --table address_queues
ls -lh ".cache/backups/d1-light-${STAMP}.sql"

step "3/9. Снос directory_houses через DDL (0 rows_written)"
$D1 --command "PRAGMA foreign_keys = OFF;
DROP TABLE IF EXISTS directory_houses;
CREATE TABLE IF NOT EXISTS directory_houses (
  region TEXT NOT NULL,
  settlement_normalized TEXT NOT NULL,
  street_normalized TEXT NOT NULL,
  house_number TEXT NOT NULL,
  house_normalized TEXT NOT NULL,
  queue TEXT,
  source TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (region, settlement_normalized, street_normalized, house_normalized)
);"

step "4/9. Удаление фантомного покрытия (строки, помеченные covered при no_data)"
$D1 --command "DELETE FROM schedule_coverage WHERE source='energy-ua';"
$D1 --command "SELECT COUNT(*) n FROM schedule_coverage WHERE source='energy-ua'" 2>&1 | tail -3

step "5/9. Перезалив слотов и честного покрытия"
$D1 --file=.cache/energy-ua/schedules-latest.sql

step "6/9. Перезалив адресных деревьев"
$D1 --command "DELETE FROM directory_streets WHERE region='chernihivska-oblast';
DELETE FROM directory_settlements WHERE region='chernihivska-oblast';"
for f in .cache/chern-parts2/f-*.sql; do
  printf '  %s\n' "$f"; $D1 --file="$f" >/dev/null
done
for f in .cache/address-ua/parts/kso-*.sql; do
  printf '  %s\n' "$f"; $D1 --file="$f" >/dev/null
done

step "7/9. Снос осиротевшей таблицы address_queue_votes"
# Голосование за очереди убрано из интерфейса и из локальной схемы, но таблица осталась в проде.
# DROP — это DDL, поэтому строки не тарифицируются. Шаг опциональный и включается флагом:
# удаление таблицы на проде требует явного согласия, а не молчаливого «заодно убрали».
if [ "${DROP_VOTES:-0}" = "1" ]; then
  $D1 --command "DROP TABLE IF EXISTS address_queue_votes;"
else
  printf '  пропущено (поставьте DROP_VOTES=1, если согласовано удаление)\n'
fi

step "8/9. Контроль покрытия: ожидаем области с реальными слотами, без фантомов"
# Анти-кэш: /regions кэшируется 120 с в памяти изолята и до 300 с в caches.default.
# Без этого параметра контроль вернёт СТАРЫЙ ответ — с фантомом Франковска и старыми слотами —
# и скрипт зряно решит, что выкладка не сработала.
CB="?_cb=$(date +%s)"
curl -s --max-time 30 "https://svitlo-api.olegvapnik45.workers.dev/api/v1/regions${CB}" \
  | python3 -c "
import json,sys
L=json.load(sys.stdin).get('data',[])
cov=[r for r in L if r.get('covered')]
print(f'  областей: {len(L)} | covered: {len(cov)}')
for r in sorted(cov,key=lambda x:x['cpu']): print('   ',r['cpu'],r.get('lastDate'),r.get('todaySlots'))
"

step "9/9. Контроль 5 адресов"
A=https://svitlo-api.olegvapnik45.workers.dev/api/v1
chk() { printf '  %-34s ' "$1 / $3 $4"
  curl -s --max-time 25 --get "$A/addresses/resolve${CB}" \
    --data-urlencode "region=$2" --data-urlencode "settlement=$1" \
    --data-urlencode "street=$3" --data-urlencode "house=$4" \
  | python3 -c "import json,sys;print('очередь =',repr(json.load(sys.stdin).get('data',{}).get('queue')))"; }
chk "Київ"     kyiv-city          "Хрещатик"     "12"
chk "Бровари"  kyivska-oblast     "Симоненка"    "25"
chk "Батурін"  chernihivska-oblast "Гетьманська" "27"
chk "Блістова" chernihivska-oblast "Лісова"       "34"
chk "Варва"    chernihivska-oblast "2-й Миру"    "11"

printf '\n>>> Готово. APK публиковать ПОСЛЕ успешных проверок выше.\n'