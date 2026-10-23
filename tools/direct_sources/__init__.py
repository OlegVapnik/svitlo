"""Прямі джерела ГПВ: спільна основа для адаптерів ОСР.

Мета — поступово прибрати залежність від зовнішнього DTEK-проксі та Energy-UA.
Кожен адаптер сам знає, як забрати й розібрати сторінку свого оператора, але
повертає єдиний нормалізований результат `HostResult`/`DayResult`.
"""
from __future__ import annotations

from .base import (
    DayResult,
    HostResult,
    HttpClient,
    QueueSpec,
    SourceAdapter,
    build_ingest_payload,
    build_sql,
    kyiv_today,
    kyiv_tomorrow,
    local_to_utc,
    merge_intervals,
)
from .chernihiv_energyua import ChernihivEnergyUaAdapter

__all__ = [
    "DayResult",
    "HostResult",
    "HttpClient",
    "QueueSpec",
    "SourceAdapter",
    "build_ingest_payload",
    "build_sql",
    "kyiv_today",
    "kyiv_tomorrow",
    "local_to_utc",
    "merge_intervals",
    "ChernihivEnergyUaAdapter",
]
