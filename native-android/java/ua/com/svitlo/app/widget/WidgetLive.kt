package ua.com.svitlo.app.widget

import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import kotlin.math.abs

/**
 * Окно отключения в epoch-миллисекундах.
 *
 * Приходит из JS (`windowsToday`/`windowsTomorrow` в снимке) уже обрезанным по киевским суткам:
 * Kotlin не умеет читать расписание, но обязан сам считать остаток — иначе таймер на виджете
 * замирает между запусками приложения.
 */
data class WidgetWindow(val startMs: Long, val endMs: Long) {
    fun contains(nowMs: Long): Boolean = nowMs in startMs until endMs
}

/** Момент, к которому идёт обратный отсчёт, и его смысл. */
data class WidgetCountdown(val mode: String, val targetAt: Long) {
    companion object {
        const val MODE_UNTIL_ON = "untilOn"
        const val MODE_UNTIL_OFF = "untilOff"
    }
}

/**
 * Остаток в минутах: раскладывается на числа, текст собирает провайдер из ресурсов.
 *
 * Тексты НЕ живут в Kotlin-литералах намеренно. В 2.41.4 кириллица из Kotlin-строк
 * приезжала на виджет кракозябрами (`Ð³Ð¾Ð´` вместо `год`), хотя ресурсы и строки из JS
 * отображались верно. Причина — разное кодирование при компиляции исходников; ресурсы
 * AAPT собирает в UTF-8 всегда, поэтому все пользовательские подписи переехали в
 * `res/values/widget_strings.xml`.
 */
data class RemainingTime(val hours: Long, val minutes: Long, val lessThanMinute: Boolean)

/**
 * Длина отключений за сутки в часах и минутах.
 *
 * `isZero` — «отключений не было», это отличается от `null` («графика нет»): пустой ответ
 * оператора нельзя выдавать за отсутствие отключений. Сам текст собирает провайдер из
 * ресурсов — в Kotlin-литералах кириллица приезжала кракозябрами.
 */
data class OutageLength(val hours: Int, val minutes: Int, val isZero: Boolean)

/**
 * Живая логика виджета: обратный отсчёт и окна отключений.
 *
 * Отдельный объект без `Context` и без Android-зависимостей — всё тестируется на JVM
 * (`WidgetLiveTest`), а не только на телефоне. Форматирование времени — явно по Киеву:
 * телефон может стоять в другом поясе, а график всегда киевский.
 */
object WidgetLive {
    val KYIV: TimeZone = TimeZone.getTimeZone("Europe/Kyiv")

    /**
     * Текущее окно отключения или `null`.
     *
     * Источник правды — только окна: `state` в снимке приходит из JS и может отставать на
     * минуту-две после записи графика. Если человек внутри окна, виджет обязан показать
     * «до увімкнення», даже когда приложение ещё думает иначе.
     */
    fun currentWindow(windows: List<WidgetWindow>, nowMs: Long): WidgetWindow? =
        windows.firstOrNull { it.contains(nowMs) }

    /** Ближайшее будущее окно: таймер «до відключення». */
    fun nextWindow(windows: List<WidgetWindow>, nowMs: Long): WidgetWindow? =
        windows.filter { it.startMs > nowMs }.minByOrNull { it.startMs }

    /**
     * Обратный отсчёт по окнам; `null` — считать нечего (график не опубликован, окна прошли).
     *
     * Внутри окна считаем до его конца, снаружи — до начала следующего.
     */
    fun countdown(windows: List<WidgetWindow>, nowMs: Long): WidgetCountdown? {
        val current = currentWindow(windows, nowMs)
        if (current != null && current.endMs > nowMs) {
            return WidgetCountdown(WidgetCountdown.MODE_UNTIL_ON, current.endMs)
        }
        val next = nextWindow(windows, nowMs) ?: return null
        return WidgetCountdown(WidgetCountdown.MODE_UNTIL_OFF, next.startMs)
    }

    /** Сколько осталось до момента; `null` — время уже прошло. */
    fun remaining(targetMs: Long, nowMs: Long): RemainingTime? {
        val left = targetMs - nowMs
        if (left <= 0L) return null
        val totalMinutes = left / 60_000L
        if (totalMinutes <= 0L) return RemainingTime(0, 0, lessThanMinute = true)
        return RemainingTime(totalMinutes / 60L, totalMinutes % 60L, lessThanMinute = false)
    }

    /** Минуты отключений за сутки: `null` — графика нет, `isZero` — отключений не было. */
    fun outageLength(totalMinutes: Int?): OutageLength? = when {
        totalMinutes == null -> null
        totalMinutes <= 0 -> OutageLength(0, 0, isZero = true)
        else -> OutageLength(totalMinutes / 60, totalMinutes % 60, isZero = false)
    }

    /** Время окна «HH:mm» — только цифры и двоеточие, без кириллицы. */
    fun clock(ms: Long): String =
        SimpleDateFormat("HH:mm", Locale.UK).apply { timeZone = KYIV }.format(Date(ms))

    /**
     * Окна как пары «начало»—«конец» для плиток: `[("09:30", "13:00"), …]`.
     *
     * Разделители и «…» подставляет провайдер из ресурсов: строки из Kotlin-литералов
     * на части прошивок приезжали кракозябрами.
     */
    fun windowPairs(windows: List<WidgetWindow>, maxRanges: Int = 2): List<Pair<String, String>> =
        windows.take(maxRanges).map { window -> clock(window.startMs) to clock(window.endMs) }

    /** Подпись «зараз» для шкалы: момент, к которому идёт отсчёт («11:00»). */
    fun hintTime(windows: List<WidgetWindow>, nowMs: Long): String? {
        currentWindow(windows, nowMs)?.let { return clock(it.endMs) }
        nextWindow(windows, nowMs)?.let { return clock(it.startMs) }
        return null
    }

    /**
     * Начало киевских суток для момента `ms` — ключ «тот же день» при сравнении графиков.
     *
     * Нужен, чтобы смена суток не читалась как «отключение перенесли»: ночью вчерашний график
     * исчезает и появляется сегодняшний, и первое окно честно начинается в другое время.
     */
    fun dayKey(ms: Long): Long {
        val calendar = Calendar.getInstance(KYIV)
        calendar.timeInMillis = ms
        calendar.set(Calendar.HOUR_OF_DAY, 0)
        calendar.set(Calendar.MINUTE, 0)
        calendar.set(Calendar.SECOND, 0)
        calendar.set(Calendar.MILLISECOND, 0)
        return calendar.timeInMillis
    }

    /**
     * Что показать вместо обратного отсчёта, когда считать нечего.
     *
     * Три состояния, которые нельзя путать:
     *  - `ALL_CLEAR` — графік на добу є, але вікон у ньому немає: «Світло не вимикатимуть»;
     *  - `LIGHT_ON` — вікна були й уже минули: «Світло є» (ніколи не показуємо старий таймер);
     *  - `NONE` — даних немає або зараз аварійне відключення: лишається текст зі снімка.
     *
     * `todayOffMinutes` — маркер «графік на добу опубліковано»: `null` означає «даних немає»,
     * і тоді обіцяти «світло не вимикатимуть» не можна.
     */
    fun fallback(
        windowsToday: List<WidgetWindow>,
        todayOffMinutes: Int?,
        state: String,
        nowMs: Long,
    ): TimerFallback {
        // Аварійне відключення поза графіком: обіцянки «не вимикатимуть» були б неправдою.
        if (state == STATE_OFF) return TimerFallback.NONE
        if (windowsToday.isEmpty()) {
            return when {
                // `null` — графіка на добу ще немає: про відключення нічого не відомо.
                todayOffMinutes == null -> TimerFallback.NONE
                // Графік відомий і в ньому нуль хвилин: саме той випадок, коли чесно сказати
                // «Світло не вимикатимуть» замість прочерку.
                todayOffMinutes <= 0 -> TimerFallback.ALL_CLEAR
                // Хвилини є, а вікон у снімку немає (обрізаний/застарілий снімок): обіцяти
                // «не вимикатимуть» не можна, але й старий таймер показувати нема сенсу.
                else -> TimerFallback.LIGHT_ON
            }
        }
        val ended = windowsToday.all { it.endMs <= nowMs }
        return if (ended) TimerFallback.LIGHT_ON else TimerFallback.NONE
    }

    /**
     * Перенос или отмена окна относительно прошлого снимка.
     *
     * Сравниваем только БУДУЩИЕ окна. Прошедшее окно исчезает из снимка само по себе (оператор
     * перепубликовал график, наступил новый день), и это не повод писать «відключення
     * перенесено». Смена суток тоже игнорируется: ночью вчерашний график уступает место
     * сегодняшнему, и первое окно честно начинается в другое время.
     *
     * Отмена — когда будущее окно было и пропало. Перенос — когда ближайшее будущее окно
     * сдвинулось больше чем на минуту (тот же порог, что у тикающего таймера).
     */
    fun detectShift(
        previousStarts: List<Long>,
        current: List<WidgetWindow>,
        nowMs: Long,
    ): ScheduleShift? {
        val previousFirst = previousStarts.filter { it > nowMs }.minOrNull() ?: return null
        if (dayKey(previousFirst) != dayKey(nowMs)) return null
        val currentFuture = current.filter { it.startMs > nowMs }
        if (currentFuture.isEmpty()) return ScheduleShift(ScheduleShift.CANCELLED, previousFirst, null)
        val currentFirst = currentFuture.minOf { it.startMs }
        if (dayKey(currentFirst) != dayKey(nowMs)) return null
        if (abs(currentFirst - previousFirst) < MIN_SHIFT_MS) return null
        return ScheduleShift(ScheduleShift.MOVED, previousFirst, currentFirst)
    }

    /** Порог «це вже інший час, а не таймерне тремтіння» — одна минута. */
    private const val MIN_SHIFT_MS = 60_000L

    /** Код стану «світло вимкнено» — той самий, що в снімку та `WidgetStyle.color`. */
    const val STATE_OFF = "off"
}

/** Что показать, когда обратного отсчёта нет. */
enum class TimerFallback {
    /** Считать нечего или данных нет: остаётся текст из снимка. */
    NONE,

    /** График на сутки есть, окон в нём нет. */
    ALL_CLEAR,

    /** Все окна суток уже прошли: сейчас свет есть. */
    LIGHT_ON,
}

/**
 * Перенос или отмена окна отключения между двумя снимками расписания.
 *
 * `fromMs` — прежнее начало первого окна суток, `toMs` — новое (null, если отключение убрали).
 */
data class ScheduleShift(val kind: String, val fromMs: Long, val toMs: Long?) {
    companion object {
        const val MOVED = "moved"
        const val CANCELLED = "cancelled"
    }
}
