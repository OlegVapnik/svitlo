package ua.com.svitlo.app.widget

/**
 * Приведение текста к виду, который безопасно едет в `RemoteViews`.
 *
 * Зачем отдельный объект:
 *  - переводы строк и управляющие символы в `TextView` с `maxLines=1` дают обрезанные
 *    «хвосты» и лишнюю высоту, а на части прошивок — заметные артефакты измерения;
 *  - строка из JS может прийти со значением `"null"`/`"undefined"` (JSON.stringify так
 *    сериализует отсутствующее поле), и тогда на виджете появляется слово «null»;
 *  - очень длинная подпись увеличивает Binder-пакет при каждом обновлении, а лимит там
 *    общий на все действия RemoteViews.
 *
 * Логика намеренно без Android-зависимостей: её проверяет обычный JVM-тест без эмулятора.
 */
object WidgetText {
    /** Верхняя граница подписи: больше в 4×1 и 2×1 всё равно не влезает. */
    const val MAX_LENGTH = 96

    private val control = Regex("[\\u0000-\\u001F\\u007F]+")
    private val spaces = Regex("\\s+")
    private val placeholder = Regex("^(null|undefined|nan)$", RegexOption.IGNORE_CASE)

    fun sanitize(value: String?, fallback: String = "", maxLength: Int = MAX_LENGTH): String {
        if (value == null) return fallback
        val flat = value
            .replace(control, " ")
            .replace(spaces, " ")
            .trim()
        if (flat.isEmpty() || placeholder.matches(flat)) return fallback
        if (flat.length <= maxLength) return flat
        // Многоточие — единственный символ, который добавляем сами: он не ломает UTF-16
        // суррогатные пары, потому что обрезаем по границе code point.
        val cut = flat.offsetByCodePoints(0, flat.codePointCount(0, flat.length).coerceAtMost(maxLength - 1))
        return flat.substring(0, cut).trimEnd() + "…"
    }
}
