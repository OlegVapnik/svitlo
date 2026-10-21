package ua.com.svitlo.app.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.widget.RemoteViews
import ua.com.svitlo.app.R
import kotlin.math.roundToInt

/**
 * Провайдер виджету: читає дані з `SharedPreferences`, малює Bitmap і оновлює всі
 * екземпляри на робочому столі.
 *
 * Три підкласи — три розміри з маніфесту, і три різних макети: 2×1 показує статус одним
 * поглядом, 4×1 — добу за годинами, 4×2 — повну картку з деталями і оновленням. Макет
 * вибирається по фактичній комірці від лаунчера, тому ресайз не ламає вёрстку.
 *
 * Захист від OEM-лаунчерів (HyperOS / OneUI / Android < 12):
 * – Вся логіка render обгорнута в try/catch — будь-який збій Canvas не роббить виджет.
 * – При збої малюється мінімальний fallback-bitmap (темний фон + текст «Немає даних»).
 * – Розміри Bitmap затискаються в [1..2048]×[1..1024] щоб уникнути OOM.
 * – Негативні значення OPTION_APPWIDGET_MIN_WIDTH/HEIGHT (деякі лаунчери) замінюються fallback.
 * – SharedPreferences читається через applicationContext щоб уникнути cross-process ізоляції MIUI.
 */
open class SvitloWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray,
    ) {
        appWidgetIds.forEach { update(context, appWidgetManager, it, fallbackSize) }
    }

    /** Ресайз виджету: лаунчер змінює розміри комірок — перемальовуємо під нову геометрію. */
    override fun onAppWidgetOptionsChanged(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetId: Int,
        newOptions: android.os.Bundle,
    ) {
        update(context, appWidgetManager, appWidgetId, fallbackSize)
    }

    /**
     * Розмір «за замовчуванням» для свого класу виджету: потрібен тільки до того, як лаунчер
     * надішле реальні опції. Перевизначається підкласами, щоб 2×1 не малювався макетом 4×2.
     */
    protected open val fallbackSize: IntArray
        get() = intArrayOf(FALLBACK_WIDTH_DP, FALLBACK_HEIGHT_DP)

    companion object {
        /** id-зони «Оновити»: JS прочитає дію і запустить sync. */
        const val ACTION_REFRESH = "refresh"
        /** id-зони «Наступна черга». */
        const val ACTION_NEXT_QUEUE = "next_queue"

        /** Запасні розміри, якщо лаунчер ще не відіслав опції (перше додавання виджету). */
        private const val FALLBACK_WIDTH_DP = 250
        private const val FALLBACK_HEIGHT_DP = 110

        /** Максимальні розміри Bitmap: запобігає OOM на HyperOS/MIUI з обмеженою пам'яттю. */
        private const val MAX_BITMAP_WIDTH = 2048
        private const val MAX_BITMAP_HEIGHT = 1024

        private val providers: List<SvitloWidgetProvider> = listOf(
            SvitloWidget2x1(),
            SvitloWidget4x1(),
            SvitloWidget4x2(),
        )

        fun updateAll(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            for (provider in providers) {
                val ids = manager.getAppWidgetIds(ComponentName(context, provider::class.java))
                ids.forEach { update(context, manager, it, provider.fallbackSize) }
            }
        }

        private fun update(
            context: Context,
            manager: AppWidgetManager,
            widgetId: Int,
            fallback: IntArray,
        ) {
            // Весь update обгорнутий у try/catch: на HyperOS/OneUI лаунчер може передати
            // некоректні опції або Canvas кине виключення в Skia — виджет не повинен залишатись
            // «чорним екраном» або показувати системну помилку.
            try {
                val payload = try {
                    WidgetPayload.parse(WidgetPrefs.readPayload(context))
                        ?: WidgetPayload.placeholder()
                } catch (_: Exception) {
                    WidgetPayload.placeholder()
                }

                val options = try {
                    manager.getAppWidgetOptions(widgetId)
                } catch (_: Exception) {
                    android.os.Bundle()
                }

                val metrics = context.resources.displayMetrics

                // Деякі OEM-лаунчери (Samsung, MIUI) повертають 0 або від'ємні значення
                // для OPTION_APPWIDGET_MIN_WIDTH/HEIGHT — замінюємо запасними.
                val widthDp = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0)
                    .takeIf { it > 0 } ?: fallback[0]
                val heightDp = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0)
                    .takeIf { it > 0 } ?: fallback[1]

                // Затискаємо px у безпечний діапазон: надто великий Bitmap → OOM на MIUI.
                val widthPx = (widthDp * metrics.density).roundToInt()
                    .coerceIn(1, MAX_BITMAP_WIDTH)
                val heightPx = (heightDp * metrics.density).roundToInt()
                    .coerceIn(1, MAX_BITMAP_HEIGHT)

                val variant = WidgetVariant.of(widthDp.toFloat(), heightDp.toFloat())

                // render() може кинути OutOfMemoryError або Canvas-виключення на деяких Skia-
                // реалізаціях OEM. Замість «чорного» виджету показуємо мінімальний fallback.
                val bitmap = try {
                    HeroWidgetRenderer(metrics.density).render(payload, widthPx, heightPx)
                } catch (_: Exception) {
                    createFallbackBitmap(widthPx, heightPx, metrics.density)
                }

                val layout = when (variant) {
                    WidgetVariant.FULL -> R.layout.svitlo_widget_hero
                    WidgetVariant.WIDE -> R.layout.svitlo_widget_hero_medium
                    WidgetVariant.NARROW -> R.layout.svitlo_widget_hero_narrow
                }
                val views = RemoteViews(context.packageName, layout)
                views.setImageViewBitmap(R.id.widget_canvas, bitmap)
                views.setOnClickPendingIntent(R.id.widget_open, openApp(context))
                // «Наступна черга» живе тільки в повній картці: там під неї намальована строка
                // «ЧЕРГА 20/1» вгорі праворуч. В однорядних макетах такої підписи немає.
                if (variant == WidgetVariant.FULL) {
                    views.setOnClickPendingIntent(
                        R.id.widget_queue,
                        widgetAction(context, ACTION_NEXT_QUEUE),
                    )
                }
                // На 2×1 зони оновлення немає: там її фізично нікуди поставити, а «сліпа» кнопка
                // в прозорому куті — найгірший варіант. Оновлення залишається в 4×1 і 4×2.
                if (variant != WidgetVariant.NARROW) {
                    views.setOnClickPendingIntent(
                        R.id.widget_refresh,
                        widgetAction(context, ACTION_REFRESH),
                    )
                }
                manager.updateAppWidget(widgetId, views)
            } catch (_: Exception) {
                // Останній рубіж: якщо навіть RemoteViews кинув виключення — мовчки ігноруємо,
                // щоб не покласти systemserver через необроблений збій в AppWidgetProvider.
            }
        }

        /**
         * Мінімальний fallback-bitmap: темний фон + «Немає даних».
         *
         * Відображається тільки якщо `HeroWidgetRenderer.render()` сам кинув виключення
         * (OOM, Skia crash тощо). Краще, ніж порожній/чорний виджет.
         */
        private fun createFallbackBitmap(widthPx: Int, heightPx: Int, density: Float): Bitmap {
            val w = widthPx.coerceIn(1, MAX_BITMAP_WIDTH)
            val h = heightPx.coerceIn(1, MAX_BITMAP_HEIGHT)
            val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(bitmap)
            val paint = Paint(Paint.ANTI_ALIAS_FLAG)

            // Фон
            paint.color = Color.parseColor("#131318")
            canvas.drawRoundRect(
                RectF(0f, 0f, w.toFloat(), h.toFloat()),
                density * 20f, density * 20f,
                paint,
            )

            // Текст
            paint.color = Color.parseColor("#71717A")
            paint.textSize = density * 12f
            paint.typeface = Typeface.create("sans-serif", Typeface.NORMAL)
            val msg = "Немає даних"
            val tw = paint.measureText(msg)
            canvas.drawText(msg, (w - tw) / 2f, h / 2f + density * 5f, paint)
            return bitmap
        }

        /**
         * Клік по тілу виджету: звичайний запуск застосунку.
         *
         * `FLAG_IMMUTABLE` обов'язковий з Android 12: без нього система кидає виключення при
         * створенні PendingIntent.
         */
        private fun openApp(context: Context): PendingIntent? {
            val intent = try {
                context.packageManager.getLaunchIntentForPackage(context.packageName)
            } catch (_: Exception) {
                null
            } ?: return null
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            return try {
                PendingIntent.getActivity(
                    context,
                    0,
                    intent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                )
            } catch (_: Exception) {
                null
            }
        }

        /**
         * Клік по зоні дії: спочатку зберігаємо дію в prefs, потім відкриваємо застосунок.
         *
         * Чому не Intent extra: Activity в `singleTask` не оновлює `getIntent()` при
         * `onNewIntent`, і повторне натискання «Оновити» губилось би. `SharedPreferences`
         * доставляє дію в обох випадках — і при холодному старті, і при живому процесі.
         */
        private fun widgetAction(context: Context, action: String): PendingIntent? {
            try { WidgetPrefs.writeAction(context, action) } catch (_: Exception) { }
            return openApp(context)
        }
    }
}

/** 2×1: дві колонки. Поки немає опцій — 150×70 dp, інакше макет був би від 4×2. */
class SvitloWidget2x1 : SvitloWidgetProvider() {
    override val fallbackSize: IntArray get() = intArrayOf(150, 70)
}

/** 4×1: чотири колонки в один рядок. */
class SvitloWidget4x1 : SvitloWidgetProvider() {
    override val fallbackSize: IntArray get() = intArrayOf(250, 70)
}

/** 4×2: повна картка. */
class SvitloWidget4x2 : SvitloWidgetProvider() {
    override val fallbackSize: IntArray get() = intArrayOf(250, 110)
}
