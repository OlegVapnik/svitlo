package ua.com.svitlo.app.live

import android.app.StatusBarManager
import android.content.ComponentName
import android.graphics.drawable.Icon
import android.os.Build
import android.util.Log
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import androidx.core.app.NotificationManagerCompat
import ua.com.svitlo.app.R

/**
 * Мост `SvitloLive`: тумблер «Статус в шторці», запрос разрешения уведомлений и добавление
 * QS-плитки в шторку (requestAddTileService, Android 13+).
 *
 * Сама плашка обновляется вне JS — из тиков виджетов; модулю остаётся только включение,
 * отключение и кнопки настроек.
 */
class SvitloLiveModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = NAME

    @ReactMethod
    fun setEnabled(enabled: Boolean) {
        val context = reactApplicationContext.applicationContext
        LivePrefs.setEnabled(context, enabled)
        if (enabled) {
            SvitloLiveStatus.ensureTicking(context)
            SvitloLiveStatus.updateAll(context)
        } else {
            SvitloLiveStatus.cancel(context)
        }
    }

    @ReactMethod
    fun isLiveEnabled(promise: Promise) {
        promise.resolve(LivePrefs.isEnabled(reactApplicationContext))
    }

    @ReactMethod
    fun hasNotificationPermission(promise: Promise) {
        promise.resolve(
            runCatching {
                NotificationManagerCompat.from(reactApplicationContext).areNotificationsEnabled()
            }.getOrDefault(false),
        )
    }

    /**
     * Просит систему показать кнопку добавления плитки. Возвращает true, если плитка уже
     * добавлена либо запрос ушёл; false — на старых API или в системах без StatusBarManager.
     */
    @ReactMethod
    fun requestAddTile(promise: Promise) {
        val context = reactApplicationContext.applicationContext
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            promise.resolve(false)
            return
        }
        val added = runCatching {
            val manager = context.getSystemService(StatusBarManager::class.java) ?: return@runCatching false
            val icon = Icon.createWithResource(context, R.drawable.ic_qs_svitlo)
            val component = ComponentName(context, SvitloTileService::class.java)
            // Сигнатура: (ComponentName, CharSequence label, Icon, Executor, Consumer<Integer>).
            manager.requestAddTileService(
                component,
                context.getString(R.string.live_tile_label),
                icon,
                context.mainExecutor,
            ) { result -> Log.d(TAG, "requestAddTileService result: $result") }
            true
        }
        if (added.getOrDefault(false)) {
            // Плитка могла добавиться позже: просим перечитать состояние на всякий случай.
            SvitloTileService.requestUpdate(context)
        }
        promise.resolve(added.getOrDefault(false))
    }

    companion object {
        private const val TAG = "SvitloLive"
        const val NAME = "SvitloLive"
    }
}
