package ua.com.svitlo.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Восстановление будильников после перезагрузки телефона.
 *
 * ПОЧЕМУ ЭТО НУЖНО. `AlarmManager` не переживает выключение питания: после reboot все
 * запланированные уведомления исчезают. Если ничего не делать, человек узнаёт об отключении
 * только когда сам откроет приложение, — то есть ровно тогда, когда предупреждение уже не нужно.
 *
 * ОТКУДА БЕРЁМ ДАННЫЕ. Последний снимок расписания, который WebView положил в
 * `SharedPreferences` (`svitlo_widget_prefs`). Сеть здесь не нужна и вредна: в момент загрузки
 * телефон может быть без связи, а старый график всё равно лучше молчания. `schedule()` заново
 * отбирает только будущие интервалы (`upcomingIntervals`), поэтому просроченные будильники не
 * ставятся.
 *
 * ЧЕГО НЕ ДЕЛАЕМ. Не запускаем WebView и не грузим картинки: receiver должен уложиться в лимит
 * `BroadcastReceiver` (десятки секунд), иначе Android убьёт процесс.
 */
public class BootCompletedReceiver extends BroadcastReceiver {

    private static final String ACTION_QUICKBOOT = "android.intent.action.QUICKBOOT_POWERON";
    private static final String ACTION_HTC_QUICKBOOT = "com.htc.intent.action.QUICKBOOT_POWERON";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (context == null || intent == null) return;
        String action = intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action)
            && !ACTION_QUICKBOOT.equals(action)
            && !ACTION_HTC_QUICKBOOT.equals(action)) {
            return;
        }

        String json = SvitloWidgetProvider.readState(context);
        if (json == null || json.isEmpty()) return;

        OutageAlarmReceiver.ensureChannel(context);
        // Метод сам фильтрует интервалы по текущему времени и перезаписывает старые PendingIntent
        // теми же requestCode — дублей не будет.
        OutageAlarmReceiver.schedule(context, json);
        SvitloWidgetProvider.refresh(context);
    }
}
