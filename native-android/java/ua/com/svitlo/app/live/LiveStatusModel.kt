package ua.com.svitlo.app.live

import android.content.Context
import ua.com.svitlo.app.R
import ua.com.svitlo.app.widget.WidgetCountdown
import ua.com.svitlo.app.widget.WidgetLive
import ua.com.svitlo.app.widget.WidgetPayload

/**
 * Чистая логика статуса для QS-плитки и постоянной плашки.
 *
 * Здесь нет диалога с Context: модель возвращает enum-состояния, long-времена и
 * [LiveText] — пару (resId, args), которую проверяют через context.getString
 * Вся кириллица живёт в res/values/live_strings.xml (урок 2.41.4: кракозябры в
 * Kotlin-литералах приезжают на устройство в том же виде, что и в исходнике).
 */
enum class LiveState { ON, WARNING, OFF, UNKNOWN }

/** Выбор smallIcon: свет есть / скорое отключение / отключение. */
enum class LiveIcon { POWER_ON, POWER_SOON, POWER_OFF }

/** Три сборки плитки: активна, выключена, нет данных. */
enum class LiveTileState { ACTIVE, INACTIVE, UNAVAILABLE }

/**
 * Форматированный текст: ресурс + аргументы.
 *
 * В args разрешены Int/Long/String и вложенный [LiveText] (например, подпись
 * «45 хв» внутри строки «До 12:00 · 45 хв») — [format] разворачивает рекурсивно.
 */
data class LiveText(val resId: Int, val args: List<Any> = emptyList()) {
    fun format(context: Context): String =
        context.getString(resId, *args.map { resolveArg(context, it) }.toTypedArray())

    private fun resolveArg(context: Context, arg: Any): Any = when (arg) {
        is LiveText -> arg.format(context)
        is Long -> arg
        is Int -> arg
        is String -> arg
        else -> arg.toString()
    }
}

/** Прогресс текущего окна отключения: (total, elapsed) в минутах. */
data class LiveProgress(val totalMinutes: Int, val elapsedMinutes: Int)

data class LiveStatus(
    val state: LiveState,
    /** Черга, как в виджетах (payload.queue). */
    val queue: String?,
    /** Подпись черги «6/1» (payload.queueLabel). */
    val queueLabel: String?,
    val placeLabel: String?,
    /** untilOn — ждём свет, untilOff — ждём отключение, null — неизвестно. */
    val mode: String?,
    /** Цель общего хронометра (epoch ms). */
    val targetAtMs: Long?,
    /** Начало и конец текущего окна — источник прогресса. */
    val windowStartMs: Long?,
    val windowEndMs: Long?,
    val todayOffMinutes: Int?,
)

object LiveStatusModel {
    /** За полчаса до отключения плитка/плашка переходят в режим «скоро вимкнуть». */
    const val WARNING_SOON_MS = 30 * 60_000L

    fun statusOf(payload: WidgetPayload, nowMs: Long): LiveStatus {
        val windows = payload.windowsToday
        val current = WidgetLive.currentWindow(windows, nowMs)
        val next = WidgetLive.nextWindow(windows, nowMs)
        val state = when {
            current != null -> LiveState.OFF
            next != null && (next.startMs - nowMs) in 0..WARNING_SOON_MS -> LiveState.WARNING
            windows.isNotEmpty() -> LiveState.ON
            // Без окон доверяем строке от JS: allClear — это всё ещё «свет есть».
            payload.state == "allClear" || payload.state == "on" -> LiveState.ON
            else -> LiveState.UNKNOWN
        }
        val countdown = WidgetLive.countdown(windows, nowMs)
        return LiveStatus(
            state = state,
            queue = payload.queue,
            queueLabel = payload.queueLabel,
            placeLabel = payload.placeLabel,
            mode = countdown?.mode,
            targetAtMs = countdown?.targetAt,
            windowStartMs = current?.startMs,
            windowEndMs = current?.endMs,
            todayOffMinutes = payload.todayOffMinutes,
        )
    }

    /** Состояние плитки — по фактическому окну, а не по payload.state. */
    fun tileState(status: LiveStatus): LiveTileState = when (status.state) {
        LiveState.OFF -> LiveTileState.INACTIVE
        LiveState.UNKNOWN -> LiveTileState.UNAVAILABLE
        else -> LiveTileState.ACTIVE
    }

    fun iconOf(status: LiveStatus): LiveIcon = when (status.state) {
        LiveState.WARNING -> LiveIcon.POWER_SOON
        LiveState.OFF -> LiveIcon.POWER_OFF
        else -> LiveIcon.POWER_ON
    }

    /** Основная строка плитки: состояние + черга. */
    fun tileLabel(status: LiveStatus): LiveText = when (status.state) {
        LiveState.OFF -> when (status.queue) {
            null -> LiveText(R.string.live_tile_off_plain)
            else -> LiveText(R.string.live_tile_off_queue, listOf(status.queue))
        }
        LiveState.UNKNOWN -> LiveText(R.string.live_tile_unavailable)
        else -> when (status.queue) {
            null -> LiveText(R.string.live_tile_on_plain)
            else -> LiveText(R.string.live_tile_on_queue, listOf(status.queue))
        }
    }

    /** Строка под основной в плитке (subtitle у Tile API): «До 12:00 · 45 хв»/«Увімкнуть о 15:30». */
    fun tileSubtitle(status: LiveStatus, nowMs: Long): LiveText? {
        val target = status.targetAtMs ?: return null
        if (target <= nowMs) return null
        val time = WidgetLive.clock(target)
        val remaining = WidgetLive.remaining(target, nowMs) ?: return LiveText(
            R.string.live_tile_until_on,
            listOf(time),
        )
        return when (status.mode) {
            WidgetCountdown.MODE_UNTIL_ON -> LiveText(R.string.live_tile_until_on, listOf(time))
            else -> LiveText(
                R.string.live_tile_until_off,
                listOf(
                    time,
                    LiveText(remainingResId(remaining.hours * 60 + remaining.minutes), listOf(remaining.hours * 60 + remaining.minutes)),
                ),
            )
        }
    }

    /** Ресурс подписи «менше хв»/«хв»/«год»/«год хв» — те же, что в виджетах. */
    fun remainingResId(remainingMinutes: Long): Int = when {
        remainingMinutes <= 0L -> R.string.widget_less_minute
        remainingMinutes < 60L -> R.string.widget_minutes_short
        remainingMinutes % 60L == 0L -> R.string.widget_hour_short
        else -> R.string.widget_hour_minute_short
    }

    /** Прогресс текущего окна: сколько минут оно длится и сколько прошло. */
    fun progressOf(payload: WidgetPayload, nowMs: Long): LiveProgress? {
        val window = WidgetLive.currentWindow(payload.windowsToday, nowMs) ?: return null
        val total = ((window.endMs - window.startMs) / 60_000L).toInt()
        if (total <= 0) return null
        val elapsed = ((nowMs - window.startMs) / 60_000L).toInt().coerceIn(0, total)
        return LiveProgress(totalMinutes = total, elapsedMinutes = elapsed)
    }

    /** Короткий текст promoted-chip (Android 14+): «до hh:mm» для открытия/отключения. */
    fun shortCriticalText(status: LiveStatus): LiveText? {
        val target = status.targetAtMs ?: return null
        val time = WidgetLive.clock(target)
        return when (status.mode) {
            WidgetCountdown.MODE_UNTIL_ON -> LiveText(R.string.live_chip_return, listOf(time))
            WidgetCountdown.MODE_UNTIL_OFF -> LiveText(R.string.live_chip_off, listOf(time))
            else -> null
        }
    }

    /** Заголовок плашки: «🟢 Дім · черга 6/1 — за графіком» (эмодзи и подпись в ресурсе). */
    fun notificationTitle(status: LiveStatus): LiveText {
        val titleRes = when (status.state) {
            LiveState.OFF -> R.string.live_notif_title_off
            LiveState.WARNING -> R.string.live_notif_title_warning
            else -> R.string.live_notif_title_on
        }
        return LiveText(titleRes, listOf(subjectOf(status)))
    }

    private fun subjectOf(status: LiveStatus): String {
        val place = status.placeLabel?.takeIf { it.isNotBlank() }
        val queue = status.queueLabel?.takeIf { it.isNotBlank() }
        // Разделитель «·» — пунктуация, не кириллица: безопасна прямо в коде.
        return when {
            place != null && queue != null -> "$place · $queue"
            place != null -> place
            queue != null -> queue
            else -> ""
        }
    }

    /** Тело плашки: «Наступне вікно: 12:00–15:30 · Сьогодні без світла: 6 год 30 хв». */
    fun notificationBody(status: LiveStatus): LiveText? {
        val windowText = windowRangeText(status)
        val outage = outageText(status.todayOffMinutes)
        return when {
            windowText != null && outage != null -> LiveText(
                R.string.live_notif_body,
                listOf(windowText, outage),
            )
            windowText != null -> LiveText(R.string.live_notif_window_only, listOf(windowText))
            outage != null -> LiveText(R.string.live_notif_outage_only, listOf(outage))
            else -> null
        }
    }

    /** Строка текущего окна отключения: «12:00–15:30» (только цифры и dash). */
    fun windowRangeText(status: LiveStatus): String? {
        val start = status.windowStartMs ?: return null
        val end = status.windowEndMs ?: return null
        if (end <= start) return null
        return "${WidgetLive.clock(start)}–${WidgetLive.clock(end)}"
    }

    /** «6 год 30 хв без світла» / «45 хв без світла» / «Без відключень» — числа в args. */
    fun outageText(totalMinutes: Int?): LiveText? {
        if (totalMinutes == null || totalMinutes <= 0) return null
        return when {
            totalMinutes < 60 -> LiveText(R.string.widget_minutes_without_power, listOf(totalMinutes))
            totalMinutes % 60 == 0 -> LiveText(R.string.widget_hours_without_power, listOf(totalMinutes / 60))
            else -> LiveText(
                R.string.widget_hours_minutes_without_power,
                listOf(totalMinutes / 60, totalMinutes % 60),
            )
        }
    }
}
