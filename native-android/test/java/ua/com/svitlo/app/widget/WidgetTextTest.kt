package ua.com.svitlo.app.widget

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Текст, который уезжает в `RemoteViews`, проходит через `WidgetText.sanitize`.
 *
 * Тест фиксирует три вещи, из-за которых виджет ломался на телефоне:
 *  - переводы строк и управляющие символы превращаются в пробелы (иначе `TextView`
 *    с `maxLines=1` на части прошивок считает высоту неправильно);
 *  - `"null"`/`"undefined"` из `JSON.stringify` не должны попадать на экран словом «null»;
 *  - длинная подпись обрезается по границе code point, а не по UTF-16 юниту, иначе
 *    эмодзи распадается на «половинки» и Android рисует квадрат.
 */
class WidgetTextTest {
    @Test
    fun `переводы строк и табуляции схлопываются в один пробел`() {
        assertEquals("Графік очікується", WidgetText.sanitize("Графік\nочікується"))
        assertEquals("Графік очікується", WidgetText.sanitize("  Графік \t очікується  "))
        assertEquals("a b c", WidgetText.sanitize("a\n\nb\t\tc"))
    }

    @Test
    fun `управляющие символы не попадают в виджет`() {
        assertEquals("Світло є", WidgetText.sanitize("Світло\u0000є\u007F"))
        assertEquals("Черга 3", WidgetText.sanitize("Черга\u00023"))
    }

    @Test
    fun `null undefined и NaN дают заглушку`() {
        assertEquals("Немає даних", WidgetText.sanitize(null, "Немає даних"))
        assertEquals("Немає даних", WidgetText.sanitize("null", "Немає даних"))
        assertEquals("Немає даних", WidgetText.sanitize("undefined", "Немає даних"))
        assertEquals("Немає даних", WidgetText.sanitize("NaN", "Немає даних"))
        assertEquals("Немає даних", WidgetText.sanitize("   ", "Немає даних"))
    }

    @Test
    fun `пустой fallback остаётся пустой строкой`() {
        assertEquals("", WidgetText.sanitize(null))
        assertEquals("", WidgetText.sanitize("null"))
    }

    @Test
    fun `короткая строка не трогается`() {
        assertEquals("Черга 35/1", WidgetText.sanitize("Черга 35/1"))
        assertEquals("x".repeat(WidgetText.MAX_LENGTH), WidgetText.sanitize("x".repeat(WidgetText.MAX_LENGTH)))
    }

    @Test
    fun `длинная строка обрезается с многоточием`() {
        val trimmed = WidgetText.sanitize("x".repeat(200))
        assertEquals(WidgetText.MAX_LENGTH, trimmed.length)
        assertTrue(trimmed.endsWith("…"))
    }

    @Test
    fun `свой лимит соблюдается`() {
        assertEquals("abcd…", WidgetText.sanitize("abcdefgh", maxLength = 5))
        assertEquals(5, WidgetText.sanitize("abcdefgh", maxLength = 5).length)
    }

    @Test
    fun `эмодзи не разрезается пополам`() {
        val trimmed = WidgetText.sanitize("😀😀😀😀😀", maxLength = 3)
        assertTrue(trimmed.endsWith("…"))
        // Суррогатная пара не должна остаться одна: длина в UTF-16 юнитах
        // всегда чётна, если все символы — астральные.
        assertEquals("😀😀…", trimmed)
    }

    @Test
    fun `кириллица и апостроф не портятся`() {
        assertEquals("Світло є до 18:30", WidgetText.sanitize("Світло є до 18:30"))
        assertEquals("П'ять груп", WidgetText.sanitize("П'ять груп"))
    }
}
