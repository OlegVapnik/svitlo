package ua.com.svitlo.app.live

import android.content.Context
import android.util.Log
import ua.com.svitlo.app.widget.WidgetPayload
import ua.com.svitlo.app.widget.WidgetPrefs
import ua.com.svitlo.app.widget.SvitloWidgetProvider

/**
 * Общая точка обновления live-статуса: плашка + QS-плитка.
 *
 * Вызывается во всех тех же местах, что и перерисовка виджетов: `SvitloWidgetModule.update`,
 * тик [WidgetActionReceiver.ACTION_TICK], включение тумблера из JS. Снимок один — читается
 * из [WidgetPrefs], и три интерфейса (виджеты, шторка, плитка) всегда согласованы.
 */
object SvitloLiveStatus {
    private const val TAG = "SvitloLive"

    fun updateAll(context: Context) {
        if (!LivePrefs.isEnabled(context)) {
            SvitloLiveNotification.cancel(context)
            return
        }
        val payload = runCatching { WidgetPayload.parse(WidgetPrefs.readPayload(context)) }
            .getOrNull()

        if (payload != null) {
            try {
                SvitloLiveNotification.show(context, payload)
            } catch (error: Throwable) {
                Log.w(TAG, "failed to show live notification", error)
            }
        } else {
            // Снимка ещё нет (свежая установка): плашку не рисуем, чтобы не было пустой
            // заглушки — появимся с первым payload от приложения.
            SvitloLiveNotification.cancel(context)
        }
        SvitloTileService.requestUpdate(context)
    }

    fun cancel(context: Context) {
        runCatching { SvitloLiveNotification.cancel(context) }
            .onFailure { Log.w(TAG, "failed to cancel live notification", it) }
    }

    /**
     * Первый после включения тик: без него AlarmManager раз в минуту запланирован только
     * виджетами, а они могут отсутствовать на экране — плашка протухла бы навсегда.
     */
    fun ensureTicking(context: Context) {
        runCatching { SvitloWidgetProvider.scheduleTick(context) }
            .onFailure { Log.w(TAG, "failed to schedule live tick", it) }
    }
}
