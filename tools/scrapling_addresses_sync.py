#!/usr/bin/env python3
"""Collect the Energy-UA address hierarchy into compact D1 directory rows.

The public hierarchy is:

    /                     -> settlements
    /select/<settlement>  -> streets
    /select/<s>/<street>  -> house links
    /grafik/<s>/<street>/<house> -> exact queue of that house

The last page carries the queue in the first few kilobytes ("У вас 2 черга (2 підгрупа)"),
so we ask the server for a byte range instead of downloading the whole 30-40 KB schedule.
Kyiv city is the exception: it has six groups and the page exposes them as
`Група 1` / `#kyivSelectedGroup`.

No queue is invented. A street without a verified queue is still written to the directory
with `default_queue = NULL`, which the worker treats as "known street, unknown group".

Usage (priority regions):
  .cache/scrapling-venv/bin/python tools/scrapling_addresses_sync.py \
    --regions kyiv-city,kyivska-oblast,chernihivska-oblast --workers 20 --sql
"""

from __future__ import annotations

import argparse
import csv
import html as html_lib
import json
import re
import sys
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import quote, unquote

CACHE = Path(".cache/address-ua")
CHERNIHIV_PDF = Path(".cache/address-hierarchy/chernihiv.json")
KATOTTG_CACHE = Path(".cache/katottg.csv")
KATOTTG_SOURCE = "https://raw.githubusercontent.com/alexbabintsev/ua-geo/main/data/out/katottg.csv"

REGION_HOSTS: dict[str, str] = {
    "chernihivska-oblast": "chernigiv.energy-ua.info",
    "kyiv-city": "kyiv.energy-ua.info",
    "kyivska-oblast": "kyiv.energy-ua.info",
    "poltavska-oblast": "energy-ua.info",
    "kharkivska-oblast": "kharkiv.energy-ua.info",
    "lvivska-oblast": "lviv.energy-ua.info",
    "zaporizka-oblast": "zap.energy-ua.info",
    "zakarpatska-oblast": "zakarpat.energy-ua.info",
    "ternopilska-oblast": "ternopil.energy-ua.info",
    "khmelnytska-oblast": "khmel.energy-ua.info",
    "chernivetska-oblast": "chernivtsi.energy-ua.info",
    "sumska-oblast": "sumy.energy-ua.info",
    "rivnenska-oblast": "rivne.energy-ua.info",
    "zhytomyrska-oblast": "zhytomyr.energy-ua.info",
    "dnipropetrovska-oblast": "dnipro.energy-ua.info",
    "ivano-frankivska-oblast": "prykarpattya.energy-ua.info",
    "kirovohradska-oblast": "krop.energy-ua.info",
}

PRIORITY = ("chernihivska-oblast", "kyiv-city", "kyivska-oblast")

KATOTTG_REGION_NAMES: dict[str, str] = {
    "chernihivska-oblast": "Чернігівська",
    "kyiv-city": "Київ",
    "kyivska-oblast": "Київська",
    "poltavska-oblast": "Полтавська",
    "kharkivska-oblast": "Харківська",
    "lvivska-oblast": "Львівська",
    "zaporizka-oblast": "Запорізька",
    "zakarpatska-oblast": "Закарпатська",
    "ternopilska-oblast": "Тернопільська",
    "khmelnytska-oblast": "Хмельницька",
    "chernivetska-oblast": "Чернівецька",
    "sumska-oblast": "Сумська",
    "rivnenska-oblast": "Рівненська",
    "zhytomyrska-oblast": "Житомирська",
    "dnipropetrovska-oblast": "Дніпропетровська",
    "ivano-frankivska-oblast": "Івано-Франківська",
    "kirovohradska-oblast": "Кіровоградська",
}

_LOCAL = threading.local()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def clean_label(value: str) -> str:
    return " ".join(unquote(value.replace("+", " ")).split()).strip()


def session_for_thread():
    from curl_cffi import requests

    session = getattr(_LOCAL, "session", None)
    if session is None:
        session = requests.Session(impersonate="chrome")
        session.headers.update({
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "uk-UA,uk;q=0.9,en;q=0.8",
        })
        _LOCAL.session = session
    return session


def fetch_text(url: str, byte_range: int = 0, retries: int = 3) -> str | None:
    """Fetch a page, optionally only its first bytes; returns None for a real 404."""
    headers = {"Range": f"bytes=0-{byte_range}"} if byte_range else {}
    last_error: Exception | None = None
    for attempt in range(retries):
        try:
            response = session_for_thread().get(
                url, headers=headers, timeout=35, allow_redirects=True
            )
            if response.status_code == 404:
                return None
            if response.status_code in (403, 429):
                time.sleep(1.5 * (attempt + 1))
                last_error = RuntimeError(f"HTTP {response.status_code}: {url}")
                continue
            if response.status_code not in (200, 206):
                last_error = RuntimeError(f"HTTP {response.status_code}: {url}")
                continue
            return response.text
        except Exception as error:  # noqa: BLE001 - network retries are deliberate
            last_error = error
            time.sleep(0.4 * (attempt + 1))
    raise RuntimeError(f"failed after {retries} attempts: {url}: {last_error}")


ANCHOR_RE = re.compile(r'<a\b[^>]*href="([^"]+)"[^>]*>(.*?)</a>', re.S | re.I)
TAG_RE = re.compile(r"<[^>]+>")


def anchors(page: str) -> list[tuple[str, str]]:
    result: list[tuple[str, str]] = []
    for match in ANCHOR_RE.finditer(page):
        href = html_lib.unescape(match.group(1)).strip()
        label = html_lib.unescape(TAG_RE.sub(" ", match.group(2)))
        label = " ".join(label.split())
        if href and label:
            result.append((href, label))
    return result


def route_parts(path: str, prefix: str) -> list[str] | None:
    if not path.startswith(prefix):
        return None
    return [unquote(part) for part in path[len(prefix):].strip("/").split("/") if part]

# --- Normalization (a byte-for-byte port of cf-worker/src/address.ts) ---------------

LETTER_MAP = str.maketrans({"ы": "и", "э": "е", "ё": "е", "ї": "і", "и": "і"})
PUNCT_RE = re.compile(r'[\[\]{}()<>,.;:"\'`«»/\\|!?*_+%$#@~^&=—–-]')
STREET_PREFIX_RE = re.compile(
    r"^(вулиця|вул|улица|ул|проспект|просп|провулок|пров|переулок|пер|село|с\.?)\s+", re.I
)
SETTLEMENT_PREFIX_RE = re.compile(r"^(м|місто|смт|с|село|селище)\.?\s+", re.I)
DISTRICT_PREFIX_RE = re.compile(r"^.*?р-н\s*,\s*", re.I)


def normalize_address(raw: str) -> str:
    value = str(raw or "").lower().translate(LETTER_MAP)
    value = PUNCT_RE.sub(" ", value)
    value = " ".join(value.split())
    value = STREET_PREFIX_RE.sub("", value)
    return value.strip()


def normalize_settlement(raw: str) -> str:
    value = str(raw or "").strip()
    value = SETTLEMENT_PREFIX_RE.sub("", value)
    return normalize_address(value)


def display_street(raw: str) -> str:
    """Назва вулиці без службового префікса району: `Київ, Подільський р-н, вул. Х` -> `вул. Х`.

    Worker нормалізує введений текст без відомостей про район, тому зберігати в `name` рядок із
    `р-н` не можна: людина обрала б чип, а `normalizeAddress(name)` не збігся б зі збереженим
    `normalized`.
    """
    value = str(raw or "").strip()
    cleaned = DISTRICT_PREFIX_RE.sub("", value).strip()
    return cleaned or value


def normalize_street(raw: str) -> str:
    value = DISTRICT_PREFIX_RE.sub("", str(raw or "").strip())
    return normalize_address(value)


def place_key(normalized: str) -> str:
    """`АТ ЧЕРНІГІВОБЛЕНЕРГО · БАТУРИН` and `м. Батурин` -> `батурін`."""
    return normalized.rsplit("·", 1)[-1].strip()


# --- Queue extraction ---------------------------------------------------------------

QUEUE_RE = re.compile(
    r"У вас\s*(?:<[^>]+>\s*)*(\d{1,2})\s*черга(?:\s*\(\s*(\d{1,2})\s*підгруп[аи]?\s*\))?",
    re.S | re.I,
)
# Київ нумерує не черги з підгрупами, а 60 груп просто числом. Справжня група будинку —
# `Ваша група <b>40</b>`; `kyivSelectedGroup` — лише вибір у cookie (типово 1), його брати не можна.
KYIV_USER_GROUP_RE = re.compile(
    r'kyiv-current-user-group[^>]*>\s*Ваша група\s*<b>\s*(\d{1,2})\s*</b>', re.S | re.I
)
GROUP_TEXT_RE = re.compile(r"Група\s*(?:<[^>]+>\s*)*(\d{1,2})", re.S)


def queue_code(base: str, subgroup: str | None = None) -> str | None:
    try:
        number = int(base)
        part = int(subgroup) if subgroup else None
    except (TypeError, ValueError):
        return None
    if not 1 <= number <= 12:
        return None
    if part is not None and not 1 <= part <= 9:
        return None
    return f"{number}/{part}" if part else str(number)


def kyiv_group_code(raw: str) -> str | None:
    """Київська група 1..60. Окрема від `queue_code`, бо там межа 12 черг."""
    try:
        number = int(raw)
    except (TypeError, ValueError):
        return None
    return str(number) if 1 <= number <= 60 else None


def extract_queue(page: str, allow_group_text: bool = True) -> str | None:
    """Точна група зі сторінки.

    На київських сторінках шукаємо лише `Ваша група`: `Група 1` поруч — це вибір у cookie, і
    саме через нього весь Київ раніше отримував групу 1 замість власної (наприклад 40).
    """
    match = QUEUE_RE.search(page)
    if match:
        return queue_code(match.group(1), match.group(2))
    match = KYIV_USER_GROUP_RE.search(page)
    if match:
        return kyiv_group_code(match.group(1))
    if not allow_group_text:
        return None
    match = GROUP_TEXT_RE.search(page)
    if match:
        return queue_code(match.group(1))
    return None


# --- Data model ---------------------------------------------------------------------

@dataclass
class HouseLink:
    label: str
    path: str


@dataclass
class StreetLink:
    name: str
    path: str


@dataclass
class StreetPage:
    name: str
    path: str
    houses: list[HouseLink] = field(default_factory=list)
    queue: str | None = None
    error: str | None = None


@dataclass
class StreetRow:
    region: str
    settlement: str
    settlement_normalized: str
    street: str
    street_normalized: str
    houses: dict[str, str | None]
    default_queue: str | None
    source: str = "energy-ua"
    updated_at: str = field(default_factory=now_iso)

    def key(self) -> tuple[str, str, str]:
        return (self.region, self.settlement_normalized, self.street_normalized)

    def as_json(self) -> dict[str, Any]:
        queues = sorted({value for value in self.houses.values() if value})
        if self.default_queue:
            queues = sorted(set(queues) | {self.default_queue})
        return {
            "region": self.region,
            "settlement": self.settlement,
            "settlementNormalized": self.settlement_normalized,
            "street": self.street,
            "streetNormalized": self.street_normalized,
            "houses": self.houses,
            "defaultQueue": self.default_queue,
            "queues": queues,
            "source": self.source,
            "updatedAt": self.updated_at,
        }


def parse_settlement_links(root: str) -> list[tuple[str, str]]:
    result: dict[str, str] = {}
    for href, label in anchors(root):
        parts = route_parts(href, "/select/")
        if parts and len(parts) == 1:
            result.setdefault(href, label)
    return sorted(((label, href) for href, label in result.items()),
                  key=lambda item: item[0].casefold())


def official_settlement_names(region: str) -> set[str]:
    """Official KATOTTG crosswalk prevents importing hromadas/REM labels as settlements."""
    region_name = KATOTTG_REGION_NAMES.get(region)
    if not region_name:
        return set()
    if not KATOTTG_CACHE.exists():
        KATOTTG_CACHE.parent.mkdir(parents=True, exist_ok=True)
        request = urllib.request.Request(KATOTTG_SOURCE, headers={"User-Agent": "svitlo-address-catalog/1.0"})
        with urllib.request.urlopen(request, timeout=120) as response, KATOTTG_CACHE.open("wb") as output:
            output.write(response.read())
    with KATOTTG_CACHE.open(encoding="utf-8", newline="") as stream:
        rows = list(csv.DictReader(stream))
    region_row = next(
        (row for row in rows if row.get("level") == "1" and normalize_address(row.get("name", "")) == normalize_address(region_name)),
        None,
    )
    if region_row is None:
        return set()
    if region == "kyiv-city":
        return {normalize_settlement(region_row.get("name", "Київ"))}
    region_code = region_row.get("code")
    return {
        normalize_settlement(row.get("name", ""))
        for row in rows
        if row.get("region_code") == region_code
        and row.get("category_name") in {"місто", "село", "селище"}
        and row.get("name")
    }


def is_real_settlement_label(label: str, official_names: set[str]) -> bool:
    """Keep only actual populated places, never territorial communities or utility districts."""
    if re.search(r"\b(?:тг|громада|територіальна громада|дільниця|обленерго|рем)\b", label, re.I):
        return False
    base = label.rsplit("·", 1)[-1].strip()
    return normalize_settlement(base) in official_names


def parse_street_links(page: str) -> list[StreetLink]:
    result: dict[str, StreetLink] = {}
    for href, label in anchors(page):
        parts = route_parts(href, "/select/")
        if parts and len(parts) == 2:
            result.setdefault(href, StreetLink(name=label, path=href))
    return list(result.values())


def parse_house_links(page: str) -> list[HouseLink]:
    result: dict[str, HouseLink] = {}
    for href, label in anchors(page):
        parts = route_parts(href, "/grafik/")
        if parts and len(parts) == 3:
            result.setdefault(href, HouseLink(label=label, path=href))
    return list(result.values())

# --- Crawling -----------------------------------------------------------------------

def chunks(items: list[Any], size: int) -> Iterable[list[Any]]:
    for index in range(0, len(items), size):
        yield items[index:index + size]


def load_settlement(host: str, item: tuple[str, str]) -> tuple[str, str, list[StreetLink], str | None, str | None]:
    name, path = item
    url = f"https://{host}{path}"
    page = fetch_text(url)
    if page is None:
        return name, path, [], None, "HTTP 404"
    streets = parse_street_links(page)
    return name, path, streets, extract_queue(page, allow_group_text=not host.startswith("kyiv.")) if not streets else None, None


def load_street(host: str, street: StreetLink) -> StreetPage:
    url = f"https://{host}{street.path}"
    try:
        page = fetch_text(url)
    except Exception as error:  # noqa: BLE001
        return StreetPage(name=street.name, path=street.path, error=str(error))
    if page is None:
        return StreetPage(name=street.name, path=street.path, error="HTTP 404")
    houses = parse_house_links(page)
    return StreetPage(
        name=street.name, path=street.path, houses=houses,
        queue=extract_queue(page, allow_group_text=not host.startswith("kyiv.")) if not houses else None,
    )


def load_house_queue(host: str, house: HouseLink, range_bytes: int = 4200) -> tuple[str, str | None]:
    url = f"https://{host}{house.path}"
    page = fetch_text(url, byte_range=range_bytes) or ""
    allow_text = not host.startswith("kyiv.")
    queue = extract_queue(page, allow_group_text=allow_text)
    if queue is None and len(page) <= range_bytes + 200:
        # The marker can sit slightly below the requested window on long breadcrumbs.
        page = fetch_text(url) or ""
        queue = extract_queue(page, allow_group_text=allow_text)
    return house.path, queue


def compress_houses(houses: dict[str, str | None]) -> dict[str, str | None]:
    """Collapse consecutive numeric houses with one group into `1-5` ranges.

    Letters and non-numeric labels stay exact. Ranges are expanded again by the worker.
    """
    numeric: dict[int, str] = {}
    exact: dict[str, str | None] = {}
    for label, queue in houses.items():
        text = str(label or "").strip()
        if re.fullmatch(r"\d{1,5}", text):
            numeric[int(text)] = queue
        else:
            exact[text] = queue

    while numeric:
        start = min(numeric)
        queue = numeric.pop(start)
        end = start
        while end + 1 in numeric and numeric[end + 1] == queue:
            end += 1
            numeric.pop(end)
        key = str(start) if start == end else f"{start}-{end}"
        if key not in exact:
            exact[key] = queue
    return exact


def crawl_region(
    region: str,
    workers: int,
    limit_settlements: int,
    limit_streets: int,
    resume: bool,
    merge_pdf: bool,
    shard_index: int = 0,
    shard_count: int = 1,
    output_suffix: str = "",
) -> Path:
    host = REGION_HOSTS[region]
    CACHE.mkdir(parents=True, exist_ok=True)
    rows_path = CACHE / f"{region}{output_suffix}.streets.jsonl"
    existing: dict[tuple[str, str, str], dict[str, Any]] = {}
    if resume and rows_path.exists():
        for line in rows_path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            row = json.loads(line)
            existing[(row["region"], row["settlementNormalized"], row["streetNormalized"])] = row

    root = fetch_text(f"https://{host}/")
    if root is None:
        raise SystemExit(f"{region}: root page is 404 on {host}")
    root_settlements = parse_settlement_links(root)
    official_names = official_settlement_names(region)
    if not official_names:
        raise SystemExit(f"{region}: KATOTTG crosswalk unavailable; refusing unvalidated settlement labels")
    settlements = [
        item for item in root_settlements
        if is_real_settlement_label(item[0], official_names)
    ]
    rejected = len(root_settlements) - len(settlements)
    print(
        f"{region}: validated {len(settlements)}/{len(root_settlements)} root links against KATOTTG "
        f"({rejected} administrative/unknown labels excluded)",
        flush=True,
    )
    if not settlements:
        raise SystemExit(f"{region}: no root link matched official KATOTTG settlements")

    if region in ("kyiv-city", "kyivska-oblast"):
        is_city = region == "kyiv-city"
        settlements = [
            item for item in settlements
            if (normalize_settlement(item[0]) == "кіів") == is_city
        ]
        if is_city and not settlements:
            settlements = [("Київ", "/select/%D0%9A%D0%B8%D1%97%D0%B2")]

    # Large regions are crawled by several processes: each takes its own modulo slice of
    # settlements, so house requests never overlap. Shards write separate JSONL files that are
    # concatenated before build_sql(), otherwise streets_count would only count one shard.
    if shard_count > 1:
        settlements = [item for index, item in enumerate(settlements) if index % shard_count == shard_index]

    if limit_settlements:
        settlements = settlements[:limit_settlements]
    label = f"{region}{output_suffix}"
    print(f"{label}: {len(settlements)} settlements on {host}", flush=True)

    # Settlement pages, in parallel: each is a list of street links.
    settlement_rows: list[tuple[str, str, list[StreetLink], str | None, str | None]] = []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(load_settlement, host, item) for item in settlements]
        for future in as_completed(futures):
            settlement_rows.append(future.result())

    street_tasks: list[tuple[str, str, list[StreetLink], str | None]] = []
    for name, _path, streets, queue, error in settlement_rows:
        if error:
            print(f"{label}: settlement {name}: {error}", file=sys.stderr, flush=True)
        if limit_streets:
            streets = streets[:limit_streets]
        street_tasks.append((name, normalize_settlement(name), streets, queue))

    # Skip streets already present in the resume file.
    todo: list[tuple[str, str, StreetLink]] = []
    for name, norm, streets, _queue in street_tasks:
        for street in streets:
            if (region, norm, normalize_street(street.name)) in existing:
                continue
            todo.append((name, norm, street))
    print(f"{label}: {len(todo)} street pages to fetch", flush=True)

    todo_by_path = {street.path: (name, norm, street) for name, norm, street in todo}
    street_pages: dict[str, tuple[str, str, StreetPage]] = {}
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(load_street, host, street) for _name, _norm, street in todo]
        for future in as_completed(futures):
            page = future.result()
            name, norm, _street = todo_by_path[page.path]
            street_pages[page.path] = (name, norm, page)
    print(f"{label}: fetched {len(street_pages)} street pages", flush=True)

    # House queues, batched to keep the future list bounded.
    house_tasks: list[tuple[str, str, str, HouseLink]] = []
    for path, (name, norm, page) in street_pages.items():
        for house in page.houses:
            house_tasks.append((name, norm, path, house))
    queues: dict[tuple[str, str], str | None] = {}
    range_bytes = 4200
    for batch in chunks(house_tasks, 6000):
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {
                pool.submit(load_house_queue, host, house, range_bytes): (name, norm, page_path)
                for name, norm, page_path, house in batch
            }
            for future in as_completed(futures):
                house_path, queue = future.result()
                _name, _norm, page_path = futures[future]
                queues[(page_path, house_path)] = queue
        print(f"{label}: house queues {len(queues)}/{len(house_tasks)}", flush=True)

    rows: list[StreetRow] = []
    for path, (name, norm, page) in street_pages.items():
        houses = {
            house.label: queues.get((path, house.path))
            for house in page.houses if house.label.strip()
        }
        distinct = {queue for queue in houses.values() if queue}
        # NULL means unknown/conflicting. Do not infer a whole-street queue from only the houses
        # whose exact pages happened to return a value.
        default = next(iter(distinct)) if houses and all(houses.values()) and len(distinct) == 1 else None
        if not houses and page.queue:
            default = page.queue
        if not houses and not default:
            # Keep the street visible even when the source has no house links.
            default = None
        street_name = display_street(page.name)
        row = StreetRow(
            region=region,
            settlement=name,
            settlement_normalized=norm,
            street=street_name,
            street_normalized=normalize_street(street_name),
            houses=compress_houses(houses),
            default_queue=default,
        )
        rows.append(row)

    # Settlements without streets still deserve a row: the cascade can show the place,
    # and a settlement-level queue is a real answer when the source publishes one.
    covered_settlements = {row.settlement_normalized for row in rows}
    for name, norm, streets, queue in street_tasks:
        if streets or norm in covered_settlements:
            continue
        rows.append(StreetRow(
            region=region, settlement=name, settlement_normalized=norm,
            street="", street_normalized="", houses={}, default_queue=queue,
        ))

    if merge_pdf and region == "chernihivska-oblast":
        rows = merge_chernihiv_pdf(region, rows)
        print(f"{label}: merged PDF, {len(rows)} street rows", flush=True)

    # Rewrite the region file atomically: the old rows are already in `existing`.
    tmp = rows_path.with_suffix(".jsonl.tmp")
    with tmp.open("w", encoding="utf-8") as stream:
        seen: set[tuple[str, str, str]] = set()
        for row in rows:
            key = row.key()
            if key in seen:
                continue
            seen.add(key)
            stream.write(json.dumps(row.as_json(), ensure_ascii=False) + "\n")
        for key, row in existing.items():
            if key not in seen:
                stream.write(json.dumps(row, ensure_ascii=False) + "\n")
    tmp.replace(rows_path)
    print(f"{label}: wrote {len(rows) + len(existing)} rows -> {rows_path}", flush=True)
    return rows_path

# --- Chernihiv PDF fallback ---------------------------------------------------------

def display_pdf_settlement(raw: str) -> str:
    part = str(raw or "").rsplit("·", 1)[-1].strip()
    return part.title() if part else str(raw or "").strip()


def merge_chernihiv_pdf(region: str, rows: list[StreetRow]) -> list[StreetRow]:
    """Merge the operator PDF dump, with live Energy-UA data always winning.

    The PDF is dated 25.12.2025 and is used only to fill houses/streets that the live
    hierarchy does not expose. A live queue for the same house is never overwritten.
    """
    if not CHERNIHIV_PDF.exists():
        print(f"{region}: PDF dump missing, skipping merge", file=sys.stderr, flush=True)
        return rows
    payload = json.loads(CHERNIHIV_PDF.read_text(encoding="utf-8"))
    house_rows = payload.get("houseRows") or payload.get("rows") or []

    live_by_key = {(row.settlement_normalized, row.street_normalized): row for row in rows}
    live_by_place = {place_key(row.settlement_normalized): row.settlement_normalized for row in rows}
    live_name_by_norm = {row.settlement_normalized: row.settlement for row in rows}

    grouped: dict[tuple[str, str], dict[str, Any]] = {}
    for item in house_rows:
        raw_settlement = str(item.get("settlement") or "")
        raw_street = str(item.get("street") or "")
        if not raw_settlement or not raw_street:
            continue
        pdf_settlement_norm = normalize_settlement(raw_settlement)
        match_norm = live_by_place.get(place_key(pdf_settlement_norm))
        settlement_norm = match_norm or pdf_settlement_norm
        settlement_name = live_name_by_norm.get(settlement_norm) or display_pdf_settlement(raw_settlement)
        street_norm = normalize_street(raw_street)
        if not street_norm:
            continue
        key = (settlement_norm, street_norm)
        bucket = grouped.setdefault(key, {
            "settlement": settlement_name,
            "street": raw_street.strip(),
            "houses": {},
            "queues": set(),
        })
        pattern = str(item.get("housePattern") or item.get("houseNormalized") or "").strip()
        queue = item.get("queue")
        if pattern:
            bucket["houses"][pattern] = queue
        if queue:
            bucket["queues"].add(queue)

    added = 0
    merged = 0
    for (settlement_norm, street_norm), bucket in grouped.items():
        existing = live_by_key.get((settlement_norm, street_norm))
        if existing:
            before = len(existing.houses)
            merged_houses = dict(bucket["houses"])
            # Keep an exact live value when present; a failed/ambiguous page must not erase the
            # PDF's last-known value with `null`. Conflicting non-null sources remain live-owned.
            merged_houses.update({key: value for key, value in existing.houses.items() if value})
            existing.houses = merged_houses
            if existing.houses and all(existing.houses.values()):
                distinct_live = set(existing.houses.values())
                if len(distinct_live) == 1:
                    existing.default_queue = next(iter(distinct_live))
            if len(existing.houses) > before:
                merged += 1
            continue
        distinct = bucket["queues"]
        row = StreetRow(
            region=region,
            settlement=bucket["settlement"],
            settlement_normalized=settlement_norm,
            street=display_street(bucket["street"]),
            street_normalized=street_norm,
            houses=compress_houses(bucket["houses"]),
            default_queue=(
                next(iter(distinct))
                if bucket["houses"] and all(bucket["houses"].values()) and len(distinct) == 1
                else None
            ),
            source="chernihivoblenergo-pdf",
            updated_at=payload.get("documentDate") or now_iso(),
        )
        rows.append(row)
        live_by_key[(settlement_norm, street_norm)] = row
        added += 1

    print(f"{region}: PDF added {added} streets, filled houses on {merged} live streets", flush=True)
    return rows


# --- SQL ----------------------------------------------------------------------------

def sql_literal(value: Any) -> str:
    if value is None:
        return "NULL"
    return "'" + str(value).replace("'", "''") + "'"


def build_sql(region: str, rows_path: Path, output: Path) -> Path:
    records = [json.loads(line) for line in rows_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    settlements: dict[str, dict[str, Any]] = {}
    for row in records:
        key = row["settlementNormalized"]
        bucket = settlements.setdefault(key, {
            "name": row["settlement"],
            "streets": 0,
            "queues": set(),
            "default": set(),
            "settlementDefault": set(),
        })
        if row.get("street"):
            bucket["streets"] += 1
        for queue in (row.get("houses") or {}).values():
            if queue:
                bucket["queues"].add(queue)
        if row.get("defaultQueue"):
            bucket["queues"].add(row["defaultQueue"])
            if row.get("street"):
                bucket["default"].add(row["defaultQueue"])
                bucket["defaultCount"] = bucket.get("defaultCount", 0) + 1
            else:
                bucket["settlementDefault"].add(row["defaultQueue"])

    lines = [
        "-- Generated by tools/scrapling_addresses_sync.py",
        f"-- region: {region}",
        f"-- rows: {len(records)}",
        "",
    ]
    for norm, bucket in sorted(settlements.items()):
        street_count = bucket["streets"]
        street_defaults = bucket["default"]
        if street_count:
            default = (
                next(iter(street_defaults))
                if len(street_defaults) == 1 and bucket.get("defaultCount", 0) == street_count
                else None
            )
        else:
            settlement_defaults = bucket.get("settlementDefault", set())
            default = next(iter(settlement_defaults)) if len(settlement_defaults) == 1 else None
        queues_json = json.dumps(sorted(bucket["queues"]), ensure_ascii=False, separators=(",", ":"))
        lines.append(
            "INSERT INTO directory_settlements "
            "(region, name, normalized, source, default_queue, queues_json, streets_count) VALUES ("
            f"{sql_literal(region)}, {sql_literal(bucket['name'])}, {sql_literal(norm)}, "
            f"'energy-ua', {sql_literal(default)}, {sql_literal(queues_json)}, {bucket['streets']}"
            ") ON CONFLICT(region, normalized) DO UPDATE SET "
            "name=excluded.name, source=excluded.source, default_queue=excluded.default_queue, "
            "queues_json=excluded.queues_json, streets_count=excluded.streets_count;"
        )

    for row in records:
        # У старих JSONL назва могла містити `р-н`; SQL будуємо з чистої назви, щоб `name`
        # і `normalized` завжди нормалізувалися в один рядок.
        street = display_street(row.get("street") or "")
        if not street:
            continue
        street_normalized = normalize_street(street)
        houses = row.get("houses") or {}
        houses_json = json.dumps(houses, ensure_ascii=False, separators=(",", ":")) if houses else None
        lines.append(
            "INSERT INTO directory_streets "
            "(region, settlement_normalized, name, normalized, source, settlement_name, default_queue, houses_json) VALUES ("
            f"{sql_literal(region)}, {sql_literal(row['settlementNormalized'])}, {sql_literal(street)}, "
            f"{sql_literal(street_normalized)}, {sql_literal(row.get('source') or 'energy-ua')}, "
            f"{sql_literal(row['settlement'])}, {sql_literal(row.get('defaultQueue'))}, {sql_literal(houses_json)}"
            ") ON CONFLICT(region, settlement_normalized, normalized) DO UPDATE SET "
            "name=excluded.name, settlement_name=excluded.settlement_name, source=excluded.source, "
            "default_queue=excluded.default_queue, houses_json=excluded.houses_json;"
        )

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"{region}: SQL {len(lines) - 3} statements, {output.stat().st_size / 1024:.0f} KB -> {output}", flush=True)
    return output


# --- Entry point --------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--regions", default=",".join(PRIORITY),
                        help="comma-separated CPU codes, or 'all'")
    parser.add_argument("--workers", type=int, default=18)
    parser.add_argument("--limit-settlements", type=int, default=0)
    parser.add_argument("--limit-streets", type=int, default=0)
    parser.add_argument("--no-resume", action="store_true")
    parser.add_argument("--no-pdf", action="store_true")
    parser.add_argument("--sql", action="store_true")
    parser.add_argument("--shard-index", type=int, default=0,
                        help="zero-based slice index for parallel region crawling")
    parser.add_argument("--shard-count", type=int, default=1,
                        help="number of parallel slices; 1 disables sharding")
    parser.add_argument("--output-suffix", default="",
                        help="suffix for .streets.jsonl/.sql, e.g. '.shard0'")
    args = parser.parse_args()

    regions = list(REGION_HOSTS) if args.regions == "all" else [
        part.strip() for part in args.regions.split(",") if part.strip()
    ]
    unknown = [region for region in regions if region not in REGION_HOSTS]
    if unknown:
        raise SystemExit(f"unknown regions: {', '.join(unknown)}")

    for region in regions:
        rows_path = crawl_region(
            region=region,
            workers=max(1, args.workers),
            limit_settlements=args.limit_settlements,
            limit_streets=args.limit_streets,
            resume=not args.no_resume,
            merge_pdf=not args.no_pdf,
            shard_index=args.shard_index,
            shard_count=args.shard_count,
            output_suffix=args.output_suffix,
        )
        if args.sql:
            build_sql(region, rows_path, CACHE / f"addresses-{region}{args.output_suffix}.sql")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
