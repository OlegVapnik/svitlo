package ua.com.svitlo.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.widget.RemoteViews;

/**
 * Виджет рабочего стола: компактная капсула 2×1, полоса 4×1 и панель 4×2.
 *
 * ОТКУДА ДАННЫЕ. Веб-часть уже посчитала состояние для героя главной (там же таймер и
 * график) и отдала компактный JSON через `window.SvitloNative.syncState`. Java-сторона
 * кладёт его в SharedPreferences и обновляет все экземпляры виджета. С v2.17.0 к этому
 * добавилось фоновое обновление раз в 30 минут (`WidgetRefreshReceiver`): виджет больше не
 * замирает на снимке, который веб записал в последний раз, когда его открывали.
 *
 * ПОЧЕМУ РАЗМЕР ВЫБИРАЕТСЯ ПО OPTIONS. Система не сообщает «это 4×2» словами: она отдаёт
 * минимальные ширину и высоту в dp. Один и тот же layout на 2×1 и 4×2 либо обрезал бы текст,
 * либо оставлял пустую половину плашки — поэтому у каждого размера свой RemoteViews.
 *
 * ЧЕГО ЗДЕСЬ НЕТ. Логики «свет есть» по часам: её считает `WidgetSnapshot` — один расчёт для
 * виджета, фонового обновления и будильников, чтобы они не расходились на минутных границах.
 */
public class SvitloWidgetProvider extends AppWidgetProvider {

    static final String PREFS = "svitlo_widget_prefs";
    /** Прежнее имя хранилища: после обновления снимок нужно перенести, иначе будильники пропадут. */
    static final String LEGACY_PREFS = "svitlo_widget";
    static final String KEY_STATE = "state";

    /** Порог «маленькой» плашки: две ячейки в ширину — это ~110–150dp у большинства лончеров. */
    private static final int SMALL_MAX_WIDTH_DP = 180;
    /** Две ячейки в высоту — примерно 110dp (70dp на ячейку минус служебные отступы). */
    private static final int LARGE_MIN_HEIGHT_DP = 110;

    private enum Size { SMALL, MEDIUM, LARGE }

    /** Веб-часть кладёт сюда последний снимок расписания. */
    static void storeState(Context context, String json) {
        if (json == null) return;
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_STATE, json)
            .apply();
        // Первый же снимок включает фоновую синхронизацию: без открытого WebView виджет иначе
        // остался бы с устаревшим статусом навсегда.
        WidgetRefreshReceiver.schedulePeriodic(context);
    }

    /**
     * Читает снимок, который записал WebView.
     *
     * После обновления приложения старый ключ `svitlo_widget` ещё лежит на телефоне. Если его не
     * прочитать, после перезагрузки будильники не восстановятся до первого открытия главной —
     * человек останется без предупреждения именно в тот момент, когда оно нужнее всего.
     */
    static String readState(Context context) {
        SharedPreferences current = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String json = current.getString(KEY_STATE, null);
        if (json != null) return json;

        SharedPreferences legacy = context.getSharedPreferences(LEGACY_PREFS, Context.MODE_PRIVATE);
        String migrated = legacy.getString(KEY_STATE, null);
        if (migrated != null) {
            storeState(context, migrated);
            legacy.edit().remove(KEY_STATE).apply();
        }
        return migrated;
    }

    /** Обновить все виджеты. Каждый — своим layout: размеры у экземпляров разные. */
    static void refresh(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, SvitloWidgetProvider.class));
        for (int id : ids) {
            manager.updateAppWidget(id, buildViews(context, sizeOf(manager.getAppWidgetOptions(id))));
        }
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int id : appWidgetIds) {
            appWidgetManager.updateAppWidget(id, buildViews(context, sizeOf(appWidgetManager.getAppWidgetOptions(id))));
        }
        WidgetRefreshReceiver.schedulePeriodic(context);
    }

    /** Человек потянул за ручку размера: перерисовываем только этот экземпляр. */
    @Override
    public void onAppWidgetOptionsChanged(
        Context context,
        AppWidgetManager appWidgetManager,
        int appWidgetId,
        Bundle newOptions
    ) {
        appWidgetManager.updateAppWidget(appWidgetId, buildViews(context, sizeOf(newOptions)));
    }

    /** Последний виджет удалён: незачем будить телефон каждые 30 минут ради пустого экрана. */
    @Override
    public void onDisabled(Context context) {
        WidgetRefreshReceiver.cancelPeriodic(context);
    }

    /**
     * Маленький — уже 180dp, большой — выше 110dp. Если лончер ещё не отдал размеры, считаем
     * виджет полосой 4×1: это состояние по умолчанию из `svitlo_widget_info.xml`.
     */
    private static Size sizeOf(Bundle options) {
        if (options == null) return Size.MEDIUM;
        int width = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0);
        int height = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0);
        if (width > 0 && width < SMALL_MAX_WIDTH_DP) return Size.SMALL;
        if (height >= LARGE_MIN_HEIGHT_DP) return Size.LARGE;
        return Size.MEDIUM;
    }

    private static RemoteViews buildViews(Context context, Size size) {
        int layout;
        if (size == Size.SMALL) {
            layout = R.layout.widget_svitlo_small;
        } else if (size == Size.LARGE) {
            layout = R.layout.widget_svitlo_large;
        } else {
            layout = R.layout.widget_svitlo;
        }
        RemoteViews views = new RemoteViews(context.getPackageName(), layout);

        WidgetSnapshot state = WidgetSnapshot.fromJson(readState(context));
        // Пересчёт по часам телефона: снимок мог быть записан два часа назад, и «світла немає»
        // уже неправда. Интервалы те же — меняется только «сейчас».
        state.recompute(System.currentTimeMillis());

        boolean hasState = !state.queue.isEmpty();
        String regionName = state.regionName.isEmpty()
            ? context.getString(R.string.widget_default_region)
            : state.regionName;
        String statusText = state.statusText.isEmpty()
            ? context.getString(R.string.widget_default_status)
            : state.statusText;
        String nextLabel = state.nextChangeLabel.isEmpty()
            ? context.getString(R.string.widget_default_next)
            : state.nextChangeLabel;

        views.setTextViewText(
            R.id.widget_queue,
            hasState
                ? (size == Size.SMALL ? state.queue : "Черга " + state.queue)
                : (size == Size.SMALL
                    ? context.getString(R.string.widget_default_queue_short)
                    : context.getString(R.string.widget_default_queue))
        );
        views.setTextViewText(R.id.widget_status, statusText);
        views.setTextViewText(R.id.widget_next, nextLabel);

        if (size != Size.SMALL) {
            views.setTextViewText(R.id.widget_region, regionName);
            views.setTextViewText(R.id.widget_hours, hasState ? state.hoursLabel() : "");
        }
        if (size == Size.LARGE) {
            String schedule = state.todayScheduleLabel();
            views.setTextViewText(
                R.id.widget_schedule,
                schedule.isEmpty() ? context.getString(R.string.widget_schedule_empty) : schedule
            );
        }

        int dot = !hasState
            ? R.drawable.widget_dot_unknown
            : state.isOff ? R.drawable.widget_dot_off : R.drawable.widget_dot_on;
        views.setImageViewResource(R.id.widget_dot, dot);

        int statusColor = !hasState
            ? context.getColor(R.color.svitlo_widget_muted)
            : state.isOff
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

        if (size != Size.SMALL) {
            // Кнопка на виджете шлёт тот же broadcast, что и периодический будильник: одна
            // логика обновления, без второго пути к сети.
            Intent refresh = new Intent(context, WidgetRefreshReceiver.class)
                .setAction(WidgetRefreshReceiver.ACTION_REFRESH_WIDGET);
            PendingIntent refreshPending = PendingIntent.getBroadcast(
                context,
                1,
                refresh,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
            views.setOnClickPendingIntent(R.id.widget_refresh, refreshPending);
        }

        views.setContentDescription(
            R.id.widget_root,
            regionName + ". " + statusText + ". " + nextLabel
        );
        return views;
    }
}

