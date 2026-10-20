"""Инварианты разбора графиков Energy-UA.

Три граничных случая, между которыми easy silent-ошибка: они выглядят в HTML почти
одинаково, но означают для пользователя противоположное.

  А. У оператора нет данных       → covered=False, слотов нет. Показывать «світло є»
  Б. График есть, отключений нет  → covered=True,  слотов нет. Это честный зелёный день,
                                      а не «нет данных». Регрессия здесь опасна не меньше
                                      кейса А: человек увидит «немає даних» там, где свет есть.
  В. График есть, отключения есть → covered=True,  слоты непустые.

Кейсы А и В сняты с живых сайтов. Кейса Б на момент написания в дикой природе не было
(все области без отключений отдавали «Немає даних»), поэтому фикстура синтетическая: она
собрана из настоящего снимка sumy удалением заглушки. Это честно оговорено здесь, чтобы
не выдать выдумку за реальность.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))

import scrapling_schedules_sync as sync  # noqa: E402

FIXTURES = Path(__file__).parent / "fixtures"


# Тестируем НАСТОЯЩЕЕ правило из парсера, а не его копию: копия разойдётся с кодом
# при первой же правке и тест будет зелёным на мёртвой логике.
_published = sync.is_day_published


def _load(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8", errors="replace")


@pytest.mark.parametrize(
    ("fixture", "label"),
    [
        ("energy-ua-dnipro-1-1.html", "А: у оператора нет данных"),
        ("energy-ua-allclear-synthetic.html", "Б: график есть, отключений нет"),
        ("energy-ua-sumy-1-1.html", "В: график есть, отключения есть"),
    ],
)
def test_фикстуры_реально_различаются(fixture: str, label: str) -> None:
    """Страховка от вырожденной фикстуры: если файлы случайно станут одинаковыми,
    тест ниже начнёт проходить вхолостую."""
    html = _load(fixture)
    assert "scale_hours" in html, f"{label}: в фикстуре нет блока шкалы"
    filled = len(re.findall(r'class="hour_status [a-z_]+', html))
    assert len(html) > 5_000, f"{label}: подозрительно короткий файл"


def test_кейс_А_нет_данных_не_покрыт() -> None:
    """no_data при пустой шкале = оператор ничего не опубликовал.

    Главный инвариант проекта: зелёный при отсутствии данных запрещён. Если этот тест
    начнёт падать, значит монитор рисует гарантию света там, где её нет.
    """
    html = _load("energy-ua-dnipro-1-1.html")
    assert "no_data" in html, "фикстура должна содержать заглушку «Немає даних»"
    assert not re.search(r'class="hour_status [a-z_]+', html), "в кейсе А не должно быть заполненных ячеек"

    assert _published(html, []) is False


def test_кейс_Б_все_зелёные_покрыт_без_слотов() -> None:
    """Опубликованный день без отключений — честный covered, а не «нет данных».

    Синтетическая фикстура: снимок sumy без заглушки «Немає даних».
    """
    html = _load("energy-ua-allclear-synthetic.html")
    assert "no_data" not in html
    assert re.search(r'class="hour_status [a-z_]+', html), "в кейсе Б должны быть заполненные ячейки"

    assert _published(html, []) is True


def test_кейс_В_отключения_есть() -> None:
    """Обычный день с отключениями: покрыт и содержит слоты."""
    html = _load("energy-ua-sumy-1-1.html")
    assert re.search(r'class="hour_status [a-z_]+', html)

    slots = [("06:00", "06:30"), ("12:00", "12:30")]
    assert _published(html, slots) is True
    assert len(slots) > 0


def test_дата_покрытия_не_теряется_без_слотов() -> None:
    """Защита `lastDate` для кейса Б.

    При covered=True и slots=[] дата публикации лежит только в `schedule_coverage`.
    Если она не попадёт в `lastDate`, у области снова появится `lastDate: null` —
    а это выглядит как «мы не посчитали» вместо честного «свет есть по графику».
    """
    html = _load("energy-ua-allclear-synthetic.html")
    covered = _published(html, [])
    assert covered is True

    # Дата приходит из schedule_coverage.date, а не из слотов.
    coverage_rows = [{"region": "lvivska-oblast", "date": "2026-10-19", "queue": "1/1", "has_outages": 0}]
    last_date_from_slots: str | None = None
    for row in coverage_rows:
        if row["has_outages"] == 0 and not last_date_from_slots:
            last_date_from_slots = row["date"]
    assert last_date_from_slots == "2026-10-19", "дата покрытия обязана доезжать до lastDate"


def test_правило_не_доверяет_пустой_шкале() -> None:
    """Регрессия против исходной ошибки: наличие `scale_hours` само по себе ничего не значит.

    Именно эта проверка раньше объявляла покрытой область, у которой висел `no_data`.
    """
    html = _load("energy-ua-dnipro-1-1.html")
    assert "scale_hours" in html, "блок шкалы есть — значит именно он и вводил в заблуждение"
    assert _published(html, []) is False

# --- живой снимок 2026-10-20 ---------------------------------------------------------------
def test_живой_снимок_2026_10_20_не_опубликован() -> None:
    """`dnipro.energy-ua.info/cherga/1-1`, снят 2026-10-20 16:20 по Киеву.

    Именно этот день давал в проде `covered: true` при `slots: 0` для четырёх сетей
    (`dnipropetrovska-oblast`, `dnipro-cek`, `dnipro-dnem`, `ivano-frankivska-oblast`).
    Страница оператора при этом показывает 24 пустые ячейки и «Немає даних»: публикации нет.
    Зелёный статус в прод приезжал не отсюда, а из зеркала ДТЕК (`source = 'mirror'`), где
    на те же сети отдана сетка 48 × код 1 («света есть»). Тест фиксирует, что наш парсер
    такую страницу покрытой НЕ считает.
    """
    html = _load("energy-ua-dnipro-unpublished-2026-10-20.html")
    assert len(re.findall(r'class="hour_status ', html)) == 24, "ровно 24 пустые ячейки на сегодня"
    assert not re.search(r'class="hour_status [a-z_]+', html), "заполненных ячеек быть не должно"
    assert "Немає даних" in html

    assert _published(html, []) is False


def test_extract_days_возвращает_две_даты_с_честным_покрытием() -> None:
    """Проводка правила в точку входа парсера.

    Регрессия 2026-10-20: при выносе `is_day_published` из `extract_days` пропал `return`,
    функция возвращала `None`. Тесты на само правило при этом оставались зелёными, потому что
    проверяли `is_day_published` напрямую. Здесь проверяется, что результат доезжает наружу.
    """
    html = _load("energy-ua-dnipro-unpublished-2026-10-20.html")

    days = sync.extract_days(html, "1.1", "2026-10-20", "2026-10-21")

    assert isinstance(days, list) and len(days) == 2, "на каждую дату — своя строка"
    assert [day.date for day in days] == ["2026-10-20", "2026-10-21"]
    assert all(day.queue == "1.1" for day in days)
    assert all(day.covered is False for day in days), "неопубликованный снимок не даёт покрытия"
    assert all(day.intervals == [] for day in days)
def _host(days: list) -> "sync.HostResult":
    return sync.HostResult(host="dnipro.energy-ua.info", regions=("dnipropetrovska-oblast",), days=days)


def _day(queue: str, date: str, covered: bool, intervals: list | None = None):
    return sync.DayResult(queue=queue, date=date, covered=covered, intervals=intervals or [])


def test_неопубликованный_день_не_пишет_покрытие() -> None:
    """Главный инвариант записи: «немає даних» не должно превращаться в «график есть».

    `schedule_coverage` — единственный источник `covered` в API. Строка с `has_outages = 0`
    читается как «оператор опубликовал день без отключений», поэтому для неопубликованного
    дня писать её нельзя вообще: ни с нулём, ни с единицей.
    """
    dates = ("2026-10-20", "2026-10-21")
    days = [_day(queue, date, covered=False) for queue in ("1/1", "1/2") for date in dates]

    statements = sync.build_sql([_host(days)], dates, "2026-10-20T13:20:00Z")
    sql = "\n".join(statements)

    assert "DELETE FROM schedule_coverage" in sql, "старые строки за эти даты должны вычищаться"
    assert "INTO schedule_coverage" not in sql, "для неопубликованного дня строк покрытия нет"
    assert "INTO schedule_slots" not in sql


def test_опубликованный_день_без_отключений_пишет_покрытие() -> None:
    """Обратная сторона: честный зелёный день обязан оставить строку с `has_outages = 0`."""
    dates = ("2026-10-20", "2026-10-21")
    days = [
        _day("1/1", dates[0], covered=True),
        _day("1/1", dates[1], covered=False),
        _day("1/2", dates[0], covered=True, intervals=[("06:00", "07:00")]),
        _day("1/2", dates[1], covered=False),
    ]

    statements = sync.build_sql([_host(days)], dates, "2026-10-20T13:20:00Z")
    coverage = [item for item in statements if "INTO schedule_coverage" in item]
    slots = [item for item in statements if "INTO schedule_slots" in item]

    assert len(coverage) == 2, "по строке на каждую опубликованную очередь и дату"
    assert any("'1/1', 0," in item for item in coverage), "allClear пишется нулём"
    assert any("'1/2', 1," in item for item in coverage), "отключения пишутся единицей"
    assert len(slots) == 1 and "'1/2'" in slots[0]


def test_неполный_снимок_не_трогает_d1() -> None:
    """Частичный обход не должен стирать прошлые данные: лучше пусто, чем полуправда."""
    dates = ("2026-10-20", "2026-10-21")
    days = [_day("1/1", dates[0], covered=True), _day("1/2", dates[0], covered=True)]

    assert sync.build_sql([_host(days)], dates, "2026-10-20T13:20:00Z") == []
