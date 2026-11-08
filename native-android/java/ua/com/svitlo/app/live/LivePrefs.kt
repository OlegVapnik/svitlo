package ua.com.svitlo.app.live

import android.content.Context

/**
 * Хранилище настроек live-статуса: отдельный prefs-файл, ключ один.
 *
 * Тумблер в JS выключает/включает это значение, а также плашку и плитку. По умолчанию
 * включено: пользователь, поставивший виджеты, ожидает и живой статус без действий.
 */
object LivePrefs {
    private const val PREFS = "svitlo_live"
    private const val KEY_ENABLED = "enabled"

    fun isEnabled(context: Context): Boolean =
        prefs(context).getBoolean(KEY_ENABLED, true)

    fun setEnabled(context: Context, enabled: Boolean) {
        prefs(context).edit().putBoolean(KEY_ENABLED, enabled).apply()
    }

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
