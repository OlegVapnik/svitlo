package ua.com.svitlo.app.widget

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import kotlin.math.roundToInt

/**
 * Единственный растровый элемент виджета — суточная шкала.
 *
 * 48 получасовых сегментов нельзя нарисовать декларативно: `RemoteViews` не умеет повторять
 * view по данным. Поэтому шкала едет одним маленьким Bitmap 480×24 в `RGB_565` — это 23 КБ,
 * а не 1–2 МБ полноэкранной картинки, как было в старом Canvas-рендере. Текст `00…24` и весь
 * остальной интерфейс остаются нативными `TextView`, поэтому системный шрифт, масштаб и
 * доступность работают как в обычном приложении.
 */
object WidgetTimeline {
    const val WIDTH = 480
    const val HEIGHT = 24

    /** Нормализует слоты до ровно 48 значений; неизвестное — `null`. */
    fun normalizedSlots(slots: List<Int?>): List<Int?> = List(SLOTS) { index -> slots.getOrNull(index) }

    fun render(payload: WidgetPayload): Bitmap {
        val bitmap = Bitmap.createBitmap(WIDTH, HEIGHT, Bitmap.Config.RGB_565)
        val canvas = Canvas(bitmap)
        canvas.drawColor(Color.parseColor("#27272A"))

        // Paint создаётся здесь, а не в полях объекта: JVM-тесты вызывают normalizedSlots
        // без Android runtime, и статическая инициализация Paint уронила бы весь класс.
        val paint = Paint().apply { isAntiAlias = false }
        val slots = normalizedSlots(payload.slots)
        val segment = WIDTH.toFloat() / SLOTS
        slots.forEachIndexed { index, code ->
            paint.color = when (code) {
                3 -> Color.parseColor(WidgetStyle.ROSE)
                2 -> Color.parseColor(WidgetStyle.AMBER)
                1 -> Color.parseColor(WidgetStyle.GREEN)
                else -> Color.parseColor("#3F3F46")
            }
            val left = index * segment
            // Зазор в 1 px делает получасовые деления читаемыми без рамок.
            canvas.drawRect(left, 0f, left + segment - 1f, HEIGHT.toFloat(), paint)
        }

        payload.nowFraction?.let { fraction ->
            val x = (fraction.coerceIn(0f, 1f) * WIDTH).roundToInt()
                .coerceIn(1, WIDTH - 1)
                .toFloat()
            paint.color = Color.WHITE
            canvas.drawRect(x - 1f, 0f, x + 1f, HEIGHT.toFloat(), paint)
        }

        return bitmap
    }

    private const val SLOTS = 48
}
