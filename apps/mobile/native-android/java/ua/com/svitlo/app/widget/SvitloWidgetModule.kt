package ua.com.svitlo.app.widget

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import ua.com.svitlo.app.R

/**
 * JS-мост виджета.
 *
 * `update` вызывается с главного экрана при каждом изменении состояния: данные ложатся в
 * `SharedPreferences`, после чего все экземпляры перерисовываются. `consumeAction` отдаёт
 * действие, сохранённое кликом по зоне виджета, и сразу очищает его — повторного срабатывания
 * при следующем открытии не будет.
 */
class SvitloWidgetModule(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context) {

    override fun getName(): String = NAME

    /**
     * Имя иконки постоянной плашки — единственная статическая ссылка на `R.drawable.ic_stat_svitlo`.
     *
     * Зачем это здесь: Notifee принимает иконку строкой из JS, и для resource shrinker такой
     * ресурс «не используется». В release-сборке drawable вырезался, Notifee не находил его —
     * и плашка в шторке не появлялась вовсе. `getResourceEntryName` и есть та ссылка, которая
     * удерживает иконку в APK (плюс JS получает имя из одного источника, а не из магической
     * строки в двух местах).
     */
    override fun getConstants(): Map<String, Any> = mapOf(
        "notificationIcon" to context.resources.getResourceEntryName(R.drawable.ic_stat_svitlo),
    )

    @ReactMethod
    fun update(payload: String) {
        WidgetPrefs.writePayload(context, payload)
        SvitloWidgetProvider.updateAll(context)
    }

    @ReactMethod
    fun consumeAction(promise: Promise) {
        promise.resolve(WidgetPrefs.consumeAction(context))
    }

    /** Сброс данных (например, при выходе из аккаунта черги): виджет вернётся к заглушке. */
    @ReactMethod
    fun clear() {
        WidgetPrefs.clear(context)
        SvitloWidgetProvider.updateAll(context)
    }

    companion object {
        const val NAME = "SvitloWidget"
    }
}
