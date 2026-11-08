package ua.com.svitlo.app

import android.content.Intent
import android.os.Process
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Перезапуск приложения после скачивания тихого OTA-бандла.
 *
 * Зачем нативный код: JS-бандл читается один раз при старте процесса (`MainApplication`
 * передаёт путь в `jsBundleFilePath`), поэтому «применить» его из JavaScript невозможно — нужен
 * новый процесс. `AppRestart.restart()` запускает launcher-intent и гасит текущий процесс:
 * Android поднимает приложение заново, `OtaBundle.resolve` видит свежий файл и ставит маркер
 * отката. Если бандл окажется битым, следующий старт автоматически вернётся к вшитому.
 *
 * Флаг CLEAR_TASK обязателен: без него система вернёт пользователя в старый стек Activity
 * поверх уже запущенного процесса, и перезапуска не произойдёт.
 */
class AppRestartModule(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context) {

    override fun getName(): String = NAME

    @ReactMethod
    fun restart() {
        val intent = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TASK or Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
        Process.killProcess(Process.myPid())
    }

    companion object {
        const val NAME = "AppRestart"
    }
}
