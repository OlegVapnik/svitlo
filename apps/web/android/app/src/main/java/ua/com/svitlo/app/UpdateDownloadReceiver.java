package ua.com.svitlo.app;

import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import java.io.File;
import java.io.FileInputStream;
import java.security.MessageDigest;

/**
 * Проверяет скачанный APK и открывает системный установщик.
 *
 * DownloadManager умеет качать в фоне, но не устанавливает файл. Перед установкой обязательно
 * сверяем SHA-256 с хешем, который сервер отдал в /api/v1/version: повреждённый или подменённый
 * файл удаляем и показываем ошибку, а не отдаём установщику.
 */
public class UpdateDownloadReceiver extends BroadcastReceiver {

    static final String PREFS = "svitlo_update_prefs";
    static final String KEY_DOWNLOAD_ID = "download_id";
    static final String KEY_SHA256 = "sha256";
    static final String KEY_FILE_NAME = "file_name";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !DownloadManager.ACTION_DOWNLOAD_COMPLETE.equals(intent.getAction())) return;
        long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L);
        if (id <= 0) return;

        android.content.SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        long expected = prefs.getLong(KEY_DOWNLOAD_ID, -1L);
        if (expected != id) return;

        DownloadManager manager = (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);
        if (manager == null) {
            clear(prefs);
            return;
        }

        Cursor cursor = manager.query(new DownloadManager.Query().setFilterById(id));
        if (cursor == null) {
            clear(prefs);
            return;
        }
        try {
            if (!cursor.moveToFirst()) {
                clear(prefs);
                return;
            }
            int status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
            if (status != DownloadManager.STATUS_SUCCESSFUL) {
                clear(prefs);
                return;
            }

            String expectedHash = prefs.getString(KEY_SHA256, "");
            String fileName = prefs.getString(KEY_FILE_NAME, null);
            if (expectedHash == null || !expectedHash.matches("[a-f0-9]{64}") || fileName == null) {
                manager.remove(id);
                clear(prefs);
                toast(context, R.string.update_download_corrupted);
                return;
            }

            File downloads = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
            File apkFile = downloads == null ? null : new File(downloads, fileName);
            if (apkFile == null || !apkFile.isFile()) {
                manager.remove(id);
                clear(prefs);
                toast(context, R.string.update_download_corrupted);
                return;
            }

            String actualHash = sha256(apkFile);
            if (!expectedHash.equalsIgnoreCase(actualHash)) {
                // Хеш не совпал: файл мог скачаться частично или его подменили. Удаляем и
                // начинаем с чистого листа при следующей попытке.
                manager.remove(id);
                //noinspection ResultOfMethodCallIgnored
                apkFile.delete();
                clear(prefs);
                toast(context, R.string.update_download_corrupted);
                return;
            }

            // Android 8+ не даст открыть установщик без разрешения «Встановлення з невідомих
            // джерел». Ведём человека прямо в настройки этого приложения, а не молча падаем.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && !context.getPackageManager().canRequestPackageInstalls()) {
                clear(prefs);
                toast(context, R.string.update_allow_install);
                Intent settings = new Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + context.getPackageName())
                );
                settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(settings);
                return;
            }

            Uri apk = FileProvider.getUriForFile(
                context,
                context.getPackageName() + ".fileprovider",
                apkFile
            );
            Intent install = new Intent(Intent.ACTION_VIEW);
            install.setDataAndType(apk, "application/vnd.android.package-archive");
            install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            clear(prefs);
            context.startActivity(install);
        } catch (Exception error) {
            // Нет места, установщик недоступен, файл удалён — приложение остаётся живым.
            clear(prefs);
            toast(context, R.string.update_download_failed);
        } finally {
            cursor.close();
        }
    }

    /** SHA-256 файла в hex; null при ошибке чтения. */
    private static String sha256(File file) {
        try (FileInputStream input = new FileInputStream(file)) {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) != -1) {
                digest.update(buffer, 0, read);
            }
            StringBuilder hex = new StringBuilder(64);
            for (byte value : digest.digest()) {
                hex.append(String.format("%02x", value & 0xff));
            }
            return hex.toString();
        } catch (Exception error) {
            return null;
        }
    }

    private static void clear(android.content.SharedPreferences prefs) {
        prefs.edit()
            .remove(KEY_DOWNLOAD_ID)
            .remove(KEY_SHA256)
            .remove(KEY_FILE_NAME)
            .apply();
    }

    private static void toast(Context context, int messageId) {
        Toast.makeText(context.getApplicationContext(), context.getString(messageId), Toast.LENGTH_LONG).show();
    }
}

