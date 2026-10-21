package ua.com.svitlo.app.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import ua.com.svitlo.app.R
import kotlin.math.roundToInt

/**
 * Провайдер виджета: читает данные из `SharedPreferences`, рисует Bitmap и обновляет все
 * экземпляры на рабочем столе.
 *
 * Три подкласса — три размера из манифеста, и три разных макета: 2×1 показывает статус одним
 * взглядом, 4×1 — сутки по часам, 4×2 — полную карточку с деталями и обновлением. Макет
 * выбирается по фактической ячейке от лаунчера, поэтому ресайз не ломает вёрстку.
 */
open class SvitloWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray,
    ) {
        appWidgetIds.forEach { update(context, appWidgetManager, it, fallbackSize) }
    }

    /** Ресайз виджета: лаунчер меняет размеры ячеек — перерисовываем под новую геометрию. */
    override fun onAppWidgetOptionsChanged(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetId: Int,
        newOptions: android.os.Bundle,
    ) {
        update(context, appWidgetManager, appWidgetId, fallbackSize)
    }

    /**
     * Размер «по умолчанию» для своего класса виджета: нужен только до того, как лаунчер
     * пришлёт реальные опции. Переопределяется подклассами, чтобы 2×1 не рисовался 4×2-макетом.
     */
    protected open val fallbackSize: IntArray
        get() = intArrayOf(FALLBACK_WIDTH_DP, FALLBACK_HEIGHT_DP)

    companion object {
        /** id-зоны «Оновити»: JS прочитает действие и запустит sync. */
        const val ACTION_REFRESH = "refresh"
        /** id-зоны «Наступна черга». */
        const val ACTION_NEXT_QUEUE = "next_queue"

        /** Запасные размеры, если лаунчер ещё не отдал опции (первое добавление виджета). */
        private const val FALLBACK_WIDTH_DP = 250
        private const val FALLBACK_HEIGHT_DP = 110

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
            val payload = WidgetPayload.parse(WidgetPrefs.readPayload(context))
                ?: WidgetPayload.placeholder()
            val options = manager.getAppWidgetOptions(widgetId)
            val metrics = context.resources.displayMetrics

            // Лаунчер отдаёт размер текущей ориентации в dp; при первом добавлении опций может
            // не быть — тогда берём запасные значения своего размера (у 2×1 они не такие, как
            // у 4×2: иначе только что поставленный маленький виджет рисовался бы полной
            // карточкой и обрезался по краям). Переводим в px сами: Bitmap обязан совпасть
            // с ячейкой один к одному, иначе `fitCenter` оставит поля, а `fitXY` сплющит
            // шрифты по одной оси.
            val widthDp = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0)
                .takeIf { it > 0 } ?: fallback[0]
            val heightDp = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0)
                .takeIf { it > 0 } ?: fallback[1]

            val widthPx = (widthDp * metrics.density).roundToInt().coerceAtLeast(1)
            val heightPx = (heightDp * metrics.density).roundToInt().coerceAtLeast(1)

            val variant = WidgetVariant.of(widthDp.toFloat(), heightDp.toFloat())
            val bitmap = HeroWidgetRenderer(metrics.density).render(payload, widthPx, heightPx)

            val layout = when (variant) {
                WidgetVariant.FULL -> R.layout.svitlo_widget_hero
                WidgetVariant.WIDE -> R.layout.svitlo_widget_hero_medium
                WidgetVariant.NARROW -> R.layout.svitlo_widget_hero_narrow
            }
            val views = RemoteViews(context.packageName, layout)
            views.setImageViewBitmap(R.id.widget_canvas, bitmap)
            views.setOnClickPendingIntent(R.id.widget_open, openApp(context))
            // «Наступна черга» живёт только в полной карточке: там под неё нарисована строка
            // «ЧЕРГА 20/1» вверху справа. В однорядных макетах такой подписи нет — значит
            // и невидимой кнопки быть не должно.
            if (variant == WidgetVariant.FULL) {
                views.setOnClickPendingIntent(
                    R.id.widget_queue,
                    widgetAction(context, ACTION_NEXT_QUEUE),
                )
            }
            // На 2×1 зоны обновления нет: там её физически некуда поставить, а «слепая» кнопка
            // в прозрачном углу — худший вариант. Обновление остаётся в 4×1 и 4×2.
            if (variant != WidgetVariant.NARROW) {
                views.setOnClickPendingIntent(
                    R.id.widget_refresh,
                    widgetAction(context, ACTION_REFRESH),
                )
            }
            manager.updateAppWidget(widgetId, views)
        }

        /**
         * Клик по телу виджета: обычный запуск приложения.
         *
         * `FLAG_IMMUTABLE` обязателен с Android 12: без него система выбрасывает исключение при
         * создании PendingIntent.
         */
        private fun openApp(context: Context): PendingIntent? {
            val intent = context.packageManager.getLaunchIntentForPackage(context.packageName)
                ?: return null
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            return PendingIntent.getActivity(
                context,
                0,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        }

        /**
         * Клик по зоне действия: сначала сохраняем действие в prefs, затем открываем приложение.
         *
         * Почему не Intent extra: Activity в `singleTask` не обновляет `getIntent()` при
         * `onNewIntent`, и повторное нажатие «Оновити» терялось бы. `SharedPreferences`
         * доставляет действие в обоих случаях — и при холодном старте, и при живом процессе.
         */
        private fun widgetAction(context: Context, action: String): PendingIntent? {
            WidgetPrefs.writeAction(context, action)
            return openApp(context)
        }
    }
}

/** 2×1: две колонки. Пока нет опций — 150×70 dp, иначе макет был бы от 4×2. */
class SvitloWidget2x1 : SvitloWidgetProvider() {
    override val fallbackSize: IntArray get() = intArrayOf(150, 70)
}

/** 4×1: четыре колонки в одну строку. */
class SvitloWidget4x1 : SvitloWidgetProvider() {
    override val fallbackSize: IntArray get() = intArrayOf(250, 70)
}

/** 4×2: полная карточка. */
class SvitloWidget4x2 : SvitloWidgetProvider() {
    override val fallbackSize: IntArray get() = intArrayOf(250, 110)
}
