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
    private const val KEY_SCHEDULE_OWNER = "schedule_owner"
    private const val KEY_SCHEDULE_DAY = "schedule_day"
    private const val KEY_SCHEDULE_STARTS = "schedule_starts"
    private const val KEY_SCHEDULE_SHIFT = "schedule_shift"
    private const val KEY_SCHEDULE_SHIFT_FROM = "schedule_shift_from"
    private const val KEY_SCHEDULE_SHIFT_TO = "schedule_shift_to"
    private const val KEY_SCHEDULE_SHIFT_AT = "schedule_shift_at"

    fun writePayload(context: Context, raw: String) {
        prefs(context).edit().putString(KEY_PAYLOAD, raw).apply()
    }

    fun readPayload(context: Context): String? = prefs(context).getString(KEY_PAYLOAD, null)

    /**
     * Подпись последнего отрисованного графика: «чей это график», «какой день», «когда окна»
     * и — если окно только что переехало — сам факт переноса.
     *
     * Зачем в `SharedPreferences`, а не в памяти процесса: виджет переживает смерть процесса,
     * а `RemoteViews` собирается заново на каждом тике. Без сохранённой подписи перенос окна
     * видно только в том кадре, где приложение ещё помнит прошлый снимок, — после
     * перезапуска подпись «Відключення перенесено» исчезала бы.
     *
     * `shiftKind` хранится вместе со подписью, потому что на экране одновременно живут копии
     * виджета: первый экземпляр замечает перенос и обновляет подпись, остальные читают уже
     * новую и обязаны показать ту же плашку, а не промолчать (иначе «перенесено» видел бы
     * только один из двух одинаковых виджетов).
     */
    data class ScheduleMemory(
        val owner: String,
        val dayKey: Long,
        val starts: List<Long>,
        val shiftKind: String? = null,
        val shiftFromMs: Long = 0L,
        val shiftToMs: Long? = null,
        val shiftAtMs: Long = 0L,
    )

    fun readSchedule(context: Context): ScheduleMemory? {
        val prefs = prefs(context)
        val owner = prefs.getString(KEY_SCHEDULE_OWNER, null) ?: return null
        val day = prefs.getLong(KEY_SCHEDULE_DAY, 0L)
        val raw = prefs.getString(KEY_SCHEDULE_STARTS, null).orEmpty()
        val starts = raw.split(',')
            .mapNotNull { it.trim().toLongOrNull() }
            .filter { it > 0L }
        val shiftAt = prefs.getLong(KEY_SCHEDULE_SHIFT_AT, 0L)
        val shiftTo = prefs.getLong(KEY_SCHEDULE_SHIFT_TO, 0L)
        return ScheduleMemory(
            owner = owner,
            dayKey = day,
            starts = starts,
            shiftKind = prefs.getString(KEY_SCHEDULE_SHIFT, null),
            shiftFromMs = prefs.getLong(KEY_SCHEDULE_SHIFT_FROM, 0L),
            shiftToMs = if (shiftTo > 0L) shiftTo else null,
            shiftAtMs = shiftAt,
        )
    }

    fun writeSchedule(context: Context, memory: ScheduleMemory) {
        prefs(context).edit()
            .putString(KEY_SCHEDULE_OWNER, memory.owner)
            .putLong(KEY_SCHEDULE_DAY, memory.dayKey)
            .putString(KEY_SCHEDULE_STARTS, memory.starts.joinToString(","))
            .putString(KEY_SCHEDULE_SHIFT, memory.shiftKind)
            .putLong(KEY_SCHEDULE_SHIFT_FROM, memory.shiftFromMs)
            .putLong(KEY_SCHEDULE_SHIFT_TO, memory.shiftToMs ?: 0L)
            .putLong(KEY_SCHEDULE_SHIFT_AT, memory.shiftAtMs)
            .apply()
    }

    /**
     * Клик по зоне виджета: receiver кладёт действие сюда и открывает приложение.
     *
     * Запись происходит только в `onReceive`, а не при создании `PendingIntent`: иначе
     * отложенное действие срабатывало бы при следующем открытии без клика.
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
