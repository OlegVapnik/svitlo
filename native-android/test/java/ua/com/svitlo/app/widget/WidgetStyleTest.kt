package ua.com.svitlo.app.widget

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Контракт виджета без телефона: форматирование плиток и нормализация шкалы.
 *
 * `null` здесь — «графика нет», а ноль — «отключений не было». Если эти два случая
 * схлопнуть, виджет начнёт уверять, что света не выключали, хотя оператор ещё молчит.
 */
class WidgetStyleTest {
    @Test
    fun `нет графика отличается от нуля минут`() {
        // null — оператор ещё молчит, 0 — отключений не было. Схлопывать нельзя.
        assertNull(WidgetLive.outageLength(null))
        assertEquals(OutageLength(0, 0, isZero = true), WidgetLive.outageLength(0))
    }

    @Test
    fun `минуты отключений раскладываются на часы и минуты`() {
        assertEquals(OutageLength(0, 30, isZero = false), WidgetLive.outageLength(30))
        assertEquals(OutageLength(1, 0, isZero = false), WidgetLive.outageLength(60))
        assertEquals(OutageLength(2, 30, isZero = false), WidgetLive.outageLength(150))
    }

    @Test
    fun `точка состояния возвращает валидный ресурс`() {
        assert(WidgetStyle.dot("on") != 0)
        assert(WidgetStyle.dot("allClear") != 0)
        assert(WidgetStyle.dot("warning") != 0)
        assert(WidgetStyle.dot("off") != 0)
        assert(WidgetStyle.dot("unknown") != 0)
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
