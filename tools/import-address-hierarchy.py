#!/usr/bin/env python3
"""Extract address-to-queue rows from the public Chernihivoblenergo PDF.

This first-stage importer is deliberately read-only: it downloads (or accepts) a PDF,
extracts candidate rows, and writes a reviewable JSON snapshot. It does not modify a
database. PDF layout changes must be reviewed before the snapshot is loaded into Svitlo.

Install the optional parser with ``python3 -m pip install pdfplumber``.
"""

from __future__ import annotations

import argparse
import json
import re
import ssl
import sys
import unicodedata
import urllib.request
from collections import defaultdict
from pathlib import Path
from typing import Any

PDF_URL = "https://chernihivoblenergo.com.ua/files/other/Grafik_obmezhen.pdf"
REGION = "chernihivska-oblast"
SOURCE = "chernihivoblenergo-pdf"
QUEUE_RE = re.compile(r"^\d{1,2}/\d{1,2}$")
STREET_RE = re.compile(r"^(.+?):\s*(.*)$")

# Column boundaries from the current operator PDF. The address cell contains a street label
# and a house list; the colon separates those parts, and continuation lines have no colon.
QUEUE_END = 115.0
SETTLEMENT_START = 205.0
ADDRESS_START = 277.0


def normalize(value: str) -> str:
    replacements = {"ы": "и", "э": "е", "ё": "е", "ї": "і", "и": "і"}
    value = value.lower()
    value = "".join(replacements.get(char, char) for char in value)
    value = re.sub(r"[\[\]{}()<>,.;:\"'`«»/\\|!?*_+%$#@~^&=—–-]", " ", value)
    value = " ".join(value.split())
    value = re.sub(
        r"^(вулиця|вул|улица|ул|проспект|просп|провулок|пров|переулок|пер|село|с\.?)\s+",
        "",
        value,
    )
    return value.strip()


def normalize_house(value: str) -> str:
    """Match `normalizeHouseNumber` in cf-worker/src/address.ts for stable address keys."""
    homoglyphs = {
        "а": "a", "в": "b", "с": "c", "е": "e", "н": "h", "і": "i", "ї": "i",
        "к": "k", "м": "m", "о": "o", "р": "p", "т": "t", "х": "x", "у": "y",
    }
    value = "".join(homoglyphs.get(char, char) for char in unicodedata.normalize("NFKC", value).lower())
    value = re.sub(r"\s+", "", value).replace("-", "").replace("–", "").replace("—", "")
    value = re.sub(r"^(\d+)/([a-z])$", r"\1\2", value)
    return re.sub(r"[^0-9a-z/]", "", value)


def fetch_pdf(url: str, destination: Path, insecure_tls: bool = False) -> None:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "Svitlo public address catalog importer/1.0", "Accept": "application/pdf"},
    )
    context = ssl.create_default_context()
    if insecure_tls:
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
    with urllib.request.urlopen(request, timeout=90, context=context) as response:
        payload = response.read()
    if not payload.startswith(b"%PDF-"):
        raise ValueError("The source response is not a PDF document")
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(payload)


def pdf_lines(page: Any) -> list[list[dict[str, Any]]]:
    words = page.extract_words(x_tolerance=2, y_tolerance=2, keep_blank_chars=False)
    lines: list[list[dict[str, Any]]] = []
    for word in sorted(words, key=lambda item: (item["top"], item["x0"])):
        if not lines or abs(word["top"] - lines[-1][0]["top"]) > 2.5:
            lines.append([word])
        else:
            lines[-1].append(word)
    return lines


def split_columns(words: list[dict[str, Any]]) -> dict[str, str]:
    columns: dict[str, list[str]] = defaultdict(list)
    for word in words:
        x = float(word["x0"])
        column = "queue" if x < QUEUE_END else "district" if x < SETTLEMENT_START else "settlement" if x < ADDRESS_START else "address"
        columns[column].append(str(word["text"]))
    return {key: " ".join(value).strip() for key, value in columns.items()}


def address_cell(words: list[dict[str, Any]]) -> str:
    """Build street + house text from the address column, including split overflow rows."""
    addresses = [word for word in words if float(word["x0"]) >= ADDRESS_START]
    if not addresses:
        return ""
    ordered = sorted(addresses, key=lambda item: float(item["x0"]))
    colon_index = next((index for index, word in enumerate(ordered) if ":" in str(word["text"])), None)
    if colon_index is None:
        return " ".join(str(word["text"]) for word in ordered).strip()
    street_words: list[str] = []
    house_words: list[str] = []
    for index, word in enumerate(ordered):
        text = str(word["text"])
        (street_words if index <= colon_index else house_words).append(text)
    street = " ".join(street_words).replace(":", "").strip()
    return f"{street}: {' '.join(house_words)}".strip()


def parse_house_list(value: str) -> list[str]:
    """Split the operator's comma-separated house cell without losing shorthand suffixes."""
    houses: list[str] = []
    for raw in re.split(r"[,;]", value.replace("\\", "/")):
        token = " ".join(raw.split()).strip(" .")
        if not token:
            continue
        # Operator notation such as ``5Б, В`` means 5Б and 5В.
        if re.fullmatch(r"[А-Яа-яІіЇїЄєҐґA-Za-z]{1,2}", token) and houses:
            previous = re.match(r"^(\d+)", houses[-1])
            if previous:
                houses.append(previous.group(1) + token)
                continue
        if re.search(r"\d", token):
            houses.append(token)
    return houses


def parse_pdf(path: Path, page_limit: int | None = None) -> dict[str, Any]:
    try:
        import pdfplumber
    except ImportError as error:
        raise SystemExit("Install the optional dependency: python3 -m pip install pdfplumber") from error

    records: dict[tuple[str, str, str, str], set[str]] = defaultdict(set)
    unresolved: list[dict[str, Any]] = []
    current_queue = ""
    current_settlement = ""
    current_street = ""
    current_street_queue = ""
    current_street_settlement = ""
    current_houses = ""
    pending_addresses: list[tuple[int, str]] = []
    page_count = 0
    document_date = None

    def add_address(queue: str, settlement: str, address_text: str) -> bool:
        match = STREET_RE.match(address_text)
        if not match or not queue or not settlement:
            return False
        street = match.group(1).strip()
        houses = parse_house_list(match.group(2))
        if not street or not houses:
            return False
        for house in houses:
            records[(queue, settlement, street, normalize(street))].add(house)
        return True

    with pdfplumber.open(path) as pdf:
        page_count = min(len(pdf.pages), page_limit) if page_limit else len(pdf.pages)
        first_page_text = pdf.pages[0].extract_text() or ""
        date_match = re.search(r"\b(?:з|від)\s+(\d{2}\.\d{2}\.\d{4})\b", first_page_text, re.IGNORECASE)
        document_date = date_match.group(1) if date_match else None
        for page_number, page in enumerate(pdf.pages[:page_count], start=1):
            for words in pdf_lines(page):
                columns = split_columns(words)
                queue_text = columns.get("queue", "")
                district_text = columns.get("district", "")
                settlement_text = columns.get("settlement", "")
                address_text = address_cell(words)

                queue_match = next((part for part in queue_text.split() if QUEUE_RE.fullmatch(part)), None)
                if queue_match:
                    current_queue = queue_match
                if district_text and district_text.strip().lower() != "дільниця":
                    current_district = district_text.strip()
                settlement_match = bool(
                    settlement_text
                    and "населений пункт" not in settlement_text.lower()
                    and re.search(r"[А-Яа-яІіЇїЄєҐґ]", settlement_text)
                    and settlement_text == settlement_text.upper()
                )
                if settlement_match:
                    current_settlement = settlement_text.strip()
                    if current_district:
                        current_settlement = f"{current_district} · {current_settlement}"

                # The first address in a page can sit a line above the queue/settlement cells
                # because those PDF cells span several rows. Hold it briefly and bind it once
                # the table context appears instead of dropping it or guessing.
                if pending_addresses and current_queue and current_settlement:
                    for _, pending in pending_addresses:
                        if not add_address(current_queue, current_settlement, pending):
                            unresolved.append({"page": page_number, "text": pending})
                    pending_addresses.clear()
                    current_street_queue = current_queue
                    current_street_settlement = current_settlement

                if not address_text or address_text.lower() == "адреси:":
                    continue
                street_match = STREET_RE.match(address_text)
                if street_match:
                    candidate_street = street_match.group(1).strip()
                    current_street = candidate_street
                    current_houses = street_match.group(2).strip()
                    if not current_queue or not current_settlement:
                        pending_addresses.append((page_number, address_text))
                        continue
                    current_street_queue = current_queue
                    current_street_settlement = current_settlement
                elif current_street:
                    current_houses = f"{current_houses} {address_text}".strip()
                    if pending_addresses and pending_addresses[-1][0] == page_number:
                        pending_addresses[-1] = (
                            page_number,
                            f"{pending_addresses[-1][1]} {address_text}".strip(),
                        )
                    if pending_addresses and (not current_queue or not current_settlement):
                        continue
                elif not current_queue or not current_settlement:
                    continue

                if not current_street_queue or not current_street_settlement or not current_street:
                    unresolved.append({"page": page_number, "text": address_text})
                    continue

                house_numbers = parse_house_list(current_houses)
                # Only commit a street row when it contains at least one concrete number/range.
                if not house_numbers:
                    unresolved.append({"page": page_number, "text": address_text})
                    continue
                for house in house_numbers:
                    records[(current_street_queue, current_street_settlement, current_street, normalize(current_street))].add(house.strip())

        for page_number, pending in pending_addresses:
            unresolved.append({"page": page_number, "text": pending})

    house_queues: dict[tuple[str, str, str], dict[str, set[str]]] = defaultdict(
        lambda: {"settlements": set(), "streets": set(), "labels": set(), "queues": set()}
    )
    for (queue, settlement, street, street_key), houses in records.items():
        settlement_key = normalize(settlement)
        for house in houses:
            entry = house_queues[(settlement_key, street_key, normalize_house(house))]
            entry["settlements"].add(settlement)
            entry["streets"].add(street)
            entry["labels"].add(house)
            entry["queues"].add(queue)

    house_rows = [
        {
            "region": REGION,
            "settlement": settlement,
            "settlementNormalized": settlement_key,
            "street": street,
            "streetNormalized": street_key,
            "housePattern": house,
            "houseNormalized": house_key,
            "queue": next(iter(queues)) if len(queues) == 1 else None,
            "source": SOURCE,
        }
        for (settlement_key, street_key, house_key), entry in sorted(house_queues.items())
        for settlement, street, house, queues in [
            (sorted(entry["settlements"])[0], sorted(entry["streets"])[0], sorted(entry["labels"])[0], entry["queues"])
        ]
    ]
    rows = [row for row in house_rows if row["queue"] is not None]
    conflicts = [row for row in house_rows if row["queue"] is None]
    return {
        "region": REGION,
        "source": SOURCE,
        "sourceUrl": PDF_URL,
        "documentDate": document_date,
        "pages": page_count,
        "rows": rows,
        "houseRows": house_rows,
        "conflicts": conflicts,
        "unresolved": unresolved,
    }


def sql_literal(value: str | None) -> str:
    if value is None:
        return "NULL"
    return "'" + str(value).replace("'", "''") + "'"


def build_sql(result: dict[str, Any]) -> str:
    """Fold house rows into compact directory rows with a `houses_json` map.

    D1 charges per row, so the PDF's 300k house records must become one row per street:
    the worker expands house patterns from JSON at request time. Two passes keep settlement
    counters honest: streets are counted once, not once per house.
    """
    region = result["region"]
    streets: dict[tuple[str, str], dict[str, Any]] = {}
    for row in result["rows"]:
        key = (row["settlementNormalized"], row["streetNormalized"])
        bucket = streets.setdefault(key, {
            "settlement": row["settlement"],
            "street": row["street"],
            "houses": {},
        })
        pattern = row["housePattern"]
        queue = row["queue"]
        previous = bucket["houses"].get(pattern)
        if previous is not None and queue is not None and previous != queue:
            # One PDF pattern resolved to two groups; keep the house visible but do not guess.
            bucket["houses"][pattern] = None
        elif pattern not in bucket["houses"]:
            bucket["houses"][pattern] = queue

    settlements: dict[str, dict[str, Any]] = {}
    for (settlement_norm, _street_norm), bucket in streets.items():
        queues = {queue for queue in bucket["houses"].values() if queue}
        entry = settlements.setdefault(settlement_norm, {
            "name": bucket["settlement"],
            "streets": 0,
            "queues": set(),
            "default": set(),
        })
        entry["streets"] += 1
        entry["queues"].update(queues)
        if len(queues) == 1 and None not in bucket["houses"].values():
            entry["default"].add(next(iter(queues)))

    lines = [
        "-- Generated by tools/import-address-hierarchy.py",
        f"-- region: {region}",
        f"-- streets: {len(streets)}",
        "",
    ]
    for settlement_norm, entry in sorted(settlements.items()):
        default = next(iter(entry["default"])) if len(entry["default"]) == 1 else None
        queues_json = json.dumps(sorted(entry["queues"]), ensure_ascii=False, separators=(",", ":"))
        lines.append(
            "INSERT INTO directory_settlements "
            "(region, name, normalized, source, default_queue, queues_json, streets_count) VALUES ("
            f"{sql_literal(region)}, {sql_literal(entry['name'])}, {sql_literal(settlement_norm)}, "
            f"{sql_literal(result['source'])}, {sql_literal(default)}, {sql_literal(queues_json)}, "
            f"{entry['streets']}"
            ") ON CONFLICT(region, normalized) DO UPDATE SET "
            "name=excluded.name, source=excluded.source, default_queue=excluded.default_queue, "
            "queues_json=excluded.queues_json, streets_count=excluded.streets_count;"
        )

    for (settlement_norm, street_norm), bucket in sorted(streets.items()):
        houses = {house: queue for house, queue in bucket["houses"].items() if queue}
        houses_json = json.dumps(houses, ensure_ascii=False, separators=(",", ":")) if houses else None
        queues = set(houses.values())
        default = next(iter(queues)) if len(queues) == 1 and len(houses) == len(bucket["houses"]) else None
        lines.append(
            "INSERT INTO directory_streets "
            "(region, settlement_normalized, name, normalized, source, settlement_name, "
            "default_queue, houses_json) VALUES ("
            f"{sql_literal(region)}, {sql_literal(settlement_norm)}, {sql_literal(bucket['street'])}, "
            f"{sql_literal(street_norm)}, {sql_literal(result['source'])}, "
            f"{sql_literal(bucket['settlement'])}, {sql_literal(default)}, {sql_literal(houses_json)}"
            ") ON CONFLICT(region, settlement_normalized, normalized) DO UPDATE SET "
            "name=excluded.name, settlement_name=excluded.settlement_name, source=excluded.source, "
            "default_queue=excluded.default_queue, houses_json=excluded.houses_json;"
        )

    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pdf", type=Path, help="Use an existing PDF instead of downloading")
    parser.add_argument("--json", type=Path, help="Write the review snapshot to this path")
    parser.add_argument("--sql", type=Path, help="Write compact directory INSERTs for D1")
    parser.add_argument("--url", default=PDF_URL, help="Override the public PDF URL")
    parser.add_argument("--pages", type=int, help="Parse only the first N pages for a quick review")
    parser.add_argument("--insecure-tls", action="store_true", help="Download despite an invalid source certificate")
    args = parser.parse_args()

    pdf_path = args.pdf or Path(".cache/address-hierarchy/chernihiv.pdf")
    try:
        if not args.pdf:
            if args.insecure_tls:
                print("Warning: downloading with TLS certificate verification disabled", file=sys.stderr)
            fetch_pdf(args.url, pdf_path, args.insecure_tls)
        result = parse_pdf(pdf_path, args.pages)
    except Exception as error:  # CLI boundary: show source failures clearly, keep traceback for debug.
        print(f"Import failed: {error}", file=sys.stderr)
        return 1

    output = json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n"
    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(output, encoding="utf-8")
    else:
        sys.stdout.write(output)
    if args.sql:
        args.sql.parent.mkdir(parents=True, exist_ok=True)
        args.sql.write_text(build_sql(result), encoding="utf-8")
        print(f"Wrote compact directory SQL to {args.sql}", file=sys.stderr)
    print(
        f"Parsed {result['pages']} pages; {len(result['rows'])} unambiguous address patterns; "
        f"{len(result['conflicts'])} ambiguous houses; "
        f"{len(result['unresolved'])} rows need review.",
        file=sys.stderr,
    )
    return 0 if result["rows"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
