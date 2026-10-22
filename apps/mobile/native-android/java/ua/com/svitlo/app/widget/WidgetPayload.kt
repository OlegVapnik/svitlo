package ua.com.svitlo.app.widget

import android.graphics.Color
import org.json.JSONArray
import org.json.JSONObject

/**
 * Данные, которые JS отдаёт виджету.
 *
 * Формат намеренно плоский: виджет рисуется без React, а `org.json` уже есть в Android —
 * тащить Gson/Moshi ради семи полей незачем. Неизвестные поля игнорируются, поэтому
 * приложение и виджет можно обновлять по отдельности (OTA-бандл и APK живут в разное время).
 */
data class WidgetPayload(
    val state: String,
    val headline: String,
    val detail: String,
    val pill: String,
    val timer: String?,
    val timerPrefix: String?,
    val queue: String?,
    /** 48 получасовых слотов: 3 — відключення, 2 — можливе, 1 — світло, null — немає даних. */
    val slots: List<Int?>,
    /** Позиция «зараз» на суточной шкале 0…1; null — не сегодня. */
    val nowFraction: Float?,
    val offMinutes: Int,
    val updatedAt: Long,
    /** «🏠 Дім · 6/1» — название сохранённого места и очередь. */
    val placeLabel: String,
    /** Минуты без света за сегодня; null — графика нет. */
    val todayOffMinutes: Int?,
    /** Минуты без света за завтра; null — график ещё не опубликован. */
    val tomorrowOffMinutes: Int?,
    /** До трёх сохранённых мест для виджета «Радар». */
    val places: List<WidgetPlace>,
) {
    companion object {
        fun parse(raw: String?): WidgetPayload? {
            if (raw.isNullOrBlank()) return null
            return runCatching {
                val json = JSONObject(raw)
                val array = json.optJSONArray("slots") ?: JSONArray()
                val slots = (0 until array.length()).map { index ->
                    if (array.isNull(index)) null else array.optInt(index)
                }
                val placesArray = json.optJSONArray("places") ?: JSONArray()
                val places = (0 until placesArray.length()).mapNotNull { index ->
                    placesArray.optJSONObject(index)?.let { place ->
                        WidgetPlace(
                            icon = place.optString("icon", "⭐"),
                            label = place.optString("label", ""),
                            queue = place.optString("queue", ""),
                            state = place.optString("state", "unknown"),
                            timeLabel = place.optString("timeLabel", ""),
                            statusText = place.optString("statusText", "Немає даних"),
                        )
                    }
                }
                WidgetPayload(
                    state = json.optString("state", "unknown"),
                    headline = json.optString("headline", "Немає даних"),
                    detail = json.optString("detail", ""),
                    pill = json.optString("pill", "Немає даних"),
                    timer = json.optString("timer", "").ifBlank { null },
                    timerPrefix = json.optString("timerPrefix", "").ifBlank { null },
                    queue = json.optString("queue", "").ifBlank { null },
                    slots = slots,
                    nowFraction = if (json.isNull("nowFraction")) {
                        null
                    } else {
                        json.optDouble("nowFraction").toFloat()
                    },
                    offMinutes = json.optInt("offMinutes", 0),
                    updatedAt = json.optLong("updatedAt", 0L),
                    placeLabel = json.optString("placeLabel", "").ifBlank { "Мій графік" },
                    todayOffMinutes = json.optNullableInt("todayOffMinutes"),
                    tomorrowOffMinutes = json.optNullableInt("tomorrowOffMinutes"),
                    places = places,
                )
            }.getOrNull()
        }

        /**
         * Тон состояния — те же значения, что `notificationColor` в приложении.
         *
         * Виджет обязан совпадать с Hero-карточкой и шторкой: три поверхности, один факт.
         */
        fun colorFor(state: String): Int = when (state) {
            "on", "allClear" -> Color.parseColor("#10B981")
            "warning" -> Color.parseColor("#F59E0B")
            "off" -> Color.parseColor("#F43F5E")
            else -> Color.parseColor("#71717A")
        }

        /** Заглушка до первой синхронизации: виджет не должен выглядеть сломанным. */
        fun placeholder(): WidgetPayload = WidgetPayload(
            state = "unknown",
            headline = "Немає даних",
            detail = "Відкрийте Svitlo, щоб завантажити графік",
            pill = "Немає даних",
            timer = null,
            timerPrefix = null,
            queue = null,
            slots = List(48) { null },
            nowFraction = null,
            offMinutes = 0,
            updatedAt = 0L,
            placeLabel = "Мій графік",
            todayOffMinutes = null,
            tomorrowOffMinutes = null,
            places = emptyList(),
        )
    }
}

/** Одно сохранённое место в виджете «Радар моїх місць». */
data class WidgetPlace(
    val icon: String,
    val label: String,
    val queue: String,
    val state: String,
    val timeLabel: String,
    val statusText: String,
)

/** `null` отличается от нуля: ноль — «света не выключали», null — «графика нет». */
private fun JSONObject.optNullableInt(key: String): Int? =
    if (!has(key) || isNull(key)) null else optInt(key)
