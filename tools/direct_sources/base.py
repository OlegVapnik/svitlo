#!/usr/bin/env python3
"""Спільне ядро фреймворку прямих джерел ГПВ.

Кожен адаптер — окремий модуль у цьому пакеті. Він знає лише, як отримати
сторінку/API свого оператора і як перетворити її на `HostResult`. Уся робота з
мережею, київськими датами, злиттям інтервалів і форматом інжесту живе тут,
щоб нові області не копіювали одну й ту саму логіку.

Навмисно без залежності від `requests`: `curl_cffi` потрібен лише для сайтів,
які відкидають звичайний TLS-відпечаток. Якщо його немає, працює stdlib.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Protocol, runtime_checkable
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

KYIV = ZoneInfo("Europe/Kyiv")
DEFAULT_TIMEOUT = 30
USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)


@dataclass(frozen=True)
class QueueSpec:
    """Черга оператора. `code` — те, що потрапляє в API (`1.1`, `2/1`)."""

    code: str
    label: str | None = None

    def __str__(self) -> str:
        return self.code


@dataclass
class DayResult:
    queue: str
    date: str
    covered: bool
    intervals: list[tuple[str, str]] = field(default_factory=list)


@dataclass
class HostResult:
    host: str
    region: str
    source: str
    days: list[DayResult] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    fetched_at: str | None = None

    def add(self, queue: str, date: str, covered: bool, intervals: list[tuple[str, str]]) -> None:
        self.days.append(DayResult(queue=queue, date=date, covered=covered, intervals=list(intervals)))


def kyiv_today(now: datetime | None = None) -> str:
    return (now or datetime.now(KYIV)).astimezone(KYIV).strftime("%Y-%m-%d")


def kyiv_tomorrow(now: datetime | None = None) -> str:
    current = (now or datetime.now(KYIV)).astimezone(KYIV)
    return (current + timedelta(days=1)).strftime("%Y-%m-%d")


def local_to_utc(date: str, time: str, end: bool = False) -> str:
    """Локальний київський час → UTC ISO. Потрібен для перевірок і SQL."""
    hour, minute = (int(part) for part in time.split(":", 1))
    local = datetime.fromisoformat(f"{date}T{hour:02d}:{minute:02d}:00").replace(tzinfo=KYIV)
    if end and hour == 0 and minute == 0:
        local += timedelta(days=1)
    return local.astimezone(ZoneInfo("UTC")).isoformat()


def merge_intervals(intervals: list[tuple[str, str]]) -> list[tuple[str, str]]:
    """Зливає сусідні/перетинні інтервали, зберігаючи порядок за часом."""
    parsed: list[tuple[int, int, str, str]] = []
    for start, end in intervals:
        start_minutes = _minutes(start)
        end_minutes = _minutes(end)
        if end_minutes == 0 and start_minutes > 0:
            end_minutes = 24 * 60
        if end_minutes <= start_minutes:
            continue
        parsed.append((start_minutes, end_minutes, start, end))
    parsed.sort()
    merged: list[list[Any]] = []
    for start_minutes, end_minutes, start, end in parsed:
        if merged and start_minutes <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], end_minutes)
            merged[-1][3] = "00:00" if end_minutes >= 24 * 60 else end
        else:
            merged.append([start_minutes, end_minutes, start, end])
    return [(row[2], row[3]) for row in merged]


def _minutes(value: str) -> int:
    hour, minute = (int(part) for part in value.split(":", 1))
    return hour * 60 + minute


def _iso_now() -> str:
    return datetime.now(ZoneInfo("UTC")).isoformat(timespec="seconds").replace("+00:00", "Z")


class HttpClient:
    """HTTP з браузерним TLS-відпечатком, якщо доступний `curl_cffi`."""

    def __init__(self, timeout: int = DEFAULT_TIMEOUT, impersonate: str = "chrome") -> None:
        self.timeout = timeout
        self.impersonate = impersonate
        self._session: Any = None
        try:
            from curl_cffi import requests as curl_requests  # type: ignore

            self._session = curl_requests.Session(impersonate=impersonate, verify=False)
        except Exception:
            self._session = None

    def get_text(self, url: str) -> str:
        if self._session is not None:
            response = self._session.get(url, timeout=self.timeout)
            response.raise_for_status()
            return response.text
        request = Request(url, headers=self._headers("text/html,application/xhtml+xml"))
        with urlopen(request, timeout=self.timeout) as response:  # noqa: S310 — довірені URL адаптерів
            return response.read().decode("utf-8", "replace")

    def get_json(self, url: str) -> Any:
        if self._session is not None:
            response = self._session.get(url, timeout=self.timeout)
            response.raise_for_status()
            return response.json()
        request = Request(url, headers=self._headers("application/json"))
        with urlopen(request, timeout=self.timeout) as response:  # noqa: S310
            return __import__("json").loads(response.read().decode("utf-8", "replace"))

    def post_json(self, url: str, payload: dict[str, Any], headers: dict[str, str] | None = None) -> Any:
        body = __import__("json").dumps(payload).encode("utf-8")
        if self._session is not None:
            response = self._session.post(
                url,
                data=body,
                headers={"Content-Type": "application/json", **(headers or {})},
                timeout=self.timeout,
            )
            response.raise_for_status()
            return response.json()
        request = Request(
            url,
            data=body,
            method="POST",
            headers=self._headers("application/json", extra=headers),
        )
        with urlopen(request, timeout=self.timeout) as response:  # noqa: S310
            return __import__("json").loads(response.read().decode("utf-8", "replace"))

    @staticmethod
    def _headers(accept: str, extra: dict[str, str] | None = None) -> dict[str, str]:
        return {
            "User-Agent": USER_AGENT,
            "Accept": accept,
            "Accept-Language": "uk-UA,uk;q=0.9,en;q=0.8",
            **(extra or {}),
        }

    def close(self) -> None:
        if self._session is not None:
            self._session.close()


@runtime_checkable
class SourceAdapter(Protocol):
    key: str
    region: str
    host: str
    queues: tuple[QueueSpec, ...]

    def fetch(self, today: str, tomorrow: str) -> HostResult:
        ...


def build_ingest_payload(hosts: list[HostResult], generated_at: str | None = None) -> dict[str, Any]:
    """Формат `POST /api/v1/internal/schedules-ingest`: лише позитивні слоти."""
    regions: dict[str, list[dict[str, Any]]] = {}
    for host in hosts:
        for day in host.days:
            if not day.covered:
                continue
            regions.setdefault(host.region, []).append(
                {
                    "queue": day.queue,
                    "date": day.date,
                    "covered": True,
                    "intervals": [{"from": start, "to": end} for start, end in day.intervals],
                }
            )
    return {
        "generatedAt": generated_at or _iso_now(),
        "regions": [{"region": region, "days": days} for region, days in sorted(regions.items())],
    }


def sql_quote(value: str) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def build_sql(hosts: list[HostResult], generated_at: str | None = None) -> list[str]:
    """SQL для D1: замінює лише рядки цього джерела, не чіпаючи mirror/telegram."""
    timestamp = generated_at or _iso_now()
    statements: list[str] = []
    for host in hosts:
        if host.errors or not host.days:
            continue
        dates = sorted({day.date for day in host.days})
        date_list = ", ".join(sql_quote(date) for date in dates)
        statements.append(
            f"DELETE FROM schedule_slots WHERE source = {sql_quote(host.source)} "
            f"AND region = {sql_quote(host.region)} AND date IN ({date_list});"
        )
        statements.append(
            f"DELETE FROM schedule_coverage WHERE source = {sql_quote(host.source)} "
            f"AND region = {sql_quote(host.region)} AND date IN ({date_list});"
        )
        for day in host.days:
            if day.covered:
                statements.append(
                    "INSERT OR REPLACE INTO schedule_coverage "
                    "(region, date, queue, has_outages, source, updated_at) VALUES ("
                    f"{sql_quote(host.region)}, {sql_quote(day.date)}, {sql_quote(day.queue)}, "
                    f"{1 if day.intervals else 0}, {sql_quote(host.source)}, {sql_quote(timestamp)});"
                )
            for start, end in day.intervals:
                statements.append(
                    "INSERT OR REPLACE INTO schedule_slots "
                    "(region, queue, date, time_from, time_to, source) VALUES ("
                    f"{sql_quote(host.region)}, {sql_quote(day.queue)}, {sql_quote(day.date)}, "
                    f"{sql_quote(start)}, {sql_quote(end)}, {sql_quote(host.source)});"
                )
    return statements


def host_to_json(host: HostResult) -> dict[str, Any]:
    return {
        "host": host.host,
        "region": host.region,
        "source": host.source,
        "fetchedAt": host.fetched_at or _iso_now(),
        "days": [
            {
                "queue": day.queue,
                "date": day.date,
                "covered": day.covered,
                "intervals": [{"from": start, "to": end} for start, end in day.intervals],
            }
            for day in host.days
        ],
        "errors": host.errors,
    }


__all__ = [
    "KYIV",
    "DayResult",
    "HostResult",
    "HttpClient",
    "QueueSpec",
    "SourceAdapter",
    "build_ingest_payload",
    "host_to_json",
    "kyiv_today",
    "kyiv_tomorrow",
    "local_to_utc",
    "merge_intervals",
]
