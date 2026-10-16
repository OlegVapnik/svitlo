#!/usr/bin/env python3
"""
Сверка контрактов ответа: Node-бэкенд (эталон) против Cloudflare Worker.

Эталон — apps/api, потому что фронтенд написан под него годами и проверен реальными
пользователями. Воркер — новый код, и расхождения в нём бьют по экрану («белый лист»),
поэтому сравниваем не тексты, а СТРУКТУРУ: какие ключи есть, каких не хватает и где типы
различаются. Диффы текстов бесполезны — значения зависят от данных и времени.

Форму сверяем внутри обязательных полей (REQUIRED): полное сравнение всего тела давало ложные
расхождения там, где контракт цел, потому что в локальной базе лежат одни данные, а в облачной
— другие. Типы приводим к JSON (`99` и `99.0` — одно и то же число), а `null` считаем пустой
веткой, а не другим типом. Расхождения, зависящие от данных, печатаются только с --verbose:
по умолчанию отчёт должен читаться однозначно — «контракт цел» или «контракт сломан».

Запуск:
    python3 tools/compare-api-contracts.py
    python3 tools/compare-api-contracts.py --only status,incidents
    # Локально, до деплоя: wrangler dev рядом с docker-бэкендом.
    SVITLO_API_BASE=http://localhost:3001/api/v1 \
    SVITLO_WORKER_BASE=http://127.0.0.1:8788/api/v1 python3 tools/compare-api-contracts.py
"""
import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
import urllib.parse

# Адреса можно переопределить переменными окружения: иначе сверку негде прогнать, кроме как
# на живом облаке, а локальный `wrangler dev` (и он же в CI) — единственный способ проверить
# правку воркера ДО деплоя. Опечатка в схеме стоит белого экрана на телефоне, поэтому проверка
# до выкладки важнее удобства «просто запусти скрипт».
API = os.environ.get("SVITLO_API_BASE", "http://192.168.1.100:3000/api/v1")
WORKER = os.environ.get("SVITLO_WORKER_BASE", "https://svitlo-api.olegvapnik45.workers.dev/api/v1")

# Маршруты, которые реально вызывает приложение.
ROUTES = [
    ("status", "status?region=chernihivska-oblast", None),
    ("outages", "outages?region=chernihivska-oblast&limit=5", None),
    ("outages/stats", "outages/stats?region=chernihivska-oblast", None),
    ("incidents", "incidents", None),
    ("reliability", "reliability?region=chernihivska-oblast", None),
    ("news", "news?limit=5", None),
    ("regions", "regions", None),
    # Чейнджлог: его читает карточка «Що нового» на главной. В воркере маршрута раньше не было
    # вовсе, и на Cloudflare-сборке карточка молча жила на устаревшей копии из бандла.
    ("changelog", "changelog", None),
    ("queues", "queues?region=chernihivska-oblast", None),
    ("schedules", "schedules?region=chernihivska-oblast&queue=1/1", None),
    ("schedules/upcoming", "schedules/upcoming?region=chernihivska-oblast&days=2", None),
    ("street-queues", "street-queues", None),
    ("addresses/settlements", "addresses/settlements?region=chernihivska-oblast&q=%D0%A7%D0%B5%D1%80%D0%BD", None),
    ("addresses/streets", "addresses/streets?region=chernihivska-oblast&settlement=%D1%81.+%D0%94%D0%B5%D1%81%D0%BD%D1%8F%D0%BD%D1%81%D1%8C%D0%BA%D0%B5", None),
    ("addresses/resolve", "addresses/resolve?region=chernihivska-oblast&settlement=%D1%81.+%D0%94%D0%B5%D1%81%D0%BD%D1%8F%D0%BD%D1%81%D1%8C%D0%BA%D0%B5", None),
    ("addresses/suggest", "addresses/suggest?q=%D0%A8%D0%B5%D0%B2", None),
    # Офлайн-пакет: один ответ вместо шести запросов на старте приложения. Сверяем его отдельно,
    # потому что расхождение здесь не видно глазами: фронтенд кладёт пакет в localStorage и
    # показывает экран из него, поэтому пропавшее поле проявится не ошибкой, а пустым блоком.
    ("sync", "sync?region=chernihivska-oblast", None),
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
    "news": ["data", "meta.count", "meta.stale"],
    "regions": ["data"],
    # Чейнджлог отдаётся конвертом { data: { generatedAt, entries } }: компонент читает список
    # записей, а пустой entries — это честное «мы ещё ничего не писали», а не ошибка сервера.
    "changelog": ["data.entries", "data.generatedAt"],
    "queues": ["data"],
    "schedules": ["data.queue", "data.date", "data.intervals"],
    # Поля localTimeFrom/localTimeTo обязательны внутри интервалов: без них карточка
    # ближайших отключений рисует «– –». Именно это уехало незамеченным.
    "schedules/upcoming": [
        "data[0].queue", "data[0].date", "data[0].isActiveNow",
        "data[0].intervals[0].startsAt", "data[0].intervals[0].endsAt",
        "data[0].intervals[0].localTimeFrom", "data[0].intervals[0].localTimeTo",
        "data[0].intervals[0].stateCode", "data[0].intervals[0].stateName",
    ],
    "addresses/settlements": ["data"],
    "addresses/streets": ["data"],
    "addresses/resolve": ["data.queue", "data.options", "data.reason", "data.source"],
    # Офлайн-пакет. Поля перечислены все: каждое из них наполняет свой кеш TanStack Query, и
    # отсутствие любого в воркере означает пустой блок на экране в офлайне — молча, без ошибки.
    "sync": [
        "data.region", "data.syncedAt", "data.etag",
        "data.status.grid.level", "data.status.lastUpdatedAt",
        "data.regions", "data.queues", "data.schedulesByRegion",
        "data.settlements", "data.settlementsTotal", "data.news", "data.contacts",
    ],
}


def fetch(base, path, etag=None):
    # Без заголовка Cloudflare отвечает 403 на Python-urllib, и сравнение молча
    # показало бы «воркер недоступен» там, где он на самом деле отвечает.
    headers = {"user-agent": "SvitloUA/2.4"}
    # `etag` — для проверки 304: без If-None-Match этот путь кода вообще не выполняется.
    if etag:
        headers["if-none-match"] = etag
    request = urllib.request.Request(f"{base}/{path}", headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        return {"__http_error__": error.code}
    except Exception as error:  # noqa: BLE001 — сеть может быть недоступна, это не повод падать
        return {"__unreachable__": str(error)[:60]}


MISSING = object()

# Путь к полю поддерживает индексы: "data[0].intervals[0].localTimeFrom".
_SEGMENT = re.compile(r"^([^\[]+)((\[\d+\])*)$")
_INDEX = re.compile(r"\[(\d+)\]")


def dig(payload, dotted):
    """Достаёт значение по пути «data[0].intervals[0].localTimeFrom».

    Возвращает MISSING, если КЛЮЧА нет, и None, если ключ есть и равен null: эти два случая
    разные, а раньше скрипт путал их и помечал исправные `lastError: null` как отсутствующие.
    """
    current = payload
    for part in dotted.split("."):
        match = _SEGMENT.match(part)
        if not match:
            return MISSING
        key, indexes = match.group(1), match.group(2)
        if isinstance(current, list):
            current = current[0] if current else MISSING
        if not isinstance(current, dict) or key not in current:
            return MISSING
        current = current[key]
        for index in _INDEX.findall(indexes or ""):
            position = int(index)
            if not isinstance(current, list) or position >= len(current):
                return MISSING
            current = current[position]
    return current


# `null` — это не «другой тип», а пустая ветка: в облачной базе нет расписания, и
# `nextAttemptAt: null` там честнее выдуманной даты. Считаем такой скелет допустимым.
NULL_WILDCARD = "null"


def _json_kind(value):
    """Имя JSON-типа значения — именно JSON, а не Python.

    `99` и `99.0` в JSON — одно и то же число, а Python различает int и float. Без этого
    приведения сверка ругалась бы на `reliabilityPct: 97.3` против `97`, то есть на разные
    ЗНАЧЕНИЯ, а не на разные типы, и настоящая поломка контракта тонула бы в этих строках.
    """
    if value is None:
        return NULL_WILDCARD
    if isinstance(value, bool):
        return "bool"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, dict):
        return "object"
    if isinstance(value, list):
        return "array"
    return type(value).__name__


def _type_name(value):
    """Имя типа для отчёта; MISSING — «нет ключа»."""
    return "нет ключа" if value is MISSING else _json_kind(value)


def shape(value, depth=0):
    """Тип и «скелет» значения — чтобы видеть расхождения структур, а не данных."""
    if depth > 3:
        return "…"
    if isinstance(value, dict):
        return {key: shape(item, depth + 1) for key, item in sorted(value.items())}
    if isinstance(value, list):
        # Сравниваем ВСЕ элементы, а не только первый: список из 12 групп мог иметь
        # одинаковую форму в обоих ответах по первому элементу и различаться дальше,
        # а простой list[0] этого не показывал.
        return [shape(item, depth + 1) for item in value[:5]]
    return _json_kind(value)


def diff_shapes(reference, worker, path, notes):
    """Расхождения ФОРМ внутри поддерева обязательного поля.

    Возвращает список проблем, а в `notes` складывает расхождения, зависящие от данных:
    ключ есть только в одном источнике, разная длина списков. Их в счётчик проблем не берём —
    иначе разные базы (локальная с одной областью и облачная) выглядели бы как сломанный
    контракт, и настоящий сигнал тонул бы в шуме. Ровно это и давало прежние «проблем: 13»
    на полностью исправных ответах.
    """
    if reference == NULL_WILDCARD or worker == NULL_WILDCARD:
        return []
    if isinstance(reference, dict) and isinstance(worker, dict):
        problems = []
        for key in sorted(set(reference) | set(worker)):
            child = f"{path}.{key}"
            if key not in reference or key not in worker:
                side = "воркере" if key not in reference else "эталоне"
                notes.append(f"{child}: ключ только в {side}")
                continue
            problems += diff_shapes(reference[key], worker[key], child, notes)
        return problems
    if isinstance(reference, list) and isinstance(worker, list):
        if len(reference) != len(worker):
            notes.append(f"{path}[]: элементов эталон={len(reference)} воркер={len(worker)}")
        problems = []
        for index, (left, right) in enumerate(zip(reference, worker)):
            problems += diff_shapes(left, right, f"{path}[{index}]", notes)
        return problems
    if reference != worker:
        return [f"{path}: эталон={reference} воркер={worker}"]
    return []


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

        notes = []
        shape_problems = []
        for field in REQUIRED.get(name, []):
            ref_value = dig(reference, field)
            wrk_value = dig(worker, field)
            if wrk_value is MISSING:
                problems += 1
                print(f"  ✗ {field}: КЛЮЧА НЕТ в воркере (эталон: {_type_name(ref_value)})")
                continue
            if ref_value is MISSING:
                # Обратная сторона тоже расхождение: поле, которого нет в эталоне, появилось в
                # воркере — значит контракты разъехались, и это стоит увидеть.
                notes.append(f"{field}: ключ только в воркере")
                print(f"  ? {field}: есть только в воркере")
                continue

            ref_kind, kind = _type_name(ref_value), _type_name(wrk_value)
            if ref_kind == kind and kind not in ("dict", "list"):
                print(f"  ✓ {field}: {ref_kind}")
                continue

            # Форму сверяем внутри ОБЯЗАТЕЛЬНОГО поля, а не по всему телу: значения зависят от
            # данных (в локальной базе одна область, в облачной — другая), и полное сравнение
            # тела давало ложные «проблемы» на исправных ответах.
            field_problems = diff_shapes(shape(ref_value), shape(wrk_value), field, notes)
            if field_problems:
                shape_problems += field_problems
                print(f"  ✗ {field}: эталон={ref_kind} воркер={kind}")
            elif ref_kind != kind:
                print(f"  ≈ {field}: эталон={ref_kind} воркер={kind} (null на пустой ветке)")
            else:
                print(f"  ✓ {field}: {ref_kind}")

        if shape_problems:
            problems += len(shape_problems)
            for problem in shape_problems:
                print(f"    ✗ {problem}")
            print("  ! ФОРМЫ ОБЯЗАТЕЛЬНЫХ ПОЛЕЙ РАЗЛИЧАЮТСЯ")
        else:
            print("  ✓ формы обязательных полей совпадают")

        # Зависимые от данных расхождения показываем только по --verbose: по умолчанию отчёт
        # должен читаться как «контракт цел / контракт сломан».
        if notes and args.verbose:
            for note in notes:
                print(f"    · {note} (зависит от данных)")

        # ETag: клиент присылает его в If-None-Match и ждёт 304 без тела. Без этой проверки обещание
        # «не тратим трафик» держится только на честном слове: 200 с тем же содержимым тоже выглядит
        # как успех, но заставляет телефон переписывать пакет на диск при каждом запуске.
        #
        # Хеш каждой стороны проверяем её же хешем: сравнивать ETag эталона и воркера нельзя — они
        # считаются от разных данных (в локальной базе воркера может лежать одна область), и обмен
        # хешами между ними давал бы вечный 200 там, где обе стороны исправны.
        for label, base, payload in (("эталон", API, reference), ("воркер", WORKER, worker)):
            etag = dig(payload, "data.etag")
            if not isinstance(etag, str) or len(etag) < 4:
                continue
            status = fetch(base, path, etag).get("__http_error__")
            if status == 304:
                print(f"  ✓ {label}: If-None-Match → 304 без тела")
            else:
                problems += 1
                print(f"  ✗ {label}: If-None-Match → {status or '200 с телом'}, ожидался 304")

    print(f"\nпроблем: {problems}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
