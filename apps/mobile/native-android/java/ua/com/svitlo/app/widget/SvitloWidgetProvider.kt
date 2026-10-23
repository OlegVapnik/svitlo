package ua.com.svitlo.app.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.util.Log
import android.view.View
import android.widget.RemoteViews
import ua.com.svitlo.app.R

/**
 * Провайдер домашнього виджета.
 *
 * Данные приходят из `SharedPreferences` (пишет JS через `SvitloWidgetModule`), а разметка —
 * обычные XML-макеты с нативными `TextView`/`ImageView`. Никакого Canvas и полноэкранного
 * Bitmap: именно они давали «Не вдаётся завантажити віджет» на HyperOS/One UI, потому что
 * картинка 4×2 в ARGB_8888 весит больше лимита Binder (~1 МБ). Единственный растр — шкала
 * суток 480×24 в RGB_565 (≈23 КБ), см. [WidgetTimeline].
 *
 * Клики не пишут `pending_action` при создании `PendingIntent`: действие едет в
 * `Intent.action` и сохраняется только в [WidgetActionReceiver.onReceive], то есть по факту
 * нажатия. Иначе «Оновити» срабатывало бы при следующем открытии приложения без клика.
 */
open class SvitloWidgetProvider : AppWidgetProvider() {

    /** Макет конкретного размера; переопределяется подклассами. */
    protected open val layoutId: Int
        get() = R.layout.svitlo_widget_command

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray,
    ) {
        appWidgetIds.forEach { update(context, appWidgetManager, it, layoutId) }
    }

    /**
     * Ресайз не меняет макет: все размеры резиновые (`match_parent`, `layout_weight`), а
     * `RemoteViews` не пересобирается под пиксели лаунчера. Поэтому достаточно перепривязать
     * данные — это дешево и не зависит от того, прислал ли OEM корректные OPTION_* размеры.
     */
    override fun onAppWidgetOptionsChanged(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetId: Int,
        newOptions: android.os.Bundle,
    ) {
        update(context, appWidgetManager, appWidgetId, layoutId)
    }

    companion object {
        private const val TAG = "SvitloWidget"

        private val providers: List<SvitloWidgetProvider> = listOf(
            SvitloWidget2x1(),
            SvitloWidget4x1(),
            SvitloWidget4x2(),
            SvitloWidgetPlaces4x2(),
        )

        fun updateAll(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            for (provider in providers) {
                val ids = manager.getAppWidgetIds(ComponentName(context, provider::class.java))
                ids.forEach { update(context, manager, it, provider.layoutId) }
            }
        }

        private fun update(
            context: Context,
            manager: AppWidgetManager,
            widgetId: Int,
            layoutId: Int,
        ) {
            try {
                val payload = try {
                    WidgetPayload.parse(WidgetPrefs.readPayload(context))
                        ?: WidgetPayload.placeholder()
                } catch (error: Exception) {
                    Log.w(TAG, "не вдалося прочитати payload віджета", error)
                    WidgetPayload.placeholder()
                }

                val views = RemoteViews(context.packageName, layoutId)
                when (layoutId) {
                    R.layout.svitlo_widget_capsule -> bindCapsule(context, views, payload)
                    R.layout.svitlo_widget_timeline -> bindTimeline(context, views, payload)
                    R.layout.svitlo_widget_places -> bindPlaces(context, views, payload)
                    else -> bindCommand(context, views, payload)
                }

                manager.updateAppWidget(widgetId, views)
            } catch (error: Exception) {
                // Без лога в поле не отличить ошибку разметки от «немає даних».
                Log.e(TAG, "update failed for widget $widgetId", error)
            }
        }

        private fun bindCapsule(context: Context, views: RemoteViews, payload: WidgetPayload) {
            val state = payload.state
            views.setInt(
                R.id.widget_root,
                "setBackgroundResource",
                WidgetStyle.capsuleBackground(state),
            )
            bindDot(views, R.id.widget_dot, state)
            views.setTextViewText(R.id.widget_place, payload.placeLabel)
            views.setTextViewText(R.id.widget_pill, payload.pill)
            views.setTextViewText(
                R.id.widget_timer,
                payload.timer?.takeUnless { it == "null" }
                    ?: if (state == "on" || state == "allClear") "Світло є" else "—"
            )
            views.setTextViewText(
                R.id.widget_timer_prefix,
                payload.timerPrefix?.takeUnless { it == "null" } ?: "",
            )
            views.setTextViewText(
                R.id.widget_detail,
                payload.detail.takeUnless { it == "null" }?.ifBlank { context.getString(R.string.widget_open_hint) }
                    ?: context.getString(R.string.widget_open_hint),
            )
            views.setImageViewBitmap(R.id.widget_scale, WidgetTimeline.renderSquiggly(payload))

            widgetAction(context, WidgetActionReceiver.ACTION_CYCLE_BOOKMARK)?.let {
                views.setOnClickPendingIntent(R.id.widget_cycle, it)
            }
            widgetAction(context, WidgetActionReceiver.ACTION_OPEN_APP)?.let {
                views.setOnClickPendingIntent(R.id.widget_pill, it)
            }
        }

        private fun bindTimeline(context: Context, views: RemoteViews, payload: WidgetPayload) {
            bindDot(views, R.id.widget_dot, payload.state)
            views.setTextViewText(R.id.widget_place, payload.placeLabel)
            views.setTextViewText(R.id.widget_pill, payload.pill)
            views.setTextViewText(
                R.id.widget_timer,
                payload.timer?.takeUnless { it == "null" }
                    ?: if (payload.state == "on" || payload.state == "allClear") "Світло є" else "—"
            )
            views.setTextViewText(
                R.id.widget_detail,
                payload.detail.takeUnless { it == "null" }?.ifBlank { context.getString(R.string.widget_open_hint) }
                    ?: context.getString(R.string.widget_open_hint),
            )
            views.setImageViewBitmap(R.id.widget_scale, WidgetTimeline.render(payload))

            widgetAction(context, WidgetActionReceiver.ACTION_CYCLE_BOOKMARK)?.let {
                views.setOnClickPendingIntent(R.id.widget_cycle, it)
            }
            widgetAction(context, WidgetActionReceiver.ACTION_REFRESH)?.let {
                views.setOnClickPendingIntent(R.id.widget_refresh, it)
            }
        }

        private fun bindCommand(context: Context, views: RemoteViews, payload: WidgetPayload) {
            bindDot(views, R.id.widget_dot, payload.state)
            views.setTextViewText(R.id.widget_place, payload.placeLabel)
            views.setTextViewText(R.id.widget_pill, payload.pill)
            views.setTextViewText(
                R.id.widget_timer,
                payload.timer?.takeUnless { it == "null" }
                    ?: if (payload.state == "on" || payload.state == "allClear") "Світло є" else "—"
            )
            views.setTextViewText(
                R.id.widget_timer_prefix,
                payload.timerPrefix?.takeUnless { it == "null" } ?: ""
            )
            views.setTextViewText(
                R.id.widget_detail,
                payload.detail.takeUnless { it == "null" }?.ifBlank { context.getString(R.string.widget_open_hint) }
                    ?: context.getString(R.string.widget_open_hint),
            )
            views.setTextViewText(
                R.id.widget_today_value,
                WidgetStyle.offLabel(payload.todayOffMinutes, context.getString(R.string.widget_no_data)),
            )
            views.setTextViewText(
                R.id.widget_tomorrow_value,
                WidgetStyle.offLabel(
                    payload.tomorrowOffMinutes,
                    context.getString(R.string.widget_schedule_pending),
                ),
            )
            views.setImageViewBitmap(R.id.widget_scale, WidgetTimeline.render(payload))

            widgetAction(context, WidgetActionReceiver.ACTION_CYCLE_BOOKMARK)?.let {
                views.setOnClickPendingIntent(R.id.widget_place_group, it)
            }
            widgetAction(context, WidgetActionReceiver.ACTION_REFRESH)?.let {
                views.setOnClickPendingIntent(R.id.widget_refresh, it)
            }
            widgetAction(context, WidgetActionReceiver.ACTION_OPEN_APP)?.let {
                views.setOnClickPendingIntent(R.id.widget_today_tile, it)
                views.setOnClickPendingIntent(R.id.widget_tomorrow_tile, it)
            }
        }

        private fun bindPlaces(context: Context, views: RemoteViews, payload: WidgetPayload) {
            val places = payload.places.take(3)
            val rows = intArrayOf(
                R.id.widget_place_row_1,
                R.id.widget_place_row_2,
                R.id.widget_place_row_3,
            )
            views.setViewVisibility(
                R.id.widget_empty,
                if (places.isEmpty()) View.VISIBLE else View.GONE,
            )
            rows.forEachIndexed { index, rowId ->
                val place = places.getOrNull(index)
                if (place == null) {
                    views.setViewVisibility(rowId, View.GONE)
                    return@forEachIndexed
                }
                views.setViewVisibility(rowId, View.VISIBLE)
                // Иконка типа места — отдельный ImageView, а не эмодзи в тексте: иначе
                // на HyperOS один и тот же значок дублировался и превращался в «тофу».
                views.setTextViewText(
                    labelId(index),
                    "${place.label} · ${place.queue}",
                )
                views.setImageViewResource(iconId(index), WidgetStyle.placeIcon(place.icon))
                bindDot(views, dotId(index), place.state)
                views.setTextViewText(statusId(index), place.statusText)
                views.setTextViewText(timeId(index), place.timeLabel)
                views.setTextColor(statusId(index), WidgetStyle.color(place.state))
                widgetAction(context, WidgetActionReceiver.ACTION_OPEN_APP)?.let {
                    views.setOnClickPendingIntent(rowId, it)
                }
            }

            widgetAction(context, WidgetActionReceiver.ACTION_REFRESH)?.let {
                views.setOnClickPendingIntent(R.id.widget_refresh, it)
            }
        }

        private fun bindDot(views: RemoteViews, id: Int, state: String) {
            views.setImageViewResource(id, WidgetStyle.dot(state))
        }

        /**
         * Клік по зоні: explicit broadcast у [WidgetActionReceiver].
         *
         * `FLAG_IMMUTABLE` обязателен с Android 12, иначе система бросает исключение при
         * создании `PendingIntent`. Request code — хеш действия, чтобы три зоны не перетирали
         * друг друга через `FLAG_UPDATE_CURRENT`.
         */
        private fun widgetAction(context: Context, action: String): PendingIntent? {
            val intent = Intent(context, WidgetActionReceiver::class.java).setAction(action)
            return try {
                PendingIntent.getBroadcast(
                    context,
                    action.hashCode(),
                    intent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                )
            } catch (error: Exception) {
                Log.w(TAG, "widgetAction PendingIntent failed for $action", error)
                null
            }
        }

        private fun labelId(index: Int): Int = when (index) {
            0 -> R.id.widget_place_label_1
            1 -> R.id.widget_place_label_2
            else -> R.id.widget_place_label_3
        }

        private fun dotId(index: Int): Int = when (index) {
            0 -> R.id.widget_place_dot_1
            1 -> R.id.widget_place_dot_2
            else -> R.id.widget_place_dot_3
        }

        private fun iconId(index: Int): Int = when (index) {
            0 -> R.id.widget_place_icon_1
            1 -> R.id.widget_place_icon_2
            else -> R.id.widget_place_icon_3
        }

        private fun statusId(index: Int): Int = when (index) {
            0 -> R.id.widget_place_status_1
            1 -> R.id.widget_place_status_2
            else -> R.id.widget_place_status_3
        }

        private fun timeId(index: Int): Int = when (index) {
            0 -> R.id.widget_place_time_1
            1 -> R.id.widget_place_time_2
            else -> R.id.widget_place_time_3
        }
    }
}

/** 2×1: «Капсула-Датчик». */
class SvitloWidget2x1 : SvitloWidgetProvider() {
    override val layoutId: Int get() = R.layout.svitlo_widget_capsule
}

/** 4×1: «Таймлайн Суток». */
class SvitloWidget4x1 : SvitloWidgetProvider() {
    override val layoutId: Int get() = R.layout.svitlo_widget_timeline
}

/** 4×2: «Командний Центр». */
class SvitloWidget4x2 : SvitloWidgetProvider() {
    override val layoutId: Int get() = R.layout.svitlo_widget_command
}

/** 4×2: «Радар Моїх Місць» — отдельный пункт в списке виджетов. */
class SvitloWidgetPlaces4x2 : SvitloWidgetProvider() {
    override val layoutId: Int get() = R.layout.svitlo_widget_places
}
