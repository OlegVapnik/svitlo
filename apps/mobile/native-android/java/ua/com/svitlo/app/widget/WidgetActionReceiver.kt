package ua.com.svitlo.app.widget

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Принимает клики по зонам виджета.
 *
 * Действие приходит в `Intent.action` и записывается в prefs только здесь, в `onReceive`,
 * то есть в момент нажатия. Раньше `pending_action` писался при создании `PendingIntent` —
 * из-за этого «Оновити» срабатывало при следующем открытии приложения без клика.
 *
 * [ACTION_OPEN_APP] не пишет действие: это обычный запуск приложения.
 */
class WidgetActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = when (intent.action) {
            ACTION_REFRESH -> "refresh"
            ACTION_NEXT_QUEUE -> "next_queue"
            ACTION_CYCLE_BOOKMARK -> "cycle_bookmark"
            ACTION_OPEN_APP -> null
            else -> {
                Log.w(TAG, "unknown widget action: ${intent.action}")
                return
            }
        }

        if (action != null) {
            try {
                WidgetPrefs.writeAction(context, action)
            } catch (error: Exception) {
                Log.w(TAG, "failed to persist widget action $action", error)
            }
        }

        val launchIntent = try {
            context.packageManager.getLaunchIntentForPackage(context.packageName)
        } catch (error: Exception) {
            Log.w(TAG, "getLaunchIntentForPackage failed", error)
            null
        } ?: run {
            Log.w(TAG, "no launch intent for ${context.packageName}")
            return
        }

        launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        try {
            context.startActivity(launchIntent)
        } catch (error: Exception) {
            // OEM может запретить старт Activity из background. Действие уже сохранено
            // и будет обработано при следующем ручном открытии приложения.
            Log.w(TAG, "failed to open app from widget", error)
        }
    }

    companion object {
        private const val TAG = "SvitloWidget"
        const val ACTION_REFRESH = "ua.com.svitlo.app.widget.action.REFRESH"
        const val ACTION_NEXT_QUEUE = "ua.com.svitlo.app.widget.action.NEXT_QUEUE"
        const val ACTION_CYCLE_BOOKMARK = "ua.com.svitlo.app.widget.action.CYCLE_BOOKMARK"
        const val ACTION_OPEN_APP = "ua.com.svitlo.app.widget.action.OPEN_APP"
    }
}
