#!/usr/bin/env python3
"""Collect live ГПВ intervals for every region published on Energy-UA.

Energy-UA regional sites expose one page per queue and subgroup:
``https://<host>/cherga/1-1`` ... ``/cherga/6-2``.  The page renders the human
readable periods but also embeds the same data as JSON:

    const periods = [{"day":18,"time_from":1792292400,"time_to":1792299600,
                      "cherga":"1.1","status":"red"}, ...];
    const tomorrowPeriods = Object.values([...]);

We parse that JSON instead of scraping the HTML text: timestamps and queue
codes are exact, and the page's own labels ("Немає даних" / all-clear) tell us
whether a schedule exists at all.

Install the fetcher in the repository-local venv (keeps system Python clean):

    python3 -m venv .cache/scrapling-venv
    .cache/scrapling-venv/bin/pip install 'scrapling[fetchers]'

Typical runs:

    # collect + write reviewable JSON/SQL, do not touch production
    .cache/scrapling-venv/bin/python tools/scrapling_schedules_sync.py \
        --json .cache/energy-ua/schedules.json --sql /tmp/schedules.sql

    # collect and apply the diff to the remote D1 database
    .cache/scrapling-venv/bin/python tools/scrapling_schedules_sync.py --apply

    # only two regions, for a quick check
    .cache/scrapling-venv/bin/python tools/scrapling_schedules_sync.py \
        --regions chernihivska-oblast,kyivska-oblast --json /tmp/s.json
    # Kyiv city has its own page with numbered groups (now 1..60), not /cherga/1-1
    .cache/scrapling-venv/bin/python tools/scrapling_schedules_sync.py \
        --regions kyiv-city --apply



The script only writes dates that are "today" or "tomorrow" in Kyiv time and
replaces rows with ``source = 'energy-ua'`` for those dates.  Mirror rows are
never deleted: if an Energy-UA row has the same primary key it is overwritten,
and the next mirror sync restores its own value.
"""

from __future__ import annotations

import argparse
import json
import re
import socket
import subprocess
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

KYIV = ZoneInfo("Europe/Kyiv")
SOURCE = "energy-ua"
USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)

# One Energy-UA host can serve two product regions (Kyiv city + Kyiv oblast).
HOST_REGIONS: dict[str, tuple[str, ...]] = {
    "chernigiv.energy-ua.info": ("chernihivska-oblast",),
    "kyiv.energy-ua.info": ("kyiv-city", "kyivska-oblast"),
    "lviv.energy-ua.info": ("lvivska-oblast",),
    "dnipro.energy-ua.info": ("dnipropetrovska-oblast",),
    "kharkiv.energy-ua.info": ("kharkivska-oblast",),
    "sumy.energy-ua.info": ("sumska-oblast",),
    # Полтавщина живёт на корневом домене, отдельного поддомена нет.
    "energy-ua.info": ("poltavska-oblast",),
    "zhytomyr.energy-ua.info": ("zhytomyrska-oblast",),
    "zakarpat.energy-ua.info": ("zakarpatska-oblast",),
    "rivne.energy-ua.info": ("rivnenska-oblast",),
    "ternopil.energy-ua.info": ("ternopilska-oblast",),
    "khmel.energy-ua.info": ("khmelnytska-oblast",),
    "prykarpattya.energy-ua.info": ("ivano-frankivska-oblast",),
    "mykolaiv.energy-ua.info": ("mykolaivska-oblast",),
    "zap.energy-ua.info": ("zaporizka-oblast",),
    "volyn.energy-ua.info": ("volynska-oblast",),
    "chernivtsi.energy-ua.info": ("chernivetska-oblast",),
    "krop.energy-ua.info": ("kirovohradska-oblast",),
}

# /cherga on the Kyiv host belongs to the oblast; Kyiv city has no ГПВ there.
SCHEDULE_REGION_BY_HOST = {host: regions[-1] for host, regions in HOST_REGIONS.items()}

REGION_NAMES: dict[str, str] = {
    "vinnytska-oblast": "Вінницька область",
    "volynska-oblast": "Волинська область",
    "dnipropetrovska-oblast": "Дніпропетровська область",
    "donetska-oblast": "Донецька область",
    "zhytomyrska-oblast": "Житомирська область",
    "zakarpatska-oblast": "Закарпатська область",
    "zaporizka-oblast": "Запорізька область",
    "ivano-frankivska-oblast": "Івано-Франківська область",
    "kyiv-city": "Київ",
    "kyivska-oblast": "Київська область",
    "kirovohradska-oblast": "Кіровоградська область",
    "luhanska-oblast": "Луганська область",
    "lvivska-oblast": "Львівська область",
    "mykolaivska-oblast": "Миколаївська область",
    "odeska-oblast": "Одеська область",
    "poltavska-oblast": "Полтавська область",
    "rivnenska-oblast": "Рівненська область",
    "sumska-oblast": "Сумська область",
    "ternopilska-oblast": "Тернопільська область",
    "kharkivska-oblast": "Харківська область",
    "khersonska-oblast": "Херсонська область",
    "khmelnytska-oblast": "Хмельницька область",
    "cherkaska-oblast": "Черкаська область",
    "chernivetska-oblast": "Чернівецька область",
    "chernihivska-oblast": "Чернігівська область",
}

QUEUES: tuple[str, ...] = tuple(
    f"{number}/{subgroup}" for number in range(1, 7) for subgroup in (1, 2)
)

PERIODS_RE = re.compile(r"const periods\s*=\s*(\[.*?\])\s*;", re.S)
TOMORROW_RE = re.compile(
    r"const tomorrowPeriods\s*=\s*Object\.values\(\s*(\[.*?\]|\{.*?\})\s*\)\s*;", re.S
)

@dataclass
class DayResult:
    """Intervals and coverage for one queue/date on one regional site."""

    queue: str
    date: str
    covered: bool
    intervals: list[tuple[str, str]] = field(default_factory=list)


@dataclass
class HostResult:
    host: str
    regions: tuple[str, ...]
    days: list[DayResult] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


def log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def iso_utc(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def local_slot_to_utc(date: str, clock: str, is_end: bool) -> str:
    """Mirror `localSlotToUtc` from the worker: 00:00 as an end means next day."""
    moment = datetime.fromisoformat(f"{date}T{clock}:00").replace(tzinfo=KYIV)
    if is_end and clock == "00:00":
        moment += timedelta(days=1)
    return iso_utc(moment)


def fetch_html(url: str, timeout: int = 30) -> str:
    """Fetch a page with Chrome impersonation, then plain urllib as a fallback."""
    last_error: Exception | None = None
    try:
        from scrapling.fetchers import Fetcher  # type: ignore[import-not-found]

        response = Fetcher.get(url, impersonate="chrome", stealthy_headers=True, timeout=timeout)
        if response.status == 200:
            return response.body.decode("utf-8", "replace")
        last_error = RuntimeError(f"HTTP {response.status}")
    except Exception as error:  # noqa: BLE001 - optional dependency and network errors
        last_error = error

    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Language": "uk-UA,uk;q=0.9,en;q=0.8",
            "Referer": "https://www.google.com/",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.read().decode("utf-8", "replace")
    except Exception as error:  # noqa: BLE001
        raise RuntimeError(f"{url}: {last_error or error}") from error


def parse_json_array(raw: str | None) -> list[dict[str, Any]]:
    if not raw:
        return []
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        return []
    if isinstance(value, dict):
        value = list(value.values())
    return [item for item in value if isinstance(item, dict)]


def block_between(html: str, start_marker: str, end_markers: tuple[str, ...]) -> str:
    start = html.find(start_marker)
    if start < 0:
        return ""
    end = len(html)
    for marker in end_markers:
        index = html.find(marker, start + len(start_marker))
        if index >= 0:
            end = min(end, index)
    return html[start:end]


def periods_to_slots(periods: list[dict[str, Any]]) -> dict[str, list[tuple[str, str]]]:
    """Group half-hour outage slots by their local start date."""
    grouped: dict[str, list[tuple[str, str]]] = {}
    for item in periods:
        status = str(item.get("status") or "red").strip().lower()
        if status in {"green", "white", "on", "0"}:
            continue
        try:
            start = datetime.fromtimestamp(int(item["time_from"]), KYIV)
            end = datetime.fromtimestamp(int(item["time_to"]), KYIV)
        except (KeyError, TypeError, ValueError, OSError):
            continue
        if end <= start:
            continue
        cursor = start.replace(minute=(start.minute // 30) * 30, second=0, microsecond=0)
        while cursor < end:
            following = cursor + timedelta(minutes=30)
            grouped.setdefault(cursor.date().isoformat(), []).append(
                (cursor.strftime("%H:%M"), following.strftime("%H:%M"))
            )
            cursor = following
    for slots in grouped.values():
        slots.sort()
    return grouped





def extract_days(html: str, queue: str, today: str, tomorrow: str) -> list[DayResult]:
    """Return today/tomorrow intervals plus an honest coverage flag for each."""
    periods_match = PERIODS_RE.search(html)
    periods = parse_json_array(periods_match.group(1) if periods_match else None)
    tomorrow_match = TOMORROW_RE.search(html)
    tomorrow_periods = parse_json_array(tomorrow_match.group(1) if tomorrow_match else None)

    # The words also appear in <title>/navigation, so anchor on the real headings.
    today_marker = 'ch_day_title">Відключення сьогодні'
    tomorrow_marker = 'ch_day_title">Відключення завтра'
    today_block = block_between(html, today_marker, (tomorrow_marker,))
    tomorrow_block = block_between(html, tomorrow_marker, ("</main>",))
    if not today_block:
        today_block = block_between(html, "Відключення сьогодні", ("Відключення завтра",))
    if not tomorrow_block:
        tomorrow_block = block_between(html, "Відключення завтра", ("</main>",))
    slots_by_date = periods_to_slots(periods + tomorrow_periods)


def is_day_published(block: str, slots: list) -> bool:
    """Опубликован ли день по разметке Energy-UA.

    Правило ровно одно, и оно проверяется тестами в `tests/test_scrapling_schedules.py`:
    побеждает наличие заполненной ячейки `class="hour_status <класс>"` либо интервалов.
    Это страхует ОБРАТНУЮ ошибку: день без отключений — это зелёные ячейки, а не пустота,
    и внутри такого блока может лежать вложенный `no_data` (так помечается пустой список
    периодов). Если судить только по `no_data`, честный «світло є за графіком» был бы
    выброшен как «немає даних» — тоже ложь, просто противоположная.
    Отсутствие публикации фиксируем, только когда ячеек нет вовсе И оператор показал
    заглушку «Немає даних».

    Отдельно: сам блок `scale_hours` рендерится ВСЕГДА (48 ячеек), поэтому его наличие
    ничего не доказывает. Именно на этом ошиблись первые версии парсера: они объявляли
    покрытой область, у которой на странице висел `class="no_data"`.
    """
    if slots or re.search(r'class="hour_status [a-z_]+', block or ""):
        return True
    return not ("no_data" in (block or "") or "Немає даних" in (block or "")) and False

    # Правило вынесено в `is_day_published` и покрыто тестами: не дублируем его здесь,
    # иначе тесты проверяли бы копию, а не рабочий код.
    today_covered = is_day_published(today_block, slots_by_date.get(today, []))
    tomorrow_covered = is_day_published(tomorrow_block, slots_by_date.get(tomorrow, []))
    if slots_by_date.get(today):
        today_covered = True
    if slots_by_date.get(tomorrow):
        tomorrow_covered = True

    return [
        DayResult(queue=queue, date=today, covered=today_covered, intervals=slots_by_date.get(today, [])),
        DayResult(queue=queue, date=tomorrow, covered=tomorrow_covered, intervals=slots_by_date.get(tomorrow, [])),
    ]


def collect_host(host: str, region: str, today: str, tomorrow: str) -> HostResult:
    result = HostResult(host=host, regions=(region,))
    try:
        # Fail quickly for guessed/nonexistent subdomains. Scrapling's network retry cycle is
        # useful for transient blocks, but repeating it for every queue on NXDOMAIN wastes minutes.
        socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    except OSError as error:
        result.errors.append(f"DNS: {error}")
        return result

    # Some regional sites publish 12 plain queues (`/cherga/1` … `/cherga/12`), while most use
    # six queues split into two subgroups (`/cherga/1-1` … `/cherga/6-2`). Probe the route shape
    # once; do not mislabel a plain queue page as subgroup 1/1.
    first_url = f"https://{host}/cherga/1-1"
    plain_queues = False
    try:
        first_html = fetch_html(first_url)
    except Exception as error:  # noqa: BLE001
        if "404" not in str(error):
            result.errors.append(f"queue route probe: {error}")
            return result
        plain_queues = True
        first_html = ""

    queue_pages: list[tuple[str, str]] = []
    if plain_queues:
        for number in range(1, 13):
            queue_pages.append((str(number), f"https://{host}/cherga/{number}"))
    else:
        queue_pages.extend((queue, f"https://{host}/cherga/{queue.replace('/', '-')}") for queue in QUEUES)

    for index, (queue, url) in enumerate(queue_pages):
        try:
            html = first_html if index == 0 and not plain_queues else fetch_html(url)
        except Exception as error:  # noqa: BLE001 - one queue must not kill the host
            result.errors.append(f"{queue}: {error}")
            continue
        result.days.extend(extract_days(html, queue, today, tomorrow))
    return result


def sql_quote(value: str) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def build_sql(results: list[HostResult], dates: tuple[str, str], generated_at: str) -> list[str]:
    """Build idempotent D1 statements for slots, coverage and canonical events."""
    statements: list[str] = []
    seen_slots: set[tuple[str, str, str, str]] = set()
    seen_events: set[str] = set()
    date_list = ", ".join(sql_quote(date) for date in dates)

    for host in results:
        # Never erase a last-known schedule after a partial fetch, dead hostname, or parser
        # regression. A complete snapshot contains both dates for every discovered queue.
        if host.errors or not host.days or len(host.days) % 2 != 0:
            log(f"skip D1 writes for {host.host}: incomplete snapshot ({len(host.days)} day rows, {len(host.errors)} errors)")
            continue
        queues = {day.queue for day in host.days}
        dates_seen = {day.date for day in host.days}
        if dates_seen != set(dates) or len(host.days) != len(queues) * len(dates):
            log(f"skip D1 writes for {host.host}: missing queue/date rows")
            continue
        region = host.regions[0]
        statements.append(
            f"DELETE FROM schedule_slots WHERE source = {sql_quote(SOURCE)} "
            f"AND region = {sql_quote(region)} AND date IN ({date_list});"
        )
        statements.append(
            f"DELETE FROM schedule_coverage WHERE source = {sql_quote(SOURCE)} "
            f"AND region = {sql_quote(region)} AND date IN ({date_list});"
        )
        for date in dates:
            statements.append(
                f"DELETE FROM outage_events WHERE external_id LIKE "
                f"{sql_quote(f'gpv:{region}:%:{date}:%')};"
            )
        for day in host.days:
            if day.covered:
                statements.append(
                    "INSERT OR REPLACE INTO schedule_coverage "
                    "(region, date, queue, has_outages, source, updated_at) VALUES ("
                    f"{sql_quote(region)}, {sql_quote(day.date)}, {sql_quote(day.queue)}, "
                    f"{1 if day.intervals else 0}, {sql_quote(SOURCE)}, {sql_quote(generated_at)});"
                )
            for time_from, time_to in day.intervals:
                key = (region, day.queue, day.date, time_from)
                if key in seen_slots:
                    continue
                seen_slots.add(key)
                statements.append(
                    "INSERT OR REPLACE INTO schedule_slots "
                    "(region, queue, date, time_from, time_to, source) VALUES ("
                    f"{sql_quote(region)}, {sql_quote(day.queue)}, {sql_quote(day.date)}, "
                    f"{sql_quote(time_from)}, {sql_quote(time_to)}, {sql_quote(SOURCE)});"
                )
                external_id = f"gpv:{region}:{day.queue}:{day.date}:{time_from}"
                if external_id in seen_events:
                    continue
                seen_events.add(external_id)
                statements.append(
                    "INSERT OR REPLACE INTO outage_events "
                    "(external_id, region, starts_at, ends_at, area_name, addresses_raw, reason, kind, "
                    "source_url, fetched_at) VALUES ("
                    f"{sql_quote(external_id)}, {sql_quote(region)}, "
                    f"{sql_quote(local_slot_to_utc(day.date, time_from, False))}, "
                    f"{sql_quote(local_slot_to_utc(day.date, time_to, True))}, "
                    f"{sql_quote(REGION_NAMES.get(region, region))}, "
                    f"{sql_quote(f'Черга {day.queue} · {day.date}')}, "
                    "'Графік ГПВ', 'gpv', NULL, "
                    f"{sql_quote(generated_at)});"
                )
    return statements


def apply_sql(statements: list[str], local: bool, chunk_size: int = 400) -> None:
    root = Path(__file__).resolve().parents[1]
    wrangler = root / "cf-worker" / "node_modules" / ".bin" / "wrangler"
    if not wrangler.exists():
        raise SystemExit(f"wrangler not found: {wrangler}")
    out_dir = root / ".cache" / "energy-ua" / "sql"
    out_dir.mkdir(parents=True, exist_ok=True)
    mode = "--local" if local else "--remote"
    for index in range(0, len(statements), chunk_size):
        chunk = statements[index:index + chunk_size]
        path = out_dir / f"schedules-{index // chunk_size:03d}.sql"
        path.write_text("\n".join(chunk) + "\n", encoding="utf-8")
        log(f"d1 {mode}: {path.name} ({len(chunk)} statements)")
        subprocess.run(
            [str(wrangler), "d1", "execute", "svitlo", mode, f"--file={path}",
             "--config=cf-worker/wrangler.toml", "--yes"],
            cwd=root,
            check=True,
            timeout=900,
        )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--regions", default="", help="comma-separated canonical cpu list")
    parser.add_argument("--hosts", default="", help="comma-separated Energy-UA hosts")
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--timeout", type=int, default=30)
    parser.add_argument("--json", type=Path, help="write the collected snapshot here")
    parser.add_argument("--sql", type=Path, help="write one reviewable SQL file here")
    parser.add_argument("--apply", action="store_true", help="execute the SQL against D1")
    parser.add_argument("--local", action="store_true", help="apply to the local D1 instead of remote")
    args = parser.parse_args()

    now = datetime.now(KYIV)
    today = now.date().isoformat()
    tomorrow = (now.date() + timedelta(days=1)).isoformat()
    generated_at = iso_utc(datetime.now(timezone.utc))

    wanted_regions = (
        set()
        if args.regions.strip().casefold() in {"", "all", "*"}
        else {item.strip() for item in args.regions.split(",") if item.strip()}
    )
    wanted_hosts = {item.strip() for item in args.hosts.split(",") if item.strip()}
    hosts = [
        host for host in HOST_REGIONS
        if (not wanted_hosts or host in wanted_hosts)
        and (not wanted_regions or SCHEDULE_REGION_BY_HOST[host] in wanted_regions)
    ]
    # Kyiv city has its own `/grafik-kyiv` page and no regional host, so `--regions kyiv-city`
    # must not fail before `collect_kyiv_city` runs.
    city_only = sorted(wanted_regions) == ["kyiv-city"]
    if not hosts and not city_only:
        log("no hosts selected")
        return 2

    log(f"collecting {len(hosts)} hosts ({today} / {tomorrow}), workers={args.workers}")
    results: list[HostResult] = []
    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        futures = {
            pool.submit(collect_host, host, SCHEDULE_REGION_BY_HOST[host], today, tomorrow): host
            for host in hosts
        }
        for future in as_completed(futures):
            host = futures[future]
            try:
                result = future.result()
            except Exception as error:  # noqa: BLE001
                result = HostResult(host=host, regions=(SCHEDULE_REGION_BY_HOST[host],), errors=[str(error)])
            results.append(result)
            covered = sum(1 for day in result.days if day.covered)
            slots = sum(len(day.intervals) for day in result.days)
            log(f"  {host}: coverage={covered}/24 slots={slots} errors={len(result.errors)}")

    results.sort(key=lambda item: item.host)
    if not wanted_regions or "kyiv-city" in wanted_regions:
        results.append(collect_kyiv_city(today, tomorrow))
        results.sort(key=lambda item: item.host)
    payload = {
        "generatedAt": generated_at,
        "source": SOURCE,
        "today": today,
        "tomorrow": tomorrow,
        "hosts": [
            {
                "host": item.host,
                "regions": list(item.regions),
                "errors": item.errors,
                "days": [
                    {"queue": day.queue, "date": day.date, "covered": day.covered,
                     "intervals": [{"from": start, "to": end} for start, end in day.intervals]}
                    for day in item.days
                ],
            }
            for item in results
        ],
    }

    json_path = args.json or Path(".cache/energy-ua/schedules-latest.json")
    json_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    log(f"snapshot: {json_path}")

    statements = build_sql(results, (today, tomorrow), generated_at)
    sql_path = args.sql or Path(".cache/energy-ua/schedules-latest.sql")
    sql_path.parent.mkdir(parents=True, exist_ok=True)
    sql_path.write_text("\n".join(statements) + "\n", encoding="utf-8")
    log(f"sql: {sql_path} ({len(statements)} statements)")

    if args.apply:
        apply_sql(statements, local=args.local)

    total_slots = sum(len(day.intervals) for item in results for day in item.days)
    total_covered = sum(1 for item in results for day in item.days if day.covered)
    log(f"done: slots={total_slots} coverage_rows={total_covered} errors={sum(len(i.errors) for i in results)}")
    return 0


KYIV_TODAY_RE = re.compile(r"const grafikToday\s*=\s*(\[.*?\])\s*;", re.S)
KYIV_TOMORROW_RE = re.compile(r"const grafikTomorrow\s*=\s*(\[.*?\])\s*;", re.S)


def collect_kyiv_city(today: str, tomorrow: str) -> HostResult:
    """Kyiv city publishes numbered groups (now 1..60), not twelve subgroups.

    The page embeds all groups at once, so one request covers the whole city. Group count is
    read from the page (`GROUP_COUNT`) instead of hardcoding 6: the operator changed 6 → 60,
    and address pages already return a real group like `40`. With the old range, `/queues` and
    `/schedules` knew only 1..6, so most Kyiv addresses resolved to a group without a schedule.
    """
    result = HostResult(host="kyiv.energy-ua.info#grafik-kyiv", regions=("kyiv-city",))
    try:
        html = fetch_html("https://kyiv.energy-ua.info/grafik-kyiv")
    except Exception as error:  # noqa: BLE001
        result.errors.append(str(error))
        return result

    today_match = KYIV_TODAY_RE.search(html)
    tomorrow_match = KYIV_TOMORROW_RE.search(html)
    today_entries = parse_json_array(today_match.group(1) if today_match else None)
    tomorrow_entries = parse_json_array(tomorrow_match.group(1) if tomorrow_match else None)

    # The city page renders one grid for every group; presence of entries is
    # the published-schedule signal, an empty array is an all-clear day.
    today_published = today_match is not None
    tomorrow_published = tomorrow_match is not None
    count_match = re.search(r"GROUP_COUNT\s*=\s*(\d{1,3})", html)
    group_count = int(count_match.group(1)) if count_match else 60

    for number in range(1, group_count + 1):
        queue = str(number)
        day_slots = periods_to_slots(
            [item for item in today_entries if str(item.get("cherga")) == queue]
            + [item for item in tomorrow_entries if str(item.get("cherga")) == queue]
        )
        result.days.append(
            DayResult(queue=queue, date=today, covered=today_published,
                      intervals=day_slots.get(today, []))
        )
        result.days.append(
            DayResult(queue=queue, date=tomorrow, covered=tomorrow_published,
                      intervals=day_slots.get(tomorrow, []))
        )
    return result


if __name__ == "__main__":
    raise SystemExit(main())
