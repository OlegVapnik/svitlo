package ua.com.svitlo.app;

import android.os.Bundle;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;

/**
 * Оболочка приложения (Capacitor) плюс передача безопасных зон телефона в веб-часть.
 *
 * ЗАЧЕМ. Приложение рисуется во весь экран (edge-to-edge: строки состояния и жестов
 * прозрачные, фон под ними — свой, поэтому часы и иконки батареи выглядят «поверх» тёмной
 * панели). Но Android-WebView не отдаёт эти зоны в CSS: env(safe-area-inset-top) всегда 0, и
 * содержимое рисовалось прямо под системными значками — «интерфейс налезал на строку
 * состояния». Поэтому зоны измеряем здесь (WindowInsets) и отдаём странице синхронным мостом
 * window.SvitloInsets; веб-часть превращает их в --safe-top / --safe-bottom
 * (см. apps/web/src/hooks/useSafeAreaInsets.ts).
 *
 * Почему мост, а не разовая инъекция скрипта: страница в WebView загружается позже, чем
 * приходит первый WindowInsets, а после перезагрузки документа любой вставленный в него стиль
 * теряется. Метод, отдающий число по запросу, живёт в WebView и доступен на каждой странице.
 *
 * В браузере (PWA) этот код не участвует совсем — там зоны знает env().
 */
public class MainActivity extends BridgeActivity {

    /** Плотность экрана: WindowInsets приходят в физических пикселях, CSS живёт в CSS-пикселях. */
    private float density = 1f;
    private int safeTopDp = 0;
    private int safeBottomDp = 0;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        density = getResources().getDisplayMetrics().density;

        View content = findViewById(android.R.id.content);
        if (content != null) {
            ViewCompat.setOnApplyWindowInsetsListener(content, (view, windowInsets) -> {
                Insets insets = windowInsets.getInsets(
                    WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
                );
                safeTopDp = Math.round(insets.top / density);
                safeBottomDp = Math.round(insets.bottom / density);
                return windowInsets;
            });
            // Первый расчёт зон — сразу, не дожидаясь чужого запроса раскладки.
            ViewCompat.requestApplyInsets(content);
        }

        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView != null) {
            webView.addJavascriptInterface(new InsetsBridge(), "SvitloInsets");
        }
    }

    /** Мост «нативные инсеты → веб»: методы вызываются из JS как window.SvitloInsets.top(). */
    private class InsetsBridge {
        @JavascriptInterface
        public int top() {
            return safeTopDp;
        }

        @JavascriptInterface
        public int bottom() {
            return safeBottomDp;
        }
    }
}
