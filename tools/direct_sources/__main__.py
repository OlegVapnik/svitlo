#!/usr/bin/env python3
"""Єдина точка запуску прямих джерел ГПВ.

Приклад:
    python -m tools.direct_sources --adapter chernihiv --json .cache/direct/chernihiv.json
    python -m tools.direct_sources --adapter chernihiv --sql .cache/direct/chernihiv.sql

Нову область додають одним модулем-адаптером і рядком у `ADAPTERS`; CLI, SQL,
JSON та інжест працюють однаково для всіх.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Sequence
from zoneinfo import ZoneInfo

from .base import (
    HostResult,
    build_ingest_payload,
    build_sql,
    host_to_json,
    kyiv_today,
    kyiv_tomorrow,
)
from .chernihiv_energyua import ChernihivEnergyUaAdapter

UTC = ZoneInfo("UTC")
ADAPTERS = {
    "chernihiv": ChernihivEnergyUaAdapter,
}


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def _write(path: str, text: str) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding="utf-8")
    print(f"записано: {target}", file=sys.stderr)


def _run(args: argparse.Namespace) -> int:
    if args.today and args.tomorrow:
        today, tomorrow = args.today, args.tomorrow
    else:
        today = args.today or kyiv_today()
        tomorrow = args.tomorrow or kyiv_tomorrow()

    names = list(ADAPTERS) if args.adapter == "all" else [args.adapter]
    hosts: list[HostResult] = []
    for name in names:
        adapter = ADAPTERS[name](timeout=args.timeout)
        host = adapter.fetch(today, tomorrow)
        hosts.append(host)
        print(
            f"{name}: {len(host.days)} днів, "
            f"{sum(1 for d in host.days if d.covered)} опубліковано, "
            f"{len(host.errors)} помилок",
            file=sys.stderr,
        )
        for error in host.errors:
            print(f"  ! {error}", file=sys.stderr)

    generated_at = _now()
    snapshot = {
        "generatedAt": generated_at,
        "today": today,
        "tomorrow": tomorrow,
        "hosts": [host_to_json(host) for host in hosts],
    }
    if args.json:
        _write(args.json, json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n")
    else:
        print(json.dumps(snapshot, ensure_ascii=False, indent=2))

    if args.sql:
        sql = build_sql(hosts, generated_at)
        _write(args.sql, "\n".join(sql) + ("\n" if sql else ""))

    if args.ingest:
        token = args.token or os.environ.get("SVITLO_INGEST_TOKEN", "")
        if not token:
            print("--ingest потребує --token або SVITLO_INGEST_TOKEN", file=sys.stderr)
            return 2
        from .base import HttpClient

        client = HttpClient(timeout=args.timeout)
        try:
            payload = build_ingest_payload(hosts, generated_at)
            print(f"інжест: {len(payload['regions'])} областей", file=sys.stderr)
            response = client.post_json(args.ingest, payload, headers={"x-ingest-token": token})
            print(json.dumps(response, ensure_ascii=False), file=sys.stderr)
        finally:
            client.close()

    return 0 if not any(host.errors for host in hosts) else 1


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Прямі джерела ГПВ Svitlo")
    parser.add_argument("--adapter", default="all", choices=["all", *ADAPTERS])
    parser.add_argument("--today", help="YYYY-MM-DD (за замовчуванням Київ)")
    parser.add_argument("--tomorrow", help="YYYY-MM-DD (за замовчуванням Київ)")
    parser.add_argument("--json", help="шлях до JSON-снімка")
    parser.add_argument("--sql", help="шлях до SQL для D1")
    parser.add_argument("--ingest", help="URL POST /api/v1/internal/schedules-ingest")
    parser.add_argument("--token", help="токен інжесту (або SVITLO_INGEST_TOKEN)")
    parser.add_argument("--timeout", type=int, default=30)
    return _run(parser.parse_args(argv))


if __name__ == "__main__":
    raise SystemExit(main())
