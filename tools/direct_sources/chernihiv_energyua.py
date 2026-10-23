#!/usr/bin/env python3
"""Чернігівська область: прямі графіки з Energy-UA.

Офіційний портал `chernihivoblenergo.com.ua` віддає графік через iframe
`interruptions.energy.cn.ua`, а його API закритий Cloudflare Turnstile. Поки
публічного токена немає, використовуємо відкриті HTML-сторінки Energy-UA: вони
містять `const periods` / `const tomorrowPeriods` з тими самими слотами, які
оператор передає в публічний графік.

Це тимчасовий, але чесний адаптер: якщо оператор не опублікував `tomorrowPeriods`,
день лишається `covered=false`, а не «світло є».
"""
from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Any, Iterable
from urllib.parse import urlencode

from .base import (
    KYIV,
    HostResult,
    HttpClient,
    QueueSpec,
    build_ingest_payload,
    host_to_json,
    kyiv_today,
    kyiv_tomorrow,
    merge_intervals,
)

HOST = "chernigiv.energy-ua.info"
REGION = "chernihivska-oblast"
# Той самий source, що й у Browser Run: інакше ручний SQL-резерв і крон пишуть
# паралельні рядки з різними ключами й можуть залишити застарілий інтервал.
SOURCE = "energy-ua"
QUEUES = tuple(QueueSpec(f"{group}/{part}") for group in range(1, 7) for part in (1, 2))
_OFF_STATUSES = frozenset({"red", "off", "disabled", "1", "true"})


def _periods_array(html: str, name: str) -> list[dict[str, Any]] | None:
    """Повертає масив або None, якщо змінної немає на сторінці."""
    match = re.search(rf"const\s+{re.escape(name)}\s*=\s*(\[[\s\S]*?\])\s*;", html)
    if not match:
        return None
    try:
        value = json.loads(match.group(1))
    except json.JSONDecodeError as error:
        raise ValueError(f"{name}: невалідний JSON ({error})") from error
    if not isinstance(value, list):
        raise ValueError(f"{name}: очікували масив")
    return [item for item in value if isinstance(item, dict)]


def _intervals(periods: Iterable[dict[str, Any]], date: str) -> list[tuple[str, str]]:
    intervals: list[tuple[str, str]] = []
    for period in periods:
        status = str(period.get("status", "")).strip().casefold()
        if status not in _OFF_STATUSES:
            continue
        raw_from, raw_to = period.get("time_from"), period.get("time_to")
        try:
            start = datetime.fromtimestamp(int(raw_from), KYIV)
            end = datetime.fromtimestamp(int(raw_to), KYIV)
        except (TypeError, ValueError, OSError):
            continue
        if start.strftime("%Y-%m-%d") != date:
            continue
        start_time = start.strftime("%H:%M")
        end_time = "00:00" if end.strftime("%Y-%m-%d") != date else end.strftime("%H:%M")
        intervals.append((start_time, end_time))
    return merge_intervals(intervals)


def parse_page(html: str, queue: str, today: str, tomorrow: str) -> list[tuple[str, bool, list[tuple[str, str]]]]:
    """HTML однієї черги → [(date, covered, intervals)] для today/tomorrow."""
    result: list[tuple[str, bool, list[tuple[str, str]]]] = []
    for name, date in (("periods", today), ("tomorrowPeriods", tomorrow)):
        periods = _periods_array(html, name)
        if periods is None:
            result.append((date, False, []))
        else:
            result.append((date, True, _intervals(periods, date)))
    return result


class ChernihivEnergyUaAdapter:
    key = SOURCE
    region = REGION
    host = HOST
    queues = QUEUES

    def __init__(self, client: HttpClient | None = None, timeout: int = 30) -> None:
        self.client = client or HttpClient(timeout=timeout)
        self.base_url = f"https://{HOST}/cherga"

    def queue_url(self, queue: str) -> str:
        slug = queue.replace('.', '-').replace('/', '-')
        return f"{self.base_url}/{slug}"

    def fetch(self, today: str | None = None, tomorrow: str | None = None) -> HostResult:
        today = today or kyiv_today()
        tomorrow = tomorrow or kyiv_tomorrow()
        result = HostResult(host=HOST, region=REGION, source=SOURCE)
        for queue in self.queues:
            url = self.queue_url(queue.code)
            try:
                html = self.client.get_text(url)
            except Exception as error:  # noqa: BLE001 — одна черга не має валити решту
                result.errors.append(f"{queue.code}: {error}")
                continue
            try:
                for date, covered, intervals in parse_page(html, queue.code, today, tomorrow):
                    result.add(queue.code, date, covered, intervals)
            except ValueError as error:
                result.errors.append(f"{queue.code}: {error}")
        return result


def _cli() -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Чернігів: прямі графіки Energy-UA")
    parser.add_argument("--today", default=None)
    parser.add_argument("--tomorrow", default=None)
    parser.add_argument("--json", default=None, help="шлях для JSON-знімка")
    parser.add_argument("--ingest", default=None, help="URL /api/v1/internal/schedules-ingest")
    parser.add_argument("--token", default=None)
    args = parser.parse_args()

    adapter = ChernihivEnergyUaAdapter()
    host = adapter.fetch(args.today, args.tomorrow)
    snapshot = {
        "generatedAt": datetime.now(KYIV).isoformat(timespec="seconds"),
        "today": args.today or kyiv_today(),
        "tomorrow": args.tomorrow or kyiv_tomorrow(),
        "hosts": [host_to_json(host)],
    }
    print(json.dumps(snapshot, ensure_ascii=False, indent=2))
    if args.json:
        from pathlib import Path

        Path(args.json).parent.mkdir(parents=True, exist_ok=True)
        Path(args.json).write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8")
    if args.ingest:
        token = args.token
        if not token:
            parser.error("для --ingest потрібен --token або SVITLO_INGEST_TOKEN")
        import os
        import urllib.request

        payload = build_ingest_payload([host])
        request = urllib.request.Request(
            args.ingest,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json", "x-ingest-token": token},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=60) as response:  # noqa: S310
            print(response.read().decode("utf-8", "replace"))
    if host.errors:
        print(f"errors: {len(host.errors)}", file=__import__("sys").stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(_cli())
