package ua.com.svitlo.app.widget

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager
import java.util.Collections

/**
 * Регистрация `SvitloWidget` в `MainApplication` — добавку делает config-plugin
 * `withAndroidWidget`, потому что сгенерированный android/ перезаписывается prebuild'ом.
 */
class SvitloWidgetPackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
        listOf(SvitloWidgetModule(reactContext))

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
        Collections.emptyList()
}
