#!/usr/bin/env python3
"""Собирает статические паки адресного справочника для Cloudflare Pages.

Источники — уже скачанные локальные выгрузки, а НЕ прод-D1:
  .cache/address-hierarchy/chernihiv-final.json  — дома Черниговщины (PDF-иерархия)
  .cache/address-ua/kyiv-city.streets.jsonl      — улицы/дома Киева (energy-ua)
  .cache/address-ua/kyivska-oblast.streets.jsonl — улицы/дома Киевщины (energy-ua)

Результат кладётся в apps/web/public/data/address/ и уезжает на Pages вместе с фронтендом.
Vite копирует public/ в dist, поэтому агенту не нужно ничего отдельно загружать.

Формат (version 2):
  manifest.json
  <region>/settlements.<hash>.json
  <region>/streets-<shard>.<hash>.json   — только названия улиц (кортежи без домов)
  <region>/houses-<0..15>.<hash>.json    — дома по 16 хеш-шардам улицы

Шард индекса улиц — первая буква нормализованного названия населённого пункта. Дома вынесены
в отдельный слой: автокомплит улиц не должен парсить десятки тысяч номеров домов, чтобы найти
одну улицу. Кортеж улицы: [name, normalized, defaultQueue, queues, housesShard].
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import re
import shutil
import sys
import unicodedata
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "apps/web/public/data/address"
CHERNIHIV = ROOT / ".cache/address-hierarchy/chernihiv-final.json"
KYIV_CITY = ROOT / ".cache/address-ua/kyiv-city.streets.jsonl"
KYIVSKA = ROOT / ".cache/address-ua/kyivska-oblast.streets.jsonl"
UKRAINIAN = set("абвгґдеєжзиіїйклмнопрстуфхцчшщьюя")

# Улица попадает в один из 16 шардов домов по стабильному FNV-1a от нормализованного ключа.
# Клиент не повторяет хеш: номер шарда лежит прямо в кортеже улицы.
HOUSE_SHARDS = 16


def house_shard(street_normalized: str) -> int:
    h = 2166136261
    for byte in street_normalized.encode("utf-8"):
        h ^= byte
        h = (h * 16777619) & 0xFFFFFFFF
    return h % HOUSE_SHARDS


def natural_key(value: str) -> list[Any]:
    """«1, 2, 10», а не «1, 10, 2»: порядок домов в шарде задаёт клиенту готовый список."""
    return [int(part) if part.isdigit() else part for part in re.split(r"(\d+)", value)]


def norm(value: Any) -> str:
    """Мягкая нормализация, если в источнике нет готового normalized-поля."""
    text = unicodedata.normalize("NFKC", str(value or "")).strip().lower()
    return " ".join(text.split())


def shard_key(settlement_normalized: str) -> str:
    first = (settlement_normalized or "")[:1]
    return first if first in UKRAINIAN else "other"


def write_pack(region: str, name: str, payload: dict[str, Any], count: int) -> dict[str, Any]:
    folder = OUT / region
    folder.mkdir(parents=True, exist_ok=True)
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")
    digest = hashlib.sha256(raw).hexdigest()[:12]
    filename = f"{name}.{digest}.json"
    (folder / filename).write_bytes(raw)
    return {
        "url": f"{region}/{filename}",
        "hash": digest,
        "count": count,
        "bytes": len(raw),
    }


def add_street(
    region: dict[str, Any],
    settlement: str,
    settlement_norm: str,
    street: str,
    street_norm: str,
    houses: dict[str, str | None],
    queues: list[str],
    default_queue: str | None,
) -> None:
    settlement_norm = settlement_norm or norm(settlement)
    street_norm = street_norm or norm(street)
    if not settlement_norm or not street_norm:
        return
    streets = region["streets"]
    entry = streets.setdefault(
        settlement_norm,
        {"name": settlement.strip(), "streets": {}},
    )
    if settlement.strip() and settlement.strip()[0].isupper():
        entry["name"] = settlement.strip()
    street_entry = entry["streets"].setdefault(
        street_norm,
        {
            "name": street.strip(),
            "normalized": street_norm,
            "defaultQueue": default_queue,
            "queues": sorted({q for q in queues if q}),
            "houses": {},
        },
    )
    if street.strip() and not street_entry["name"]:
        street_entry["name"] = street.strip()
    if default_queue and not street_entry["defaultQueue"]:
        street_entry["defaultQueue"] = default_queue
    street_entry["queues"] = sorted(set(street_entry["queues"]) | {q for q in queues if q})
    for pattern, queue in houses.items():
        key = str(pattern or "").strip()
        if not key:
            continue
        street_entry["houses"][key] = queue or None


def load_chernihiv() -> dict[str, Any]:
    data = json.loads(CHERNIHIV.read_text(encoding="utf-8"))
    region: dict[str, Any] = {"streets": {}}
    for row in data["rows"]:
        queue = row.get("queue") or None
        add_street(
            region,
            row.get("settlement", ""),
            row.get("settlementNormalized", ""),
            row.get("street", ""),
            row.get("streetNormalized", ""),
            {row.get("housePattern", ""): queue},
            [queue] if queue else [],
            queue,
        )
    return region


def load_jsonl(path: Path) -> dict[str, Any]:
    region: dict[str, Any] = {"streets": {}}
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            queues = [q for q in (row.get("queues") or []) if q]
            default_queue = row.get("defaultQueue") or (queues[0] if len(queues) == 1 else None)
            add_street(
                region,
                row.get("settlement", ""),
                row.get("settlementNormalized", ""),
                row.get("street", ""),
                row.get("streetNormalized", ""),
                row.get("houses") or {},
                queues,
                default_queue,
            )
    return region


def build_region(cpu: str, source: dict[str, Any]) -> dict[str, Any]:
    settlements: list[dict[str, Any]] = []
    shards: dict[str, dict[str, list[dict[str, Any]]]] = {}
    house_shards: dict[int, dict[str, list[list[str | None]]]] = {}

    for settlement_norm, entry in sorted(source["streets"].items()):
        streets = sorted(entry["streets"].values(), key=lambda item: item["normalized"])
        queues: set[str] = set()
        street_tuples: list[list[Any]] = []
        for street in streets:
            queues.update(street.get("queues") or [])
            if street.get("defaultQueue"):
                queues.add(street["defaultQueue"])
            houses = street.get("houses") or {}
            shard = house_shard(street["normalized"]) if houses else None
            if shard is not None:
                key = f"{settlement_norm}|{street['normalized']}"
                house_shards.setdefault(shard, {})[key] = [
                    [pattern, queue or None]
                    for pattern, queue in sorted(houses.items(), key=lambda kv: natural_key(str(kv[0])))
                ]
            street_tuples.append(
                [
                    street["name"],
                    street["normalized"],
                    street.get("defaultQueue"),
                    street.get("queues") or [],
                    shard,
                ]
            )
        settlements.append(
            {
                "name": entry["name"],
                "normalized": settlement_norm,
                "queues": sorted(queues),
                "streetsCount": len(street_tuples),
            }
        )
        shards.setdefault(shard_key(settlement_norm), []).append(
            {
                "settlement": entry["name"],
                "settlementNormalized": settlement_norm,
                "streets": street_tuples,
            }
        )

    settlements_pack = write_pack(
        cpu,
        "settlements",
        {"region": cpu, "settlements": settlements},
        len(settlements),
    )

    shard_manifest: dict[str, Any] = {}
    for key, items in sorted(shards.items()):
        # Словарь по нормализованному НП: клиент выбирает шард по первой букве и берёт свой ключ.
        payload = {
            "region": cpu,
            "shard": key,
            "settlements": {item["settlementNormalized"]: item for item in items},
        }
        shard_manifest[key] = write_pack(
            cpu,
            f"streets-{key}",
            payload,
            sum(len(item["streets"]) for item in items),
        )

    houses_manifest: dict[str, Any] = {}
    for shard, streets_map in sorted(house_shards.items()):
        houses_manifest[str(shard)] = write_pack(
            cpu,
            f"houses-{shard}",
            {"region": cpu, "shard": shard, "streets": streets_map},
            len(streets_map),
        )

    return {
        "settlements": settlements_pack,
        "shards": shard_manifest,
        "houses": houses_manifest,
        "settlementsCount": len(settlements),
        "streetsCount": sum(item["count"] for item in shard_manifest.values()),
        "housesCount": sum(item["count"] for item in houses_manifest.values()),
    }


def main() -> int:
    missing = [p for p in (CHERNIHIV, KYIV_CITY, KYIVSKA) if not p.exists()]
    if missing:
        print("ОШИБКА: нет локальных источников:", ", ".join(map(str, missing)), file=sys.stderr)
        return 1

    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)

    regions = {
        "chernihivska-oblast": build_region("chernihivska-oblast", load_chernihiv()),
        "kyiv-city": build_region("kyiv-city", load_jsonl(KYIV_CITY)),
        "kyivska-oblast": build_region("kyivska-oblast", load_jsonl(KYIVSKA)),
    }

    manifest = {
        "version": 2,
        "generatedAt": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "regions": regions,
    }
    (OUT / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    total = sum(item["settlementsCount"] for item in regions.values())
    streets = sum(item["streetsCount"] for item in regions.values())
    size = sum(p.stat().st_size for p in OUT.rglob("*.json"))
    houses = sum(item["housesCount"] for item in regions.values())
    print(
        f"Готово: {len(regions)} областей, {total} НП, {streets} улиц, {houses} улиц с домами, "
        f"{size / 1024 / 1024:.1f} МБ JSON"
    )
    for cpu, item in regions.items():
        print(
            f"  {cpu}: НП {item['settlementsCount']}, улиц {item['streetsCount']}, "
            f"шардов улиц {len(item['shards'])}, шардов домов {len(item['houses'])}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
