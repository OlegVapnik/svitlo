---
name: ops-deploy-check
description: "Deployment and operations checklist for Svitlo (Docker Compose: db, migrate, api, web/nginx): why containers exited (137, Exit 1), HTTPS for the PWA, nginx upstream resolution, restart policies, healthchecks, closing the DB port, trustProxy and the rate limit, env override trap (x-api-env vs .env), scheduler/demo flags, backups, monitoring of stale data. Use for any docker-compose/nginx/Dockerfile/.env change, 'site is down', 'containers stopped', going to production, or setting up a server. Триггеры: docker, compose, nginx, деплой, сервер, контейнер упал, Exited, HTTPS, сертификат, бэкап, прод, порт 5432, restart."
---

# Ops and deploy check

Run the **diagnosis** first when something is down; run the **production checklist** before exposing the service to the internet.
Back up before changing compose/nginx (`agent-discipline`). Do not print `.env` values.

## 1. Diagnose "containers are stopped"

```bash
docker compose ps -a
docker compose logs --tail=200 api web db
docker inspect -f '{{.Name}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}} err={{.State.Error}}' $(docker compose ps -aq)
docker compose config -q && echo "compose file valid"
docker stats --no-stream            # memory pressure?
```

| Symptom | Meaning | Fix |
|---|---|---|
| `api Exited (137)` | SIGKILL: OOM-killer or host/`docker kill`. `oom=true` confirms OOM | find memory hog (parse run, big query, `MAX_ROWS` array), add `mem_limit`, fix the leak; if `oom=false`, someone/something stopped it (host reboot, `docker compose down`) |
| `web Exited (1)` + log `host not found in upstream "api"` | nginx resolves `api` at startup; api was down | nginx resolver trick (§3) and `depends_on: api: condition: service_healthy` |
| `migrate` non-zero | a migration failed; `api` will not start (by design) | read `docker compose logs migrate`, fix SQL, see `db-migrations` |
| `db Exited (0)` | stopped cleanly (compose down/stop/host shutdown) | `restart: unless-stopped` |
| `ADMIN_TOKEN` error at `up` | compose requires it | set it in `.env` (long random) |

Restart: `docker compose up -d` (images exist) or `docker compose up -d --build` (code changed). After a web rebuild do a hard reload in the browser (PWA cache).

## 2. Traps specific to this project

- `x-api-env` in `docker-compose.yml` **overrides `.env`**. Changing `ENABLE_SCHEDULER` in `.env` does nothing until you edit the compose file. Prefer `${ENABLE_SCHEDULER:-true}` style references so `.env` is the single source.
- Current prod flags are wrong for a live product: `ENABLE_SCHEDULER=false` (data never refreshes), `SCHEDULE_DEMO=true` (fake schedule shown to residents). Target prod: scheduler **on**, demo **off**.
- `VITE_API_BASE_URL` is baked at build time. Use the relative `/api/v1` and let nginx proxy; a `http://localhost:3001/...` value breaks every non-local deployment.
- `migrate` uses `image: svitlo-api:latest` — make sure it is the image built in this `up --build`, not a stale tag.
- Toolchain mismatch: host node 26 / pnpm 11 vs image node 22 / pnpm 9.15. Test in the container.
- `docker/init.sql` runs only on an empty volume.

## 3. Production checklist

**Network and exposure**
- [ ] DB not published: remove `5432:5432` (or `127.0.0.1:5432:5432`). Default credentials `energymon/energymon/energymon` replaced by long random ones from `.env`.
- [ ] Only the reverse proxy is public (80/443). `api:3001` is internal, or at least firewalled.
- [ ] HTTPS in front (PWA/service worker requires it outside localhost). Simplest: Caddy (automatic certificates):
  ```
  your.domain.example {
    encode gzip
    reverse_proxy web:80
  }
  ```
  add a `caddy` service publishing 80/443 and remove the `3000:80` publish.
- [ ] Admin endpoints and pages reachable only from trusted places (nginx `allow/deny` or basic auth on `/admin`, and no admin entries in the public UI).
- [ ] Security headers on the web server (`X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, a CSP suited to Leaflet/ECharts), `/docs` (Swagger) restricted or off.
- [ ] CORS: with the relative `/api/v1` the API can restrict `origin` to your domain instead of `*`.

**Behind a proxy: rate limit and client IP**
- [ ] In `server.ts` Fastify created with `trustProxy: true` (or the proxy's CIDR) and nginx/Caddy forwards `X-Forwarded-For`. Otherwise every visitor shares the proxy's IP and the 100 req/min limit applies to **all users together**. Verify: `docker compose logs api | head` should show real client IPs.

**nginx upstream resolution** (prevents Exit 1 when api is down)
```
location /api/ {
  resolver 127.0.0.11 valid=10s ipv6=off;   # Docker's embedded DNS
  set $api_upstream http://api:3001;
  proxy_pass $api_upstream;                  # original URI is passed unchanged
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```

**Compose reliability**
```yaml
api:
  restart: unless-stopped
  mem_limit: 512m
  healthcheck:
    test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:3001/api/v1/health || exit 1"]
    interval: 30s
    timeout: 5s
    retries: 3
web:
  restart: unless-stopped
  depends_on:
    api:
      condition: service_healthy
db:
  restart: unless-stopped
```
Also: run the api as a non-root user (`USER node` in `Dockerfile.api`), pin versions (`.nvmrc`/`engines`/`packageManager`).

**Data freshness and monitoring**
- [ ] Scheduler on; `/status` shows `dataStale=false` after 30–40 minutes.
- [ ] External uptime check (e.g. a free ping service) on a readiness endpoint that returns 503 when `dataStale` is true or the DB is down. `/health` should check the DB (`select 1`); keep liveness and readiness separate.
- [ ] `parse_runs` reviewed: `select started_at,status,records_found,error_message from parse_runs order by started_at desc limit 10;`
- [ ] If the operator blocks us: do not rotate IPs; back off and contact the owner (`scraper-adapter-hardening`).

**Backups**
```bash
# nightly (cron on the host), keep 14 days
docker compose exec -T db pg_dump -U energymon -d energymon -Fc > /backups/energymon_$(date +%F).dump
find /backups -name 'energymon_*.dump' -mtime +14 -delete
# restore test (do it once, for real, on a scratch DB)
docker compose exec -T db pg_restore -U energymon -d energymon_restore_test --clean --if-exists < /backups/energymon_YYYY-MM-DD.dump
```
Manual data (`street_queues`, `schedule_slots`, `contacts`) is the part that cannot be re-fetched.

## Verify after changes

```bash
docker compose up -d --build && docker compose ps          # all Up, db healthy
curl -s localhost:3001/api/v1/health
curl -s localhost:3001/api/v1/status | head -c 300          # check dataStale, powerSummary
curl -s localhost:3000/ | grep -o 'assets/index-[^"]*\.js'  # new bundle hash
```
Report which items of the checklist are done, not done, or unverifiable from where you are.
