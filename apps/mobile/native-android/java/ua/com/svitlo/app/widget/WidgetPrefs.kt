package ua.com.svitlo.app.widget

import android.content.Context

/**
 * Мост между JS и виджетом через `SharedPreferences`.
 *
 * Почему не файл или broadcast: виджет обновляется системой в любой момент, в том числе когда
 * процесса приложения нет. `SharedPreferences` читается мгновенно, переживает смерть процесса и
 * не требует разбирать extras из Intent.
 */
object WidgetPrefs {
    private const val PREFS = "svitlo_widget"
    private const val KEY_PAYLOAD = "payload"
    private const val KEY_ACTION = "pending_action"

    fun writePayload(context: Context, raw: String) {
        prefs(context).edit().putString(KEY_PAYLOAD, raw).apply()
    }

    fun readPayload(context: Context): String? = prefs(context).getString(KEY_PAYLOAD, null)

    /**
     * Клик по зоне виджета: provider кладёт действие сюда и открывает приложение.
     *
     * Через Intent extra нельзя: Activity в `singleTask` не обновляет `getIntent()` при
     * `onNewIntent`, и повторный клик по «Оновити» терялся бы. `SharedPreferences`
     * доставляет действие в обоих случаях — и при холодном старте, и при живом процессе.
     */
    fun writeAction(context: Context, action: String) {
        prefs(context).edit().putString(KEY_ACTION, action).apply()
    }

    fun consumeAction(context: Context): String? {
        val stored = prefs(context).getString(KEY_ACTION, null) ?: return null
        prefs(context).edit().remove(KEY_ACTION).apply()
        return stored
    }

    fun clear(context: Context) {
        prefs(context).edit().clear().apply()
    }

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
