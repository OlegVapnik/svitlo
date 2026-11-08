package ua.com.svitlo.app.widget

/**
 * Размер экземпляра виджета в dp и производные режимы раскладки.
 *
 * Зачем отдельный тип: `RemoteViews` не умеет медиа-запросов, а одна и та же разметка живёт
 * и в 2×1 (≈110×40dp), и в растянутой 4×2. HyperOS сообщает реальные `OPTION_APPWIDGET_MIN_*`
 * и в `onUpdate`, и в `onAppWidgetOptionsChanged`, поэтому провайдер может честно выбрать
 * «компактную» шапку вместо того, чтобы гадать по XML.
 *
 * Логика намеренно без `Bundle`: так её проверяет обычный JVM-тест (`WidgetMetricsTest`),
 * без Robolectric и эмулятора.
 */
data class WidgetMetrics(val widthDp: Int, val heightDp: Int) {

    /**
     * Узкая ячейка: шапке физически не хватает места на название места, очередь и статус.
     *
     * 176dp — порог по замеру: «Дім» + «2/2» + «За графіком» в 11/8/10sp занимают ≈150dp,
     * плюс точка, отступы и паддинги карточки. Всё, что уже этого, отдаёт ширину названию,
     * а код очереди остаётся в застосунке: он есть на главном экране и в плитке.
     */
    val compactHeader: Boolean
        get() = widthDp in 1..COMPACT_WIDTH_DP

    /** Высокая ячейка (2×2 и больше): в капсуле снова есть место для подписи таймера. */
    val tall: Boolean
        get() = heightDp >= TALL_HEIGHT_DP

    companion object {
        /** Размер неизвестен (лаунчер не прислал OPTION_*): рисуем полную шапку. */
        val UNKNOWN = WidgetMetrics(0, 0)

        const val COMPACT_WIDTH_DP = 176
        const val TALL_HEIGHT_DP = 96
    }
}
