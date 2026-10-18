package ua.com.svitlo.app;

import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;

/**
 * Открывает системный установщик после завершения загрузки APK.
 *
 * DownloadManager умеет качать в фоне и показывает уведомление, но сам установку не запускает.
 * Без этого шага человек видел бы «загрузка завершена» и не понимал, что делать дальше.
 * Приёмник срабатывает только для той загрузки, которую начал мост `downloadUpdate`:
 * id хранится в SharedPreferences, чужие завершения игнорируются.
 */
public class UpdateDownloadReceiver extends BroadcastReceiver {

    static final String PREFS = "svitlo_update_prefs";
    static final String KEY_DOWNLOAD_ID = "download_id";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !DownloadManager.ACTION_DOWNLOAD_COMPLETE.equals(intent.getAction())) return;
        long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L);
        if (id <= 0) return;

        long expected = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getLong(KEY_DOWNLOAD_ID, -1L);
        if (expected != id) return;

        DownloadManager manager = (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);
        if (manager == null) return;

        Cursor cursor = manager.query(new DownloadManager.Query().setFilterById(id));
        if (cursor == null) return;
        try {
            if (!cursor.moveToFirst()) return;
            int status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
            if (status != DownloadManager.STATUS_SUCCESSFUL) return;

            Uri apk = manager.getUriForDownloadedFile(id);
            if (apk == null) return;

            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(KEY_DOWNLOAD_ID).apply();
            Intent install = new Intent(Intent.ACTION_VIEW);
            install.setDataAndType(apk, "application/vnd.android.package-archive");
            install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(install);
        } catch (Exception ignored) {
            // Файл удалён, установщик недоступен, нет разрешения — приложение остаётся живым,
            // человек может открыть APK из «Загрузок» вручную.
        } finally {
            cursor.close();
        }
    }
}
