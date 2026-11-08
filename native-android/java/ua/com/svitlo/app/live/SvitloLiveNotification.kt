package ua.com.svitlo.app.live

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import ua.com.svitlo.app.R
import ua.com.svitlo.app.widget.WidgetPayload
import ua.com.svitlo.app.widget.WidgetStyle

/**
 * Постоянный статус в шторке и на экране блокировки.
 *
 * Непрерывная (ongoing) плашка IMPORTANCE_LOW без звука: она висит сама по себе и
 * обновляется на каждом тике виджетов (тот же AlarmManager). Хронометр тикает силами
 * SystemUI (setChronometerCountDown), поэтому за стрелку секунд наш процесс не отвечает.
 *
 * Вся кириллица — в live_strings.xml; здесь только числа, «HH:mm» и resId.
 */
object SvitloLiveNotification {
    const val CHANNEL_ID = "svitlo_live_status"
    const val NOTIFICATION_ID = 7302

    fun show(context: Context, payload: WidgetPayload) {
        val manager = NotificationManagerCompat.from(context)
        if (!manager.areNotificationsEnabled()) return
        ensureChannel(context)

        val now = System.currentTimeMillis()
        val status = LiveStatusModel.statusOf(payload, now)

        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(iconRes(LiveStatusModel.iconOf(status)))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setNotificationSilent()
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(contentIntent(context))
            .setColor(WidgetStyle.color(stateName(status)))
            .setContentTitle(LiveStatusModel.notificationTitle(status).format(context))
            .setCategory(NotificationCompat.CATEGORY_STATUS)

        LiveStatusModel.notificationBody(status)
            ?.let { builder.setContentText(it.format(context)) }
            ?: builder.setContentText(context.getString(R.string.widget_no_data))

        // Живой хронометр: SystemUI сам тикает до цели.
        val target = status.targetAtMs
        if (target != null && target > now) {
            builder.setWhen(target)
                .setUsesChronometer(true)
                .setChronometerCountDown(true)
        }

        // Прогресс текущего окна отключения: минуты total/elapsed.
        LiveStatusModel.progressOf(payload, now)?.let { progress ->
            builder.setProgress(progress.totalMinutes, progress.elapsedMinutes, false)
        }

        // Promoted chip (новые Android): короткий текст «до hh:mm» для свёрнутой плашки.
        LiveStatusModel.shortCriticalText(status)?.let { chip ->
            setShortCriticalText(builder, chip.format(context))
        }

        runCatching { manager.notify(NOTIFICATION_ID, builder.build()) }
            .onFailure { /* SecurityException без POST_NOTIFICATIONS — статус не критичен */ }
    }

    fun cancel(context: Context) {
        NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)
    }

    /** Канал IMPORTANCE_LOW, публичный на локскрине, без бейджа: статус не должен шуметь. */
    private fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            context.getString(R.string.live_channel_name),
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = context.getString(R.string.live_channel_desc)
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            setShowBadge(false)
        }
        manager.createNotificationChannel(channel)
    }

    private fun iconRes(icon: LiveIcon): Int = when (icon) {
        LiveIcon.POWER_ON -> R.drawable.ic_stat_power_on
        LiveIcon.POWER_SOON -> R.drawable.ic_stat_power_soon
        LiveIcon.POWER_OFF -> R.drawable.ic_stat_power_off
    }

    private fun stateName(status: LiveStatus): String = when (status.state) {
        LiveState.OFF -> "off"
        LiveState.WARNING -> "warning"
        else -> "on"
    }

    private fun contentIntent(context: Context) = runCatching {
        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: Intent()
        android.app.PendingIntent.getActivity(
            context,
            0,
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE,
        )
    }.getOrNull()

    /**
     * `setShortCriticalText` может отсутствовать в compileSdk текущей сборки, поэтому зовём
     * через reflection и молча пропускаем: это чистое улучшение отображения, без него
     * плашка не теряет смысла. На старых API метод не вызывается вовсе.
     */
    private fun setShortCriticalText(builder: NotificationCompat.Builder, text: String) {
        if (Build.VERSION.SDK_INT < 34) return
        runCatching {
            builder.javaClass.methods
                .firstOrNull { it.name == "setShortCriticalText" && it.parameterTypes.size == 1 }
                ?.invoke(builder, text)
        }
    }
}
