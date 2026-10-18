#!/usr/bin/env python3
"""Audit and crawl public Energy-UA regional address catalogs.

The pages expose a three-step public hierarchy:
  /select/<settlement> -> /select/<settlement>/<street> -> /grafik/<settlement>/<street>/<house>

Use Scrapling's HTTP fetcher with browser TLS/header impersonation. This avoids launching a
browser for the static server-rendered catalog pages and handles the site's ordinary 403 to
urllib/curl clients. The crawler is read-only and writes reviewable JSON/JSONL snapshots only.

Install in an isolated environment:
  python3 -m venv .cache/scrapling-venv
  .cache/scrapling-venv/bin/pip install 'scrapling[fetchers]'

Audit every linked region:
  .cache/scrapling-venv/bin/python tools/energy_ua_catalog.py audit \
    --output .cache/energy-ua/audit.json

Bounded crawl (supply a host and a small settlement limit for review):
  .cache/scrapling-venv/bin/python tools/energy_ua_catalog.py crawl \
    --host chernigiv.energy-ua.info --region chernihivska-oblast \
    --limit-settlements 10 --max-house-pages 500 \
    --output .cache/energy-ua/chernihiv.jsonl

No database writes are performed. A queue is emitted only when the exact house page states it.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urljoin, urlparse

ROOT_HOST = "energy-ua.info"
REGION_HOSTS: dict[str, tuple[str, ...]] = {
    "energy-ua.info": ("poltavska-oblast",),
    "kharkiv.energy-ua.info": ("kharkivska-oblast",),
    "lviv.energy-ua.info": ("lvivska-oblast",),
    "zap.energy-ua.info": ("zaporizka-oblast",),
    "zakarpat.energy-ua.info": ("zakarpatska-oblast",),
    "ternopil.energy-ua.info": ("ternopilska-oblast",),
    "khmel.energy-ua.info": ("khmelnytska-oblast",),
    "chernivtsi.energy-ua.info": ("chernivetska-oblast",),
    "kyiv.energy-ua.info": ("kyiv-city", "kyivska-oblast"),
    "sumy.energy-ua.info": ("sumska-oblast",),
    "rivne.energy-ua.info": ("rivnenska-oblast",),
    "zhytomyr.energy-ua.info": ("zhytomyrska-oblast",),
    "dnipro.energy-ua.info": ("dnipropetrovska-oblast",),
    "prykarpattya.energy-ua.info": ("ivano-frankivska-oblast",),
    "krop.energy-ua.info": ("kirovohradska-oblast",),
    "chernigiv.energy-ua.info": ("chernihivska-oblast",),
}

# All 25 regions in the product catalog. Absence from the linked-host set is a discovery gap,
# not proof that no unlinked subdomain or other Energy-UA source exists.
ALL_REGIONS = {
    "vinnytska-oblast", "volynska-oblast", "dnipropetrovska-oblast", "donetska-oblast",
    "zhytomyrska-oblast", "zakarpatska-oblast", "zaporizka-oblast",
    "ivano-frankivska-oblast", "kyiv-city", "kyivska-oblast", "kirovohradska-oblast",
    "luhanska-oblast", "lvivska-oblast", "mykolaivska-oblast", "odeska-oblast",
    "poltavska-oblast", "rivnenska-oblast", "sumska-oblast", "ternopilska-oblast",
    "kharkivska-oblast", "khersonska-oblast", "khmelnytska-oblast", "cherkaska-oblast",
    "chernivetska-oblast", "chernihivska-oblast",
}

# The repository GeoNames snapshot stores oblast identifiers as stable 01..27 codes.
GEONAMES_OBLAST_CODES = {
    "cherkaska-oblast": "01", "chernihivska-oblast": "02", "chernivetska-oblast": "03",
    "dnipropetrovska-oblast": "04", "donetska-oblast": "05", "ivano-frankivska-oblast": "06",
    "kharkivska-oblast": "07", "khersonska-oblast": "08", "khmelnytska-oblast": "09",
    "kirovohradska-oblast": "10", "kyiv-city": "12", "kyivska-oblast": "13",
    "luhanska-oblast": "14", "lvivska-oblast": "15", "mykolaivska-oblast": "16",
    "odeska-oblast": "17", "poltavska-oblast": "18", "rivnenska-oblast": "19",
    "sumska-oblast": "21", "ternopilska-oblast": "22", "vinnytska-oblast": "23",
    "volynska-oblast": "24", "zakarpatska-oblast": "25", "zaporizka-oblast": "26",
    "zhytomyrska-oblast": "27",
}

QUEUE_PATTERNS = (
    re.compile(r"(?:у вас\s*)?(\d{1,2})\s*(?:черга|група)\s*(?:\(\s*(\d)\s*підгруп[а-я]*\s*\))?", re.I),
    re.compile(r"(?:група|черга)\s*(\d{1,2})[./-](\d)", re.I),
)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def clean_label(value: str) -> str:
    return " ".join(unquote(value.replace("+", " ")).split()).strip()


def canonical_host(value: str) -> str:
    host = urlparse(value if "://" in value else f"https://{value}").hostname or ""
    return host.lower().removeprefix("www.")


def get_fetcher():
    try:
        from scrapling.fetchers import Fetcher
    except ImportError as error:
        raise SystemExit("Install Scrapling: pip install 'scrapling[fetchers]'") from error
    return Fetcher


def fetch(url: str, timeout: int = 40):
    """Fetch once with browser-like TLS and headers; never retry explicit 403/429 blocks."""
    response = get_fetcher().get(
        url,
        timeout=timeout,
        retries=1,
        stealthy_headers=True,
        impersonate="chrome",
    )
    if response.status in (403, 429):
        raise RuntimeError(f"source blocked with HTTP {response.status}: {url}")
    if response.status != 200:
        raise RuntimeError(f"HTTP {response.status}: {url}")
    return response


def local_links(page: Any, prefix: str) -> list[dict[str, str]]:
    links: dict[str, dict[str, str]] = {}
    for anchor in page.css(f'a[href^="{prefix}"]'):
        href = str(anchor.attrib.get("href", "")).strip()
        label = " ".join(anchor.text.split())
        if href and label and href not in links:
            links[href] = {"label": label, "path": href}
    return list(links.values())


def discover_regions() -> dict[str, dict[str, Any]]:
    landing = fetch(f"https://{ROOT_HOST}/")
    hosts: dict[str, dict[str, Any]] = {}
    for anchor in landing.css('a[href*="energy-ua.info"]'):
        href = str(anchor.attrib.get("href", "")).strip()
        host = canonical_host(href)
        if not host.endswith("energy-ua.info"):
            continue
        label = " ".join(anchor.text.split())
        cpus = REGION_HOSTS.get(host, ())
        hosts[host] = {"host": host, "label": label, "regions": list(cpus)}
    hosts[ROOT_HOST] = {
        "host": ROOT_HOST,
        "label": landing.css("title::text").get() or "",
        "regions": list(REGION_HOSTS[ROOT_HOST]),
        "root_page": landing,
    }
    return hosts


def extract_queue(text: str) -> tuple[str | None, str]:
    for pattern in QUEUE_PATTERNS:
        match = pattern.search(text)
        if match:
            base, subgroup = match.groups()
            queue = str(int(base)) + (f"/{subgroup}" if subgroup else "")
            return queue, "queue-observed"
    if re.search(r"(?:черга|підгрупа|група)\s*\d", text, re.I):
        return None, "queue-text-unparsed"
    return None, "queue-not-published"


def route_parts(path: str, prefix: str) -> list[str] | None:
    if not path.startswith(prefix):
        return None
    return [part for part in path[len(prefix):].strip("/").split("/") if part]


def page_links(page: Any, prefixes: tuple[str, ...]) -> list[dict[str, str]]:
    links: dict[str, dict[str, str]] = {}
    for prefix in prefixes:
        for link in local_links(page, prefix):
            links.setdefault(link["path"], link)
    return list(links.values())


def parse_locality_page(page: Any) -> dict[str, Any]:
    settlements = []
    for link in page_links(page, ("/select/", "/grafik/")):
        parts = route_parts(link["path"], "/select/") or route_parts(link["path"], "/grafik/")
        if parts and len(parts) == 1:
            settlements.append(link)
    return {"title": page.css("title::text").get() or "", "settlements": settlements}


def parse_street_page(page: Any) -> dict[str, Any]:
    streets = []
    for link in page_links(page, ("/select/", "/grafik/")):
        parts = route_parts(link["path"], "/select/") or route_parts(link["path"], "/grafik/")
        if parts and len(parts) == 2:
            streets.append(link)
    return {"title": page.css("title::text").get() or "", "streets": streets}


def parse_house_page(page: Any) -> dict[str, Any]:
    houses = []
    for link in local_links(page, "/grafik/"):
        parts = route_parts(link["path"], "/grafik/")
        if parts and len(parts) == 3:
            houses.append({"label": link["label"], "path": link["path"]})
    return {"title": page.css("title::text").get() or "", "houses": houses}


def comparable_place_name(value: str) -> str:
    """Loose locality-name key for coverage indicators only, never for assigning an address."""
    value = unicodedata.normalize("NFKC", clean_label(value)).casefold()
    value = re.sub(r"\s*\([^)]*\)\s*$", "", value)
    value = re.sub(r"^(?:село|селище|місто|смт\.?|с\.?|м\.?)\s*", "", value)
    return "".join(char for char in value if char.isalnum())


def geonames_baseline() -> tuple[dict[str, set[str]], dict[str, int]]:
    path = Path("cf-worker/src/settlements-ua.json")
    if not path.exists():
        return {}, {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        places = payload.get("places", [])
    except (OSError, json.JSONDecodeError):
        return {}, {}
    # The partial `regions` object has aliases/omissions and cannot be used as a
    # denominator for all 25 catalog regions.
    by_region: dict[str, set[str]] = {}
    counts: dict[str, int] = {}
    for host, cpus in REGION_HOSTS.items():
        names: set[str] = set()
        for cpu in cpus:
            codes = {GEONAMES_OBLAST_CODES[cpu]} if cpu in GEONAMES_OBLAST_CODES else set()
            names.update(comparable_place_name(str(row[0])) for row in places
                         if isinstance(row, list) and len(row) > 1 and row[1] in codes)
        if names:
            by_region[host] = names
            counts[host] = len(names)
    return by_region, counts


def audit(output: Path, samples_per_host: int) -> dict[str, Any]:
    hosts = discover_regions()
    baseline_names, baseline_counts = geonames_baseline()
    reports: list[dict[str, Any]] = []
    discovered_regions: set[str] = set()
    for host, host_info in sorted(hosts.items()):
        started = time.monotonic()
        try:
            root = host_info.pop("root_page", None) or fetch(f"https://{host}/")
            landing_info = parse_locality_page(root)
            settlements = landing_info["settlements"]
            energy_names = {comparable_place_name(item["label"]) for item in settlements}
            baseline = baseline_names.get(host, set())
            discovered_regions.update(host_info["regions"])
            page_report: dict[str, Any] = {
                **host_info,
                "status": "ok" if settlements else "empty-or-layout-changed",
                "http_status": root.status,
                "root_title": landing_info["title"],
                "settlement_count": len(settlements),
                "unique_settlement_labels": len({clean_label(item["label"]).casefold() for item in settlements}),
                "geonames_known_place_baseline": baseline_counts.get(host, 0),
                "geonames_name_matches": len(energy_names & baseline),
                "sampled": [],
            }
            if settlements:
                indices = sorted({round(i * (len(settlements) - 1) / max(samples_per_host - 1, 1))
                                  for i in range(min(samples_per_host, len(settlements)))})
                for index in indices:
                    item = settlements[index]
                    result = {"settlement": clean_label(item["label"]), "path": item["path"]}
                    try:
                        settlement_page = fetch(urljoin(f"https://{host}/", item["path"]))
                        street_info = parse_street_page(settlement_page)
                        result["street_count"] = len(street_info["streets"])
                        result["settlement_title"] = street_info["title"]
                        result["settlement_queue"], result["settlement_queue_status"] = extract_queue(
                            settlement_page.get_all_text()
                        )
                        page_report["tested_settlement_pages"] = page_report.get("tested_settlement_pages", 0) + 1
                        if result["settlement_queue"]:
                            page_report["settlement_level_queue_samples"] = page_report.get("settlement_level_queue_samples", 0) + 1
                        if street_info["streets"]:
                            page_report["sampled_localities_with_streets"] = page_report.get("sampled_localities_with_streets", 0) + 1
                            street = street_info["streets"][len(street_info["streets"]) // 2]
                            result["street_sample"] = clean_label(street["label"])
                            street_page = fetch(urljoin(f"https://{host}/", street["path"]))
                            house_info = parse_house_page(street_page)
                            result["house_count"] = len(house_info["houses"])
                            result["street_queue"], result["street_queue_status"] = extract_queue(
                                street_page.get_all_text()
                            )
                            page_report["tested_street_pages"] = page_report.get("tested_street_pages", 0) + 1
                            if result["street_queue"]:
                                page_report["street_level_queue_samples"] = page_report.get("street_level_queue_samples", 0) + 1
                            if house_info["houses"]:
                                page_report["sampled_streets_with_houses"] = page_report.get("sampled_streets_with_houses", 0) + 1
                                house = house_info["houses"][len(house_info["houses"]) // 2]
                                house_page = fetch(urljoin(f"https://{host}/", house["path"]))
                                queue, queue_status = extract_queue(house_page.get_all_text())
                                if queue:
                                    queue_status = "exact-house-page"
                                result["house_sample"] = house["label"]
                                result["sample_queue"] = queue
                                result["queue_status"] = queue_status
                                result["exact_page_title"] = house_page.css("title::text").get() or ""
                                page_report.setdefault("tested_house_pages", 0)
                                page_report["tested_house_pages"] += 1
                                if queue:
                                    page_report["queue_confirmed_samples"] = page_report.get("queue_confirmed_samples", 0) + 1
                    except Exception as error:  # noqa: BLE001 - keep region-level audit alive
                        result["sample_error"] = str(error)[:240]
                    page_report["sampled"].append(result)
            page_report["elapsed_seconds"] = round(time.monotonic() - started, 2)
            reports.append(page_report)
        except Exception as error:  # noqa: BLE001 - a blocked region must not hide others
            reports.append({**host_info, "status": "error", "error": str(error)[:300]})

    mapped = set().union(*(set(info["regions"]) for info in reports if info.get("regions")))
    try:
        all_places = json.loads(Path("cf-worker/src/settlements-ua.json").read_text(encoding="utf-8")).get("places", [])
    except (OSError, json.JSONDecodeError):
        all_places = []
    unlinked_baseline = {
        cpu: sum(1 for row in all_places if isinstance(row, list) and len(row) > 1
                 and row[1] == GEONAMES_OBLAST_CODES.get(cpu))
        for cpu in sorted(ALL_REGIONS - mapped)
    }
    summary = {
        "created_at": now_iso(),
        "method": "Scrapling Fetcher, browser TLS/header impersonation, server-rendered HTML",
        "root_discovered_hosts": len(hosts),
        "regions_with_linked_hosts": len(mapped),
        "regions_without_linked_hosts": sorted(ALL_REGIONS - mapped),
        "unlinked_regions_geonames_baseline": unlinked_baseline,
        "host_reports": reports,
        "limitations": [
            "A root-page locality count measures catalog entries, not all Ukrainian settlements.",
            "The root directory and sampled exact-house pages do not establish per-house completeness.",
            "Energy-UA is a secondary source; queue labels require independent operator verification before import.",
            "Kyiv and Kyiv oblast share one host; Dnipro covers a multi-DSO oblast and needs operator-level reconciliation.",
        ],
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: value for key, value in summary.items() if key != "host_reports"}, ensure_ascii=False, indent=2))
    for report in reports:
        print(f"{report.get('host')}: {report.get('status')} · {report.get('settlement_count', 0)} places · "
              f"streets {report.get('sampled_localities_with_streets', 0)}/{report.get('tested_settlement_pages', 0)} · "
              f"houses {report.get('sampled_streets_with_houses', 0)}/{report.get('tested_street_pages', 0)} · "
              f"queues {report.get('queue_confirmed_samples', 0)}/{report.get('tested_house_pages', 0)} · "
              f"GeoNames matches {report.get('geonames_name_matches', 0)}/{report.get('geonames_known_place_baseline', 0)}")
    return summary


def crawl(
    host: str,
    region: str,
    output: Path,
    limit_settlements: int,
    max_house_pages: int,
    delay: float,
) -> None:
    host = canonical_host(host)
    if host not in REGION_HOSTS:
        raise SystemExit(f"Unknown Energy-UA host mapping: {host}; add it to REGION_HOSTS after auditing its title")
    if region not in REGION_HOSTS[host]:
        raise SystemExit(f"Region {region} is not mapped to {host}: {REGION_HOSTS[host]}")
    root = fetch(f"https://{host}/")
    settlements = parse_locality_page(root)["settlements"]
    if limit_settlements > 0:
        settlements = settlements[:limit_settlements]
    output.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    stop = False
    with output.open("w", encoding="utf-8") as stream:
        for settlement in settlements:
            if max_house_pages > 0 and count >= max_house_pages:
                break
            settlement_name = clean_label(settlement["label"])
            try:
                street_page = fetch(urljoin(f"https://{host}/", settlement["path"]))
                streets = parse_street_page(street_page)["streets"]
            except Exception as error:  # noqa: BLE001
                print(f"skip settlement {settlement_name}: {error}", file=sys.stderr)
                continue
            time.sleep(max(0, delay))
            if not streets:
                queue, status = extract_queue(street_page.get_all_text())
                if queue:
                    row = {
                        "region": region,
                        "settlement": settlement_name,
                        "street": None,
                        "house": None,
                        "queue": queue,
                        "scope": "settlement",
                        "queue_status": "parsed",
                        "queue_evidence_scope": "settlement-page",
                        "source": "energy-ua",
                        "source_url": urljoin(f"https://{host}/", settlement["path"]),
                        "fetched_at": now_iso(),
                        "evidence_title": street_page.css("title::text").get() or "",
                    }
                    stream.write(json.dumps(row, ensure_ascii=False) + "\n")
                    stream.flush()
                    count += 1
                continue
            for street in streets:
                if max_house_pages > 0 and count >= max_house_pages:
                    stop = True
                    break
                street_name = clean_label(street["label"])
                try:
                    house_page = fetch(urljoin(f"https://{host}/", street["path"]))
                    houses = parse_house_page(house_page)["houses"]
                except Exception as error:  # noqa: BLE001
                    print(f"skip street {settlement_name}/{street_name}: {error}", file=sys.stderr)
                    continue
                time.sleep(max(0, delay))
                if not houses:
                    queue, status = extract_queue(house_page.get_all_text())
                    if queue:
                        row = {
                            "region": region,
                            "settlement": settlement_name,
                            "street": street_name,
                            "house": None,
                            "queue": queue,
                            "scope": "street",
                            "queue_status": "parsed",
                            "queue_evidence_scope": "street-page",
                            "source": "energy-ua",
                            "source_url": urljoin(f"https://{host}/", street["path"]),
                            "fetched_at": now_iso(),
                            "evidence_title": house_page.css("title::text").get() or "",
                        }
                        stream.write(json.dumps(row, ensure_ascii=False) + "\n")
                        stream.flush()
                        count += 1
                    continue
                for house in houses:
                    if max_house_pages > 0 and count >= max_house_pages:
                        stop = True
                        break
                    source_url = urljoin(f"https://{host}/", house["path"])
                    try:
                        exact_page = fetch(source_url)
                        queue, status = extract_queue(exact_page.get_all_text())
                        row = {
                            "region": region,
                            "settlement": settlement_name,
                            "settlement_path": settlement["path"],
                            "street": street_name,
                            "street_path": street["path"],
                            "house": clean_label(house["label"]),
                            "queue": queue,
                            "scope": "house",
                            "queue_status": "exact-house-page" if queue else status,
                            "queue_evidence_scope": "exact-house-page",
                            "source": "energy-ua",
                            "source_url": source_url,
                            "fetched_at": now_iso(),
                            "evidence_title": exact_page.css("title::text").get() or "",
                        }
                        stream.write(json.dumps(row, ensure_ascii=False) + "\n")
                        stream.flush()
                        count += 1
                    except Exception as error:  # noqa: BLE001
                        print(f"skip house {source_url}: {error}", file=sys.stderr)
                    time.sleep(max(0, delay))
                if stop:
                    break
            print(f"{host}: {settlement_name} — {len(streets)} streets; {count} houses exported", file=sys.stderr)
            if stop:
                break
    print(f"Exported {count} house pages to {output}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    audit_parser = subparsers.add_parser("audit", help="discover linked hosts and sample catalog depth")
    audit_parser.add_argument("--output", type=Path, default=Path(".cache/energy-ua/audit.json"))
    audit_parser.add_argument("--samples-per-host", type=int, default=3)
    crawl_parser = subparsers.add_parser("crawl", help="crawl exact house pages for bounded review")
    crawl_parser.add_argument("--host", required=True)
    crawl_parser.add_argument("--region", required=True)
    crawl_parser.add_argument("--output", type=Path, required=True)
    crawl_parser.add_argument("--limit-settlements", type=int, default=10)
    crawl_parser.add_argument("--max-house-pages", type=int, default=500,
                              help="hard cap on emitted rows; 0 means unlimited")
    crawl_parser.add_argument("--delay", type=float, default=0.4, help="polite delay between requests in seconds")
    args = parser.parse_args()
    if args.command == "audit":
        audit(args.output, max(1, args.samples_per_host))
    else:
        crawl(args.host, args.region, args.output, args.limit_settlements,
              args.max_house_pages, args.delay)


if __name__ == "__main__":
    main()
