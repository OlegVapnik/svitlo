package ua.com.svitlo.app.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.app.AlarmManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.SystemClock
import android.util.Log
import android.util.TypedValue
import android.view.View
import android.widget.RemoteViews
import ua.com.svitlo.app.R

/**
 * Провайдер домашнього виджета.
 *
 * Данные приходят из `SharedPreferences` (пишет JS через `SvitloWidgetModule`), а разметка —
 * обычные XML-макеты с нативными `TextView`/`ImageView`. Никакого Canvas и полноэкранного
 * Bitmap: именно они давали «Не вдаётся завантажити віджет» на HyperOS/One UI, потому что
 * картинка 4×2 в ARGB_8888 весит больше лимита Binder (~1 МБ). Единственный растр — шкала
 * суток 480×24 в RGB_565 (≈23 КБ), см. [WidgetTimeline].
 *
 * Клики не пишут `pending_action` при создании `PendingIntent`: действие едет в
 * `Intent.action` и сохраняется только в [WidgetActionReceiver.onReceive], то есть по факту
 * нажатия. Иначе «Оновити» срабатывало бы при следующем открытии приложения без клика.
 */
open class SvitloWidgetProvider : AppWidgetProvider() {

    /** Макет конкретного размера; переопределяется подклассами. */
    protected open val layoutId: Int
        get() = R.layout.svitlo_widget_command

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray,
    ) {
        appWidgetIds.forEach { update(context, appWidgetManager, it, layoutId, optionsOf(appWidgetManager, it)) }
        // Таймер теперь текст, а не Chronometer: `RemoteViews.setChronometer` падал в лаунчере
        // (`TextView doesn't have method: setBase(long)`). Чтобы минуты шли и без открытого
        // приложения, раз в минуту приходит будильник и перерисовывает снимок.
        scheduleTick(context)
    }

    override fun onEnabled(context: Context) {
        super.onEnabled(context)
        scheduleTick(context)
    }

    override fun onDisabled(context: Context) {
        super.onDisabled(context)
        cancelTick(context)
    }

    /**
     * Ресайз: пересобираем `RemoteViews` под НОВЫЕ размеры, а не просто перепривязываем данные.
     *
     * HyperOS присылает `OPTION_APPWIDGET_MIN_WIDTH`/`MIN_HEIGHT` именно здесь, и только они
     * описывают ячейку после перетаскивания ручки. Раньше метод молча вызывал `update(...)`
     * без опций — виджет перерисовывался в прежней «компактной» логике, и на 2×2 оставался
     * квадратный макет с обрезанной шапкой. Теперь размеры прокидываются в сборку макета.
     */
    override fun onAppWidgetOptionsChanged(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetId: Int,
        newOptions: Bundle,
    ) {
        update(context, appWidgetManager, appWidgetId, layoutId, newOptions)
    }

    companion object {
        private const val TAG = "SvitloWidget"
        /** Дольше суток обратный отсчёт теряет смысл: в ячейке остаётся спокойный текст. */
        /** Идентификатор будильника и период: минута — шаг сетки ГПВ и подписей таймера. */
        private const val TICK_REQUEST = 7301
        private const val TICK_INTERVAL_MS = 60_000L
        private const val MAX_COUNTDOWN_MS = 24L * 60L * 60L * 1000L

        /** Базовий кегль таймера для 4×1 і 4×2: у 2×1 свій (20f), у 2×2 — 22f. */
        private const val BASE_TIMER_SP = 24f

        /** Стеля кегля: «12 хв» кеглем 30sp виглядав би як заголовок і вилазив по ширині. */
        private const val MAX_TIMER_SP = 26f

        /** Скільки пам'ятаємо факт переносу вікна: довше — це вже історія, а не підказка. */
        private const val SHIFT_TTL_MS = 3L * 60L * 60L * 1000L

        private val providers: List<SvitloWidgetProvider> = listOf(
            SvitloWidget2x1(),
            SvitloWidget4x1(),
            SvitloWidget4x2(),
            SvitloWidgetPlaces4x2(),
            SvitloWidgetEvent2x2(),
        )

        /**
         * Раз в минуту обновляет виджеты, пока они на экране.
         *
         * `setInexactRepeating` разрешён без спецразрешений (в отличие от точных будильников),
         * а точность до минуты таймеру и нужна: он показывает «12 хв», а не секунды.
         * `ELAPSED_REALTIME` не будит устройство зря — после разблокировки значение всё равно
         * пересчитывается из окон отключений.
         */
        fun scheduleTick(context: Context) {
            val alarm = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
            val intent = Intent(context, WidgetActionReceiver::class.java)
                .setAction(WidgetActionReceiver.ACTION_TICK)
            val pending = PendingIntent.getBroadcast(
                context,
                TICK_REQUEST,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            try {
                alarm.setInexactRepeating(
                    AlarmManager.ELAPSED_REALTIME,
                    SystemClock.elapsedRealtime() + TICK_INTERVAL_MS,
                    TICK_INTERVAL_MS,
                    pending,
                )
            } catch (error: Exception) {
                Log.w(TAG, "failed to schedule widget tick", error)
            }
        }

        fun cancelTick(context: Context) {
            val alarm = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
            val intent = Intent(context, WidgetActionReceiver::class.java)
                .setAction(WidgetActionReceiver.ACTION_TICK)
            val pending = PendingIntent.getBroadcast(
                context,
                TICK_REQUEST,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            try {
                alarm.cancel(pending)
            } catch (error: Exception) {
                Log.w(TAG, "failed to cancel widget tick", error)
            }
        }

        /**
         * Размеры конкретного экземпляра виджета.
         *
         * `getAppWidgetOptions` есть с API 16, но часть лаунчеров возвращает `null` или пустой
         * `Bundle` — это не ошибка приложения, поэтому исключение гасим здесь, а не в `onUpdate`.
         */
        private fun optionsOf(manager: AppWidgetManager, widgetId: Int): Bundle? = try {
            manager.getAppWidgetOptions(widgetId)
        } catch (error: Exception) {
            Log.w(TAG, "getAppWidgetOptions failed for widget $widgetId", error)
            null
        }

        fun updateAll(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            for (provider in providers) {
                val ids = manager.getAppWidgetIds(ComponentName(context, provider::class.java))
                ids.forEach { update(context, manager, it, provider.layoutId, optionsOf(manager, it)) }
            }
        }

        /**
         * Собирает и отправляет `RemoteViews` конкретному экземпляру.
         *
         * `options` приходят из `onUpdate` (то, что система уже знает) или из
         * `onAppWidgetOptionsChanged` (свежие размеры после ресайза). Если их нет — работаем
         * с полной шапкой: показать лишний бейдж лучше, чем спрятать название места.
         */
        private fun update(
            context: Context,
            manager: AppWidgetManager,
            widgetId: Int,
            layoutId: Int,
            options: Bundle? = null,
        ) {
            val payload = safePayload(context)
            val metrics = metricsOf(options)
            val shift = resolveShift(context, payload)
            // Две ступени защиты. Первая — сборка основного макета: любая ошибка данных
            // (битый drawable, отсутствующий id, слишком большой Bitmap) не должна оставлять
            // человека с «Не вдається завантажити віджет». Вторая — сама отправка в лаунчер:
            // RemoteViews может отвергнуть Binder-пакет уже на стороне системы.
            val views = try {
                buildViews(context, layoutId, payload, metrics, shift)
            } catch (error: Throwable) {
                Log.e(TAG, "не вдалося зібрати макет $layoutId для віджета $widgetId", error)
                fallbackViews(context, payload, error)
            }
            try {
                manager.updateAppWidget(widgetId, views)
            } catch (error: Throwable) {
                Log.e(TAG, "updateAppWidget failed for widget $widgetId", error)
            }
        }

        /**
         * Размеры экземпляра из `Bundle`.
         *
         * `OPTION_APPWIDGET_MIN_*` уже в dp — пересчёт плотности не нужен. Значения `0` и
         * отрицательные приходят от лаунчеров, которые не умеют опции (старые MIUI), и тогда
         * `WidgetMetrics.UNKNOWN` отключает компактный режим.
         */
        private fun metricsOf(options: Bundle?): WidgetMetrics {
            if (options == null) return WidgetMetrics.UNKNOWN
            val width = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0)
            val height = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0)
            if (width <= 0 && height <= 0) return WidgetMetrics.UNKNOWN
            return WidgetMetrics(width, height)
        }

        /**
         * Подпись переноса/отмены окна — только по реальным данным, которые уже есть.
         *
         * В снимке JS нет поля «перенесено», а выдумывать его нельзя: сервер присылает только
         * окна суток (`windowsToday`). Поэтому правило производное — сравниваем подпись
         * графика (отсортированный список начал окон) с той, что видели в прошлый раз:
         *  - начала поменялись, день и место те же → «Відключення перенесено на HH:mm»;
         *  - окна были, а теперь их нет → «Відключення скасували».
         *
         * Память живёт в `SharedPreferences` ([WidgetPrefs.ScheduleMemory]) и хранит сам факт
         * переноса: копий виджета на экране может быть несколько, и каждая обязана показать
         * ту же плашку. Срок жизни подписи — [SHIFT_TTL_MS]; дольше человеку это уже неважно,
         * а врущая «перенесено» через сутки хуже молчания.
         *
         * Смена места или киевских суток сбрасывает память: иначе переключение закладки
         * выглядело бы как «отключение перенесли».
         */
        private fun resolveShift(
            context: Context,
            payload: WidgetPayload,
            nowMs: Long = System.currentTimeMillis(),
        ): ScheduleShift? {
            val owner = payload.placeLabel + " " + payload.queueLabel
            val starts = payload.windowsToday.map { it.startMs }.sorted()
            val memory = try {
                WidgetPrefs.readSchedule(context)
            } catch (error: Exception) {
                Log.w(TAG, "не вдалося прочитати підпис графіка", error)
                null
            }
            val sameSchedule = memory != null &&
                memory.owner == owner &&
                memory.dayKey == WidgetLive.dayKey(nowMs)
            val previousStarts = if (sameSchedule) memory?.starts.orEmpty() else emptyList()
            val detected = if (sameSchedule && previousStarts != starts) {
                WidgetLive.detectShift(previousStarts, payload.windowsToday, nowMs)
            } else {
                null
            }
            val stored = memory?.shiftKind?.let { kind ->
                val age = nowMs - memory.shiftAtMs
                if (sameSchedule && age in 0..SHIFT_TTL_MS && memory.starts == starts) {
                    ScheduleShift(kind, memory.shiftFromMs, memory.shiftToMs)
                } else {
                    null
                }
            }
            val result = detected ?: stored
            try {
                WidgetPrefs.writeSchedule(
                    context,
                    WidgetPrefs.ScheduleMemory(
                        owner = owner,
                        dayKey = WidgetLive.dayKey(nowMs),
                        starts = starts,
                        shiftKind = result?.kind,
                        shiftFromMs = result?.fromMs ?: 0L,
                        shiftToMs = result?.toMs,
                        // Свежий перенос получает новую отметку, унаследованный — прежнюю.
                        shiftAtMs = if (detected != null) nowMs else memory?.shiftAtMs ?: 0L,
                    ),
                )
            } catch (error: Exception) {
                Log.w(TAG, "не вдалося зберегти підпис графіка", error)
            }
            return result
        }


        /** Payload из SharedPreferences: битый JSON или огромные строки не должны ронять виджет. */
        private fun safePayload(context: Context): WidgetPayload {
            val parsed = try {
                WidgetPayload.parse(WidgetPrefs.readPayload(context)) ?: WidgetPayload.placeholder()
            } catch (error: Exception) {
                Log.w(TAG, "не вдалося прочитати payload віджета", error)
                WidgetPayload.placeholder()
            }
            return parsed.sanitized(context)
        }

        /**
         * Обрезка текста до безопасной длины.
         *
         * `TextView` с `maxLines=1` не спасает от Binder-лимита: каждая строка едет отдельным
         * действием RemoteViews, а `JSON.stringify` умеет прислать `null` строкой. После
         * нормализации «null» становится заглушкой, переводы строк — пробелами.
         */
        private fun WidgetPayload.sanitized(context: Context): WidgetPayload = copy(
            placeLabel = WidgetText.sanitize(placeLabel, context.getString(R.string.widget_no_data), maxLength = 40),
            queueLabel = WidgetText.sanitize(queueLabel, maxLength = 16),
            pill = WidgetText.sanitize(pill, context.getString(R.string.widget_no_data), maxLength = 32),
            detail = WidgetText.sanitize(detail),
            timer = timer?.let { WidgetText.sanitize(it, maxLength = 32) },
            timerPrefix = timerPrefix?.let { WidgetText.sanitize(it, maxLength = 32) },
            places = places.map { place ->
                place.copy(
                    label = WidgetText.sanitize(place.label),
                    queue = WidgetText.sanitize(place.queue, maxLength = 32),
                    statusText = WidgetText.sanitize(place.statusText, context.getString(R.string.widget_no_data)),
                    timeLabel = WidgetText.sanitize(place.timeLabel, maxLength = 48),
                )
            },
        )

        private fun buildViews(
            context: Context,
            layoutId: Int,
            payload: WidgetPayload,
            metrics: WidgetMetrics,
            shift: ScheduleShift?,
        ): RemoteViews {
            val views = RemoteViews(context.packageName, layoutId)
            when (layoutId) {
                R.layout.svitlo_widget_capsule -> bindCapsule(context, views, payload, metrics, shift)
                R.layout.svitlo_widget_timeline -> bindTimeline(context, views, payload, metrics, shift)
                R.layout.svitlo_widget_places -> bindPlaces(context, views, payload)
                R.layout.svitlo_widget_event -> bindEvent(context, views, payload, metrics, shift)
                else -> bindCommand(context, views, payload, metrics, shift)
            }
            return views
        }

        /**
         * Аварийный виджет: только классы, разрешённые в RemoteViews на любой прошивке.
         *
         * Причину пишем в текст мелким шрифтом — так с телефона видно, что дело не в данных,
         * а в конкретном OEM-ограничении.
         */
        private fun fallbackViews(context: Context, payload: WidgetPayload, error: Throwable): RemoteViews {
            val views = RemoteViews(context.packageName, R.layout.svitlo_widget_fallback)
            val reason = error::class.java.simpleName.ifBlank { "WidgetError" }
            views.setImageViewResource(R.id.widget_dot, WidgetStyle.dot(payload.state))
            views.setTextViewText(R.id.widget_place, WidgetText.sanitize(payload.placeLabel, context.getString(R.string.app_name)))
            views.setTextViewText(
                R.id.widget_detail,
                context.getString(R.string.widget_fallback_hint, reason),
            )
            views.setTextViewText(
                R.id.widget_timer,
                payload.timer?.takeUnless { it == "null" } ?: context.getString(R.string.widget_dash),
            )
            widgetAction(context, WidgetActionReceiver.ACTION_OPEN_APP)?.let {
                views.setOnClickPendingIntent(R.id.widget_root, it)
            }
            return views
        }

        /**
         * Шкала суток — единственный растр. Рисование вынесено в отдельную функцию, потому что
         * `Bitmap.createBitmap` на слабом устройстве может бросить `OutOfMemoryError`: без
         * перехвата весь `onUpdate` падал и лаунчер показывал ошибку загрузки.
         */
        private fun setScale(views: RemoteViews, squiggly: Boolean, payload: WidgetPayload) {
            val bitmap = try {
                if (squiggly) WidgetTimeline.renderSquiggly(payload) else WidgetTimeline.render(payload)
            } catch (error: Throwable) {
                Log.w(TAG, "не вдалося намалювати шкалу доби", error)
                return
            }
            views.setImageViewBitmap(R.id.widget_scale, bitmap)
        }

        /**
         * Полоса-«светофор» — фон `FrameLayout`, а не `src` у `ImageView`.
         *
         * `setImageViewResource` с XML-`<shape>` на части прошивок падает при применении
         * RemoteViews в процессе лаунчера (у shape нет собственной геометрии). У `FrameLayout`
         * есть `@RemoteView`, а `setBackgroundResource` понимает любой View — это самый
         * предсказуемый путь.
         */
        private fun setAccent(views: RemoteViews, state: String) {
            views.setInt(R.id.widget_accent, "setBackgroundResource", WidgetStyle.accent(state))
        }

        /**
         * Шапка: место и очередь двумя отдельными `TextView`.
         *
         * Раньше JS присылал «Дім · 6/1» одной строкой — в 2×1 кириллица с длинным названием
         * места вытесняла очередь целиком. Теперь очередь — своя вьюха, и её можно скрыть,
         * когда график ещё не выбран, а не показывать пустую точку.
         *
         * В узкой ячейке (`WidgetMetrics.compactHeader`) чип очереди прячется совсем: при
         * 110–176dp два бейджа плюс название не помещаются физически, и лаунчер показывал
         * вместо «Дім» многоточие. Название места и статус важнее кода очереди — код есть
         * на главном экране приложения.
         */
        private fun bindHeader(views: RemoteViews, payload: WidgetPayload, metrics: WidgetMetrics) {
            views.setTextViewText(R.id.widget_place, payload.placeLabel)
            val queue = payload.queueLabel
            if (queue.isBlank() || metrics.compactHeader) {
                views.setViewVisibility(R.id.widget_queue, View.GONE)
            } else {
                views.setViewVisibility(R.id.widget_queue, View.VISIBLE)
                views.setTextViewText(R.id.widget_queue, queue)
            }
        }

        /**
         * Таймер: остаток считается из окон отключений, а не берётся из снимка.
         *
         * Окна приходят из JS в epoch-ms, поэтому «12 хв» остаётся верным и между запусками
         * приложения: раз в минуту виджет перерисовывает будильник (`scheduleTick`).
         *
         * Когда считать нечего, старый текст из снимка НЕ показываем вслепую — он бывает
         * просроченным («5 год 02 хв» уже после отключения). Сначала три честных состояния
         * (`WidgetLive.fallback`): «Світло не вимикатимуть», «Світло є», и только потом
         * текст снимка (аварийное отключение вне графика).
         *
         * `timerSp` — БАЗОВЫЙ кегль конкретного макета: 20 для 2×1, 22 для 2×2, 24 для 4×1
         * и 4×2. Раньше здесь стояло жёсткое `24f` для любого размера, и в узкой капсуле
         * «5 год 02 хв» вылезал за клітинку. Ограничение сверху (`MAX_TIMER_SP`) не даёт
         * короткому «12 хв» стать огромным.
         *
         * `autoSize` — только 2×1: там размер шрифта считает XML (`autoSizeTextType`), и
         * `setTextViewTextSize` только мешал бы ему подобрать высоту строки.
         */
        private fun bindTimer(
            context: Context,
            views: RemoteViews,
            payload: WidgetPayload,
            timerSp: Float = BASE_TIMER_SP,
            autoSize: Boolean = false,
            nowMs: Long = System.currentTimeMillis(),
        ) {
            val countdown = WidgetLive.countdown(payload.windowsToday, nowMs)
            val target = countdown?.targetAt
            // Дальше суток обратный отсчёт теряет смысл — остаётся спокойный текст из снимка.
            // ВАЖНО: только `setTextViewText`. `RemoteViews.setChronometer` дергает у View
            // `setBase(long)`, которого у TextView нет: лаунчер падал с ActionException и
            // виджет не загружался (регрессия 2.41.3). Тик раз в минуту приходит от AlarmManager
            // (`scheduleTick`), а пока приложение открыто — снимок обновляет JS.
            val remaining = target?.let { WidgetLive.remaining(it, nowMs) }
            if (remaining != null && target - nowMs in 1..MAX_COUNTDOWN_MS) {
                views.setTextViewText(R.id.widget_timer, remainingLabel(context, remaining))
                val prefixRes = if (countdown?.mode == WidgetCountdown.MODE_UNTIL_ON) {
                    R.string.widget_until_on
                } else {
                    R.string.widget_until_off
                }
                views.setTextViewText(R.id.widget_timer_prefix, context.getString(prefixRes))
                views.setViewVisibility(R.id.widget_timer_prefix, View.VISIBLE)
                if (!autoSize) {
                    views.setTextViewTextSize(
                        R.id.widget_timer,
                        TypedValue.COMPLEX_UNIT_SP,
                        timerSp.coerceAtMost(MAX_TIMER_SP),
                    )
                }
                return
            }
            val fallback = WidgetLive.fallback(
                windowsToday = payload.windowsToday,
                todayOffMinutes = payload.todayOffMinutes,
                state = payload.state,
                nowMs = nowMs,
            )
            val text = when (fallback) {
                TimerFallback.ALL_CLEAR -> context.getString(R.string.widget_no_outages_today)
                TimerFallback.LIGHT_ON -> context.getString(R.string.widget_light_on)
                TimerFallback.NONE -> payload.timer?.takeUnless { it == "null" }
                    ?: if (payload.state == "on" || payload.state == "allClear") {
                        context.getString(R.string.widget_light_on)
                    } else {
                        context.getString(R.string.widget_dash)
                    }
            }
            views.setTextViewText(R.id.widget_timer, text)
            // «Світло не вимикатимуть» / «Світло є» — самодостатні: підпис «до відключення»
            // поруч із ними суперечив би змісту.
            val prefix = if (fallback == TimerFallback.NONE) {
                payload.timerPrefix?.takeUnless { it == "null" } ?: ""
            } else {
                ""
            }
            views.setTextViewText(R.id.widget_timer_prefix, prefix)
            // Пустой TextView всё равно занимает строку по высоте: в 2×1 это ровно тот
            // вертикальный запас, которого не хватало таймеру.
            views.setViewVisibility(
                R.id.widget_timer_prefix,
                if (prefix.isBlank()) View.GONE else View.VISIBLE,
            )
            if (autoSize) return
            // В 2×2, 4×1 и 4×2 таймер — самая крупная строка: длинный текст вроде «Світло є»
            // и «1 год 20 хв» не должен обрезаться по ширине ячейки. Подписи-состояния
            // («Світло не вимикатимуть») длиннее любого таймера и уходят в мелкий кегль.
            val size = when {
                text.length <= 6 -> timerSp + 4f
                text.length <= 9 -> timerSp + 1f
                else -> timerSp - 4f
            }
            views.setTextViewTextSize(
                R.id.widget_timer,
                TypedValue.COMPLEX_UNIT_SP,
                size.coerceAtMost(MAX_TIMER_SP),
            )
        }

        /**
         * Подпись под таймером: «Вимкнуть о 23:00», «Відключення перенесено на 01:00».
         *
         * Перенос и отмена важнее обычной подписи: человек, который ждал отключение в 09:30,
         * обязан увидеть, что оно переехало, а не гадать, почему таймер показывает другое.
         */
        private fun detailLabel(
            context: Context,
            payload: WidgetPayload,
            shift: ScheduleShift?,
            nowMs: Long = System.currentTimeMillis(),
        ): String {
            if (shift?.kind == ScheduleShift.CANCELLED) {
                return context.getString(R.string.widget_outage_cancelled)
            }
            if (shift?.kind == ScheduleShift.MOVED) {
                // Время берём из самой смены: `countdown` внутри окна вернул бы его КОНЕЦ,
                // и виджет написал бы «перенесено на 13:00» уже после начала отключения.
                val target = shift.toMs ?: payload.windowsToday.minOfOrNull { it.startMs }
                if (target != null) {
                    return context.getString(R.string.widget_outage_moved, WidgetLive.clock(target))
                }
            }
            return payload.detail.takeUnless { it == "null" }
                ?.ifBlank { context.getString(R.string.widget_open_hint) }
                ?: context.getString(R.string.widget_open_hint)
        }


        /** Остаток в минутах словами: «12 хв», «1 год 05 хв», «менше хв». */
        private fun remainingLabel(context: Context, remaining: RemainingTime): String = when {
            remaining.lessThanMinute -> context.getString(R.string.widget_less_minute)
            remaining.hours == 0L -> context.getString(R.string.widget_minutes_short, remaining.minutes)
            remaining.minutes == 0L -> context.getString(R.string.widget_hour_short, remaining.hours)
            else -> context.getString(
                R.string.widget_hour_minute_short,
                remaining.hours,
                remaining.minutes,
            )
        }

        /**
         * Длина отключений за сутки: «30 хв без світла», «1 год без світла», «Без відключень».
         *
         * `null` — графика нет (показываем переданную заглушку), ноль — отключений не было.
         * Слова берутся из ресурсов: кириллица в Kotlin-литералах приезжала кракозябрами.
         */
        private fun outageLabel(context: Context, totalMinutes: Int?, unknown: String): String {
            val length = WidgetLive.outageLength(totalMinutes) ?: return unknown
            return when {
                length.isZero -> context.getString(R.string.widget_no_outages)
                length.hours == 0 -> context.getString(R.string.widget_minutes_without_power, length.minutes)
                length.minutes == 0 -> context.getString(R.string.widget_hours_without_power, length.hours)
                else -> context.getString(
                    R.string.widget_hours_minutes_without_power,
                    length.hours,
                    length.minutes,
                )
            }
        }

        /**
         * Окна отключений строкой для плитки: «09:30–13:00, 17:00–20:00 …».
         *
         * Разделители — тоже ресурсы: `–` из Kotlin-литерала приезжал кракозябрами.
         */
        private fun windowsLabel(context: Context, windows: List<WidgetWindow>, maxRanges: Int = 2): String {
            val pairs = WidgetLive.windowPairs(windows, maxRanges)
            if (pairs.isEmpty()) return context.getString(R.string.widget_no_outages)
            val joined = pairs
                .map { (start, end) -> context.getString(R.string.widget_windows_range, start, end) }
                .reduce { left, right -> context.getString(R.string.widget_windows_join, left, right) }
            return if (windows.size > maxRanges) {
                context.getString(R.string.widget_windows_join, joined, context.getString(R.string.widget_windows_more))
            } else {
                joined
            }
        }

        private fun bindCapsule(
            context: Context,
            views: RemoteViews,
            payload: WidgetPayload,
            metrics: WidgetMetrics,
            shift: ScheduleShift?,
        ) {
            val state = payload.state
            views.setInt(
                R.id.widget_root,
                "setBackgroundResource",
                WidgetStyle.capsuleBackground(state),
            )
            bindDot(views, R.id.widget_dot, state)
            bindHeader(views, payload, metrics)
            views.setTextViewText(R.id.widget_pill, payload.pill)
            // Авто-розмір таймера задан у XML: у 2×1 саме він гарантує, що цифри не ріжуться.
            // `timerSp` тут — база для випадку, коли авто-розмір недоступний (старий OEM).
            bindTimer(context, views, payload, timerSp = 20f, autoSize = true)
            // Підпис «до відключення» повертаємо лише у високій клітинці: у 2×1 його роль уже
            // виконує рядок точного часу, а зайва строка з'їдала б висоту таймера.
            if (!metrics.tall) {
                views.setViewVisibility(R.id.widget_timer_prefix, View.GONE)
            }
            views.setTextViewText(R.id.widget_detail, detailLabel(context, payload, shift))
            setScale(views, squiggly = true, payload = payload)

            widgetAction(context, WidgetActionReceiver.ACTION_CYCLE_BOOKMARK)?.let {
                views.setOnClickPendingIntent(R.id.widget_cycle, it)
            }
            widgetAction(context, WidgetActionReceiver.ACTION_OPEN_APP)?.let {
                views.setOnClickPendingIntent(R.id.widget_pill, it)
            }
        }

        /**
         * 2×2 «Наступна Зміна»: вертикальный формат без строки места — сверху точка
         * состояния и пилюля, в центре огромный таймер, внизу «змійка» доби.
         */
        private fun bindEvent(
            context: Context,
            views: RemoteViews,
            payload: WidgetPayload,
            metrics: WidgetMetrics,
            shift: ScheduleShift?,
        ) {
            val state = payload.state
            bindDot(views, R.id.widget_dot, state)
            // Горизонтальный «светофор» сверху: цвет мгновенно читается как состояние.
            setAccent(views, state)
            bindHeader(views, payload, metrics)
            views.setTextViewText(R.id.widget_pill, payload.pill)
            // 2×2: квадратна клітинка ≈110dp, тому кегль трохи менший за 4×1/4×2.
            bindTimer(context, views, payload, timerSp = 22f)
            views.setTextViewText(R.id.widget_detail, detailLabel(context, payload, shift))
            setScale(views, squiggly = true, payload = payload)

            widgetAction(context, WidgetActionReceiver.ACTION_CYCLE_BOOKMARK)?.let {
                views.setOnClickPendingIntent(R.id.widget_cycle, it)
            }
            widgetAction(context, WidgetActionReceiver.ACTION_OPEN_APP)?.let {
                views.setOnClickPendingIntent(R.id.widget_pill, it)
            }
        }

        private fun bindTimeline(
            context: Context,
            views: RemoteViews,
            payload: WidgetPayload,
            metrics: WidgetMetrics,
            shift: ScheduleShift?,
        ) {
            bindDot(views, R.id.widget_dot, payload.state)
            // Вертикальный «светофор» слева: состояние сети видно краем глаза.
            setAccent(views, payload.state)
            bindHeader(views, payload, metrics)
            views.setTextViewText(R.id.widget_pill, payload.pill)
            bindTimer(context, views, payload, timerSp = 24f)
            views.setTextViewText(R.id.widget_detail, detailLabel(context, payload, shift))
            setScale(views, squiggly = false, payload = payload)

            widgetAction(context, WidgetActionReceiver.ACTION_CYCLE_BOOKMARK)?.let {
                views.setOnClickPendingIntent(R.id.widget_cycle, it)
            }
        }

        private fun bindCommand(
            context: Context,
            views: RemoteViews,
            payload: WidgetPayload,
            metrics: WidgetMetrics,
            shift: ScheduleShift?,
        ) {
            bindDot(views, R.id.widget_dot, payload.state)
            // Вертикальный «светофор» слева: состояние сети видно краем глаза.
            setAccent(views, payload.state)
            bindHeader(views, payload, metrics)
            views.setTextViewText(R.id.widget_pill, payload.pill)
            bindTimer(context, views, payload, timerSp = 24f)
            views.setTextViewText(R.id.widget_detail, detailLabel(context, payload, shift))

            val todayValue = outageLabel(context, payload.todayOffMinutes, context.getString(R.string.widget_no_data))
            // Плитка «Завтра»: три стани, які не можна змішувати.
            //  - графіка ще немає → «Графік очікується» + коли він з'явиться (вечір);
            //  - графік є, відключень немає → «Без відключень», другий рядок ховаємо: обіцянка
            //    «Оновиться ввечері» тут була б неправдою, бо графік уже опубліковано;
            //  - інакше → сумарні хвилини + точні вікна.
            val tomorrowPending = payload.windowsTomorrow.isEmpty() && payload.tomorrowOffMinutes == null
            val tomorrowValue: String
            val tomorrowWindows: String
            when {
                tomorrowPending -> {
                    tomorrowValue = context.getString(R.string.widget_schedule_pending)
                    tomorrowWindows = context.getString(R.string.widget_schedule_evening)
                }
                payload.tomorrowOffMinutes == 0 -> {
                    tomorrowValue = context.getString(R.string.widget_no_outages)
                    tomorrowWindows = ""
                }
                else -> {
                    tomorrowValue = outageLabel(
                        context,
                        payload.tomorrowOffMinutes,
                        context.getString(R.string.widget_no_data),
                    )
                    // Пусто — у снімку немає жодного вікна: порожній рядок краще за хибне
                    // «Без відключень» поруч із «30 хв без світла».
                    tomorrowWindows = if (payload.windowsTomorrow.isEmpty()) {
                        ""
                    } else {
                        windowsLabel(context, payload.windowsTomorrow)
                    }
                }
            }
            val todayWindows = windowsLabel(context, payload.windowsToday)
            views.setTextViewText(R.id.widget_today_value, todayValue)
            views.setTextViewText(R.id.widget_tomorrow_value, tomorrowValue)
            // Другий рядок плитки ховаємо, якщо він порожній або повторює перший: інакше
            // «Без відключень» друкувалось двічі (жирним і сірим), а «Графік очікується» — теж.
            if (shouldShowWindows(todayWindows, todayValue)) {
                views.setViewVisibility(R.id.widget_today_windows, View.VISIBLE)
                views.setTextViewText(R.id.widget_today_windows, todayWindows)
            } else {
                views.setViewVisibility(R.id.widget_today_windows, View.GONE)
            }
            if (shouldShowWindows(tomorrowWindows, tomorrowValue)) {
                views.setViewVisibility(R.id.widget_tomorrow_windows, View.VISIBLE)
                views.setTextViewText(R.id.widget_tomorrow_windows, tomorrowWindows)
            } else {
                views.setViewVisibility(R.id.widget_tomorrow_windows, View.GONE)
            }
            setScale(views, squiggly = false, payload = payload)

            widgetAction(context, WidgetActionReceiver.ACTION_CYCLE_BOOKMARK)?.let {
                views.setOnClickPendingIntent(R.id.widget_place_group, it)
            }
            widgetAction(context, WidgetActionReceiver.ACTION_OPEN_APP)?.let {
                views.setOnClickPendingIntent(R.id.widget_today_tile, it)
                views.setOnClickPendingIntent(R.id.widget_tomorrow_tile, it)
            }
        }

        /**
         * Второй рядок плитки показуємо, лише якщо він не повторює перший.
         *
         * Заголовок плитки відповідає «скільки», підпис — «коли». Коли «коли» немає (графіка
         * на добу не опубліковано), підпис несе «коли буде графік», а не дубль заголовка.
         */
        private fun shouldShowWindows(text: String, value: String): Boolean =
            text.isNotBlank() && text != value

        private fun bindPlaces(context: Context, views: RemoteViews, payload: WidgetPayload) {
            val places = payload.places.take(3)
            val rows = intArrayOf(
                R.id.widget_place_row_1,
                R.id.widget_place_row_2,
                R.id.widget_place_row_3,
            )
            views.setViewVisibility(
                R.id.widget_empty,
                if (places.isEmpty()) View.VISIBLE else View.GONE,
            )
            rows.forEachIndexed { index, rowId ->
                val place = places.getOrNull(index)
                if (place == null) {
                    views.setViewVisibility(rowId, View.GONE)
                    return@forEachIndexed
                }
                views.setViewVisibility(rowId, View.VISIBLE)
                // Иконка типа места — отдельный ImageView, а не эмодзи в тексте: иначе
                // на HyperOS один и тот же значок дублировался и превращался в «тофу».
                views.setInt(
                    rowId,
                    "setBackgroundResource",
                    WidgetStyle.rowBackground(place.state),
                )
                views.setTextViewText(
                    labelId(index),
                    context.getString(R.string.widget_place_join, place.label, place.queue),
                )
                views.setImageViewResource(iconId(index), WidgetStyle.placeIcon(place.icon))
                bindDot(views, dotId(index), place.state)
                views.setTextViewText(statusId(index), place.statusText)
                views.setTextViewText(timeId(index), place.timeLabel)
                views.setTextColor(statusId(index), WidgetStyle.color(place.state))
                widgetAction(context, WidgetActionReceiver.ACTION_OPEN_APP)?.let {
                    views.setOnClickPendingIntent(rowId, it)
                }
            }
        }

        private fun bindDot(views: RemoteViews, id: Int, state: String) {
            views.setImageViewResource(id, WidgetStyle.dot(state))
        }

        /**
         * Клік по зоні: explicit broadcast у [WidgetActionReceiver].
         *
         * `FLAG_IMMUTABLE` обязателен с Android 12, иначе система бросает исключение при
         * создании `PendingIntent`. Request code — хеш действия, чтобы три зоны не перетирали
         * друг друга через `FLAG_UPDATE_CURRENT`.
         */
        private fun widgetAction(context: Context, action: String): PendingIntent? {
            val intent = Intent(context, WidgetActionReceiver::class.java).setAction(action)
            return try {
                PendingIntent.getBroadcast(
                    context,
                    action.hashCode(),
                    intent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                )
            } catch (error: Exception) {
                Log.w(TAG, "widgetAction PendingIntent failed for $action", error)
                null
            }
        }

        private fun labelId(index: Int): Int = when (index) {
            0 -> R.id.widget_place_label_1
            1 -> R.id.widget_place_label_2
            else -> R.id.widget_place_label_3
        }

        private fun dotId(index: Int): Int = when (index) {
            0 -> R.id.widget_place_dot_1
            1 -> R.id.widget_place_dot_2
            else -> R.id.widget_place_dot_3
        }

        private fun iconId(index: Int): Int = when (index) {
            0 -> R.id.widget_place_icon_1
            1 -> R.id.widget_place_icon_2
            else -> R.id.widget_place_icon_3
        }

        private fun statusId(index: Int): Int = when (index) {
            0 -> R.id.widget_place_status_1
            1 -> R.id.widget_place_status_2
            else -> R.id.widget_place_status_3
        }

        private fun timeId(index: Int): Int = when (index) {
            0 -> R.id.widget_place_time_1
            1 -> R.id.widget_place_time_2
            else -> R.id.widget_place_time_3
        }
    }
}

/** 2×1: «Капсула-Датчик». */
class SvitloWidget2x1 : SvitloWidgetProvider() {
    override val layoutId: Int get() = R.layout.svitlo_widget_capsule
}

/** 4×1: «Таймлайн Суток». */
class SvitloWidget4x1 : SvitloWidgetProvider() {
    override val layoutId: Int get() = R.layout.svitlo_widget_timeline
}

/** 4×2: «Командний Центр». */
class SvitloWidget4x2 : SvitloWidgetProvider() {
    override val layoutId: Int get() = R.layout.svitlo_widget_command
}

/** 4×2: «Радар Моїх Місць» — отдельный пункт в списке виджетов. */
class SvitloWidgetPlaces4x2 : SvitloWidgetProvider() {
    override val layoutId: Int get() = R.layout.svitlo_widget_places
}

/** 2×2: «Наступна Зміна» — огромный таймер и шкала доби. */
class SvitloWidgetEvent2x2 : SvitloWidgetProvider() {
    override val layoutId: Int get() = R.layout.svitlo_widget_event
}
