from __future__ import annotations

import unittest
from datetime import datetime

from .base import KYIV
from .chernihiv_energyua import parse_page


def epoch(date: str, time: str) -> int:
    return int(datetime.fromisoformat(f"{date}T{time}:00").replace(tzinfo=KYIV).timestamp())


TODAY = "2026-10-23"
TOMORROW = "2026-10-24"
HTML_WITH_RED = f"""
<script>
const periods = [{{"id":359,"day":23,"time_from":{epoch(TODAY, "11:30")},"time_to":{epoch(TODAY, "15:00")},"cherga":"1.1","status":"red"}}];
const tomorrowPeriods = [];
</script>
"""


class ParsePageTest(unittest.TestCase):
    def test_today_red_and_tomorrow_all_clear(self) -> None:
        days = parse_page(HTML_WITH_RED, "1.1", TODAY, TOMORROW)
        self.assertEqual(days[0], (TODAY, True, [("11:30", "15:00")]))
        self.assertEqual(days[1], (TOMORROW, True, []))

    def test_missing_periods_means_not_published(self) -> None:
        days = parse_page("<script>const tomorrowPeriods = [];</script>", "1.1", TODAY, TOMORROW)
        self.assertEqual(days[0], (TODAY, False, []))
        self.assertEqual(days[1], (TOMORROW, True, []))

    def test_merges_adjacent_red_cells_and_ignores_other_statuses(self) -> None:
        html = f"""
        const periods = [
          {{"time_from":{epoch(TODAY, "08:00")},"time_to":{epoch(TODAY, "08:30")},"status":"red"}},
          {{"time_from":{epoch(TODAY, "08:30")},"time_to":{epoch(TODAY, "09:00")},"status":"off"}},
          {{"time_from":{epoch(TODAY, "09:00")},"time_to":{epoch(TODAY, "10:00")},"status":"green"}},
          {{"time_from":{epoch(TODAY, "10:00")},"time_to":{epoch(TODAY, "10:30")},"status":"red"}}
        ];
        """
        days = parse_page(html, "2.1", TODAY, TOMORROW)
        self.assertEqual(days[0], (TODAY, True, [("08:00", "09:00"), ("10:00", "10:30")]))

    def test_ignores_other_dates_and_midnight_end(self) -> None:
        html = f"""
        const periods = [
          {{"time_from":{epoch("2026-10-22", "22:00")},"time_to":{epoch(TODAY, "00:00")},"status":"red"}},
          {{"time_from":{epoch(TODAY, "22:00")},"time_to":{epoch(TOMORROW, "00:00")},"status":"red"}}
        ];
        """
        days = parse_page(html, "3.1", TODAY, TOMORROW)
        self.assertEqual(days[0], (TODAY, True, [("22:00", "00:00")]))

    def test_broken_json_is_reported(self) -> None:
        with self.assertRaises(ValueError):
            parse_page("const periods = [oops];", "1.1", TODAY, TOMORROW)


if __name__ == "__main__":
    unittest.main()
