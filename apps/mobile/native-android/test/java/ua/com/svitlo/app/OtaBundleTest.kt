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
 * MainApplication, только каталог передаётся снаружи.
 *
 * Что проверяем: успешный подхват бандла, принудительный откат по маркеру `.booted` (JS не
 * подтвердил старт), отказ от слишком маленького файла и идемпотентность после отката.
 */
class OtaBundleTest {
    private fun tempDir(): File = Files.createTempDirectory("svitlo-ota").toFile()

    private fun writeBundle(dir: File, size: Int = 200_000): File =
        File(dir, "index.android.bundle").apply {
            parentFile?.mkdirs()
            writeBytes(ByteArray(size) { 0x42 })
        }

    @Test
    fun `без бандла возвращает null и не ставит маркер`() {
        val dir = tempDir()

        assertNull(OtaBundle.resolveIn(dir))
        assertFalse(File(dir, ".booted").exists())
    }

    @Test
    fun `слишком маленький бандл не подхватывается`() {
        val dir = tempDir()
        val bundle = writeBundle(dir, size = 1_000)

        assertNull(OtaBundle.resolveIn(dir))
        assertTrue("битый бандл должен остаться на месте до следующей загрузки", bundle.exists())
        assertFalse(File(dir, ".booted").exists())
    }

    @Test
    fun `первый запуск подхватывает бандл и ставит маркер`() {
        val dir = tempDir()
        val bundle = writeBundle(dir)

        val resolved = OtaBundle.resolveIn(dir)

        assertEquals(bundle.absolutePath, resolved?.absolutePath)
        assertTrue("маркер нужен, чтобы следующий запуск откатился при сбое", File(dir, ".booted").exists())
    }

    @Test
    fun `маркер от прошлого запуска откатывает бандл к APK`() {
        val dir = tempDir()
        val bundle = writeBundle(dir)
        File(dir, ".booted").writeText("1")

        assertNull(OtaBundle.resolveIn(dir))
        assertFalse("бандл, не подтвердивший старт, удаляется", bundle.exists())
        assertFalse("маркер снимается вместе с бандлом", File(dir, ".booted").exists())
    }

    @Test
    fun `после отката следующий запуск идёт на вшитом бандле`() {
        val dir = tempDir()
        writeBundle(dir)
        File(dir, ".booted").writeText("1")

        assertNull(OtaBundle.resolveIn(dir))
        assertNull("второй запуск не должен находить остатки", OtaBundle.resolveIn(dir))
    }
}
