package ua.com.svitlo.app.widget

import android.graphics.Color
import ua.com.svitlo.app.R

/**
 * Визуальный язык виджетов: один статус — один символ, цвет и фон.
 *
 * Символы намеренно разные по форме (`●`, `◆`, `■`), а не только по цвету: дальтоник
 * отличает «светло» от «выключено» без оттенка. Это те же три состояния, что в Hero-карточке
 * и шторке, поэтому виджет не спорит с приложением.
 */
object WidgetStyle {
    const val GREEN = "#10B981"
    const val AMBER = "#F59E0B"
    const val ROSE = "#F43F5E"
    const val ZINC = "#A1A1AA"
    const val MUTED = "#71717A"
    const val INK = "#FFFFFF"
    const val INK_SOFT = "#D4D4D8"

    fun symbol(state: String): String = when (state) {
        "on", "allClear" -> "●"
        "warning" -> "◆"
        "off" -> "■"
        else -> "•"
    }

    fun color(state: String): Int = Color.parseColor(
        when (state) {
            "on", "allClear" -> GREEN
            "warning" -> AMBER
            "off" -> ROSE
            else -> MUTED
        },
    )

    /** Фон капсулы 2×1: сплошной акцент состояния, как требует макет. */
    fun capsuleBackground(state: String): Int = when (state) {
        "on", "allClear" -> R.drawable.widget_capsule_on
        "warning" -> R.drawable.widget_capsule_warning
        "off" -> R.drawable.widget_capsule_off
        else -> R.drawable.widget_capsule_unknown
    }

    /**
     * «4 год 30 хв без світла» / «Без відключень» / «Графік очікується».
     *
     * `null` — графика нет, а не ноль: пустой ответ оператора нельзя выдавать за «света не
     * выключали». Текст считается здесь, а не в XML, потому что число приходит из JS.
     */
    fun offLabel(minutes: Int?, unknown: String): String {
        if (minutes == null) return unknown
        if (minutes <= 0) return "Без відключень"
        val hours = minutes / 60
        val rest = minutes % 60
        return when {
            hours == 0 -> "$rest хв без світла"
            rest == 0 -> "$hours год без світла"
            else -> "$hours год $rest хв без світла"
        }
    }
}
