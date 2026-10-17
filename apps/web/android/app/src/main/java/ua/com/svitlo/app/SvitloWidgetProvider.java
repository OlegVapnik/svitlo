package ua.com.svitlo.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.widget.RemoteViews;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Виджет рабочего стола 4×1: область, черга, статус света и ближайшее переключение.
 *
 * ОТКУДА ДАННЫЕ. Веб-часть уже посчитала состояние для героя главной (там же таймер и
 * график) и отдала компактный JSON через `window.SvitloNative.syncState`. Java-сторона
 * кладёт его в SharedPreferences и обновляет все экземпляры виджета. Отдельного сетевого
 * запроса у виджета нет: он не умеет авторизоваться, не знает выбранную область и в фоне
 * разбудил бы радио без пользы.
 *
 * ПОЧЕМУ JSON, А НЕ ОТДЕЛЬНЫЕ КЛЮЧИ. Один снимок — одно состояние: область, очередь,
 * статус и интервалы не могут разъехаться между собой, как это было бы с пятью ключами,
 * записанными в разное время.
 *
 * ЧЕГО ЗДЕСЬ НЕТ. Логики «свет есть» по часам: её уже посчитал фронтенд, и второй расчёт
 * на Java неизбежно разошёлся бы с главным экраном на минутных границах.
 */
public class SvitloWidgetProvider extends AppWidgetProvider {

    static final String PREFS = "svitlo_widget";
    static final String KEY_STATE = "state";

    /** Веб-часть кладёт сюда последний снимок расписания. */
    static void storeState(Context context, String json) {
        if (json == null) return;
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_STATE, json)
            .apply();
    }

    private static String readState(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        return prefs.getString(KEY_STATE, null);
    }

    /** Обновить все виджеты. Вызывается после syncState и после загрузки приложения. */
    static void refresh(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, SvitloWidgetProvider.class));
        if (ids.length == 0) return;
        RemoteViews views = buildViews(context);
        for (int id : ids) {
            manager.updateAppWidget(id, views);
        }
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        RemoteViews views = buildViews(context);
        for (int id : appWidgetIds) {
            appWidgetManager.updateAppWidget(id, views);
        }
    }

    private static RemoteViews buildViews(Context context) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_svitlo);

        String regionName = context.getString(R.string.widget_default_region);
        String queue = null;
        String statusText = context.getString(R.string.widget_default_status);
        String nextLabel = context.getString(R.string.widget_default_next);
        String hoursText = "";
        boolean isOff = false;
        boolean hasState = false;

        String json = readState(context);
        if (json != null) {
            try {
                JSONObject state = new JSONObject(json);
                regionName = state.optString("regionName", regionName);
                queue = state.optString("queue", "");
                statusText = state.optString("statusText", statusText);
                nextLabel = state.optString("nextChangeLabel", nextLabel);
                isOff = state.optBoolean("isOff", false);
                hoursText = formatHours(state.optDouble("todayOutageHours", 0));
                hasState = !queue.isEmpty();
            } catch (JSONException ignored) {
                // Битый снимок (обновление формата, обрезанная запись) — показываем заглушку,
                // а не пустую плашку: человек должен понимать, что данных ещё нет.
            }
        }

        views.setTextViewText(R.id.widget_region, regionName);
        views.setTextViewText(
            R.id.widget_queue,
            queue == null || queue.isEmpty()
                ? context.getString(R.string.widget_default_queue)
                : "Черга " + queue
        );
        views.setTextViewText(R.id.widget_status, statusText);
        views.setTextViewText(R.id.widget_next, nextLabel);
        views.setTextViewText(R.id.widget_hours, hoursText);

        int dot = !hasState
            ? R.drawable.widget_dot_unknown
            : isOff ? R.drawable.widget_dot_off : R.drawable.widget_dot_on;
        views.setImageViewResource(R.id.widget_dot, dot);

        int statusColor = !hasState
            ? context.getColor(R.color.svitlo_widget_muted)
            : isOff
                ? context.getColor(R.color.svitlo_widget_danger)
                : context.getColor(R.color.svitlo_widget_success);
        views.setTextColor(R.id.widget_status, statusColor);

        // Тап по любому месту плашки открывает приложение. CLEAR_TOP — чтобы не плодить
        // копии MainActivity: она launchMode=singleTask, но флаг делает намерение однозначным.
        Intent open = new Intent(context, MainActivity.class);
        open.setAction("ua.com.svitlo.app.OPEN_FROM_WIDGET");
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pending = PendingIntent.getActivity(
            context,
            0,
            open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        views.setOnClickPendingIntent(R.id.widget_root, pending);

        views.setContentDescription(
            R.id.widget_root,
            regionName + ". " + statusText + ". " + nextLabel
        );
        return views;
    }

    /** «−6 год 11 хв» — те же единицы, что в интерфейсе, без десятых долей часа. */
    private static String formatHours(double hours) {
        int total = (int) Math.round(Math.max(0, hours) * 60);
        if (total <= 0) return "0 хв";
        if (total < 60) return "−" + total + " хв";
        int wholeHours = total / 60;
        int rest = total % 60;
        return rest == 0 ? "−" + wholeHours + " год" : "−" + wholeHours + " год " + rest + " хв";
    }
}

