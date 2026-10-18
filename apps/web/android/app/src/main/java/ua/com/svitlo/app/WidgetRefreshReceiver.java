package ua.com.svitlo.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Фоновое обновление виджета и будильников без открытия приложения.
 *
 * ПОЧЕМУ НЕ WorkManager. Периодическая задача WorkManager на свободном тарифе всё равно не
 * гарантирует 30 минут, а тянет отдельную зависимость и инициализацию. Здесь уже есть
 * AlarmManager и BroadcastReceiver для уведомлений об отключениях — тот же механизм, без нового
 * слоя: `setInexactRepeating` раз в 30 минут и ручной запуск кнопкой на виджете.
 *
 * ЧТО ДЕЛАЕМ. Читаем снимок из `SharedPreferences`, идём в `GET /schedules/upcoming` за свежими
 * окнами своей черги, пересчитываем статус по часам телефона, сохраняем снимок, перерисовываем
 * все виджеты и перепланируем уведомления. Если сети нет — статус всё равно пересчитывается по
 * последним известным интервалам: «світла немає» не должно висеть после окончания окна.
 *
 * ЧЕГО НЕ ДЕЛАЕМ. Не шлём авторизацию и не собираем ПД: запрос публичный, в нём только область
 * и код черги.
 */
public class WidgetRefreshReceiver extends BroadcastReceiver {

    static final String ACTION_REFRESH_WIDGET = "ua.com.svitlo.app.REFRESH_WIDGET";

    /** 30 минут: чаще будить радио ради плашки на столе бессмысленно, реже — статус устаревает. */
    private static final long INTERVAL_MS = 30 * 60_000L;
    private static final int REQUEST_PERIODIC = 4201;
    private static final String KEY_SCHEDULED = "refresh_scheduled";
    private static final int TIMEOUT_MS = 5_000;
    private static final int MAX_BYTES = 512 * 1024;

    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();

    @Override
    public void onReceive(Context context, Intent intent) {
        if (context == null) return;
        Context app = context.getApplicationContext();

        // Кнопка на виджете и периодический будильник приходят одним действием: план обновления
        // не должен зависеть от того, кто именно разбудил receiver.
        schedulePeriodic(app);

        final PendingResult pending = goAsync();
        EXECUTOR.execute(() -> {
            try {
                refreshNow(app);
            } catch (RuntimeException ignored) {
                // Сеть, разбор, права — всё это не должно ронять процесс: следующий будильник
                // попробует снова, а виджет покажет последний честный снимок.
            } finally {
                pending.finish();
            }
        });
    }

    /** Включает периодическое обновление один раз: повторные вызовы не сдвигают фазу будильника. */
    static void schedulePeriodic(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(SvitloWidgetProvider.PREFS, Context.MODE_PRIVATE);
        if (prefs.getBoolean(KEY_SCHEDULED, false)) return;
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (manager == null) return;
        manager.setInexactRepeating(
            AlarmManager.RTC,
            System.currentTimeMillis() + INTERVAL_MS,
            INTERVAL_MS,
            periodicIntent(context)
        );
        prefs.edit().putBoolean(KEY_SCHEDULED, true).apply();
    }

    /**
     * После перезагрузки телефона AlarmManager пуст, а флаг «уже запланировано» остался.
     * BootCompletedReceiver сбрасывает флаг и вызывает этот метод.
     */
    static void restorePeriodic(Context context) {
        context.getSharedPreferences(SvitloWidgetProvider.PREFS, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(KEY_SCHEDULED, false)
            .apply();
        schedulePeriodic(context);
    }

    static void cancelPeriodic(Context context) {
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pending = PendingIntent.getBroadcast(
            context,
            REQUEST_PERIODIC,
            new Intent(context, WidgetRefreshReceiver.class).setAction(ACTION_REFRESH_WIDGET),
            PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE
        );
        if (manager != null && pending != null) {
            manager.cancel(pending);
            pending.cancel();
        }
        context.getSharedPreferences(SvitloWidgetProvider.PREFS, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(KEY_SCHEDULED, false)
            .apply();
    }

    private static PendingIntent periodicIntent(Context context) {
        Intent intent = new Intent(context, WidgetRefreshReceiver.class).setAction(ACTION_REFRESH_WIDGET);
        return PendingIntent.getBroadcast(
            context,
            REQUEST_PERIODIC,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    /** Сеть + пересчёт + запись снимка + перерисовка + будильники. */
    static void refreshNow(Context context) {
        String json = SvitloWidgetProvider.readState(context);
        if (json == null || json.isEmpty()) return;

        WidgetSnapshot snapshot = WidgetSnapshot.fromJson(json);
        String payload = fetchSchedule(snapshot);
        // Неудачный разбор не затирает прежние интервалы: пустота — не факт, а отсутствие ответа.
        if (payload != null) snapshot.applySchedulePayload(payload);

        snapshot.recompute(System.currentTimeMillis());
        String updated = snapshot.toJson().toString();
        SvitloWidgetProvider.storeState(context, updated);
        SvitloWidgetProvider.refresh(context);
        OutageAlarmReceiver.schedule(context, updated);
    }

    /**
     * `null` — запрос не нужен или не удался. В PWA адрес относительный (`/api/v1`), и сетевой
     * запрос из виджета там невозможен — это штатный случай, а не ошибка.
     */
    private static String fetchSchedule(WidgetSnapshot snapshot) {
        String base = snapshot.apiBaseUrl == null ? "" : snapshot.apiBaseUrl.trim();
        if (!base.startsWith("http://") && !base.startsWith("https://")) return null;

        String region = snapshot.regionCpu == null ? "" : snapshot.regionCpu.trim();
        String queue = snapshot.queue == null ? "" : snapshot.queue.trim();
        if (region.isEmpty() || queue.isEmpty()) return null;

        HttpURLConnection connection = null;
        try {
            String url = base
                + (base.endsWith("/") ? "" : "/")
                + "schedules/upcoming?days=2&region=" + encode(region) + "&queue=" + encode(queue);
            connection = (HttpURLConnection) new URL(url).openConnection();
            connection.setRequestMethod("GET");
            connection.setConnectTimeout(TIMEOUT_MS);
            connection.setReadTimeout(TIMEOUT_MS);
            connection.setRequestProperty("Accept", "application/json");
            // Worker отдаёт публичный ответ; User-Agent нужен, чтобы в логах было видно, кто читал.
            connection.setRequestProperty("User-Agent", "SvitloWidget/1.0 (Android)");
            if (connection.getResponseCode() != 200) return null;

            try (InputStream stream = connection.getInputStream()) {
                BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8));
                StringBuilder builder = new StringBuilder();
                char[] buffer = new char[8_192];
                int read;
                while ((read = reader.read(buffer)) != -1) {
                    builder.append(buffer, 0, read);
                    if (builder.length() > MAX_BYTES) return null;
                }
                return builder.toString();
            }
        } catch (Exception ignored) {
            return null;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    /** Кодирует область и черту для query-строки; ошибка кодировки невозможна для UTF-8. */
    private static String encode(String value) {
        try {
            return java.net.URLEncoder.encode(value, "UTF-8");
        } catch (java.io.UnsupportedEncodingException ignored) {
            return value;
        }
    }
}
