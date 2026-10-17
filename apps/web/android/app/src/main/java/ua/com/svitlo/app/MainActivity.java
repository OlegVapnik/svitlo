package ua.com.svitlo.app;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Base64;
import android.view.HapticFeedbackConstants;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.core.content.FileProvider;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import java.io.File;
import java.io.FileOutputStream;
import java.lang.ref.WeakReference;

/**
 * Оболочка приложения (Capacitor): безопасные зоны телефона для веб-части и запрет зума.
 *
 * ЗАЧЕМ ИНСЕТЫ. Приложение рисуется во весь экран (edge-to-edge: строки состояния и жестов
 * прозрачные, фон под ними — свой, поэтому часы и иконки батареи выглядели «поверх» панели).
 * Android-WebView не отдаёт эти зоны в CSS: env(safe-area-inset-top) всегда 0, и содержимое
 * рисовалось прямо под системными значками — «интерфейс налезал на строку состояния». Поэтому
 * зоны считаем здесь и передаём странице ДВУМЯ путями:
 *   1. мост window.SvitloInsets.top()/bottom() — по запросу из веба (useSafeAreaInsets.ts);
 *   2. push: пишем --safe-top/--safe-bottom в <html> через evaluateJavascript.
 * Второй путь — страховка на случай, когда мост недоступен (пересозданный WebView, отказ
 * рефлексии). Оба пути берут значения из одного источника (insetCssPx), поэтому не спорят.
 *
 * ЗАЧЕМ ЗАПРЕТ ЗУМА (setSupportZoom(false)). В приложении «щипок» и двойной тап масштабировали
 * интерфейс: панели уезжали за край экрана, отступы переставали совпадать с системными. В
 * браузере (PWA) зум оставлен — это требование доступности (WCAG 1.4.4), но приложение — не
 * документ, а панель управления: вёрстка рассчитана на масштаб 1:1.
 */
public class MainActivity extends BridgeActivity {

    /** Мост ставится один раз: повторный addJavascriptInterface перезаписывает объект с тем же именем. */
    private boolean bridgeRegistered = false;
    /** Последние отданные в CSS значения — чтобы не дёргать evaluateJavascript на каждый кадр. */
    private int pushedTop = -1;
    private int pushedBottom = -1;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Capacitor создаёт WebView внутри super.onCreate, поэтому обычно мост ставится здесь же.
        setupWebView();
        observeInsets();
        requestNotificationPermission();
        OutageAlarmReceiver.ensureChannel(this);
        // После перезапуска показываем последний снимок сразу, не дожидаясь открытия главной.
        SvitloWidgetProvider.refresh(this);
    }

    /**
     * Android 13+ показывает уведомления только с разрешения POST_NOTIFICATIONS. Спрашиваем
     * один раз при старте: будильники ставятся уже сейчас, и без разрешения они сработают
     * «в пустоту» — человек будет думать, что приложение не предупреждает.
     */
    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return;
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return;
        requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, 4100);
    }

    @Override
    public void onStart() {
        super.onStart();
        // Сюда попадаем и после возврата из фона: WebView мог быть пересоздан, а инсеты —
        // измениться (жестовая навигация вместо кнопок, поворот экрана).
        setupWebView();
        pushInsetsToPage(true);
    }

    @Override
    public void onResume() {
        super.onResume();
        pushInsetsToPage(false);
    }

    private WebView webView() {
        Bridge bridge = getBridge();
        return bridge == null ? null : bridge.getWebView();
    }

    private void setupWebView() {
        WebView webView = webView();
        if (webView == null) return;

        if (!bridgeRegistered) {
            webView.addJavascriptInterface(new InsetsBridge(this), "SvitloInsets");
            webView.addJavascriptInterface(new HapticsBridge(this), "SvitloHaptics");
            webView.addJavascriptInterface(new ShareBridge(this), "SvitloShare");
            // Единый мост новых возможностей: тактильный отклик и снимок расписания для
            // виджета/будильников. Старые мосты оставлены для совместимости с уже собранным
            // веб-бандлом в кэше WebView.
            webView.addJavascriptInterface(new NativeBridge(this), "SvitloNative");
            bridgeRegistered = true;
        }

        WebSettings settings = webView.getSettings();
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        // Системный «размер шрифта» Android WebView применяет как textZoom: текст растёт,
        // а отступы, иконки и высоты кнопок остаются прежними — вёрстка разъезжается, подписи
        // обрезаются многоточием, карточка вылезает за экран. Приложение рисуется по сетке
        // 1:1 (как и задумано для панели управления), поэтому масштаб текста фиксируем.
        settings.setTextZoom(100);
    }

    /**
     * Повод пересчитать зоны: поворот экрана, переход «жесты ↔ кнопки», появление выреза.
     * Значения не запоминаем — только отправляем на страницу актуальные.
     */
    private void observeInsets() {
        View content = findViewById(android.R.id.content);
        if (content == null) return;
        ViewCompat.setOnApplyWindowInsetsListener(content, (view, windowInsets) -> {
            pushInsetsToPage(false);
            return windowInsets;
        });
        ViewCompat.requestApplyInsets(content);
    }

    /** Инсеты в CSS-пикселях на текущий момент; 0 — система их ещё не сообщила. */
    static int insetCssPx(MainActivity activity, boolean top) {
        View decor = activity.getWindow() != null ? activity.getWindow().getDecorView() : null;
        if (decor == null) return 0;
        WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(decor);
        if (insets == null) return 0;
        Insets bars = insets.getInsets(
            WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
        );
        float density = activity.getResources().getDisplayMetrics().density;
        if (density <= 0f) return 0;
        return Math.round((top ? bars.top : bars.bottom) / density);
    }

    /** Второй путь доставки зон: пишем CSS-переменные страницы напрямую (см. .pt-safe/.pb-safe). */
    private void pushInsetsToPage(boolean force) {
        WebView webView = webView();
        if (webView == null) return;

        int top = insetCssPx(this, true);
        int bottom = insetCssPx(this, false);
        if (!force && top == pushedTop && bottom == pushedBottom) return;
        pushedTop = top;
        pushedBottom = bottom;

        String script = "document.documentElement.style.setProperty('--safe-top','" + top + "px');"
            + "document.documentElement.style.setProperty('--safe-bottom','" + bottom + "px');";
        webView.post(() -> webView.evaluateJavascript(script, null));
    }

    /**
     * Отдаёт PNG системному меню «Поділитися». Возвращает false, если файл не записался или
     * Intent не удался — тогда веб-часть честно уходит на запасной путь (navigator.share / скачивание).
     *
     * ЗАЧЕМ МОСТ. В Android WebView нет Web Share API: `navigator.share` отсутствует, а `<a download>`
     * с blob-URL молча ничего не делает (у WebView нет загрузчика). Поэтому картинка, которая
     * «скачалась» на телефоне, на самом деле никуда не попадала. Тот же приём, что и с вибрацией:
     * маленький JS-мост в MainActivity, без сторонних плагинов.
     */
    private boolean shareImage(String base64, String fileName, String title) {
        if (base64 == null || base64.isEmpty()) return false;
        try {
            byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
            File dir = new File(getCacheDir(), "share");
            if (!dir.exists() && !dir.mkdirs()) return false;
            File file = new File(dir, safeFileName(fileName));
            try (FileOutputStream out = new FileOutputStream(file)) {
                out.write(bytes);
            }

            Uri uri = FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", file);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("image/png");
            send.putExtra(Intent.EXTRA_STREAM, uri);
            if (title != null && !title.isEmpty()) {
                send.putExtra(Intent.EXTRA_SUBJECT, title);
            }
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(send, title);
            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            runOnUiThread(() -> startActivity(chooser));
            return true;
        } catch (Exception error) {
            // Битый base64, нет FileProvider, не хватило места — это не повод ронять приложение.
            return false;
        }
    }

    /** Имя файла из JS: оставляем только безопасные символы, иначе путь может выйти за cache. */
    private static String safeFileName(String fileName) {
        String fallback = "svitlo-schedule.png";
        if (fileName == null || fileName.isEmpty()) return fallback;
        String cleaned = fileName.replaceAll("[^a-zA-Z0-9._-]", "-");
        return cleaned.isEmpty() ? fallback : cleaned;
    }

    /**
     * Мост «нативные инсеты → веб»: методы вызываются из JS как window.SvitloInsets.top().
     *
     * Класс public static, а не внутренний: WebView вызывает методы через рефлексию, и у
     * непубличного класса доступ к ним зависит от версии WebView. Activity держим по слабой
     * ссылке — мост живёт дольше одного экрана, и жёсткая ссылка удержала бы уничтоженную Activity.
     */
    public static class InsetsBridge {

        private final WeakReference<MainActivity> activity;

        InsetsBridge(MainActivity activity) {
            this.activity = new WeakReference<>(activity);
        }

        @JavascriptInterface
        public int top() {
            MainActivity current = activity.get();
            return current == null ? 0 : insetCssPx(current, true);
        }

        @JavascriptInterface
        public int bottom() {
            MainActivity current = activity.get();
            return current == null ? 0 : insetCssPx(current, false);
        }
    }

    /**
     * Мост «веб → системне меню Поділитися»: window.SvitloShare.shareImage(base64, fileName, title).
     *
     * base64, а не Blob: Blob нельзя передать через JavascriptInterface, а конвертация в
     * dataURL уже есть в вебе. Картинка 1080×1350 весит сотни килобайт — один строковый
     * вызов моста дешевле, чем плагин ради одного Intent.
     *
     * Класс public static по той же причине, что и InsetsBridge: WebView вызывает методы
     * через рефлексию. Activity держим по слабой ссылке — мост живёт дольше одного экрана.
     */
    public static class ShareBridge {

        private final WeakReference<MainActivity> activity;

        ShareBridge(MainActivity activity) {
            this.activity = new WeakReference<>(activity);
        }

        @JavascriptInterface
        public boolean shareImage(String base64, String fileName, String title) {
            MainActivity current = activity.get();
            return current != null && current.shareImage(base64, fileName, title);
        }
    }

    /**
     * Мост «веб → тактильный отклик»: window.SvitloHaptics.vibrateTick('tick'|'select'|'confirm').
     *
     * ЗАЧЕМ НЕ navigator.vibrate. В WebView вибрация требует разрешения VIBRATE в манифесте, а
     * на Android 13+ ещё и зависит от канала уведомлений. performHapticFeedback работает без
     * разрешений и уважает системный выключатель «тактильный отклик»: если человек его отключил,
     * телефон молчит — это его выбор, и приложение не должно его обходить.
     *
     * Класс public static по той же причине, что и InsetsBridge: WebView вызывает методы через
     * рефлексию. Activity держим по слабой ссылке — мост живёт дольше одного экрана.
     */
    public static class HapticsBridge {

        private final WeakReference<MainActivity> activity;

        HapticsBridge(MainActivity activity) {
            this.activity = new WeakReference<>(activity);
        }

        @JavascriptInterface
        public void vibrateTick(String kind) {
            MainActivity current = activity.get();
            if (current == null) return;
            WebView webView = current.webView();
            if (webView == null) return;
            int feedback = hapticConstant(kind);
            // post: вызов приходит из JS-потока, а методы View должны идти в UI-потоке.
            webView.post(() -> webView.performHapticFeedback(feedback));
        }

        /** 'confirm' — значимая смена состояния, 'select' — выбор группы/области, иначе — тик. */
        static int hapticConstant(String kind) {
            if ("confirm".equals(kind)) {
                // CONFIRM появился в API 30; на старых версиях ведёт себя как обычное нажатие.
                return Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
                    ? HapticFeedbackConstants.CONFIRM
                    : HapticFeedbackConstants.VIRTUAL_KEY;
            }
            if ("select".equals(kind)) return HapticFeedbackConstants.CONTEXT_CLICK;
            return HapticFeedbackConstants.CLOCK_TICK;
        }
    }

    /**
     * Мост `window.SvitloNative` — новые возможности без плагинов Capacitor.
     *
     * `haptic(type)` — тактильный отклик на переключение очередей, областей и вкладок.
     * `syncState(json)` — компактный снимок расписания: кладём в SharedPreferences,
     * обновляем виджет рабочего стола и переставляем будильники уведомлений.
     *
     * Почему один класс на две задачи: обе вызываются из веба в одном месте (главный экран
     * после загрузки графика), и разделять их на два JS-объекта значило бы два раза
     * регистрировать мост и два раза объяснять, почему он необязательный.
     *
     * Класс public static — WebView вызывает методы через рефлексию; Activity держим по
     * слабой ссылке, чтобы мост не удерживал уничтоженный экран.
     */
    public static class NativeBridge {

        private final WeakReference<MainActivity> activity;

        NativeBridge(MainActivity activity) {
            this.activity = new WeakReference<>(activity);
        }

        @JavascriptInterface
        public void haptic(String kind) {
            MainActivity current = activity.get();
            if (current == null || current.getWindow() == null) return;
            View decor = current.getWindow().getDecorView();
            int feedback = HapticsBridge.hapticConstant(kind);
            // post: вызов идёт из JS-потока, а методы View обязаны выполняться в UI-потоке.
            decor.post(() -> decor.performHapticFeedback(feedback));
        }

        @JavascriptInterface
        public void syncState(String json) {
            MainActivity current = activity.get();
            if (current == null || json == null || json.isEmpty()) return;
            SvitloWidgetProvider.storeState(current, json);
            SvitloWidgetProvider.refresh(current);
            OutageAlarmReceiver.schedule(current, json);
        }
    }
}
