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
    /** «Дім · 6/1» — название сохранённого места и очередь (без эмодзи). */
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
                            icon = place.optString("icon", "star"),
                            label = cleanLabel(place.optString("label", "")),
                            queue = place.optString("queue", ""),
                            state = place.optString("state", "unknown"),
                            timeLabel = place.optString("timeLabel", ""),
                            statusText = cleanLabel(place.optString("statusText", "Немає даних")),
                        )
                    }
                }
                WidgetPayload(
                    state = json.optNonEmptyString("state", "unknown"),
                    headline = json.optNonEmptyString("headline", "Немає даних"),
                    detail = cleanLabel(json.optNonEmptyString("detail", "")),
                    pill = cleanLabel(json.optNonEmptyString("pill", "Немає даних")),
                    timer = json.optNonEmptyString("timer", "").ifBlank { null }?.takeUnless { it == "null" },
                    timerPrefix = cleanLabel(json.optNonEmptyString("timerPrefix", "")).ifBlank { null }?.takeUnless { it == "null" },
                    queue = json.optNonEmptyString("queue", "").ifBlank { null }?.takeUnless { it == "null" },
                    slots = slots,
                    nowFraction = if (json.isNull("nowFraction")) {
                        null
                    } else {
                        json.optDouble("nowFraction").toFloat()
                    },
                    offMinutes = json.optInt("offMinutes", 0),
                    updatedAt = json.optLong("updatedAt", 0L),
                    placeLabel = cleanLabel(json.optNonEmptyString("placeLabel", "")).ifBlank { "Мій графік" }.takeUnless { it == "null" } ?: "Мій графік",
                    todayOffMinutes = json.optNullableInt("todayOffMinutes"),
                    tomorrowOffMinutes = json.optNullableInt("tomorrowOffMinutes"),
                    places = places,
                )
            }.getOrNull()
        }

        /**
         * Убирает эмодзи и variation selectors из старых OTA-снимков.
         *
         * Новый JS присылает чистые подписи, но APK и бандл обновляются раздельно: пока
         * сервер отдаёт прежний снимок, «🏠 Дім · 6/1» не должно вернуть эмодзи в виджет.
         * `\p{So}` — прочие символы (эмодзи), `\p{Sk}` — модификаторы, плюс ZWJ/VS16.
         */
        fun cleanLabel(value: String): String =
            value
                .replace(Regex("[\\p{So}\\p{Sk}\\uFE0F\\u200D]"), "")
                .replace(Regex("\\s{2,}"), " ")
                .trim()

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
    /** Ключ Lucide-иконки: home, work, family, dacha, garage, office, school, star. */
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

private fun JSONObject.optNonEmptyString(key: String, fallback: String): String {
    if (!has(key) || isNull(key)) return fallback
    val value = optString(key, fallback)
    return if (value == "null") fallback else value
}
