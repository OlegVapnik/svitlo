# Skill: Docker, Nginx, HTTPS & Operations (`ops-deploy-check`)

## Когда применять
При правках `docker-compose.yml`, `docker/Dockerfile.api`, `docker/Dockerfile.web`, `docker/nginx.conf`, настройке переменных окружения, HTTPS/TLS, диагностике падений контейнеров и резервном копировании БД.

## Правила инфраструктуры и эксплуатации
1. **Защита от падений контейнеров (`Exited 137` / `Exited 1`):**
   - В `docker/nginx.conf` апстрим `api` должен резолвиться динамически через Docker DNS (`resolver 127.0.0.11 valid=10s;`), чтобы `web` не падал с `Exit 1`, если контейнер `api` перезапускается.
   - Для `sw.js`, `registerSW.js` и `index.html` в `nginx.conf` должен стоять `Cache-Control: no-cache`, а для `/assets/` — `immutable` на 1 год.
   - В `docker/Dockerfile.api` обязательно копировать `packages/shared/node_modules` в финальный runner-образ (иначе `zod` не найдётся на старте).
2. **Порты и сеть:**
   - Порт PostgreSQL публикуется **только на loopback**: `127.0.0.1:5432:5432`. Никогда не открывай `0.0.0.0:5432` наружу.
   - Для установки PWA на телефон и работы Service Worker вне `localhost` необходим **HTTPS (TLS)** (через Caddy или внешний reverse-proxy).
3. **Приоритет окружения в `docker-compose.yml`:**
   - Помни, что блок `x-api-env` в `docker-compose.yml` передаёт переменные в контейнер `api`: используй синтаксис `${VAR:-default}`, чтобы значения из `.env` (`ENABLE_SCHEDULER`, `MIRROR_SCHEDULE_ENABLED`, `MIRROR_SCHEDULE_IMPORT_REGIONS`, `NEWS_COLLECT_ENABLED`) корректно подхватывались без переписывания compose-файла.
4. **Бэкапы с проверкой восстановления:**
   - На хосте может не быть утилиты `pg_restore` — снимай и проверяй дампы через `docker compose exec -T db`.
   - **Никогда** не выполняй `docker compose down -v` и не удаляй тома `svitlo_pg_data` / `energy-monitor_pg_data` без прямого согласия человека (`Permissions`).

## Пошаговая процедура пересборки и проверки
1. Проверь валидность `docker-compose.yml` через `docker compose config -q`.
2. Пересобери и перезапусти изменённые сервисы: `docker compose up -d --build`.
3. Убедись, что `migrate` завершился с `Exited (0)`, а `db`, `api` и `web` находятся в статусе `Up (healthy)`.
4. Проверь живой ответ API (`:3001/api/v1/health`) и раздачу фронтенда через nginx (`:3000/`).

## Команды проверки
```bash
docker compose config -q && echo "COMPOSE OK"
docker compose ps
curl -sf http://localhost:3001/api/v1/health && echo " API OK"
curl -sfI http://localhost:3000/ | head -n 5
```

## Типичные ошибки
- Изменение `POSTGRES_PASSWORD` только в `.env` на уже инициализированном томе `pg_data` (пароль внутри существующей БД меняется только через `ALTER ROLE svitlo WITH PASSWORD '...'`).
- Забытый билд `web` после изменения `VITE_API_BASE_URL` (переменная запекается в бандл на этапе `vite build`).
