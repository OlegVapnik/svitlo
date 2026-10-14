#!/usr/bin/env python3
"""
Сверка контрактов ответа: Node-бэкенд (эталон) против Cloudflare Worker.

Эталон — apps/api, потому что фронтенд написан под него годами и проверен реальными
пользователями. Воркер — новый код, и расхождения в нём бьют по экрану («белый лист»),
поэтому сравниваем не тексты, а СТРУКТУРУ: какие ключи есть, каких не хватает и где типы
различаются. Диффы текстов бесполезны — значения зависят от данных и времени.

Запуск:
    python3 tools/compare-api-contracts.py
    python3 tools/compare-api-contracts.py --only status,incidents
"""
import argparse
import json
import sys
import urllib.error
import urllib.request
import urllib.parse

API = "http://192.168.1.100:3000/api/v1"
WORKER = "https://svitlo-api.olegvapnik45.workers.dev/api/v1"

# Маршруты, которые реально вызывает приложение.
ROUTES = [
    ("status", "status?region=chernihivska-oblast", None),
    ("outages", "outages?region=chernihivska-oblast&limit=5", None),
    ("outages/stats", "outages/stats?region=chernihivska-oblast", None),
    ("incidents", "incidents", None),
    ("reliability", "reliability?region=chernihivska-oblast", None),
    ("contacts", "contacts", None),
    ("news", "news?limit=5", None),
    ("regions", "regions", None),
    ("queues", "queues?region=chernihivska-oblast", None),
    ("schedules", "schedules?region=chernihivska-oblast&queue=1/1", None),
    ("schedules/upcoming", "schedules/upcoming?region=chernihivska-oblast&days=2", None),
    ("street-queues", "street-queues", None),
    ("addresses/settlements", "addresses/settlements?region=chernihivska-oblast&q=%D0%A7%D0%B5%D1%80%D0%BD", None),
    ("addresses/streets", "addresses/streets?region=chernihivska-oblast&settlement=%D1%81.+%D0%94%D0%B5%D1%81%D0%BD%D1%8F%D0%BD%D1%81%D1%8C%D0%BA%D0%B5", None),
    ("addresses/resolve", "addresses/resolve?region=chernihivska-oblast&settlement=%D1%81.+%D0%94%D0%B5%D1%81%D0%BD%D1%8F%D0%BD%D1%81%D1%8C%D0%BA%D0%B5", None),
    ("addresses/suggest", "addresses/suggest?q=%D0%A8%D0%B5%D0%B2", None),
]

# Что компоненты читают обязательно. Пустое значение — поле просто должно существовать,
# иначе компонент упадёт на `.level` / `.map` / `.length`.
REQUIRED = {
    # ВАЖНО: /status оборачивается в data — так отдаёт и эталон, и воркер.
    "status": [
        "data.grid.level", "data.grid.message", "data.activeOutages", "data.scheduledOutages",
        "data.activeGroups", "data.scheduledGroups", "data.activeIncidents",
        "data.scheduledIncidents", "data.totalIncidents", "data.lastUpdatedAt",
        "data.dataStale", "data.lastError", "data.pausedUntil", "data.nextAttemptAt",
        "data.consecutiveParseFailures", "data.powerSummary",
    ],
    "outages": ["data", "meta"],
    "outages/stats": ["data.byHour", "data.byDay", "data.byArea", "data.heatmap", "data.totalActive", "data.totalScheduled"],
    "incidents": ["data"],
    "reliability": ["data"],
    "contacts": ["data"],
    "news": ["data", "meta.count", "meta.stale"],
    "regions": ["data"],
    "queues": ["data"],
    "schedules": ["data.queue", "data.date", "data.intervals"],
    "schedules/upcoming": ["data"],
    "addresses/settlements": ["data"],
    "addresses/streets": ["data"],
    "addresses/resolve": ["data.queue", "data.options", "data.reason", "data.source"],
}


def fetch(base, path):
    # Без заголовка Cloudflare отвечает 403 на Python-urllib, и сравнение молча
    # показало бы «воркер недоступен» там, где он на самом деле отвечает.
    request = urllib.request.Request(f"{base}/{path}", headers={"user-agent": "SvitloUA/2.4"})
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        return {"__http_error__": error.code}
    except Exception as error:  # noqa: BLE001 — сеть может быть недоступна, это не повод падать
        return {"__unreachable__": str(error)[:60]}


MISSING = object()


def dig(payload, dotted):
    """Достаёт значение по пути «a.b.c».

    Возвращает MISSING, если КЛЮЧА нет, и None, если ключ есть и равен null: эти два случая
    разные, а раньше скрипт путал их и помечал исправные `lastError: null` как отсутствующие.
    """
    current = payload
    for part in dotted.split("."):
        if isinstance(current, list):
            current = current[0] if current else MISSING
        if not isinstance(current, dict):
            return MISSING
        if part not in current:
            return MISSING
        current = current[part]
    return current


def _type_name(value):
    """Имя типа для отчёта; MISSING — «нет ключа»."""
    return "нет ключа" if value is MISSING else type(value).__name__


def shape(value, depth=0):
    """Тип и «скелет» значения — чтобы видеть расхождения структур, а не данных."""
    if depth > 3:
        return "…"
    if isinstance(value, dict):
        return {key: shape(item, depth + 1) for key, item in sorted(value.items())}
    if isinstance(value, list):
        return [shape(value[0], depth + 1)] if value else []
    return type(value).__name__


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", default="")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()
    only = {item.strip() for item in args.only.split(",") if item.strip()}

    problems = 0
    for name, path, _ in ROUTES:
        if only and name not in only:
            continue
        reference = fetch(API, path)
        worker = fetch(WORKER, path)

        print(f"\n=== {name} ===")
        if "__unreachable__" in reference:
            print(f"  эталон недоступен: {reference['__unreachable__']}")
            continue
        if "__unreachable__" in worker:
            print(f"  ! ВОРКЕР НЕДОСТУПЕН: {worker['__unreachable__']}")
            problems += 1
            continue

        for field in REQUIRED.get(name, []):
            ref_value = dig(reference, field)
            wrk_value = dig(worker, field)
            if wrk_value is MISSING:
                problems += 1
                print(f"  ✗ {field}: КЛЮЧА НЕТ в воркере (эталон: {_type_name(ref_value)})")
            else:
                ref_kind = "нет ключа" if ref_value is MISSING else _type_name(ref_value)
                kind = "нет ключа" if ref_value is MISSING else _type_name(wrk_value)
                mark = "  " if (ref_value is MISSING or _type_name(ref_value) == kind) else "~ "
                print(f"  {mark}{field}: эталон={ref_kind} воркер={kind}")

        if shape(reference) != shape(worker):
            problems += 1
            print("  ! СТРУКТУРЫ РАЗЛИЧАЮТСЯ")
            if args.verbose:
                print(f"    эталон: {json.dumps(shape(reference), ensure_ascii=False)[:600]}")
                print(f"    воркер: {json.dumps(shape(worker), ensure_ascii=False)[:600]}")
        else:
            print("  ✓ структуры совпадают")

    print(f"\nпроблем: {problems}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
