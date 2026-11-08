package ua.com.svitlo.app

import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Сценарии OTA-загрузчика без телефона: `OtaBundle.resolveIn` — та же логика, что работает в
 * MainApplication, только каталог и версия APK передаются снаружи.
 *
 * Что проверяем: успешный подхват бандла, принудительный откат по маркеру `.booted` (JS не
 * подтвердил старт), отказ от слишком маленького файла, сброс `ota/` при установке нового APK
 * и идемпотентность после отката.
 */
class OtaBundleTest {
    /** Окремий батьківський каталог на тест: маркер версії лежить поруч із `ota/`, як у filesDir. */
    private fun tempDir(): File {
        val parent = Files.createTempDirectory("svitlo-files").toFile()
        return File(parent, "ota")
    }

    private fun writeBundle(
        dir: File,
        size: Int = 200_000,
        version: String = "2.50.0",
    ): File = File(dir, "index.android.bundle").apply {
        parentFile?.mkdirs()
        writeBytes(ByteArray(size) { 0x42 })
        if (version.isNotEmpty()) {
            File(dir, "meta.json").writeText("""{"version":"$version"}""")
        }
    }

    @Test
    fun `без бандла возвращает null и не ставит маркер`() {
        val dir = tempDir()

        assertNull(OtaBundle.resolveIn(dir, 286, "2.41.8"))
        assertFalse(File(dir, ".booted").exists())
    }

    @Test
    fun `слишком маленький бандл не подхватывается`() {
        val dir = tempDir()
        val bundle = writeBundle(dir, size = 1_000)

        assertNull(OtaBundle.resolveIn(dir, 286, "2.41.8"))
        assertTrue("битый бандл должен остаться на месте до следующей загрузки", bundle.exists())
        assertFalse(File(dir, ".booted").exists())
    }

    @Test
    fun `при той же версии APK и более свежем OTA возвращает файл бандла`() {
        val dir = tempDir()
        val bundle = writeBundle(dir)

        val resolved = OtaBundle.resolveIn(dir, 286, "2.41.8")

        assertEquals(bundle.absolutePath, resolved?.absolutePath)
        assertTrue("маркер нужен, чтобы следующий запуск откатился при сбое", File(dir, ".booted").exists())
        assertTrue("версия APK фиксируется рядом с ota/", File(dir.parentFile, ".ota-apk-version").exists())
    }

    @Test
    fun `повышение VERSION_CODE сносит ota и возвращает null`() {
        val dir = tempDir()
        writeBundle(dir)
        // Первый запуск активирует бандл и запоминает версию APK 286.
        OtaBundle.resolveIn(dir, 286, "2.41.8")

        // Пользователь установил APK 287 поверх: files/ota сохранился, но JS от 286 уже старый.
        assertNull(OtaBundle.resolveIn(dir, 287, "2.41.8"))
        assertFalse("каталог ota должен быть удалён целиком", dir.exists())
        assertFalse("старый бандл не должен пережить обновление APK", File(dir, "index.android.bundle").exists())
    }

    @Test
    fun `повышение VERSION_NAME сносит ota даже при том же versionCode`() {
        val dir = tempDir()
        writeBundle(dir)
        OtaBundle.resolveIn(dir, 286, "2.41.8")

        assertNull(OtaBundle.resolveIn(dir, 286, "2.42.0"))
        assertFalse("смена versionName — тоже новый APK", dir.exists())
    }

    @Test
    fun `OTA не новее APK отбрасывается даже без маркера версии`() {
        val dir = tempDir()
        writeBundle(dir, version = "2.41.8")

        assertNull("равная версия — это не обновление JS", OtaBundle.resolveIn(dir, 286, "2.41.8"))
        assertFalse(dir.exists())
    }

    @Test
    fun `старый OTA без meta и маркера не подхватывается после обновления APK`() {
        val dir = tempDir()
        writeBundle(dir, version = "")

        assertNull(OtaBundle.resolveIn(dir, 287, "2.41.9"))
        assertFalse("непроверенный бандл от прошлой версии удаляется", dir.exists())
    }

    @Test
    fun `маркер от прошлого запуска откатывает бандл к APK`() {
        val dir = tempDir()
        val bundle = writeBundle(dir)
        OtaBundle.resolveIn(dir, 286, "2.41.8")
        // Имитируем следующий запуск: предыдущий OTA не удалил `.booted`.
        File(dir, ".booted").writeText("1")

        assertNull(OtaBundle.resolveIn(dir, 286, "2.41.8"))
        assertFalse("бандл, не подтвердивший старт, удаляется", bundle.exists())
        assertFalse("маркер снимается вместе с бандлом", File(dir, ".booted").exists())
    }

    @Test
    fun `после отката следующий запуск идёт на вшитом бандле`() {
        val dir = tempDir()
        writeBundle(dir)
        OtaBundle.resolveIn(dir, 286, "2.41.8")
        File(dir, ".booted").writeText("1")

        assertNull(OtaBundle.resolveIn(dir, 286, "2.41.8"))
        assertNull("второй запуск не должен находить остатки", OtaBundle.resolveIn(dir, 286, "2.41.8"))
    }

    @Test
    fun `semver сравнивает числа, а не строки`() {
        assertTrue(OtaBundle.compareVersions("2.41.10", "2.41.9") > 0)
        assertTrue(OtaBundle.compareVersions("2.41.9", "2.41.10") < 0)
        assertEquals(0, OtaBundle.compareVersions("v2.41.8", "2.41.8"))
        assertTrue(OtaBundle.compareVersions("2.41.8", "2.41.8-rc.1") > 0)
    }
}
