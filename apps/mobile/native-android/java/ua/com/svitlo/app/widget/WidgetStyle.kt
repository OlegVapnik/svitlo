package ua.com.svitlo.app.widget

import android.graphics.Color
import ua.com.svitlo.app.R

/**
 * Визуальный язык виджетов: один статус — одна точка, один тип места — одна Lucide-иконка.
 *
 * Эмодзи из виджетов убраны: в системном шрифте они выглядят разноцветно и по-разному на
 * каждом OEM, а на HyperOS часть глифов вообще превращается в «тофу». Векторные иконки
 * рисуются одинаково и не дублируют друг друга.
 */
object WidgetStyle {
    const val GREEN = "#10B981"
    const val AMBER = "#F59E0B"
    const val ROSE = "#F43F5E"
    const val ZINC = "#A1A1AA"
    const val MUTED = "#71717A"
    const val INK = "#FFFFFF"
    const val INK_SOFT = "#D4D4D8"

    /** Точка состояния — цветной кружок без текста и без эмодзи. */
    fun dot(state: String): Int = when (state) {
        "on", "allClear" -> R.drawable.widget_dot_on
        "warning" -> R.drawable.widget_dot_warning
        "off" -> R.drawable.widget_dot_off
        else -> R.drawable.widget_dot_unknown
    }

    /**
     * Lucide-иконка типа места.
     *
     * Принимает и ключ (`home`, `work`, …), и старое эмодзи из OTA-бандла: приложение и APK
     * обновляются отдельно, поэтому виджет не должен ломаться на переходный период.
     */
    fun placeIcon(icon: String): Int = when (icon) {
        "home", "🏠", "🏡" -> R.drawable.ic_widget_home
        "work", "💼", "🧳" -> R.drawable.ic_widget_work
        "family", "👨‍👩‍👧", "👪", "👨‍👩‍👧‍👦" -> R.drawable.ic_widget_family
        "dacha", "🌳", "🌲", "🍃" -> R.drawable.ic_widget_dacha
        "garage", "🚗", "🚙", "🏠‍🚗" -> R.drawable.ic_widget_garage
        "office", "🏢", "🏬" -> R.drawable.ic_widget_office
        "school", "🎓", "🏫", "📚" -> R.drawable.ic_widget_school
        "star", "⭐", "🌟" -> R.drawable.ic_widget_star
        else -> R.drawable.ic_widget_pin
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
