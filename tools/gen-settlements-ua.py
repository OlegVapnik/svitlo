#!/usr/bin/env python3
"""
Сборка статического справочника населённых пунктов Украины для Cloudflare Worker.

Зачем: подсказки «область → село» должны отвечать за миллисекунды и без похода в Nominatim.
Nominatim требует полное слово («Черніг» не находит «Чернігів»), поэтому города и центры
громад кладём в бандл один раз, а OSM остаётся только для хуторов и улиц.

Источник — официальный дамп GeoNames (https://download.geonames.org/export/dump/UA.zip).
Данные НЕ выдумываются: берутся реальные населённые пункты Украины с реальными координатами.

Что попадает в справочник:
  * PPLC  — столица (Київ);
  * PPLA2 — центры 2-го уровня;
  * PPLA3 — центры 3-го уровня, то есть нынешние громады (ОТГ);
  * все места с населением > 5000 (из cities5000) — чтобы город, не являющийся админцентром,
    тоже попал в подсказки.

Украинское название берётся из alternatenames: в поле name у GeoNames лежит латиница, а человек
ищет «Чернігів», а не «Chernihiv». Русские варианты отсеиваем по буквам ы/э/ё/ъ, приоритет —
за і/ї/є/ґ.

Запуск:
    curl -sO https://download.geonames.org/export/dump/UA.zip && unzip -o UA.zip
    python3 tools/gen-settlements-ua.py
"""
import json
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GEONAMES = Path("/tmp/opencode/UA.txt")
CITIES = Path("/tmp/opencode/cities5000.txt")
OUT = ROOT / "cf-worker" / "src" / "settlements-ua.json"

# Буквы, по которым русский вариант отличить от украинского.
RU_ONLY = set("ыэёъЫЭЁЪ")

# Буквы, которых нет в украинском: белорусские (ў), молдавские (ș/ț), гагаузские.
# Без этого фильтра «Чарнігаў» (белорусское) оказывалось короче «Чернігів» и выигрывало
# при выборе самого короткого варианта — в подсказку попадало «Чарнігаў».
NOT_UK = set("ўЎșțșȚğəĞ")
UA_ONLY = set("іїєґІЇЄҐ")
CYRILLIC = re.compile(r"[Ѐ-ӿ]")
LATIN = re.compile(r"[A-Za-z]")


def uk_name(row):
    """Достаёт украинское название из alternatenames.

    Порядок предпочтений: вариант с украинскими специфичными буквами → просто кириллица без
    русских → латиница. Русские варианты («Чернигов», «Чернігов») отбрасываются по ы/э/ё/ъ.
    """
    name = row["name"].strip()
    asciiname = row.get("ascii", "")
    alternates = [a.strip() for a in row["alts"].split(",") if a.strip()]

    candidates = [name, *alternates]
    cyrillic_ua, cyrillic_any, latin = [], [], name

    for value in candidates:
        if not CYRILLIC.search(value):
            if LATIN.search(value):
                latin = value
            continue
        if any(ch in RU_ONLY for ch in value) or any(ch in NOT_UK for ch in value):
            continue
        cyrillic_any.append(value)
        if any(ch in UA_ONLY for ch in value):
            cyrillic_ua.append(value)

    for bucket in (cyrillic_ua, cyrillic_any):
        if not bucket:
            continue
        unique = sorted(set(bucket))
        # Выбрасываем варианты, которые являются ПОДСТРОКОЙ другого варианта: у «Івано-
        # Франківськ» в alternatenames есть и кусок «Франківськ», и без этого отбрасывания
        # правило «самый короткий» давало человеку «Франківськ» вместо «Івано-Франківськ».
        full = [value for value in unique if not any(value != other and value in other for other in unique)]
        # Фильтр по asciiname обязателен: он отсекает исторические названия. Если ничего не
        # осталось — честно отдаём латинское название GeoNames, но не гадаем украинское.
        agreeing = [value for value in full if matches_ascii(value, asciiname)]
        if not agreeing:
            # Ни один кириллический вариант не согласуется с asciiname — значит, назвать
            # по-украински здесь нечем. Отдаём латинское имя и не выдумываем украинское.
            continue
        exact = [value for value in agreeing if skeleton(value) == skeleton(asciiname)]
        return min(exact or agreeing, key=len)
    return latin


# Кириллица → латиница по ГОСТ/ISO-подобной схеме. Нужна только для сверки кандидата с
# asciiname из GeoNames, поэтому точность схемы не важна — важна лишь устойчивость.
_TRANSLIT = str.maketrans({
    "а": "a", "б": "b", "в": "v", "г": "h", "ґ": "g", "д": "d", "е": "e", "є": "ie",
    "ж": "zh", "з": "z", "и": "i", "і": "i", "ї": "yi", "й": "i", "к": "k", "л": "l",
    "м": "m", "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
    "ф": "f", "х": "kh", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "shch", "ь": "", "ю": "yu",
    "я": "ia", "ё": "e", "ы": "y", "э": "e", "ъ": "",
})


def translit(value):
    """Кириллица → латиница, только буквы. Для сверки с asciiname."""
    return re.sub(r"[^a-z]", "", value.lower().translate(_TRANSLIT))


def skeleton(value):
    """Только согласные латинской транслитерации — «Хмельницький» → khmlntsk.

    Гласные в разных схемах транслитерации расходятся, а согласные совпадают, поэтому
    сравнение по ним устойчиво к различиям схем.
    """
    return "".join(ch for ch in translit(value) if ch not in "aeiouy")


def _levenshtein(a, b):
    if a == b:
        return 0
    if not a or not b:
        return max(len(a), len(b))
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def matches_ascii(candidate, asciiname):
    """Похож ли кандидат на латинское название GeoNames.

    Фильтр обязателен: иначе проходят исторические названия («Плоскурів» вместо
    «Хмельницький», «Дніпрослав» вместо «Дніпро»), которые короче настоящих и потому
    выигрывали при выборе самого короткого варианта.

    Строгое сравнение не годится: схемы транслитерации в GeoNames не совпадают между собой
    («Хмельницький» → khmelnytskyi, но иначе у другого города), поэтому сверяем «скелет»
    согласных с порогом похожести. Историческое название порог не проходит: у «Плоскурів»
    скелет plskrv, у Khmelnytskyi — khmlnstk.
    """
    if not asciiname:
        return False
    target = skeleton(asciiname)
    candidate_skeleton = skeleton(candidate)
    if not target or not candidate_skeleton:
        return False
    distance = _levenshtein(candidate_skeleton, target)
    longest = max(len(candidate_skeleton), len(target))
    return 1 - distance / longest >= 0.72


def normalize(value):
    """Ключ для поиска по префиксу: нижний регистр без «і/ї/є/ґ» → «и/и/е/г».

    Так «Черніг» и «Черниг» сходятся, и украиноязычный человек с русской раскладкой клавиатуры
    получает тот же результат.
    """
    text = unicodedata.normalize("NFC", value).lower()
    return text.translate(str.maketrans("іїєґ", "ииег"))


# Город, по которому определяется код области (admin1) в дампе GeoNames.
# Коды у нас не читаемые («02»), а регионы приложения называются по-своему
# («chernihivska-oblast»), поэтому связываем их через имя областного центра.
# Соответствие проверено по дампу: город с таким именем лежит именно в этой области.
CITY_OF_REGION = {
    "chernihivska-oblast": "Чернігів",
    "cherkaska-oblast": "Черкаси",
    "dnipro-dnem": "Дніпро",
    "dnipro-cek": "Дніпро",
    "ivano-frankivska-oblast": "Івано-Франківськ",
    "kharkivska-oblast": "Харків",
    "khmelnytska-oblast": "Хмельницький",
    "lvivska-oblast": "Львів",
    "poltavska-oblast": "Полтава",
    "rivnenska-oblast": "Рівне",
    "zakarpatska-oblast": "Ужгород",
    "zaporizka-oblast": "Запоріжжя",
    "zhytomyrska-oblast": "Житомир",
    "kyiv": "Київ",
    "kiivska-oblast": "Київ",
}


def region_code_by_cpu(center_code):
    """Сопоставляет `cpu` региона приложения с кодом admin1 из GeoNames.

    Код берётся из строки областного центра, поэтому однозначен.
    """
    result = {}
    for cpu, city in CITY_OF_REGION.items():
        code = center_code.get(skeleton(city))
        if code is None:
            raise SystemExit(f"Не найден областной центр «{city}» для региона {cpu}.")
        result[cpu] = code
    return result


def main():
    if not GEONAMES.exists():
        sys.exit(f"Нет файла {GEONAMES}. Скачайте UA.zip и распакуйте (см. docstring).")

    oblasts = {}
    # Код области для её центра. Берём прямо из строки PPLA/PPLC: областной центр по
    # определению принадлежит своей области, тогда как обычный поиск города по всем
    # регионам даёт ложные совпадения (например, «Рівне» есть ещё в нескольких областях).
    center_code = {}
    places = {}
    seen_geoname = set()

    with GEONAMES.open(encoding="utf-8") as handle:
        for line in handle:
            f = line.rstrip("\n").split("\t")
            if len(f) < 15 or f[6] != "P":
                continue
            row = {
                "gid": f[0],
                "name": f[1],
                "alts": f[3],
                "ascii": f[2],
                "lat": f[4],
                "lon": f[5],
                "code": f[7],
                "country": f[8],
                "admin1": f[10],
                "pop": f[14],
            }
            if row["country"] != "UA":
                continue

            # Области строим по их центрам: PPLA/PPLC — это областные центры и столица.
            if row["code"] in ("PPLA", "PPLC"):
                name = uk_name(row)
                if name:
                    # Ключ — «скелет», а не точное написание: GeoNames в alternatenames держит
                    # и «Хмельницький», и «Хмельницкий» (с русским «и»). Назвать область
                    # нужно по одному коду, и спорить о букве в одной из двух записей
                    # бессмысленно — по «скелету» обе формы дают один и тот же ключ.
                    center_code[skeleton(name)] = row["admin1"]
                    if row["admin1"] not in oblasts:
                        oblasts[row["admin1"]] = name
                # Сам центр при этом остаётся населённым пунктом — «Чернігів» обязан быть
                # в подсказках, и раньше он отсюда выпадал.
            elif row["code"] not in ("PPLA2", "PPLA3"):
                continue
            key = row["gid"]
            if key in seen_geoname:
                continue
            seen_geoname.add(key)
            places[key] = (uk_name(row), row["admin1"], row["lat"], row["lon"])

    # Города с населением > 5000: добавляем тех, кого нет среди админцентров.
    if CITIES.exists():
        with CITIES.open(encoding="utf-8") as handle:
            for line in handle:
                f = line.rstrip("\n").split("\t")
                if len(f) < 15 or f[8] != "UA":
                    continue
                gid = f[0]
                if gid in seen_geoname:
                    continue
                seen_geoname.add(gid)
                places[gid] = (uk_name({
                    "name": f[1], "alts": f[3], "ascii": f[2],
                }), f[10], f[4], f[5])

    clean = []
    for name, admin1, lat, lon in places.values():
        if not name or not admin1:
            continue
        try:
            # Три знака после запятой — это ~100 м, достаточно для подсказки на карте,
            # а на 6 знаках файл распухает вдвое без практической пользы.
            clean.append([name, admin1, round(float(lat), 2), round(float(lon), 2)])
        except ValueError:
            continue

    # Одноимённые сёла в одной области схлопываем: в подсказке три строки «Іванівка» подряд
    # бесполезны. Разные области с тем же названием оставляем — это разные места.
    deduped = {}
    for item in clean:
        deduped.setdefault((normalize(item[0]), item[1]), item)
    clean = list(deduped.values())

    # Сортируем по нормализованному имени: префиксный поиск идёт обычным бинарным поиском.
    clean.sort(key=lambda item: normalize(item[0]))

    # Название области в payload НЕ храним: у GeoNames в этом поле лежит название её центра
    # («Житомир»), а не «Житомирська область». Человекочитаемые названия уже есть у воркера в
    # REGION_NAMES, поэтому здесь оставляем связку код → область, а не выдуманный текст.
    payload = {"regions": region_code_by_cpu(center_code), "places": clean}
    OUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    size_kb = OUT.stat().st_size / 1024
    print(f"Регионов сопоставлено: {len(payload['regions'])}, населённых пунктов: {len(clean)}")
    print(f"Файл: {OUT.relative_to(ROOT)} — {size_kb:.1f} КБ")
    for probe in ("Черніг", "Біл", "Іван", "Льв"):
        hits = [p[0] for p in clean if normalize(p[0]).startswith(normalize(probe))]
        print(f"  префикс «{probe}» → {len(hits)}: {', '.join(hits[:4])}")


if __name__ == "__main__":
    main()
