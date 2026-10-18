#!/usr/bin/env python3
"""Сгенерировать справочник населённых пунктов регионов из открытого классификатора КОАТУУ.

Зачем: операторы (Чернігівобленерго и др.) идентифицируют населённые пункты кодами КОАТУУ —
это коды государственного классификатора, а не внутренние id оператора. Без справочника
приходилось держать в .env один-два id руками, из-за чего сбор вёлся по одному селу,
хотя у оператора есть данные по всей области (Мена — 208 записей, Бахмач — 109).

Источник (открытые данные, CC BY 4.0): https://github.com/alexbabintsev/ua-geo
  data/out/katottg.csv — реестр КОАТТГ + колонка koatuu (старый 10-значный код КОАТУУ).

Прогон (нужна сеть, файл ~6.5 МБ):
    python3 tools/gen_settlement_directory.py \
        --source https://github.com/alexbabintsev/ua-geo/raw/refs/heads/main/data/out/katottg.csv \
        --out apps/api/src/providers/data/settlement-directory.json

Формат выхода:
    {
      "generatedAt": "...",
      "source": "...",
      "regions": {
        "<код области>": {
          "nameUa": "Чернігівська область",
          "settlements": [ { "koatuu": "7420310100", "name": "Бахмач", "kind": "місто",
                            "raion": "Бахмацький район", "hromada": "..." } ],
          "cityDistricts": [ { "koatuu": "7410136300", "name": "Деснянський", "city": "Чернігів" } ]
        }
      }
    }

Файл коммитится в репозиторий: сбор не должен падать из-за отсутствия сети.
"""

from __future__ import annotations

import argparse
import csv
import json
import pathlib
import sys
import urllib.request

# Коды областей в КОАТТГ. Проверено по реестру: Чернігівська область = UA74000000000025378
# (область — строка з category_name='область', у неё region_code == code).
# Другие области добавляются по мере подключения операторов.
DEFAULT_REGIONS = {
    "UA74000000000025378": "Чернігівська область",
}

UA_DEFAULT_SOURCE = "https://raw.githubusercontent.com/alexbabintsev/ua-geo/main/data/out/katottg.csv"

# Категории, которые имеют смысл отдавать оператору: города/сёла/посёлки.
SETTLEMENT_KINDS = {"місто", "село", "селище"}
CITY_KINDS = {"місто"}


def download(source: str, cache: pathlib.Path) -> pathlib.Path:
    """Скачать (или взять из кэша) реестр КОАТТГ."""
    if cache.exists():
        return cache
    cache.parent.mkdir(parents=True, exist_ok=True)
    print(f"Загружаю реестр КОАТТГ: {source}", file=sys.stderr)
    request = urllib.request.Request(source, headers={"User-Agent": "svitlo-settlement-directory/1.0"})
    with urllib.request.urlopen(request, timeout=120) as response, cache.open("wb") as handle:
        handle.write(response.read())
    return cache


def build(rows, regions: dict[str, str]) -> dict:
    # Реєстр не містить назв районів/громад — лише їхні коди. Розгортаємо їх у словник один раз,
    # інакше в довідник потрапили б «UA7404003000» замість «Бахмацький район».
    names_by_code: dict[str, tuple[str, str]] = {
        (row.get("code") or "").strip(): ((row.get("name") or "").strip(), (row.get("category_name") or "").strip())
        for row in rows
        if (row.get("code") or "").strip()
    }

    def resolve(code: str, want: str) -> str | None:
        if not code:
            return None
        name, category = names_by_code.get(code, ("", ""))
        return name if name and category == want else None

    out_regions: dict[str, dict] = {}
    for row in rows:
        region_code = (row.get("region_code") or "").strip()
        if region_code not in regions:
            continue
        koatuu = (row.get("koatuu") or "").strip()
        name = (row.get("name") or "").strip()
        if not koatuu or not name:
            continue
        category = (row.get("category_name") or "").strip()
        bucket = out_regions.setdefault(
            region_code,
            {"nameUa": regions[region_code], "settlements": [], "cityDistricts": []},
        )
        if category in SETTLEMENT_KINDS:
            bucket["settlements"].append(
                {
                    "koatuu": koatuu,
                    "name": name,
                    "kind": category,
                    # Пріоритет: міста обходять першими — там найчастіше шукають відключення.
                    "priority": 1 if category in CITY_KINDS else 2,
                    "raion": resolve((row.get("raion_code") or "").strip(), "район"),
                    "hromada": resolve((row.get("hromada_code") or "").strip(), "громада"),
                }
            )
        elif category == "місто зі спеціальним статусом":
            # Київ у КАТОТТГ стоїть на рівні області, але для адресного каскаду це єдиний НП
            # продуктового регіону `kyiv-city`.
            bucket["settlements"].append(
                {
                    "koatuu": koatuu,
                    "name": name,
                    "kind": "місто",
                    "priority": 1,
                    "raion": None,
                    "hromada": None,
                }
            )
        elif category == "район у місті":
            city = resolve((row.get("parent_code") or "").strip(), "місто")
            bucket["cityDistricts"].append({"koatuu": koatuu, "name": name, "city": city})

    for bucket in out_regions.values():
        # Детермінований порядок: спершу міста, потім сёла/селища, усі за абеткою.
        bucket["settlements"].sort(key=lambda item: (item["priority"], item["name"]))
        bucket["cityDistricts"].sort(key=lambda item: item["name"])
    return out_regions


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source", default=UA_DEFAULT_SOURCE, help="URL реєстру КОАТТГ (CSV)")
    parser.add_argument("--out", required=True, type=pathlib.Path, help="куда писать JSON")
    parser.add_argument("--cache", type=pathlib.Path, default=pathlib.Path("/tmp/katottg.csv"))
    parser.add_argument(
        "--all-regions",
        action="store_true",
        help="включить 24 области и Киев; Крым и Севастополь не входят в каталог приложения",
    )
    args = parser.parse_args()

    csv_path = download(args.source, args.cache)
    with csv_path.open(encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))

    selected_regions = DEFAULT_REGIONS
    if args.all_regions:
        excluded = {"Автономна Республіка Крим", "Севастополь"}
        selected_regions = {
            row["code"]: row["name"]
            for row in rows
            if row.get("level") == "1"
            and row.get("category_name") in {"область", "місто зі спеціальним статусом"}
            and row.get("name") not in excluded
        }
    regions = build(rows, selected_regions)
    if not regions:
        print("Реєстр порожній або немає очікуваних областей", file=sys.stderr)
        return 1

    payload = {
        "generatedAt": None,
        "source": args.source,
        "note": "Згенеровано tools/gen_settlement_directory.py з відкритого реєстру КОАТТГ. Не редагувати вручну.",
        "regions": regions,
    }
    import datetime

    payload["generatedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    for code, bucket in regions.items():
        cities = sum(1 for item in bucket["settlements"] if item["kind"] in CITY_KINDS)
        print(
            f"{bucket['nameUa']} ({code}): {len(bucket['settlements'])} НП "
            f"(з них міст: {cities}), районів у місті: {len(bucket['cityDistricts'])}",
            file=sys.stderr,
        )
    print(f"Записано: {args.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
