package ua.com.svitlo.app.live

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import ua.com.svitlo.app.R
import ua.com.svitlo.app.widget.WidgetCountdown
import ua.com.svitlo.app.widget.WidgetPayload

/**
 * JVM-тесты чистой модели статуса: состояния, иконки, прогресс окна, короткие тексты.
 *
 * Тестируется то, что рисуют уведомление и QS-плитка. Payload идёт через
 * WidgetPayload.parse — тот же путь, что и на устройстве, с теми же JSON-окнами.
 */
class LiveStatusModelTest {
    private val base = System.currentTimeMillis()

    /** Окно «начало–конец» — окно today, собранное в JSON Payload. */
    private fun payloadWith(
        windows: List<Pair<Long, Long>?>,
        state: String = "on",
        queue: String = "6",
        queueLabel: String = "6/1",
        todayOffMinutes: Int? = 390,
    ): WidgetPayload {
        val windowsJson = windows.filterNotNull().joinToString(",") { "[${it.first},${it.second}]" }
        val queueJson = if (queue.isEmpty()) "null" else "\"$queue\""
        val queueLabelJson = if (queueLabel.isEmpty()) "null" else "\"$queueLabel\""
        val offJson = if (todayOffMinutes == null) "null" else "$todayOffMinutes"
        val json = "{\"state\":\"$state\",\"headline\":\"head\",\"detail\":\"next\",\"queue\":$queueJson," +
            "\"placeLabel\":\"Dim\",\"queueLabel\":$queueLabelJson,\"todayOffMinutes\":$offJson," +
            "\"windowsToday\":[$windowsJson]}"
        return WidgetPayload.parse(json)!!
    }

    private fun statusOnly(windows: List<Pair<Long, Long>?>, params: Pair<String, Int?> = "on" to 390): LiveStatus =
        LiveStatusModel.statusOf(payloadWith(windows, state = params.first, todayOffMinutes = params.second), base)

    @Test
    fun insideWindowIsOffWithUntilOnCountdown() {
        val start = base - HOUR
        val end = base + HOUR
        val status = statusOnly(listOf(start to end, end to end + HOUR))

        assertEquals(LiveState.OFF, status.state)
        assertEquals(WidgetCountdown.MODE_UNTIL_ON, status.mode)
        assertEquals(end, status.targetAtMs)
        assertEquals(start, status.windowStartMs)
        assertEquals(LiveTileState.INACTIVE, LiveStatusModel.tileState(status))
        assertEquals(LiveIcon.POWER_OFF, LiveStatusModel.iconOf(status))
    }

    @Test
    fun twentyMinutesBeforeWindowIsWarning() {
        val soon = base + 20 * 60_000L
        val status = statusOnly(listOf(soon to soon + HOUR))

        assertEquals(LiveState.WARNING, status.state)
        assertEquals(WidgetCountdown.MODE_UNTIL_OFF, status.mode)
        assertEquals(soon, status.targetAtMs)
        assertEquals(LiveIcon.POWER_SOON, LiveStatusModel.iconOf(status))
        assertEquals(LiveTileState.ACTIVE, LiveStatusModel.tileState(status))
    }

    @Test
    fun twoHoursBeforeWindowIsPlainOn() {
        val later = base + 2 * HOUR
        val status = statusOnly(listOf(later to later + HOUR))

        assertEquals(LiveState.ON, status.state)
        assertEquals(LiveIcon.POWER_ON, LiveStatusModel.iconOf(status))
        assertEquals(LiveTileState.ACTIVE, LiveStatusModel.tileState(status))

        // allClear — то же «свет есть» для плитки и плашки.
        assertEquals(LiveState.ON, statusOnly(listOf(null), "allClear" to null).state)
    }

    @Test
    fun unknownStateRendersUnavailableTile() {
        val status = statusOnly(listOf(null), "unknown" to null)

        assertEquals(LiveState.UNKNOWN, status.state)
        assertEquals(LiveTileState.UNAVAILABLE, LiveStatusModel.tileState(status))
    }

    @Test
    fun progressFollowsCurrentWindow() {
        val start = base - 30 * 60_000L
        val end = base + 90 * 60_000L
        val progress = LiveStatusModel.progressOf(payloadWith(listOf(start to end)), base)

        assertEquals(120, progress!!.totalMinutes)
        assertEquals(30, progress.elapsedMinutes)
        // Вне окна бара нет.
        assertNull(LiveStatusModel.progressOf(payloadWith(listOf(base + HOUR to base + 2 * HOUR)), base))
    }

    @Test
    fun remainingFormatChoosesUnit() {
        assertEquals(R.string.widget_less_minute, LiveStatusModel.remainingResId(0))
        assertEquals(R.string.widget_minutes_short, LiveStatusModel.remainingResId(45))
        assertEquals(R.string.widget_hour_short, LiveStatusModel.remainingResId(120))
        assertEquals(R.string.widget_hour_minute_short, LiveStatusModel.remainingResId(95))
    }

    @Test
    fun shortCriticalTextDependsOnCountdownMode() {
        val off = statusOnly(listOf(base - HOUR to base + HOUR))
        assertEquals(R.string.live_chip_return, LiveStatusModel.shortCriticalText(off)!!.resId)

        val on = statusOnly(listOf(base + HOUR to base + 2 * HOUR))
        assertEquals(R.string.live_chip_off, LiveStatusModel.shortCriticalText(on)!!.resId)
    }

    @Test
    fun notificationBodyCombinesWindowAndDailyCounter() {
        val status = statusOnly(listOf(base - HOUR to base + HOUR), "off" to 95)
        val body = LiveStatusModel.notificationBody(status)!!

        assertEquals(R.string.live_notif_body, body.resId)
        assertTrue((body.args[0] as String).isNotBlank())
        assertTrue(body.args[1] is LiveText)

        // Только счётчик за день, без текущего окна.
        val onlyOutage = statusOnly(listOf(null), "on" to 45)
        assertEquals(R.string.live_notif_outage_only, LiveStatusModel.notificationBody(onlyOutage)!!.resId)

        // Ни окна, ни счётчика — тела нет.
        assertNull(LiveStatusModel.notificationBody(statusOnly(listOf(null), "unknown" to null)))
    }

    @Test
    fun outageTextFormatsHoursAndMinutes() {
        val mixed = LiveStatusModel.outageText(390)!!
        assertEquals(R.string.widget_hours_minutes_without_power, mixed.resId)
        assertEquals(6, mixed.args[0])
        assertEquals(30, mixed.args[1])

        assertEquals(R.string.widget_minutes_without_power, LiveStatusModel.outageText(45)!!.resId)
        assertNull(LiveStatusModel.outageText(null))
        assertNull(LiveStatusModel.outageText(0))
    }

    @Test
    fun tileLabelDistinguishesQueueAndPlainLight() {
        val withQueue = LiveStatusModel.tileLabel(statusOnly(listOf(null)))
        assertEquals(R.string.live_tile_on_queue, withQueue.resId)
        assertEquals("6", withQueue.args[0])

        val noQueue = LiveStatusModel.tileLabel(
            LiveStatusModel.statusOf(
                payloadWith(listOf(null), queue = "", queueLabel = ""),
                base,
            ),
        )
        assertEquals(R.string.live_tile_on_plain, noQueue.resId)
    }

    @Test
    fun offlinePayloadWithoutWindowsDoesNotCrashModel() {
        // Битое окно (конец раньше начала) отбрасывается parse — статус честно UNKNOWN.
        val broken = WidgetPayload.parse(
            "{\"state\":\"unknown\",\"windowsToday\":[[$base,${base - HOUR}]]}",
        )!!
        assertEquals(LiveState.UNKNOWN, LiveStatusModel.statusOf(broken, base).state)
        assertTrue(LiveStatusModel.statusOf(broken, base).targetAtMs == null)
    }

    private companion object {
        private const val HOUR = 3_600_000L
    }
}
