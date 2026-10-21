package ua.com.svitlo.app

import android.content.Context
import java.io.File

/**
 * Загрузчик тихого OTA JS-бандла.
 *
 * JS-код кладёт `files/ota/index.android.bundle` и удаляет маркер `.booted`, только когда
 * приложение успешно смонтировалось. Логика старта:
 *  1. бандла нет или он подозрительно мал → вшитый бандл из APK;
 *  2. маркер `.booted` остался с прошлого запуска → тот бандл не поднялся, удаляем и
 *     откатываемся к APK;
 *  3. иначе возвращаем OTA-файл и ставим маркер. Если JS не подтвердит старт, следующий
 *     запуск автоматически откатится.
 */
object OtaBundle {
    private const val DIR = "ota"
    private const val BUNDLE = "index.android.bundle"
    private const val BOOT_MARKER = ".booted"
    private const val MIN_SIZE = 100_000L

    fun resolve(context: Context): File? = resolveIn(File(context.filesDir, DIR))

    /**
     * Решение о бандле для каталога `dir`. Без Android API — поэтому его проверяет обычный
     * JVM-тест `native-android/test/.../OtaBundleTest.kt`, а не только телефон в руках.
     */
    fun resolveIn(dir: File): File? {
        val bundle = File(dir, BUNDLE)
        if (!bundle.exists() || bundle.length() < MIN_SIZE) return null

        val marker = File(dir, BOOT_MARKER)
        if (marker.exists()) {
            // Прошлый OTA-бандл не подтвердил успешный старт — откатываемся.
            bundle.delete()
            marker.delete()
            return null
        }

        return try {
            marker.writeText("1")
            bundle
        } catch (_: Exception) {
            null
        }
    }
}
