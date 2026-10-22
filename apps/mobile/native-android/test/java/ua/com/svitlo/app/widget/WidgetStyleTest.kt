package ua.com.svitlo.app.widget

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Контракт виджета без телефона: форматирование плиток и нормализация шкалы.
 *
 * `null` здесь — «графика нет», а ноль — «отключений не было». Если эти два случая
 * схлопнуть, виджет начнёт уверять, что света не выключали, хотя оператор ещё молчит.
 */
class WidgetStyleTest {
    @Test
    fun `нет графика показывает переданную заглушку`() {
        assertEquals("Графік очікується", WidgetStyle.offLabel(null, "Графік очікується"))
        assertEquals("Немає даних", WidgetStyle.offLabel(null, "Немає даних"))
    }

    @Test
    fun `ноль минут это отсутствие отключений`() {
        assertEquals("Без відключень", WidgetStyle.offLabel(0, "Немає даних"))
    }

    @Test
    fun `минуты и часы склоняются по украински`() {
        assertEquals("30 хв без світла", WidgetStyle.offLabel(30, "Немає даних"))
        assertEquals("1 год без світла", WidgetStyle.offLabel(60, "Немає даних"))
        assertEquals("2 год 30 хв без світла", WidgetStyle.offLabel(150, "Немає даних"))
    }

    @Test
    fun `форма статуса отличается без цвета`() {
        assertEquals("●", WidgetStyle.symbol("on"))
        assertEquals("●", WidgetStyle.symbol("allClear"))
        assertEquals("◆", WidgetStyle.symbol("warning"))
        assertEquals("■", WidgetStyle.symbol("off"))
        assertEquals("•", WidgetStyle.symbol("unknown"))
    }

    @Test
    fun `шкала всегда 48 слотов`() {
        val actual = WidgetTimeline.normalizedSlots(listOf(3, 1))
        assertEquals(48, actual.size)
        assertEquals(3, actual[0])
        assertEquals(1, actual[1])
        assertEquals(null, actual[2])
    }

    @Test
    fun `лишние слоты отбрасываются`() {
        val actual = WidgetTimeline.normalizedSlots(List(60) { 1 })
        assertEquals(48, actual.size)
        assertEquals(1, actual[47])
    }
}
