package ua.com.svitlo.app.widget

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.TimeZone

/**
 * Живой отсчёт виджета — та часть, которую нельзя проверить глазами на телефоне.
 *
 * Ошибка здесь не падает: виджет просто показывает «12:00» вместо «до 12:00» или крутит
 * таймер на уже прошедшее окно. Поэтому логика вынесена из `SvitloWidgetProvider` в
 * чистый объект и покрыта на JVM.
 */
class WidgetLiveTest {
    /** 30 октября 2026, Киев живёт по зимнему времени (UTC+2). */
    private fun kyiv(date: String, time: String): Long =
        java.time.OffsetDateTime.parse("${date}T${time}:00+02:00").toInstant().toEpochMilli()

    @Test
    fun `внутри окна считает до включения`() {
        val windows = listOf(WidgetWindow(kyiv("2026-10-30", "09:30"), kyiv("2026-10-30", "13:00")))
        val countdown = WidgetLive.countdown(windows, kyiv("2026-10-30", "10:15"))
        assertEquals(WidgetCountdown.MODE_UNTIL_ON, countdown?.mode)
        assertEquals(kyiv("2026-10-30", "13:00"), countdown?.targetAt)
        assertEquals(WidgetCountdown.MODE_UNTIL_ON, countdown?.mode)
    }

    @Test
    fun `до окна считает до отключения`() {
        val windows = listOf(WidgetWindow(kyiv("2026-10-30", "09:30"), kyiv("2026-10-30", "13:00")))
        val countdown = WidgetLive.countdown(windows, kyiv("2026-10-30", "08:00"))
        assertEquals(WidgetCountdown.MODE_UNTIL_OFF, countdown?.mode)
        assertEquals(kyiv("2026-10-30", "09:30"), countdown?.targetAt)
        assertEquals(WidgetCountdown.MODE_UNTIL_OFF, countdown?.mode)
    }

    @Test
    fun `после последнего окна отсчёта нет`() {
        val windows = listOf(WidgetWindow(kyiv("2026-10-30", "09:30"), kyiv("2026-10-30", "13:00")))
        assertNull(WidgetLive.countdown(windows, kyiv("2026-10-30", "19:00")))
    }

    @Test
    fun `пустой график не даёт отсчёта`() {
        assertNull(WidgetLive.countdown(emptyList(), kyiv("2026-10-30", "10:00")))
    }

    @Test
    fun `окна форматируются по Киеву с ограничением`() {
        val windows = listOf(
            WidgetWindow(kyiv("2026-10-30", "09:30"), kyiv("2026-10-30", "13:00")),
            WidgetWindow(kyiv("2026-10-30", "17:00"), kyiv("2026-10-30", "20:00")),
        )
        assertEquals(listOf("09:30" to "13:00", "17:00" to "20:00"), WidgetLive.windowPairs(windows))
        assertEquals(emptyList<Pair<String, String>>(), WidgetLive.windowPairs(emptyList()))

        val three = windows + WidgetWindow(kyiv("2026-10-30", "22:00"), kyiv("2026-10-30", "23:00"))
        // Третье окно в плитку не влезает: лучше «…», чем обрезка посреди времени.
        assertEquals(2, WidgetLive.windowPairs(three).size)
        // Явно меньший лимит тоже честно помечает, что остались ещё окна.
        assertEquals(listOf("09:30" to "13:00"), WidgetLive.windowPairs(windows, maxRanges = 1))
    }

    @Test
    fun `подпись подсказывает ближайшую границу`() {
        val windows = listOf(WidgetWindow(kyiv("2026-10-30", "09:30"), kyiv("2026-10-30", "13:00")))
        assertEquals("13:00", WidgetLive.hintTime(windows, kyiv("2026-10-30", "10:15")))
        assertEquals("09:30", WidgetLive.hintTime(windows, kyiv("2026-10-30", "08:00")))
        assertNull(WidgetLive.hintTime(windows, kyiv("2026-10-30", "21:00")))
    }

    @Test
    fun `выбор окон устойчив к краям и порядку`() {
        val first = WidgetWindow(kyiv("2026-10-30", "09:30"), kyiv("2026-10-30", "13:00"))
        val second = WidgetWindow(kyiv("2026-10-30", "17:00"), kyiv("2026-10-30", "20:00"))
        val shuffled = listOf(second, first)

        assertEquals(first, WidgetLive.nextWindow(shuffled, kyiv("2026-10-30", "08:00")))
        // Начало окна включительно: в 09:30 человек уже без света.
        assertEquals(first, WidgetLive.currentWindow(shuffled, kyiv("2026-10-30", "09:30")))
        // Конец — исключительно: в 13:00 свет уже вернули.
        assertNull(WidgetLive.currentWindow(shuffled, kyiv("2026-10-30", "13:00")))
    }

    @Test
    fun `форматирование не зависит от пояса телефона`() {
        val original = TimeZone.getDefault()
        try {
            TimeZone.setDefault(TimeZone.getTimeZone("America/New_York"))
            val windows = listOf(WidgetWindow(kyiv("2026-10-30", "09:30"), kyiv("2026-10-30", "13:00")))
            assertEquals(listOf("09:30" to "13:00"), WidgetLive.windowPairs(windows))
            assertEquals("Europe/Kyiv", WidgetLive.KYIV.id)
        } finally {
            TimeZone.setDefault(original)
        }
    }

    @Test
    fun `остаток до события считается словами`() {
        val now = kyiv("2026-10-30", "09:00")
        assertEquals(RemainingTime(0, 12, false), WidgetLive.remaining(now + 12 * 60_000L, now))
        assertEquals(RemainingTime(1, 0, false), WidgetLive.remaining(now + 60 * 60_000L, now))
        assertEquals(RemainingTime(1, 5, false), WidgetLive.remaining(now + 65 * 60_000L, now))
        // Меньше минуты и прошедшее время — не «0 хв»: лучше честное «менше хв» и null.
        assertEquals(RemainingTime(0, 0, true), WidgetLive.remaining(now + 30_000L, now))
        assertNull(WidgetLive.remaining(now - 1L, now))
    }

    @Test
    fun `известный график без окон обещает спокойный день`() {
        val now = kyiv("2026-10-30", "10:00")
        // Ноль минут за сутки — это факт «отключений не будет», а не пустой график.
        assertEquals(
            TimerFallback.ALL_CLEAR,
            WidgetLive.fallback(emptyList(), todayOffMinutes = 0, state = "on", nowMs = now),
        )
    }

    @Test
    fun `без графика обещаний нет`() {
        val now = kyiv("2026-10-30", "10:00")
        // `null` — оператор ещё не опубликовал график: «не вимикатимуть» было бы выдумкой.
        assertEquals(
            TimerFallback.NONE,
            WidgetLive.fallback(emptyList(), todayOffMinutes = null, state = "unknown", nowMs = now),
        )
        // Аварийное отключение вне графика тоже не даёт права обещать свет.
        assertEquals(
            TimerFallback.NONE,
            WidgetLive.fallback(emptyList(), todayOffMinutes = 0, state = "off", nowMs = now),
        )
    }

    @Test
    fun `прошедшие окна дают свет, а не старый таймер`() {
        val now = kyiv("2026-10-30", "21:00")
        val windows = listOf(WidgetWindow(kyiv("2026-10-30", "09:30"), kyiv("2026-10-30", "13:00")))
        assertEquals(
            TimerFallback.LIGHT_ON,
            WidgetLive.fallback(windows, todayOffMinutes = 210, state = "on", nowMs = now),
        )
        // Минуты есть, а окон в снимке нет — обіцяти «не вимикатимуть» не можна.
        assertEquals(
            TimerFallback.LIGHT_ON,
            WidgetLive.fallback(emptyList(), todayOffMinutes = 45, state = "on", nowMs = now),
        )
    }

    @Test
    fun `перенос окна виден по смене подписи суток`() {
        val now = kyiv("2026-10-30", "08:00")
        val was = kyiv("2026-10-30", "09:30")
        val moved = listOf(WidgetWindow(kyiv("2026-10-30", "17:00"), kyiv("2026-10-30", "20:00")))

        val shift = WidgetLive.detectShift(listOf(was), moved, now)
        assertEquals(ScheduleShift.MOVED, shift?.kind)
        assertEquals(was, shift?.fromMs)
        assertEquals(kyiv("2026-10-30", "17:00"), shift?.toMs)

        // Та же подпись — это не перенос, а обычная перерисовка раз в минуту.
        assertNull(WidgetLive.detectShift(listOf(kyiv("2026-10-30", "17:00")), moved, now))
        // Завтрашний график не сравниваем с сегодняшним: новый день, а не перенос.
        assertNull(
            WidgetLive.detectShift(
                listOf(kyiv("2026-10-30", "23:30")),
                listOf(WidgetWindow(kyiv("2026-10-31", "01:00"), kyiv("2026-10-31", "04:00"))),
                kyiv("2026-10-30", "23:00"),
            ),
        )
    }

    @Test
    fun `прошедшее окно не выдаёт себя за перенос`() {
        // В 14:00 окно 09:30 уже позади: сравнивать его не с чем, и «перенесли» тут не бывает.
        val now = kyiv("2026-10-30", "14:00")
        assertNull(
            WidgetLive.detectShift(
                listOf(kyiv("2026-10-30", "09:30")),
                listOf(WidgetWindow(kyiv("2026-10-30", "17:00"), kyiv("2026-10-30", "20:00"))),
                now,
            ),
        )
    }

    @Test
    fun `исчезнувшие окна — это отмена`() {
        val now = kyiv("2026-10-30", "14:00")
        val shift = WidgetLive.detectShift(listOf(kyiv("2026-10-30", "17:00")), emptyList(), now)
        assertEquals(ScheduleShift.CANCELLED, shift?.kind)
        assertNull(shift?.toMs)
        // А если из снимка ушло уже прошедшее окно — это не отмена, а просто устаревшая запись.
        assertNull(WidgetLive.detectShift(listOf(kyiv("2026-10-30", "09:30")), emptyList(), now))
    }

    @Test
    fun `ключ суток режется по киевской полуночи`() {
        val morning = WidgetLive.dayKey(kyiv("2026-10-30", "00:01"))
        val evening = WidgetLive.dayKey(kyiv("2026-10-30", "23:59"))
        val next = WidgetLive.dayKey(kyiv("2026-10-31", "00:01"))
        assertEquals(morning, evening)
        assertEquals(24L * 60L * 60L * 1000L, next - evening)
    }
}
