package ua.com.svitlo.app

import android.content.Context
import java.io.File
import org.json.JSONObject

/**
 * Загрузчик тихого OTA JS-бандла.
 *
 * JS-код кладёт `files/ota/index.android.bundle` и удаляет маркер `.booted`, только когда
 * приложение успешно смонтировалось. Логика старта:
 *  1. бандла нет или он подозрительно мал → вшитый бандл из APK;
 *  2. бандл скачан при другой версии APK → это старый JS, удаляем каталог и идём в APK;
 *  3. версия OTA-бандла не новее установленного APK → тоже старый JS, удаляем;
 *  4. маркер `.booted` остался с прошлого запуска → тот бандл не поднялся, удаляем и
 *     откатываемся к APK;
 *  5. иначе возвращаем OTA-файл и ставим маркер. Если JS не подтвердит старт, следующий
 *     запуск автоматически откатится.
 *
 * Маркер версии APK лежит РЯДОМ с каталогом `ota/` (`.ota-apk-version`), а не внутри него:
 * при смене APK каталог удаляется целиком, и старый OTA не может пережить обновление.
 */
object OtaBundle {
    private const val DIR = "ota"
    private const val BUNDLE = "index.android.bundle"
    private const val BOOT_MARKER = ".booted"
    private const val META = "meta.json"
    private const val VERSION_MARKER = ".ota-apk-version"
    private const val MIN_SIZE = 100_000L

    fun resolve(context: Context): File? = resolveIn(
        File(context.filesDir, DIR),
        BuildConfig.VERSION_CODE,
        BuildConfig.VERSION_NAME,
    )

    /**
     * Решение о бандле для каталога `dir`. Без Android API — поэтому его проверяет обычный
     * JVM-тест `native-android/test/.../OtaBundleTest.kt`, а не только телефон в руках.
     *
     * `apkVersionCode`/`apkVersionName` передаются явно, чтобы тест мог имитировать установку
     * нового APK поверх старого без сборки второго APK.
     */
    fun resolveIn(
        dir: File,
        apkVersionCode: Int = BuildConfig.VERSION_CODE,
        apkVersionName: String = BuildConfig.VERSION_NAME,
    ): File? {
        val versionFile = File(dir.parentFile ?: dir, VERSION_MARKER)
        val saved = readVersionMarker(versionFile)

        // APK обновился: OTA-бандл от прошлой версии несовместим с новым нативным кодом.
        // Сносим каталог целиком ещё до проверки размера — иначе старый JS продолжал бы
        // подхватываться на каждом запуске.
        if (saved != null && (saved.versionCode != apkVersionCode || saved.versionName != apkVersionName)) {
            clearOta(dir, versionFile, apkVersionCode, apkVersionName)
            return null
        }

        val bundle = File(dir, BUNDLE)
        if (!bundle.exists() || bundle.length() < MIN_SIZE) return null

        val bundleVersion = readBundleVersion(dir)
        // Бандл, скачанный до появления маркера версии, или бандл не новее APK — это
        // устаревший JS. Сравнение по semver не даёт «2.41.9» проиграть «2.41.10».
        if (
            (saved == null && bundleVersion == null) ||
            (bundleVersion != null && compareVersions(bundleVersion, apkVersionName) <= 0)
        ) {
            clearOta(dir, versionFile, apkVersionCode, apkVersionName)
            return null
        }

        val marker = File(dir, BOOT_MARKER)
        if (marker.exists()) {
            // Прошлый OTA-бандл не подтвердил успешный старт — откатываемся.
            bundle.delete()
            marker.delete()
            return null
        }

        return try {
            marker.writeText("1")
            writeVersionMarker(versionFile, apkVersionCode, apkVersionName)
            bundle
        } catch (_: Exception) {
            null
        }
    }

    private fun clearOta(dir: File, versionFile: File, apkVersionCode: Int, apkVersionName: String) {
        dir.deleteRecursively()
        // Фиксируем версию APK, при которой каталог очищен: следующий запуск уже не должен
        // считать остатки (если они появятся) бандлом от прошлой версии.
        writeVersionMarker(versionFile, apkVersionCode, apkVersionName)
    }

    private data class SavedVersion(val versionCode: Int, val versionName: String)

    private fun readVersionMarker(file: File): SavedVersion? {
        if (!file.exists()) return null
        return try {
            val lines = file.readLines()
            val code = lines.getOrNull(0)?.trim()?.toIntOrNull() ?: return null
            val name = lines.getOrNull(1)?.trim().orEmpty()
            if (name.isBlank()) null else SavedVersion(code, name)
        } catch (_: Exception) {
            null
        }
    }

    private fun writeVersionMarker(file: File, versionCode: Int, versionName: String) {
        try {
            file.parentFile?.mkdirs()
            file.writeText("$versionCode\n$versionName\n")
        } catch (_: Exception) {
            // Маркер — оптимизация, а не критичные данные: без него бандл просто не подхватится.
        }
    }

    /** Версия из `meta.json`, который пишет JS-апдейтер рядом с бандлом. */
    private fun readBundleVersion(dir: File): String? {
        val meta = File(dir, META)
        if (!meta.exists()) return null
        return try {
            JSONObject(meta.readText()).optString("version").takeIf { it.isNotBlank() }
        } catch (_: Exception) {
            null
        }
    }

    /** Сравнение semver-строк: отрицательное — `left` старее, 0 — равны, положительное — новее. */
    internal fun compareVersions(left: String, right: String): Int {
        fun parse(raw: String): Pair<List<Int>, List<String>> {
            val clean = raw.trim().removePrefix("v").substringBefore('+')
            val main = clean.substringBefore('-')
            val prerelease = clean.substringAfter('-', "")
                .split('.')
                .filter { it.isNotBlank() }
            val numbers = main.split('.').map { part -> part.takeWhile(Char::isDigit).toIntOrNull() ?: 0 }
            return numbers to prerelease
        }

        val (leftNumbers, leftPre) = parse(left)
        val (rightNumbers, rightPre) = parse(right)
        val size = maxOf(leftNumbers.size, rightNumbers.size)
        for (index in 0 until size) {
            val diff = (leftNumbers.getOrNull(index) ?: 0) - (rightNumbers.getOrNull(index) ?: 0)
            if (diff != 0) return if (diff > 0) 1 else -1
        }
        // Релиз новее любого prerelease: 2.0.0 > 2.0.0-rc.1.
        if (leftPre.isEmpty() && rightPre.isNotEmpty()) return 1
        if (leftPre.isNotEmpty() && rightPre.isEmpty()) return -1
        for (index in 0 until maxOf(leftPre.size, rightPre.size)) {
            val leftPart = leftPre.getOrNull(index) ?: return -1
            val rightPart = rightPre.getOrNull(index) ?: return 1
            val leftNumber = leftPart.toIntOrNull()
            val rightNumber = rightPart.toIntOrNull()
            val diff = when {
                leftNumber != null && rightNumber != null -> leftNumber - rightNumber
                leftNumber != null -> 1
                rightNumber != null -> -1
                else -> leftPart.compareTo(rightPart)
            }
            if (diff != 0) return if (diff > 0) 1 else -1
        }
        return 0
    }
}
