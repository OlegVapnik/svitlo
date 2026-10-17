package ua.com.svitlo.app;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/**
 * Фоновые уведомления о начале отключения и возвращении света.
 *
 * ПОЧЕМУ BroadcastReceiver + AlarmManager, а не уведомление из WebView. Веб-часть живёт,
 * пока открыт WebView: стоит выгрузить приложение из памяти, и таймер в JS умирает. Системный
 * будильник переживает выгрузку процесса и срабатывает даже в Doze (`setExactAndAllowWhileIdle`
 * либо `setAndAllowWhileIdle`, если точные будильники запрещены настройками).
 *
 * КОГДА СТАВИМ. При каждом `syncState` из веба: за 15 минут до ближайшего отключения и в
 * момент его окончания (когда свет должен вернуться). Старые будильники перезаписываются
 * теми же requestCode, поэтому накопления и дублей нет.
 *
 * ЧЕГО НЕ ДЕЛАЕМ. Не показываем «через 15 хв», если до отключения осталось меньше 15 минут:
 * иначе каждое минутное обновление графика ставило бы будильник на «сейчас» и человек получал
 * бы одно и то же уведомление каждую минуту.
 */
public class OutageAlarmReceiver extends BroadcastReceiver {

    static final String ACTION_OUTAGE_SOON = "ua.com.svitlo.app.OUTAGE_SOON";
    static final String ACTION_POWER_BACK = "ua.com.svitlo.app.POWER_BACK";
    static final String EXTRA_TITLE = "title";
    static final String EXTRA_TEXT = "text";
    static final String EXTRA_ID = "id";
    static final String CHANNEL_ID = "svitlo_outages";

    private static final int REQUEST_SOON = 4101;
    private static final int REQUEST_BACK = 4102;
    private static final long SOON_LEAD_MS = 15 * 60_000L;

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (!ACTION_OUTAGE_SOON.equals(action) && !ACTION_POWER_BACK.equals(action)) return;

        ensureChannel(context);

        String title = intent.getStringExtra(EXTRA_TITLE);
        String text = intent.getStringExtra(EXTRA_TEXT);
        if (title == null || title.isEmpty()) title = context.getString(R.string.app_name);

        Intent open = new Intent(context, MainActivity.class);
        open.setAction("ua.com.svitlo.app.OPEN_FROM_NOTIFICATION");
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(
            context,
            0,
            open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_svitlo)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
            .setColor(0xFF8AB4F8)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setAutoCancel(true)
            .setContentIntent(contentIntent);

        try {
            NotificationManagerCompat manager = NotificationManagerCompat.from(context);
            if (manager.areNotificationsEnabled()) {
                manager.notify(intent.getIntExtra(EXTRA_ID, REQUEST_SOON), builder.build());
            }
        } catch (SecurityException ignored) {
            // Android 13+ без разрешения POST_NOTIFICATIONS: молча выходим, будильник
            // продолжит работать после того, как человек разрешит уведомления.
        }
    }

    /** Канал создаётся идемпотентно: повторный вызов не сбрасывает настройки человека. */
    static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            context.getString(R.string.notification_channel_outages),
            NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription(context.getString(R.string.notification_channel_outages_desc));
        channel.enableVibration(true);
        channel.setShowBadge(true);
        manager.createNotificationChannel(channel);
    }

    /** Запланировать будильники по снимку расписания из WebView. */
    static void schedule(Context context, String json) {
        long now = System.currentTimeMillis();
        long soonestStart = Long.MAX_VALUE;
        long nearestEnd = Long.MAX_VALUE;
        String queue = "";

        try {
            JSONObject state = new JSONObject(json);
            queue = state.optString("queue", "");
            JSONArray intervals = state.optJSONArray("upcomingIntervals");
            if (intervals != null) {
                for (int index = 0; index < intervals.length(); index++) {
                    JSONObject interval = intervals.optJSONObject(index);
                    if (interval == null) continue;
                    long start = interval.optLong("startEpochMs", 0);
                    long end = interval.optLong("endEpochMs", 0);
                    if (end <= now) continue;
                    if (start > now && start < soonestStart) soonestStart = start;
                    if (end < nearestEnd) nearestEnd = end;
                }
            }
        } catch (JSONException ignored) {
            // Битый снимок: снимаем старые будильники, чтобы не показать уведомление
            // по устаревшему графику.
            cancel(context, ACTION_OUTAGE_SOON, REQUEST_SOON);
            cancel(context, ACTION_POWER_BACK, REQUEST_BACK);
            return;
        }

        String prefix = queue.isEmpty() ? "" : "Черга " + queue + ": ";

        // Окно «за 15 минут»: если до отключения больше 15 минут — ставим ровно на границу.
        // Если меньше — не ставим вовсе (см. комментарий класса), чтобы не спамить.
        if (soonestStart != Long.MAX_VALUE && soonestStart - now > SOON_LEAD_MS + 5_000L) {
            scheduleAt(
                context,
                soonestStart - SOON_LEAD_MS,
                ACTION_OUTAGE_SOON,
                prefix + "відключення через 15 хв",
                "Початок о " + hm(soonestStart),
                REQUEST_SOON
            );
        } else {
            cancel(context, ACTION_OUTAGE_SOON, REQUEST_SOON);
        }

        // Момент включения: конец ближайшего (текущего или будущего) отключения.
        if (nearestEnd != Long.MAX_VALUE && nearestEnd > now + 5_000L) {
            scheduleAt(
                context,
                nearestEnd,
                ACTION_POWER_BACK,
                prefix + "світло повернулося",
                "О " + hm(nearestEnd),
                REQUEST_BACK
            );
        } else {
            cancel(context, ACTION_POWER_BACK, REQUEST_BACK);
        }
    }

    private static void scheduleAt(
        Context context,
        long atMs,
        String action,
        String title,
        String text,
        int requestCode
    ) {
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (manager == null) return;
        PendingIntent pending = pendingIntent(context, action, requestCode, title, text);

        // Точные будильники на Android 12+ требуют разрешения SCHEDULE_EXACT_ALARM. Если
        // человек его не дал — не падаем: setAndAllowWhileIdle разбудит процесс в Doze,
        // пусть и с возможной задержкой в несколько минут.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !manager.canScheduleExactAlarms()) {
            manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMs, pending);
        } else {
            manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMs, pending);
        }
    }

    private static void cancel(Context context, String action, int requestCode) {
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (manager == null) return;
        Intent intent = baseIntent(context, action, requestCode);
        PendingIntent pending = PendingIntent.getBroadcast(
            context,
            requestCode,
            intent,
            PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE
        );
        if (pending == null) return;
        manager.cancel(pending);
        pending.cancel();
    }

    private static PendingIntent pendingIntent(
        Context context,
        String action,
        int requestCode,
        String title,
        String text
    ) {
        Intent intent = baseIntent(context, action, requestCode)
            .putExtra(EXTRA_TITLE, title)
            .putExtra(EXTRA_TEXT, text)
            .putExtra(EXTRA_ID, requestCode);
        return PendingIntent.getBroadcast(
            context,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    /** data-URI делает PendingIntent уникальным: иначе два будильника с разными extras
     *  считались бы одним и второй затёр первый. */
    private static Intent baseIntent(Context context, String action, int requestCode) {
        return new Intent(context, OutageAlarmReceiver.class)
            .setAction(action)
            .setData(Uri.parse("svitlo://alarm/" + requestCode));
    }

    /** «19:00» по Киеву — так же, как время показывает график оператора. */
    private static String hm(long epochMs) {
        SimpleDateFormat format = new SimpleDateFormat("HH:mm", Locale.forLanguageTag("uk-UA"));
        format.setTimeZone(TimeZone.getTimeZone("Europe/Kyiv"));
        return format.format(new Date(epochMs));
    }
}

