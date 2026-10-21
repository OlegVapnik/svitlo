package ua.com.svitlo.app.widget

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.max
import kotlin.math.min

/**
 * Какой макет рисовать.
 *
 * Размер выбирает лаунчер, а не приложение: пользователь может растянуть 2×1 до 4×1 и наоборот.
 * Поэтому вариант считается от фактической ячейки, а не от класса провайдера. Смысл у размеров
 * разный: 2×1 — «статус одним взглядом», 4×1 — «сутки по часам», 4×2 — полная карточка
 * с деталями и обновлением.
 */
enum class WidgetVariant {
    NARROW,
    WIDE,
    FULL,
    ;

    companion object {
        /** Ниже этой высоты полная карточка не помещается даже в сжатом виде, переходим на 4×1. */
        const val FULL_MIN_HEIGHT_DP = 112f

        /** Граница «четыре колонки»: на 2×1 чип очереди ещё влезает, на 4×1 — уже свободно. */
        const val WIDE_MIN_WIDTH_DP = 200f

        fun of(widthDp: Float, heightDp: Float): WidgetVariant = when {
            widthDp >= WIDE_MIN_WIDTH_DP && heightDp >= FULL_MIN_HEIGHT_DP -> FULL
            widthDp >= WIDE_MIN_WIDTH_DP -> WIDE
            else -> NARROW
        }
    }
}

/**
 * Canvas-рендер виджета.
 *
 * Почему Canvas, а не XML-вёрстка: у виджета нет доступа к React и Tailwind, а составные
 * градиенты и штриховку пришлось бы собирать десятком View. Один Bitmap в ImageView даёт ровно
 * тот же макет, что Hero-карточка приложения.
 */
class HeroWidgetRenderer(private val density: Float) {

    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        typeface = Typeface.create("sans-serif", Typeface.BOLD)
    }

    /** `widthPx`/`heightPx` — фактический размер ячейки на рабочем столе, не «логический». */
    fun render(data: WidgetPayload, widthPx: Int, heightPx: Int): Bitmap {
        val width = max(1, widthPx)
        val height = max(1, heightPx)
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val accent = WidgetPayload.colorFor(data.state)

        drawBackground(canvas, width, height, accent)

        when (WidgetVariant.of(width / density, height / density)) {
            WidgetVariant.FULL -> drawFull(canvas, width, height, data, accent)
            WidgetVariant.WIDE -> drawWide(canvas, width, height, data, accent)
            WidgetVariant.NARROW -> drawNarrow(canvas, width, height, data, accent)
        }
        return bitmap
    }

    /** Фон карточки: графит, радиальный блик состояния справа сверху, грань 1 dp. */
    private fun drawBackground(canvas: Canvas, width: Int, height: Int, accent: Int) {
        val rect = RectF(0f, 0f, width.toFloat(), height.toFloat())
        val radius = dp(20f)

        paint.reset()
        paint.isAntiAlias = true
        paint.style = Paint.Style.FILL
        paint.color = Color.parseColor("#131318")
        canvas.drawRoundRect(rect, radius, radius, paint)

        try {
            canvas.save()
            val clip = Path().apply { addRoundRect(rect, radius, radius, Path.Direction.CW) }
            canvas.clipPath(clip)
            paint.reset()
            paint.isAntiAlias = true
            paint.shader = RadialGradient(
                width * 0.94f,
                0f,
                max(width, height) * 0.95f,
                intArrayOf(withAlpha(accent, 0.30f), withAlpha(accent, 0f)),
                null,
                Shader.TileMode.CLAMP,
            )
            canvas.drawRect(rect, paint)
            paint.shader = null
            canvas.restore()
        } catch (_: Exception) {
            // Skia fallback
        }

        paint.reset()
        paint.isAntiAlias = true
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = dp(1f)
        paint.color = Color.parseColor("#1AFFFFFF")
        canvas.drawRoundRect(rect, radius, radius, paint)
    }

    /**
     * 2×1: «статус одним взглядом» — чип очереди, состояние и остаток одной строкой.
     */
    private fun drawNarrow(
        canvas: Canvas,
        width: Int,
        height: Int,
        data: WidgetPayload,
        accent: Int,
    ) {
        val pad = min(dp(9f), height * 0.14f)
        val timelineHeight = min(dp(16f), height * 0.30f)
        val timelineTop = height - pad - timelineHeight
        val rowHeight = (timelineTop - pad * 2).coerceAtLeast(dp(12f))
        val baseline = pad + rowHeight * 0.72f

        var left = pad
        data.queue?.let { queue ->
            left += drawQueueChip(canvas, left, baseline, queue, accent, 9f, 17f) + dp(6f)
        }

        textPaint.typeface = Typeface.create("sans-serif", Typeface.BOLD)
        textPaint.color = accent
        textPaint.textSize = dp(13f)
        val timerText = data.timer?.takeIf { !it.equals("null", ignoreCase = true) }
        val timerWidth = if (timerText != null) textPaint.measureText(timerText) else 0f
        if (timerText != null) {
            canvas.drawText(timerText, width - pad - timerWidth, baseline, textPaint)
        }

        textPaint.textSize = dp(12f)
        textPaint.color = Color.parseColor("#FAFAFA")
        val headlineMax = max(0f, width - pad - timerWidth - dp(8f) - left)
        canvas.drawText(fit(data.headline, dp(12f), headlineMax), left, baseline, textPaint)

        drawTimeline(
            canvas = canvas,
            left = pad,
            top = timelineTop,
            width = width - pad * 2,
            height = timelineHeight,
            data = data,
            accent = accent,
        )
    }

    /**
     * 4×1: «сутки по часам» — строка статуса и подписанная шкала 00:00…24:00.
     *
     * Правый край отмеряется строго по цепочке (глиф -> остаток -> заголовок),
     * исключая наслоение текста "Вимкнуть" под "хв".
     */
    private fun drawWide(
        canvas: Canvas,
        width: Int,
        height: Int,
        data: WidgetPayload,
        accent: Int,
    ) {
        val pad = min(dp(10f), height * 0.13f)
        val labelsBaseline = height - pad
        val timelineHeight = min(dp(18f), height * 0.26f)
        val timelineBottom = labelsBaseline - dp(10f)
        val timelineTop = timelineBottom - timelineHeight
        val rowHeight = (timelineTop - pad).coerceAtLeast(dp(14f))
        val baseline = pad + rowHeight * 0.72f

        var left = pad
        data.queue?.let { queue ->
            left += drawQueueChip(canvas, left, baseline, queue, accent, 9f, 16f) + dp(7f)
        }

        // Точка состояния
        paint.reset()
        paint.isAntiAlias = true
        paint.style = Paint.Style.FILL
        paint.color = accent
        val dotRadius = dp(3f)
        canvas.drawCircle(left + dotRadius, baseline - dp(4f), dotRadius, paint)
        left += dotRadius * 2 + dp(6f)

        var right = width - pad
        if (data.updatedAt > 0L) {
            textPaint.typeface = Typeface.create("sans-serif", Typeface.BOLD)
            textPaint.textSize = dp(12f)
            textPaint.color = Color.parseColor("#A1A1AA")
            val glyph = "↻"
            val glyphWidth = textPaint.measureText(glyph)
            right -= glyphWidth
            canvas.drawText(glyph, right, baseline, textPaint)
            right -= dp(6f)
        }

        val wideTimer = data.timer?.takeIf { !it.equals("null", ignoreCase = true) }
        if (wideTimer != null) {
            textPaint.typeface = Typeface.create("sans-serif", Typeface.BOLD)
            textPaint.textSize = dp(14f)
            textPaint.color = accent
            val timerWidth = textPaint.measureText(wideTimer)
            right -= timerWidth
            canvas.drawText(wideTimer, right, baseline, textPaint)
            right -= dp(6f)
        }

        textPaint.typeface = Typeface.create("sans-serif", Typeface.BOLD)
        textPaint.textSize = dp(12f)
        textPaint.color = Color.parseColor("#FAFAFA")
        val headlineMax = max(0f, right - left)
        canvas.drawText(fit(data.headline, dp(12f), headlineMax), left, baseline, textPaint)

        drawTimeline(
            canvas = canvas,
            left = pad,
            top = timelineTop,
            width = width - pad * 2,
            height = timelineHeight,
            data = data,
            accent = accent,
        )
        drawTimeLabels(canvas, pad, width - pad * 2, labelsBaseline, dp(8f))
    }

    /**
     * 4×2: полная карточка — пилюля, очередь, заголовок, точное время следующего события,
     * остаток, подписанная шкала и нижняя строка со временем обновления.
     */
    private fun drawFull(
        canvas: Canvas,
        width: Int,
        height: Int,
        data: WidgetPayload,
        accent: Int,
    ) {
        val scale = min(1f, (height / density) / 152f).coerceAtLeast(0.78f)
        val unit = { value: Float -> dp(value * scale) }

        val pad = unit(12f)
        val pillTop = pad
        val pillHeight = unit(22f)
        val headlineBaseline = pillTop + pillHeight + unit(24f)
        val detailBaseline = headlineBaseline + unit(20f)

        val footerBaseline = height - pad
        val labelsBaseline = footerBaseline - unit(11f)
        val timelineBottom = labelsBaseline - unit(10f)
        val timelineHeight = min(unit(24f), timelineBottom - detailBaseline - unit(10f))
            .coerceAtLeast(unit(14f))
        val timelineTop = timelineBottom - timelineHeight

        // Пилюля состояния.
        textPaint.typeface = Typeface.create("sans-serif", Typeface.BOLD)
        textPaint.textSize = unit(11f)
        val pillText = data.pill
        val pillWidth = min(
            width - pad * 2 - unit(96f),
            textPaint.measureText(pillText) + unit(34f),
        ).coerceAtLeast(unit(40f))
        val pillRect = RectF(pad, pillTop, pad + pillWidth, pillTop + pillHeight)
        paint.reset()
        paint.isAntiAlias = true
        paint.style = Paint.Style.FILL
        paint.color = withAlpha(accent, 0.12f)
        canvas.drawRoundRect(pillRect, pillHeight / 2f, pillHeight / 2f, paint)
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = dp(1f)
        paint.color = withAlpha(accent, 0.28f)
        canvas.drawRoundRect(pillRect, pillHeight / 2f, pillHeight / 2f, paint)
        paint.style = Paint.Style.FILL
        paint.color = accent
        canvas.drawCircle(pad + unit(10f), pillTop + pillHeight / 2f, unit(3f), paint)

        textPaint.color = accent
        canvas.drawText(
            fit(pillText, unit(11f), pillWidth - unit(24f)),
            pad + unit(18f),
            pillTop + pillHeight / 2f + unit(4f),
            textPaint,
        )

        // Очередь — справа вверху
        textPaint.textSize = unit(10f)
        textPaint.color = Color.parseColor("#D4D4D8")
        val queueText = data.queue?.let { "ЧЕРГА $it" } ?: "ЧЕРГА НЕ ВИБРАНА"
        canvas.drawText(
            queueText,
            width - pad - textPaint.measureText(queueText),
            pillTop + pillHeight / 2f + unit(3.5f),
            textPaint,
        )

        textPaint.typeface = Typeface.create("sans-serif", Typeface.BOLD)
        textPaint.textSize = unit(18f)
        textPaint.color = accent
        canvas.drawText(
            fit(data.headline, unit(18f), width - pad * 2),
            pad,
            headlineBaseline,
            textPaint,
        )

        // Справа — остаток, слева — детали события.
        var timerWidth = 0f
        val fullTimer = data.timer?.takeIf { !it.equals("null", ignoreCase = true) }
        if (fullTimer != null) {
            textPaint.typeface = Typeface.create("sans-serif", Typeface.BOLD)
            textPaint.textSize = unit(14f)
            textPaint.color = accent
            val valueWidth = textPaint.measureText(fullTimer)
            canvas.drawText(fullTimer, width - pad - valueWidth, detailBaseline, textPaint)
            timerWidth = valueWidth

            val prefixRaw = data.timerPrefix?.takeIf { !it.equals("null", ignoreCase = true) }
            if (prefixRaw != null) {
                textPaint.typeface = Typeface.create("sans-serif", Typeface.BOLD)
                textPaint.textSize = unit(9f)
                textPaint.color = Color.parseColor("#A1A1AA")
                val prefix = prefixRaw.uppercase()
                val prefixWidth = textPaint.measureText(prefix)
                canvas.drawText(
                    prefix,
                    width - pad - valueWidth - unit(4f) - prefixWidth,
                    detailBaseline,
                    textPaint,
                )
                timerWidth += prefixWidth + unit(4f)
            }
        }

        textPaint.typeface = Typeface.create("sans-serif", Typeface.NORMAL)
        textPaint.textSize = unit(11f)
        textPaint.color = Color.parseColor("#A1A1AA")
        var cleanDetail = if (data.detail.equals("null", ignoreCase = true)) "" else data.detail
        if (cleanDetail.startsWith("Світло є. ")) {
            cleanDetail = cleanDetail.removePrefix("Світло є. ")
        }
        val detailMaxWidth = max(0f, width - pad * 2 - timerWidth - unit(8f))
        canvas.drawText(
            fit(cleanDetail, unit(11f), detailMaxWidth),
            pad,
            detailBaseline,
            textPaint,
        )

        drawTimeline(
            canvas = canvas,
            left = pad,
            top = timelineTop,
            width = width - pad * 2,
            height = timelineHeight,
            data = data,
            accent = accent,
        )
        drawTimeLabels(canvas, pad, width - pad * 2, labelsBaseline, unit(9f))

        // Нижняя строка: время без света и отметка обновления
        val updated = formatUpdatedAt(data.updatedAt)
        if (updated != null) {
            textPaint.textSize = unit(9f)
            textPaint.color = Color.parseColor("#A1A1AA")
            val stamp = "↻ Оновлено $updated"
            canvas.drawText(
                stamp,
                width - pad - textPaint.measureText(stamp),
                footerBaseline,
                textPaint,
            )
        }
        textPaint.color = Color.parseColor("#71717A")
        val footer = if (data.offMinutes > 0) {
            "Без світла за добу: ${formatMinutes(data.offMinutes)}"
        } else {
            "Графік оновлюється автоматично"
        }
        val footerMax = max(0f, width - pad * 2 - (if (updated != null) unit(104f) else 0f))
        canvas.drawText(fit(footer, unit(9f), footerMax), pad, footerBaseline, textPaint)
    }

    /**
     * Компактный бейдж очереди («20/1») для 2×1 и 4×1.
     */
    private fun drawQueueChip(
        canvas: Canvas,
        left: Float,
        baseline: Float,
        text: String,
        accent: Int,
        fontSizeDp: Float,
        heightDp: Float,
    ): Float {
        textPaint.typeface = Typeface.create("sans-serif", Typeface.BOLD)
        textPaint.textSize = dp(fontSizeDp)
        textPaint.color = accent
        val textWidth = textPaint.measureText(text)
        val chipWidth = textWidth + dp(10f)
        val chipHeight = dp(heightDp)
        val top = baseline - chipHeight
        val rect = RectF(left, top, left + chipWidth, top + chipHeight)

        paint.reset()
        paint.isAntiAlias = true
        paint.style = Paint.Style.FILL
        paint.color = withAlpha(accent, 0.14f)
        canvas.drawRoundRect(rect, chipHeight / 2f, chipHeight / 2f, paint)
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = dp(1f)
        paint.color = withAlpha(accent, 0.30f)
        canvas.drawRoundRect(rect, chipHeight / 2f, chipHeight / 2f, paint)

        val metrics = textPaint.fontMetrics
        val centered = (top + chipHeight / 2f) - (metrics.ascent + metrics.descent) / 2f
        canvas.drawText(text, left + dp(5f), centered, textPaint)
        return chipWidth
    }

    /**
     * Подписи шкалы: 00:00, 06:00, 12:00, 18:00, 24:00 под своими делениями.
     */
    private fun drawTimeLabels(
        canvas: Canvas,
        left: Float,
        width: Float,
        baseline: Float,
        fontSize: Float,
    ) {
        val labels = arrayOf("00:00", "06:00", "12:00", "18:00", "24:00")
        textPaint.typeface = Typeface.create("sans-serif", Typeface.NORMAL)
        textPaint.textSize = fontSize
        textPaint.color = Color.parseColor("#71717A")

        labels.forEachIndexed { index, label ->
            val x = left + width * index / (labels.size - 1)
            textPaint.textAlign = when (index) {
                0 -> Paint.Align.LEFT
                labels.lastIndex -> Paint.Align.RIGHT
                else -> Paint.Align.CENTER
            }
            canvas.drawText(label, x, baseline, textPaint)
        }
        textPaint.textAlign = Paint.Align.LEFT
    }

    /** Суточная шкала: 48 получасовых сегментов, штриховка у отключений, белая засечка «зараз». */
    private fun drawTimeline(
        canvas: Canvas,
        left: Float,
        top: Float,
        width: Float,
        height: Float,
        data: WidgetPayload,
        accent: Int,
    ) {
        val radius = dp(7f)
        val track = RectF(left, top, left + width, top + height)
        paint.reset()
        paint.isAntiAlias = true
        paint.style = Paint.Style.FILL
        paint.color = Color.parseColor("#0E0E12")
        canvas.drawRoundRect(track, radius, radius, paint)
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = dp(1f)
        paint.color = Color.parseColor("#14FFFFFF")
        canvas.drawRoundRect(track, radius, radius, paint)

        val inner = dp(3f)
        val count = if (data.slots.isEmpty()) 48 else data.slots.size
        val slotGap = dp(1f)
        val innerLeft = left + inner
        val innerTop = top + inner
        val innerWidth = width - inner * 2
        val innerHeight = height - inner * 2
        val slotWidth = max(dp(1f), (innerWidth - slotGap * (count - 1)) / count)

        for (index in 0 until count) {
            val code = data.slots.getOrNull(index)
            val x = innerLeft + index * (slotWidth + slotGap)
            val rect = RectF(x, innerTop, x + slotWidth, innerTop + innerHeight)
            paint.reset()
            paint.isAntiAlias = true
            paint.style = Paint.Style.FILL
            paint.color = when (code) {
                3 -> Color.parseColor("#57F43F5E")
                2 -> Color.parseColor("#42F59E0B")
                1 -> Color.parseColor("#3D10B981")
                else -> Color.parseColor("#1B1B22")
            }
            canvas.drawRoundRect(rect, dp(1.5f), dp(1.5f), paint)
            if (code == 3) drawHatch(canvas, rect)
        }

        val fraction = data.nowFraction
        if (fraction != null) {
            val x = innerLeft + innerWidth * fraction.coerceIn(0f, 1f)
            paint.reset()
            paint.isAntiAlias = true
            paint.style = Paint.Style.FILL
            paint.color = withAlpha(accent, 0.18f)
            canvas.drawRect(x - dp(4f), innerTop, x + dp(4f), innerTop + innerHeight, paint)
            paint.color = Color.WHITE
            canvas.drawRect(x - dp(1f), innerTop, x + dp(1f), innerTop + innerHeight, paint)
        }
    }

    /** Диагональная штриховка отключения — та же, что в `Timeline24h` приложения. */
    private fun drawHatch(canvas: Canvas, rect: RectF) {
        canvas.save()
        canvas.clipRect(rect)
        paint.reset()
        paint.isAntiAlias = true
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = dp(1.4f)
        paint.strokeCap = Paint.Cap.ROUND
        paint.color = Color.parseColor("#57FFE4E6")
        var x = rect.left - rect.height()
        val step = dp(4.5f)
        while (x < rect.right + rect.height()) {
            canvas.drawLine(x, rect.bottom, x + rect.height(), rect.top, paint)
            x += step
        }
        canvas.restore()
    }

    /** Обрезает строку по ширине с многоточием. */
    private fun fit(text: String, size: Float, maxWidth: Float): String {
        if (maxWidth <= 0f) return ""
        textPaint.textSize = size
        if (textPaint.measureText(text) <= maxWidth) return text
        var end = text.length
        while (end > 1 && textPaint.measureText(text.substring(0, end) + "…") > maxWidth) {
            end -= 1
        }
        return text.substring(0, end) + "…"
    }

    private fun formatMinutes(minutes: Int): String {
        val hours = minutes / 60
        val rest = minutes % 60
        return when {
            hours > 0 && rest > 0 -> "$hours год $rest хв"
            hours > 0 -> "$hours год"
            else -> "$rest хв"
        }
    }

    /** Время последней синхронизации «07:42»; null — данных ещё не было. */
    private fun formatUpdatedAt(value: Long): String? {
        if (value <= 0L) return null
        return SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(value))
    }

    private fun withAlpha(color: Int, alpha: Float): Int = Color.argb(
        (alpha.coerceIn(0f, 1f) * 255).toInt(),
        Color.red(color),
        Color.green(color),
        Color.blue(color),
    )

    private fun dp(value: Float): Float = value * density
}
