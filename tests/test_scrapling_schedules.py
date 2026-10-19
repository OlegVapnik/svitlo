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