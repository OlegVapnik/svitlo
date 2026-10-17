package ua.com.svitlo.app;

import android.os.Build;
import android.os.Bundle;
import android.view.HapticFeedbackConstants;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
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
            bridgeRegistered = true;
        }

        WebSettings settings = webView.getSettings();
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
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
        private static int hapticConstant(String kind) {
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
}
