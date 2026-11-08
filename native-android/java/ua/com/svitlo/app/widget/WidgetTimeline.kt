package ua.com.svitlo.app.widget

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import kotlin.math.roundToInt

/**
 * Единственный растровый элемент виджета — «змійка» суточной шкалы.
 *
 * 48 получасовых сегментов нельзя нарисовать декларативно: `RemoteViews` не умеет повторять
 * view по данным. Поэтому шкала едет одним маленьким Bitmap 960×48 в `RGB_565` — это ~92 КБ,
 * а не 1–2 МБ полноэкранной картинки, как было в старом Canvas-рендере.
 *
 * Рисунок повторяет [Timeline24h] с главного экрана: тёмная закруглённая дорожка, зазоры
 * между получасовыми блоками, диагональная штриховка отключений и белый маркер «зараз».
 * Соотношение сторон 20:1 совпадает и с капсулой 2×1 (9 dp), и с таймлайном 4×1 (18 dp).
 */
object WidgetTimeline {
    const val WIDTH = 960
    const val HEIGHT = 48

    private const val SLOTS = 48
    private const val SEGMENT_GAP = 1.5f
    private const val TRACK_RADIUS = 14f
    private const val SEGMENT_RADIUS = 5f
    private const val SEGMENT_TOP = 6f
    private const val SEGMENT_BOTTOM = 42f

    /** Нормализует слоты до ровно 48 значений; неизвестное — `null`. */
    fun normalizedSlots(slots: List<Int?>): List<Int?> = List(SLOTS) { index -> slots.getOrNull(index) }

    fun render(payload: WidgetPayload): Bitmap {
        val bitmap = Bitmap.createBitmap(WIDTH, HEIGHT, Bitmap.Config.RGB_565)
        val canvas = Canvas(bitmap)
        val paint = Paint().apply { isAntiAlias = true }

        // Дорожка: тот же #0c0c10 с тонким контуром, что и на главном экране.
        val track = RectF(0f, 0f, WIDTH.toFloat(), HEIGHT.toFloat())
        paint.style = Paint.Style.FILL
        paint.color = Color.parseColor("#0C0C10")
        canvas.drawRoundRect(track, TRACK_RADIUS, TRACK_RADIUS, paint)
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = 2f
        paint.color = Color.parseColor("#27272A")
        canvas.drawRoundRect(track, TRACK_RADIUS, TRACK_RADIUS, paint)
        paint.style = Paint.Style.FILL

        val slots = normalizedSlots(payload.slots)
        val segment = WIDTH.toFloat() / SLOTS
        val now = payload.nowFraction?.coerceIn(0f, 1f)
        val nowX = now?.let { it * WIDTH }

        slots.forEachIndexed { index, code ->
            val left = index * segment + SEGMENT_GAP / 2f
            val right = (index + 1) * segment - SEGMENT_GAP / 2f
            val rect = RectF(left, SEGMENT_TOP, right, SEGMENT_BOTTOM)
            val past = nowX != null && (left + right) / 2f < nowX
            val dim = if (past) 0.55f else 1f

            val (fill, border) = when (code) {
                3 -> Color.argb((0.42f * 255 * dim).roundToInt(), 244, 63, 94) to
                    Color.argb((0.65f * 255 * dim).roundToInt(), 244, 63, 94)
                2 -> Color.argb((0.35f * 255 * dim).roundToInt(), 245, 158, 11) to
                    Color.argb((0.60f * 255 * dim).roundToInt(), 245, 158, 11)
                1 -> Color.argb((0.28f * 255 * dim).roundToInt(), 16, 185, 129) to
                    Color.argb((0.45f * 255 * dim).roundToInt(), 16, 185, 129)
                else -> Color.parseColor("#27272A") to Color.parseColor("#3F3F46")
            }

            paint.style = Paint.Style.FILL
            paint.color = fill
            canvas.drawRoundRect(rect, SEGMENT_RADIUS, SEGMENT_RADIUS, paint)
            paint.style = Paint.Style.STROKE
            paint.strokeWidth = 2f
            paint.color = border
            canvas.drawRoundRect(rect, SEGMENT_RADIUS, SEGMENT_RADIUS, paint)
            paint.style = Paint.Style.FILL

            if (code == 3) drawHatch(canvas, rect, dim)
        }

        if (nowX != null) {
            val x = nowX.coerceIn(2f, WIDTH - 2f)
            paint.color = Color.WHITE
            paint.style = Paint.Style.FILL
            canvas.drawRoundRect(
                RectF(x - 2f, 2f, x + 2f, HEIGHT - 2f),
                2f,
                2f,
                paint,
            )
        }

        return bitmap
    }

    /**
     * Рендерит змейку прогресса («Squiggly Seekbar» / M3 Wavy Progress) для виджета 2×1 Капсула.
     *
     * Повторяет логику WavyProgressBar из приложения:
     * - Спокойный трек фонового цвета на всю ширину.
     * - Пройденная часть: плавная волна (Bézier синусоида) цвета текущего статуса.
     *   При отключении (off) — прямая линия.
     * - Оставшаяся часть: прямая линия.
     * - Белый бегунок-пилюля на стыке (позиция прогресса).
     */
    fun renderSquiggly(payload: WidgetPayload): Bitmap {
        val bitmap = Bitmap.createBitmap(WIDTH, HEIGHT, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val paint = Paint().apply {
            isAntiAlias = true
            strokeCap = Paint.Cap.ROUND
        }

        val midY = HEIGHT / 2f
        val rawPercent = (payload.progress ?: payload.nowFraction?.let { (it * 100f).roundToInt() } ?: 0).coerceIn(0, 100)
        val progressX = (rawPercent / 100f) * WIDTH

        // 1. Спокойный фоновый трек (track)
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = 6f
        paint.color = Color.parseColor("#27272A") // muted track
        canvas.drawLine(0f, midY, WIDTH.toFloat(), midY, paint)

        // 2. Волна пройденной части
        val toneColor = WidgetPayload.colorFor(payload.state)
        val isOff = payload.state == "off"
        val amplitude = if (isOff) 0f else 11f // амплитуда волны
        val wavelength = 64f // длина одной полной волны

        if (progressX > 0f) {
            paint.color = toneColor
            paint.strokeWidth = 8f

            if (amplitude > 0f) {
                val wavePath = Path()
                wavePath.moveTo(0f, midY)
                val quarter = wavelength / 4f
                val half = wavelength / 2f
                val control = amplitude * 2f

                var x = 0f
                while (x < progressX) {
                    wavePath.quadTo(x + quarter, midY - control, x + half, midY)
                    wavePath.quadTo(x + half + quarter, midY + control, x + wavelength, midY)
                    x += wavelength
                }

                // Обрезаем волну ровно по progressX
                canvas.save()
                canvas.clipRect(0f, 0f, progressX, HEIGHT.toFloat())
                canvas.drawPath(wavePath, paint)
                canvas.restore()
            } else {
                // Если отключение — прямая строгая линия
                canvas.drawLine(0f, midY, progressX, midY, paint)
            }
        }

        // 3. Белый ползунок-индикатор на позиции прогресса
        val thumbX = progressX.coerceIn(8f, WIDTH - 8f)
        val thumbHalfWidth = 5f
        val thumbHeight = 32f
        val thumbTop = midY - thumbHeight / 2f
        val thumbBottom = midY + thumbHeight / 2f

        paint.style = Paint.Style.FILL
        paint.color = Color.WHITE
        val thumbRect = RectF(thumbX - thumbHalfWidth, thumbTop, thumbX + thumbHalfWidth, thumbBottom)
        canvas.drawRoundRect(thumbRect, 4f, 4f, paint)

        return bitmap
    }

    /** Диагональная штриховка внутри ruby-сегмента, как на главной шкале. */
    private fun drawHatch(canvas: Canvas, rect: RectF, dim: Float) {
        val paint = Paint().apply {
            isAntiAlias = true
            style = Paint.Style.STROKE
            strokeWidth = 3f
            color = Color.argb((0.35f * 255 * dim).roundToInt(), 255, 228, 230)
        }
        val clip = Path().apply {
            addRoundRect(rect, SEGMENT_RADIUS, SEGMENT_RADIUS, Path.Direction.CW)
        }
        canvas.save()
        canvas.clipPath(clip)
        val height = rect.height()
        var x = rect.left - height
        while (x < rect.right + height) {
            canvas.drawLine(x, rect.bottom, x + height, rect.top, paint)
            x += 12f
        }
        canvas.restore()
    }
}
